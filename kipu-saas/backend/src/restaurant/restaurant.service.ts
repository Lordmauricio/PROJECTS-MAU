import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { createHash } from 'node:crypto';
import { Prisma } from '../../generated/prisma/client';
import { TenantPrismaService } from '../prisma/tenant-prisma.service';
import { SalesService } from '../sales/sales.service';
import { ConfirmSaleDto } from '../sales/dto/payment.dto';
import { money, ZERO_MONEY } from '../common/money';
import {
  ComponentDto,
  CreateOrderDto,
  ListOrdersDto,
  MenuOptionDto,
  SaveMenuEntryDto,
  TransitionOrderDto,
} from './restaurant.dto';

const orderInclude = {
  sale: { include: { payments: true } },
  events: { orderBy: { createdAt: 'asc' as const } },
};

@Injectable()
export class RestaurantService {
  constructor(
    private readonly tenant: TenantPrismaService,
    private readonly sales: SalesService,
  ) {}

  menu(organizationId: string, warehouseId?: string) {
    return this.tenant.run(organizationId, async (tx) => {
      if (
        warehouseId &&
        !(await tx.warehouse.findFirst({
          where: { id: warehouseId, organizationId },
        }))
      )
        throw new BadRequestException('Almacén no encontrado');
      const entries = await tx.menuEntry.findMany({
        where: { organizationId },
        orderBy: [{ category: 'asc' }, { name: 'asc' }],
      });
      const stocks = warehouseId
        ? await tx.inventory.findMany({
            where: { organizationId, warehouseId },
          })
        : [];
      const quantities = new Map(
        stocks.map((row) => [row.productId, row.quantity]),
      );
      const products = await tx.product.findMany({
        where: { organizationId, active: true },
        select: { id: true },
      });
      const active = new Set(products.map((p) => p.id));
      return entries.map((entry) => {
        const components = entry.components as unknown as ComponentDto[];
        const available =
          !active.has(entry.productId) ||
          components.some((c) => !active.has(c.productId))
            ? 0
            : warehouseId
              ? Math.max(
                  0,
                  Math.min(
                    ...components.map((c) =>
                      Math.floor(
                        Number(quantities.get(c.productId) ?? 0) / c.quantity,
                      ),
                    ),
                  ),
                )
              : null;
        return { ...entry, available };
      });
    });
  }

  saveMenu(
    organizationId: string,
    actorUserId: string,
    dto: SaveMenuEntryDto,
    id?: string,
  ) {
    return this.tenant.run(organizationId, async (tx) => {
      if (
        id &&
        !(await tx.menuEntry.findFirst({ where: { id, organizationId } }))
      )
        throw new NotFoundException('Plato no encontrado');
      const uniqueComponents = (components: ComponentDto[]) =>
        new Set(components.map((c) => c.productId)).size === components.length;
      if (
        !uniqueComponents(dto.components) ||
        dto.options.some((o) => !uniqueComponents(o.components))
      )
        throw new BadRequestException(
          'No repitas un producto dentro de una composición',
        );
      if (new Set(dto.options.map((o) => o.id)).size !== dto.options.length)
        throw new BadRequestException(
          'Las opciones deben tener identificadores únicos',
        );
      if (
        dto.options.some(
          (o) =>
            o.replacesProductId &&
            !dto.components.some((c) => c.productId === o.replacesProductId),
        )
      )
        throw new BadRequestException(
          'Una sustitución debe reemplazar un componente del plato',
        );
      const ids = [
        ...new Set([
          dto.productId,
          ...dto.components.map((c) => c.productId),
          ...dto.options.flatMap((o) => o.components.map((c) => c.productId)),
        ]),
      ];
      const count = await tx.product.count({
        where: { organizationId, id: { in: ids }, active: true },
      });
      if (count !== ids.length)
        throw new BadRequestException(
          'Los productos deben estar activos y pertenecer a esta empresa',
        );
      const data = {
        ...dto,
        components: dto.components.map((c) => ({
          productId: c.productId,
          quantity: c.quantity,
        })),
        options: dto.options.map((o) => ({
          id: o.id,
          name: o.name,
          price: o.price,
          ...(o.replacesProductId
            ? { replacesProductId: o.replacesProductId }
            : {}),
          components: o.components.map((c) => ({
            productId: c.productId,
            quantity: c.quantity,
          })),
        })),
      };
      const entry = id
        ? await tx.menuEntry.update({ where: { id }, data })
        : await tx.menuEntry.create({ data: { organizationId, ...data } });
      // Local events and snapshots commit with business state; no queue dependency.
      await tx.auditLog.create({
        data: {
          organizationId,
          userId: actorUserId,
          action: id ? 'menu.update' : 'menu.create',
          entityType: 'MenuEntry',
          entityId: entry.id,
        },
      });
      return entry;
    });
  }

