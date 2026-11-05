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
import { InventoryService } from '../inventory/inventory.service';
import { SalesService } from '../sales/sales.service';
import { stockComponents } from './stock-components';
import { money } from '../common/money';
import {
  SaveTableDto,
  OpenAccountDto,
  MoveAccountDto,
  AssignWaiterDto,
  SplitAccountDto,
  MergeAccountDto,
  CloseAccountDto,
} from './dining.dto';
import { CreatePaymentDto } from '../sales/dto/payment.dto';
const include = {
  table: true,
  orders: {
    include: { sale: { include: { payments: true } }, tasks: true },
    orderBy: { createdAt: 'asc' as const },
  },
};
const hash = (value: unknown) =>
  createHash('sha256').update(JSON.stringify(value)).digest('hex');
type Tx = Prisma.TransactionClient;
@Injectable()
export class DiningService {
  constructor(
    private readonly tenant: TenantPrismaService,
    private readonly inventory: InventoryService,
    private readonly sales: SalesService,
  ) {}
  waiters(org: string) {
    return this.tenant.run(org, (tx) =>
      tx.organizationUser.findMany({
        where: { organizationId: org, status: 'ACTIVE' },
        select: { userId: true, user: { select: { name: true } } },
      }),
    );
  }
  tables(org: string, branchId?: string) {
    return this.tenant.run(org, (tx) =>
      tx.diningTable.findMany({
        where: { organizationId: org, ...(branchId ? { branchId } : {}) },
        orderBy: [{ area: 'asc' }, { name: 'asc' }],
        include: {
          accounts: {
            where: { status: 'OPEN' },
            select: { id: true, label: true, waiterName: true },
          },
        },
      }),
    );
  }
  saveTable(org: string, actor: string, dto: SaveTableDto, id?: string) {
    return this.tenant.run(org, async (tx) => {
      if (
        !dto.name.trim() ||
        !dto.area.trim() ||
        !(await tx.branch.findFirst({
          where: { id: dto.branchId, organizationId: org },
        }))
      )
        throw new BadRequestException('Nombre, zona o sucursal inválidos');
      if (id) {
        const table = await tx.diningTable.findFirst({
          where: { id, organizationId: org },
        });
        if (!table) throw new NotFoundException('Mesa no encontrada');
        if (table.branchId !== dto.branchId)
          throw new BadRequestException('La sucursal de una mesa no se cambia');
      }
      // Serialize names within the branch, including first creation.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${org}), hashtext(${dto.branchId}))`;
      if (
        await tx.diningTable.findFirst({
          where: {
            organizationId: org,
            branchId: dto.branchId,
            name: dto.name.trim(),
            ...(id ? { id: { not: id } } : {}),
          },
        })
      )
        throw new ConflictException('Ya existe una mesa con ese nombre');
      const data = { ...dto, name: dto.name.trim(), area: dto.area.trim() };
      const table = id
        ? await tx.diningTable.update({ where: { id }, data })
        : await tx.diningTable.create({
            data: { organizationId: org, ...data },
          });
      await this.audit(tx, org, actor, table.id, 'dining.table.save');
      return table;
    });
  }
  list(org: string, branchId?: string) {
    return this.tenant.run(org, (tx) =>
      tx.diningAccount.findMany({
        where: {
          organizationId: org,
          status: 'OPEN',
          ...(branchId ? { branchId } : {}),
        },
        include,
        orderBy: { createdAt: 'asc' },
      }),
    );
  }
  get(org: string, id: string) {
    return this.tenant.run(org, (tx) => this.load(tx, org, id));
  }
  async waiter(tx: Tx, org: string, userId: string) {
    const member = await tx.organizationUser.findFirst({
      where: { organizationId: org, userId, status: 'ACTIVE' },
      include: { user: true },
    });
    if (!member)
      throw new BadRequestException('Mesero no activo en esta empresa');
    return member.user.name;
  }
  open(org: string, actor: string, dto: OpenAccountDto) {
    return this.tenant.run(org, async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${org}), hashtext(${dto.requestKey}))`;
      const requestHash = hash([
        dto.tableId,
        dto.posTerminalId,
        dto.warehouseId,
        dto.label,
        dto.waiterId ?? actor,
      ]);
      const existing = await tx.diningAccount.findUnique({
        where: {
          organizationId_requestKey: {
            organizationId: org,
            requestKey: dto.requestKey,
          },
        },
      });
      if (existing) {
        if (existing.requestHash !== requestHash)
          throw new ConflictException('Clave utilizada con otros datos');
        return this.load(tx, org, existing.id);
      }
      const table = await tx.diningTable.findFirst({
        where: { id: dto.tableId, organizationId: org, active: true },
      });
      const terminal = await tx.pOSTerminal.findFirst({
        where: { id: dto.posTerminalId, organizationId: org, active: true },
      });
      const warehouse = await tx.warehouse.findFirst({
        where: { id: dto.warehouseId, organizationId: org },
      });
      if (
        !table ||
        !terminal ||
        !warehouse ||
        table.branchId !== terminal.branchId ||
        table.branchId !== warehouse.branchId ||
        !dto.label.trim()
      )
        throw new BadRequestException(
          'Mesa, terminal y almacén deben ser de la misma sucursal',
        );
      if (dto.waiterId && dto.waiterId !== actor) {
        const member = await tx.organizationUser.findFirst({
          where: { organizationId: org, userId: actor, status: 'ACTIVE' },
        });
        const canAssign =
          member &&
          (await tx.rolePermission.findFirst({
            where: {
              organizationId: org,
              roleId: member.roleId,
              permission: { key: 'sales.update' },
            },
          }));
        if (!canAssign)
          throw new ForbiddenException(
            'Asignar otro mesero requiere autorización de encargado',
          );
      }
      const waiterId = dto.waiterId ?? actor;
      const waiterName = await this.waiter(tx, org, waiterId);
      const account = await tx.diningAccount.create({
        data: {
          organizationId: org,
          tableId: table.id,
          branchId: table.branchId,
          posTerminalId: terminal.id,
          warehouseId: warehouse.id,
          label: dto.label.trim(),
          waiterId,
          waiterName,
          requestKey: dto.requestKey,
          requestHash,
        },
      });
      await this.audit(tx, org, actor, account.id, 'dining.open');
      return this.load(tx, org, account.id);
    });
  }
  move(org: string, actor: string, id: string, dto: MoveAccountDto) {
    return this.tenant.run(org, async (tx) => {
      const a = await this.lock(tx, org, id, dto.version);
      const table = await tx.diningTable.findFirst({
        where: {
          id: dto.tableId,
          organizationId: org,
          branchId: a.branchId,
          active: true,
        },
      });
      if (!table) throw new BadRequestException('Mesa de destino inválida');
      await tx.diningAccount.update({
        where: { id },
        data: { tableId: table.id, version: { increment: 1 } },
      });
      await this.audit(
        tx,
        org,
        actor,
        id,
        'dining.move',
        `${a.tableId} → ${table.id}`,
      );
      return this.load(tx, org, id);
    });
  }
  assign(org: string, actor: string, id: string, dto: AssignWaiterDto) {
    return this.tenant.run(org, async (tx) => {
      await this.lock(tx, org, id, dto.version);
      const waiterName = await this.waiter(tx, org, dto.waiterId);
      await tx.diningAccount.update({
        where: { id },
        data: { waiterId: dto.waiterId, waiterName, version: { increment: 1 } },
      });
      await this.audit(tx, org, actor, id, 'dining.assign', dto.waiterId);
      return this.load(tx, org, id);
    });
  }
  split(org: string, actor: string, id: string, dto: SplitAccountDto) {
    return this.tenant.run(org, async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${org}), hashtext(${dto.requestKey}))`;
      const requestHash = hash([
        id,
        dto.version,
        dto.label,
        [...dto.orderIds].sort(),
      ]);
      const existing = await tx.diningAccount.findUnique({
        where: {
          organizationId_requestKey: {
            organizationId: org,
            requestKey: dto.requestKey,
          },
        },
      });
      if (existing) {
        if (existing.requestHash !== requestHash)
          throw new ConflictException('Clave utilizada con otra división');
        return this.load(tx, org, existing.id);
      }
      const a = await this.lock(tx, org, id, dto.version);
      const orders = await tx.restaurantOrder.findMany({
        where: { organizationId: org, accountId: id },
      });
      if (
        !dto.label.trim() ||
        dto.orderIds.length >= orders.length ||
        dto.orderIds.some((oid) => !orders.some((o) => o.id === oid))
      )
        throw new BadRequestException(
          'Selecciona parte de las comandas de esta cuenta',
        );
      const target = await tx.diningAccount.create({
        data: {
          organizationId: org,
          tableId: a.tableId,
          branchId: a.branchId,
          posTerminalId: a.posTerminalId,
          warehouseId: a.warehouseId,
          waiterId: a.waiterId,
          waiterName: a.waiterName,
          label: dto.label.trim(),
          requestKey: dto.requestKey,
          requestHash,
        },
      });
      await tx.restaurantOrder.updateMany({
        where: { organizationId: org, accountId: id, id: { in: dto.orderIds } },
        data: { accountId: target.id },
      });
      await tx.diningAccount.update({
        where: { id },
        data: { version: { increment: 1 } },
      });
      await this.audit(tx, org, actor, id, 'dining.split', target.id);
      return this.load(tx, org, target.id);
    });
  }
  merge(org: string, actor: string, id: string, dto: MergeAccountDto) {
    return this.tenant.run(org, async (tx) => {
      if (id === dto.sourceId)
        throw new BadRequestException('Selecciona otra cuenta');
      // Deterministic account lock order prevents opposite merges deadlocking.
      for (const accountId of [id, dto.sourceId].sort())
        await tx.$queryRaw`SELECT id FROM dining_accounts WHERE id=${accountId} AND "organizationId"=${org} FOR UPDATE`;
      const target = await this.lock(tx, org, id, dto.version);
      const source = await this.lock(tx, org, dto.sourceId, dto.sourceVersion);
      if (
        target.branchId !== source.branchId ||
        target.posTerminalId !== source.posTerminalId ||
        target.warehouseId !== source.warehouseId
      )
        throw new BadRequestException(
          'Las cuentas deben compartir sucursal, terminal y almacén',
        );
      await tx.restaurantOrder.updateMany({
        where: { organizationId: org, accountId: source.id },
        data: { accountId: id },
      });
      await tx.diningAccount.update({
        where: { id: source.id },
        data: {
          status: 'MERGED',
          mergedIntoId: id,
          closedAt: new Date(),
          version: { increment: 1 },
        },
      });
      await tx.diningAccount.update({
        where: { id },
        data: { version: { increment: 1 } },
      });
      await this.audit(tx, org, actor, id, 'dining.merge', source.id);
      return this.load(tx, org, id);
    });
  }
  dispatch(org: string, actor: string, id: string, orderId: string) {
    return this.tenant.run(org, async (tx) => {
      await this.lock(tx, org, id);
      const order = await tx.restaurantOrder.findFirst({
        where: { id: orderId, organizationId: org, accountId: id },
      });
      if (!order)
        throw new NotFoundException('Comanda no encontrada en esta cuenta');
      await tx.$queryRaw`SELECT id FROM sales WHERE id=${order.saleId} AND "organizationId"=${org} FOR UPDATE`;
      await tx.$queryRaw`SELECT id FROM restaurant_orders WHERE id=${orderId} AND "organizationId"=${org} FOR UPDATE`;
      const current = await tx.restaurantOrder.findUniqueOrThrow({
        where: { id: orderId },
      });
      const sale = await tx.sale.findUniqueOrThrow({
        where: { id: order.saleId },
        include: { items: true },
      });
      if (current.status !== 'DRAFT') {
        if (current.status === 'CANCELLED')
          throw new ConflictException('Comanda cancelada');
        return this.load(tx, org, id);
      }
      if (sale.status === 'DRAFT') {
        for (const item of sale.items
          .flatMap(stockComponents)
          .sort((a, b) => a.productId.localeCompare(b.productId)))
          await this.inventory.applyMovement(tx, {
            organizationId: org,
            warehouseId: sale.warehouseId!,
            productId: item.productId,
            type: 'OUT',
            direction: 'DECREASE',
            quantity: item.quantity,
            reason: 'Comanda de salón',
            reference: sale.id,
            userId: actor,
          });
        await tx.sale.update({
          where: { id: sale.id },
          data: {
            status: money(sale.total).eq(0) ? 'PAID' : 'CONFIRMED',
            confirmedAt: new Date(),
          },
        });
      } else if (!['CONFIRMED', 'PARTIALLY_PAID', 'PAID'].includes(sale.status))
        throw new ConflictException('Venta no disponible');
      const lines = current.snapshot as unknown as Array<{ station: string }>;
      await tx.kitchenTask.createMany({
        data: [...new Set(lines.map((l) => l.station || 'Cocina'))].map(
          (station) => ({ organizationId: org, orderId, station }),
        ),
      });
      await tx.restaurantOrder.update({
        where: { id: orderId },
        data: {
          status: 'QUEUED',
          queuedAt: new Date(),
          version: { increment: 1 },
        },
      });
      await tx.restaurantOrderEvent.create({
        data: {
          organizationId: org,
          orderId,
          action: 'QUEUED',
          actorUserId: actor,
          detail: 'Cuenta abierta de salón; cobro pendiente',
        },
      });
      await this.audit(tx, org, actor, id, 'dining.dispatch', orderId);
      return this.load(tx, org, id);
    });
  }
  async pay(
    org: string,
    actor: string,
    id: string,
    orderId: string,
    dto: CreatePaymentDto,
  ) {
    const account = await this.get(org, id);
    const order = account.orders.find((o) => o.id === orderId);
    if (!order) throw new NotFoundException('Comanda no encontrada');
    if (account.status !== 'OPEN')
      throw new ConflictException('Cuenta cerrada');
    return this.sales.addPayment(org, order.saleId, dto, actor);
  }
  close(org: string, actor: string, id: string, dto: CloseAccountDto) {
    return this.tenant.run(org, async (tx) => {
      await tx.$queryRaw`SELECT id FROM dining_accounts WHERE id=${id} AND "organizationId"=${org} FOR UPDATE`;
      const a = await this.load(tx, org, id);
      const closeHash = hash([
        dto.version,
        money(dto.tipAmount).toFixed(2),
        dto.tipMethod,
      ]);
      if (a.status === 'CLOSED' && a.closeHash === closeHash) return a;
      if (a.status !== 'OPEN' || a.version !== dto.version)
        throw new ConflictException('La cuenta cambió. Actualiza el salón');
      if (
        a.orders.some(
          (o) =>
            !['CANCELLED', 'REFUNDED', 'PAID'].includes(o.sale.status) ||
            !['DELIVERED', 'CANCELLED'].includes(o.status),
        )
      )
        throw new ConflictException(
          'Cobra y entrega todas las comandas antes de cerrar',
        );
      if (dto.tipAmount > 0 && !a.orders.some((o) => o.sale.status === 'PAID'))
        throw new BadRequestException(
          'No registres propina en una cuenta sin consumo',
        );
      if (dto.tipAmount > 0 && dto.tipMethod === 'CASH') {
        const registers = await tx.$queryRaw<
          Array<{ id: string }>
        >`SELECT id FROM cash_registers WHERE "organizationId"=${org} AND "posTerminalId"=${a.posTerminalId} AND status='OPEN' FOR UPDATE`;
        if (!registers[0])
          throw new ConflictException(
            'Abre la caja antes de registrar propina en efectivo',
          );
        await tx.cashMovement.create({
          data: {
            organizationId: org,
            cashRegisterId: registers[0].id,
            type: 'CASH_IN',
            amount: money(dto.tipAmount),
            reason: 'Propina de salón (separada de venta)',
            reference: id,
            createdById: actor,
            idempotencyKey: `dining-tip-${id}`,
          },
        });
      }
      await tx.diningAccount.update({
        where: { id },
        data: {
          status: 'CLOSED',
          closedAt: new Date(),
          version: { increment: 1 },
          tipAmount: money(dto.tipAmount),
          tipMethod: dto.tipAmount > 0 ? dto.tipMethod : null,
          closeHash,
        },
      });
      await this.audit(
        tx,
        org,
        actor,
        id,
        'dining.close',
        `Propina ${money(dto.tipAmount).toFixed(2)} ${dto.tipMethod}`,
      );
      return this.load(tx, org, id);
    });
  }
  private async load(tx: Tx, org: string, id: string) {
    const a = await tx.diningAccount.findFirst({
      where: { id, organizationId: org },
      include,
    });
    if (!a) throw new NotFoundException('Cuenta no encontrada');
    return a;
  }
  private async lock(tx: Tx, org: string, id: string, version?: number) {
    await tx.$queryRaw`SELECT id FROM dining_accounts WHERE id=${id} AND "organizationId"=${org} FOR UPDATE`;
    const a = await tx.diningAccount.findFirst({
      where: { id, organizationId: org },
    });
    if (!a) throw new NotFoundException('Cuenta no encontrada');
    if (a.status !== 'OPEN' || (version !== undefined && a.version !== version))
      throw new ConflictException('La cuenta cambió. Actualiza el salón');
    return a;
  }
  private audit(
    tx: Tx,
    org: string,
    actor: string,
    id: string,
    action: string,
    detail?: string,
  ) {
    return tx.auditLog.create({
      data: {
        organizationId: org,
        userId: actor,
        entityType: 'DiningAccount',
        entityId: id,
        action,
        metadata: { detail: detail ?? '' },
      },
    });
  }
}