  list(organizationId: string, filters: ListOrdersDto) {
    return this.tenant.run(organizationId, (tx) =>
      tx.restaurantOrder.findMany({
        where: {
          organizationId,
          ...filters,
          ...(!filters.status
            ? {
                status: { notIn: ['DELIVERED' as const, 'CANCELLED' as const] },
              }
            : {}),
        },
        include: orderInclude,
        orderBy: { createdAt: 'desc' },
        take: 100,
      }),
    );
  }

  findOne(organizationId: string, id: string) {
    return this.tenant.run(organizationId, async (tx) => {
      const order = await tx.restaurantOrder.findFirst({
        where: { id, organizationId },
        include: orderInclude,
      });
      if (!order) throw new NotFoundException('Pedido no encontrado');
      return order;
    });
  }

  create(organizationId: string, actorUserId: string, dto: CreateOrderDto) {
    const requestHash = createHash('sha256')
      .update(
        JSON.stringify([
          dto.posTerminalId,
          dto.warehouseId,
          dto.service,
          dto.customerName ?? '',
          dto.notes ?? '',
          dto.discount ?? 0,
          dto.items.map((item) => [
            item.menuEntryId,
            item.quantity,
            [...item.optionIds].sort(),
          ]),
        ]),
      )
      .digest('hex');
    return this.tenant.run(organizationId, async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${organizationId}), hashtext(${dto.requestKey}))`;
      const existing = await tx.restaurantOrder.findUnique({
        where: {
          organizationId_requestKey: {
            organizationId,
            requestKey: dto.requestKey,
          },
        },
        include: orderInclude,
      });
      if (existing) {
        if (existing.requestHash !== requestHash)
          throw new ConflictException(
            'La clave de reintento ya pertenece a otro pedido',
          );
        return existing;
      }
      const terminal = await tx.pOSTerminal.findFirst({
        where: { id: dto.posTerminalId, organizationId, active: true },
      });
      const warehouse = await tx.warehouse.findFirst({
        where: { id: dto.warehouseId, organizationId },
      });
      if (!terminal || !warehouse || terminal.branchId !== warehouse.branchId)
        throw new BadRequestException(
          'El punto de venta y almacén deben pertenecer a la misma sucursal',
        );
      const ids = [...new Set(dto.items.map((i) => i.menuEntryId))].sort();
      await tx.$queryRaw`SELECT id FROM menu_entries WHERE "organizationId" = ${organizationId} AND id IN (${Prisma.join(ids)}) ORDER BY id FOR SHARE`;
      const entries = await tx.menuEntry.findMany({
        where: { id: { in: ids }, organizationId, active: true },
      });
      if (entries.length !== ids.length)
        throw new BadRequestException('Uno o más platos no están disponibles');
      const byId = new Map(entries.map((entry) => [entry.id, entry]));
      const products = await tx.product.findMany({
        where: { organizationId, active: true },
        select: { id: true, name: true },
      });
      const names = new Map(products.map((p) => [p.id, p.name]));
      const snapshots = dto.items.map((line) => {
        const entry = byId.get(line.menuEntryId)!;
        const options = entry.options as unknown as MenuOptionDto[];
        const selected = line.optionIds.map((id) => {
          const found = options.find((option) => option.id === id);
          if (!found)
            throw new BadRequestException(
              'Opción no disponible para este plato',
            );
          return found;
        });
        const replacements = selected.flatMap((o) =>
          o.replacesProductId ? [o.replacesProductId] : [],
        );
        if (new Set(replacements).size !== replacements.length)
          throw new BadRequestException(
            'Elige una sola sustitución por componente',
          );
        const base = (entry.components as unknown as ComponentDto[]).filter(
          (c) => !replacements.includes(c.productId),
        );
        const quantities = new Map<string, Prisma.Decimal>();
        for (const component of [
          ...base,
          ...selected.flatMap((o) => o.components),
        ])
          quantities.set(
            component.productId,
            (quantities.get(component.productId) ?? ZERO_MONEY).add(
              money(component.quantity),
            ),
          );
        if (
          !names.has(entry.productId) ||
          [...quantities.keys()].some((id) => !names.has(id))
        )
          throw new BadRequestException(
            'Un producto del plato está desactivado',
          );
        const unitPrice = selected.reduce(
          (sum, o) => sum.add(money(o.price)),
          money(entry.price),
        );
        return {
          menuEntryId: entry.id,
          productId: entry.productId,
          name: entry.name,
          category: entry.category,
          station: entry.station,
          quantity: line.quantity,
          unitPrice: unitPrice.toFixed(2),
          subtotal: unitPrice.mul(line.quantity).toFixed(2),
          options: selected.map((o) => ({
            id: o.id,
            name: o.name,
            price: money(o.price).toFixed(2),
          })),
          components: [...quantities].map(([productId, quantity]) => ({
            productId,
            name: names.get(productId)!,
            quantity: quantity.toFixed(2),
          })),
        };
      });
      const subtotal = snapshots.reduce(
        (sum, line) => sum.add(money(line.subtotal)),
        ZERO_MONEY,
      );
      const discount = money(dto.discount ?? 0);
      if (discount.gt(subtotal))
        throw new BadRequestException(
          'El descuento no puede superar el subtotal',
        );
      if (discount.gt(0)) {
        const membership = await tx.organizationUser.findFirst({
          where: { organizationId, userId: actorUserId, status: 'ACTIVE' },
        });
        const authorized =
          membership &&
          (await tx.rolePermission.findFirst({
            where: {
              organizationId,
              roleId: membership.roleId,
              permission: { key: 'sales.update' },
            },
          }));
        if (!authorized)
          throw new ForbiddenException(
            'El descuento requiere autorización de un encargado con sales.update',
          );
      }
      const total = subtotal.sub(discount);
      if (subtotal.gt('9999999999.99'))
        throw new BadRequestException(
          'El pedido supera el importe máximo permitido',
        );
      const sale = await tx.sale.create({
        data: {
          organizationId,
          posTerminalId: terminal.id,
          warehouseId: warehouse.id,
          subtotal,
          discount,
          total,
          createdById: actorUserId,
          items: {
            create: snapshots.map((line) => ({
              organizationId,
              productId: line.productId,
              productName: [line.name, ...line.options.map((o) => o.name)].join(
                ' · ',
              ),
              quantity: line.quantity,
              unitPrice: line.unitPrice,
              subtotal: line.subtotal,
              stockComponents: line.components.map((c) => ({
                productId: c.productId,
                quantity: c.quantity,
              })),
            })),
          },
        },
      });
      return tx.restaurantOrder.create({
        data: {
          organizationId,
          branchId: terminal.branchId,
          saleId: sale.id,
          requestKey: dto.requestKey,
          requestHash,
          service: dto.service,
          customerName: dto.customerName,
          notes: dto.notes,
          snapshot: snapshots,
          events: {
            create: { organizationId, action: 'CREATED', actorUserId },
          },
        },
        include: orderInclude,
      });
    });
  }

  async checkout(
    organizationId: string,
    actorUserId: string,
    id: string,
    dto: ConfirmSaleDto,
  ) {
    const paymentKeys = (dto.payments ?? []).map(
      (payment) => payment.idempotencyKey,
    );
    if (new Set(paymentKeys).size !== paymentKeys.length)
      throw new BadRequestException(
        'Cada método de pago necesita una clave distinta',
      );
    const order = await this.findOne(organizationId, id);
    if (order.status === 'CANCELLED')
      throw new ConflictException('Pedido cancelado');
    const amount = (dto.payments ?? []).reduce(
      (sum, payment) => sum.add(money(payment.amount)),
      ZERO_MONEY,
    );
    if (order.sale.status === 'DRAFT' && !amount.eq(order.sale.total))
      throw new BadRequestException(
        'El cobro debe cubrir exactamente el total; entrega el cambio en efectivo por separado',
      );
    const sale = await this.sales.confirm(
      organizationId,
      order.saleId,
      dto,
      actorUserId,
    );
    if (sale.status !== 'PAID')
      throw new ConflictException(
        'El pedido debe estar pagado antes de entrar a cocina',
      );
    return this.tenant.run(organizationId, async (tx) => {
      await this.lock(tx, organizationId, id);
      const currentSale = await tx.sale.findFirstOrThrow({
        where: { id: order.saleId, organizationId },
      });
      if (currentSale.status !== 'PAID')
        throw new ConflictException('La venta ya no está pagada');
      const changed = await tx.restaurantOrder.updateMany({
        where: { id, organizationId, status: 'DRAFT' },
        data: {
          status: 'QUEUED',
          queuedAt: new Date(),
          version: { increment: 1 },
        },
      });
      if (changed.count)
        await tx.restaurantOrderEvent.create({
          data: { organizationId, orderId: id, action: 'QUEUED', actorUserId },
        });
      return tx.restaurantOrder.findFirstOrThrow({
        where: { id, organizationId },
        include: orderInclude,
      });
    });
  }

  transition(
    organizationId: string,
    actorUserId: string,
    id: string,
    dto: TransitionOrderDto,
  ) {
    return this.tenant.run(organizationId, async (tx) => {
      const order = await this.lock(tx, organizationId, id);
      if (order.status === dto.status && order.version === dto.version + 1)
        return tx.restaurantOrder.findFirstOrThrow({
          where: { id, organizationId },
          include: orderInclude,
        });
      const previous = {
        PREPARING: 'QUEUED',
        READY: 'PREPARING',
        DELIVERED: 'READY',
      };
      if (
        order.version !== dto.version ||
        order.status !== previous[dto.status]
      )
        throw new ConflictException(
          'El pedido cambió. Actualiza el tablero antes de continuar',
        );
      const sale = await tx.sale.findFirstOrThrow({
        where: { id: order.saleId, organizationId },
      });
      if (sale.status !== 'PAID')
        throw new ConflictException(
          'La venta ya no está pagada; revisa su devolución o cancelación',
        );
      const now = new Date();
      await tx.restaurantOrder.update({
        where: { id },
        data: {
          status: dto.status,
          version: { increment: 1 },
          ...(dto.status === 'PREPARING'
            ? { preparingAt: now }
            : dto.status === 'READY'
              ? { readyAt: now }
              : { deliveredAt: now }),
        },
      });
      await tx.restaurantOrderEvent.create({
        data: { organizationId, orderId: id, action: dto.status, actorUserId },
      });
      return tx.restaurantOrder.findFirstOrThrow({
        where: { id, organizationId },
        include: orderInclude,
      });
    });
  }

  async cancel(
    organizationId: string,
    actorUserId: string,
    id: string,
    reason: string,
  ) {
    const order = await this.findOne(organizationId, id);
    if (order.status === 'CANCELLED') return order;
    if (order.status !== 'DRAFT')
      throw new ConflictException(
        'Un pedido pagado requiere devolución desde la venta; no se repone comida preparada automáticamente',
      );
    await this.sales.cancel(organizationId, order.saleId, actorUserId);
    return this.tenant.run(organizationId, async (tx) => {
      await this.lock(tx, organizationId, id);
      const changed = await tx.restaurantOrder.updateMany({
        where: { id, organizationId, status: 'DRAFT' },
        data: { status: 'CANCELLED', version: { increment: 1 } },
      });
      if (changed.count)
        await tx.restaurantOrderEvent.create({
          data: {
            organizationId,
            orderId: id,
            action: 'CANCELLED',
            actorUserId,
            detail: reason,
          },
        });
      return tx.restaurantOrder.findFirstOrThrow({
        where: { id, organizationId },
        include: orderInclude,
      });
    });
  }

  print(organizationId: string, actorUserId: string, id: string) {
    return this.tenant.run(organizationId, async (tx) => {
      await this.lock(tx, organizationId, id);
      const order = await tx.restaurantOrder.update({
        where: { id },
        data: { printCount: { increment: 1 } },
        include: orderInclude,
      });
      await tx.restaurantOrderEvent.create({
        data: {
          organizationId,
          orderId: id,
          action: order.printCount === 1 ? 'PRINT' : 'REPRINT',
          actorUserId,
          detail: `Copia ${order.printCount}`,
        },
      });
      return order;
    });
  }

  private async lock(
    tx: Prisma.TransactionClient,
    organizationId: string,
    id: string,
  ) {
    const rows = await tx.$queryRaw<
      Array<{ id: string; saleId: string; status: string; version: number }>
    >`SELECT id, "saleId", status, version FROM restaurant_orders WHERE id = ${id} AND "organizationId" = ${organizationId} FOR UPDATE`;
    if (!rows[0]) throw new NotFoundException('Pedido no encontrado');
    return rows[0];
  }
}
