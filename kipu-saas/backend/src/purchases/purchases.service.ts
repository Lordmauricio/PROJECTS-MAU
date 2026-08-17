import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '../../generated/prisma/client';
import { TenantPrismaService } from '../prisma/tenant-prisma.service';
import { AuditService } from '../audit/audit.service';
import { InventoryService } from '../inventory/inventory.service';
import { money, sumMoney, ZERO_MONEY } from '../common/money';
import {
  CreatePurchaseDto,
  UpdatePurchaseDto,
} from './dto/create-purchase.dto';
import { ReceivePurchaseDto } from './dto/receive-purchase.dto';
import { ReturnPurchaseDto } from './dto/return-purchase.dto';
import { ListPurchasesQueryDto } from './dto/list-purchases-query.dto';

type Tx = Prisma.TransactionClient;

const RECEIVABLE_STATUSES = ['CONFIRMED', 'PARTIALLY_RECEIVED'];
const RETURNABLE_STATUSES = ['PARTIALLY_RECEIVED', 'RECEIVED'];

interface ValidatedItem {
  organizationId: string;
  productId: string;
  quantity: Prisma.Decimal;
  unitCost: Prisma.Decimal;
  discount: Prisma.Decimal;
  subtotal: Prisma.Decimal;
}

@Injectable()
export class PurchasesService {
  constructor(
    private readonly tenantPrisma: TenantPrismaService,
    private readonly inventory: InventoryService,
    private readonly audit: AuditService,
  ) {}

  list(organizationId: string, filters: ListPurchasesQueryDto) {
    const page = filters.page ?? 1;
    const pageSize = Math.min(filters.pageSize ?? 20, 100);
    return this.tenantPrisma.run(organizationId, (tx) =>
      tx.purchase.findMany({
        where: {
          organizationId,
          ...(filters.status ? { status: filters.status } : {}),
          ...(filters.supplierId ? { supplierId: filters.supplierId } : {}),
        },
        include: {
          supplier: { select: { id: true, name: true } },
          _count: { select: { items: true, receipts: true } },
        },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
    );
  }

  async findOne(organizationId: string, purchaseId: string) {
    return this.tenantPrisma.run(organizationId, async (tx) => {
      const found = await tx.purchase.findFirst({
        where: { id: purchaseId, organizationId },
      });
      if (!found) throw new NotFoundException('Compra no encontrada');
      return this.loadFull(tx, organizationId, purchaseId);
    });
  }

  async create(
    organizationId: string,
    dto: CreatePurchaseDto,
    actorUserId: string,
  ) {
    const purchase = await this.tenantPrisma.run(organizationId, async (tx) => {
      await this.validateSupplierAndWarehouse(
        tx,
        organizationId,
        dto.supplierId,
        dto.warehouseId,
      );
      const { itemsData, subtotal, discount, total } = await this.buildItems(
        tx,
        organizationId,
        dto,
      );

      return tx.purchase.create({
        data: {
          organizationId,
          supplierId: dto.supplierId,
          warehouseId: dto.warehouseId,
          status: 'DRAFT',
          subtotal,
          discount,
          total,
          createdById: actorUserId,
          items: { create: itemsData },
        },
        include: {
          items: {
            include: {
              product: { select: { id: true, name: true, sku: true } },
            },
          },
        },
      });
    });

    await this.audit.log({
      organizationId,
      userId: actorUserId,
      action: 'purchases.create',
      entityType: 'Purchase',
      entityId: purchase.id,
      metadata: {
        total: purchase.total.toString(),
        itemCount: purchase.items.length,
      },
    });

    return purchase;
  }

  /** Reemplaza proveedor/almacén/descuento/ítems completos — solo mientras la orden está en DRAFT. */
  async update(
    organizationId: string,
    purchaseId: string,
    dto: UpdatePurchaseDto,
    actorUserId: string,
  ) {
    const purchase = await this.tenantPrisma.run(organizationId, async (tx) => {
      const locked = await this.lockPurchase(tx, organizationId, purchaseId);
      if (!locked) throw new NotFoundException('Compra no encontrada');
      if (locked.status !== 'DRAFT') {
        throw new ConflictException(
          'Solo se puede editar una orden de compra en borrador',
        );
      }

      await this.validateSupplierAndWarehouse(
        tx,
        organizationId,
        dto.supplierId,
        dto.warehouseId,
      );
      const { itemsData, subtotal, discount, total } = await this.buildItems(
        tx,
        organizationId,
        dto,
      );

      // Reemplazo completo de ítems: seguro porque en DRAFT nunca existió
      // ninguna PurchaseReceiptItem que referencie los ítems viejos (las
      // recepciones solo pueden ocurrir después de CONFIRMED).
      await tx.purchaseItem.deleteMany({
        where: { purchaseId, organizationId },
      });
      await tx.purchase.update({
        where: { id: purchaseId },
        data: {
          supplierId: dto.supplierId,
          warehouseId: dto.warehouseId,
          subtotal,
          discount,
          total,
          items: { create: itemsData },
        },
      });

      return this.loadFull(tx, organizationId, purchaseId);
    });

    await this.audit.log({
      organizationId,
      userId: actorUserId,
      action: 'purchases.update',
      entityType: 'Purchase',
      entityId: purchaseId,
    });

    return purchase;
  }

  async confirm(
    organizationId: string,
    purchaseId: string,
    actorUserId: string,
  ) {
    const result = await this.tenantPrisma.run(organizationId, async (tx) => {
      const locked = await this.lockPurchase(tx, organizationId, purchaseId);
      if (!locked) throw new NotFoundException('Compra no encontrada');

      if (locked.status !== 'DRAFT') {
        if (locked.status === 'CANCELLED') {
          throw new ConflictException(
            'No se puede confirmar una orden cancelada',
          );
        }
        // Ya confirmada por un intento anterior (retry/doble click): idempotente.
        return this.loadFull(tx, organizationId, purchaseId);
      }

      await tx.purchase.update({
        where: { id: purchaseId },
        data: { status: 'CONFIRMED', confirmedAt: new Date() },
      });
      return this.loadFull(tx, organizationId, purchaseId);
    });

    await this.audit.log({
      organizationId,
      userId: actorUserId,
      action: 'purchases.confirm',
      entityType: 'Purchase',
      entityId: purchaseId,
    });

    return result;
  }

  async cancel(
    organizationId: string,
    purchaseId: string,
    actorUserId: string,
  ) {
    const result = await this.tenantPrisma.run(organizationId, async (tx) => {
      const locked = await this.lockPurchase(tx, organizationId, purchaseId);
      if (!locked) throw new NotFoundException('Compra no encontrada');
      if (locked.status === 'CANCELLED')
        return this.loadFull(tx, organizationId, purchaseId);
      if (locked.status !== 'DRAFT' && locked.status !== 'CONFIRMED') {
        throw new ConflictException(
          'No se puede cancelar una orden con recepciones registradas; usa una devolución al proveedor',
        );
      }
      await tx.purchase.update({
        where: { id: purchaseId },
        data: { status: 'CANCELLED', cancelledAt: new Date() },
      });
      return this.loadFull(tx, organizationId, purchaseId);
    });

    await this.audit.log({
      organizationId,
      userId: actorUserId,
      action: 'purchases.cancel',
      entityType: 'Purchase',
      entityId: purchaseId,
    });

    return result;
  }

  /**
   * Registra una recepción (total o parcial). Atómico: por cada ítem se
   * valida que no se reciba más de lo pedido, se aplica el movimiento de
   * inventario IN (mismo InventoryService.applyMovement de Ventas — un solo
   * motor de stock), se incrementa PurchaseItem.receivedQuantity, se
   * recalcula el status de la orden, y se crea/actualiza la Payable
   * correspondiente. Idempotencia vía PurchaseReceipt.idempotencyKey, mismo
   * patrón que SalesService.runOrResolvePaymentConflict: el catch de la
   * colisión de unicidad se maneja FUERA de la transacción que la generó.
   */
  async receive(
    organizationId: string,
    purchaseId: string,
    dto: ReceivePurchaseDto,
    actorUserId: string,
  ) {
    const result = await this.runOrResolveReceiptConflict(
      organizationId,
      purchaseId,
      dto.idempotencyKey,
      async (tx) => {
        const locked = await this.lockPurchase(tx, organizationId, purchaseId);
        if (!locked) throw new NotFoundException('Compra no encontrada');

        const existingReceipt = await tx.purchaseReceipt.findUnique({
          where: { idempotencyKey: dto.idempotencyKey },
        });
        if (existingReceipt) {
          if (existingReceipt.purchaseId !== purchaseId) {
            throw new ConflictException(
              'Esta idempotencyKey ya fue usada en otra compra',
            );
          }
          // Replay idempotente: misma recepción reintentada, no se duplica.
          return this.loadFull(tx, organizationId, purchaseId);
        }

        if (!RECEIVABLE_STATUSES.includes(locked.status)) {
          throw new ConflictException(
            `No se pueden registrar recepciones sobre una orden en estado ${locked.status}`,
          );
        }
        if (!locked.warehouseId) {
          throw new BadRequestException('La orden no tiene almacén asignado');
        }

        const items = await tx.purchaseItem.findMany({
          where: { purchaseId, organizationId },
        });
        const itemsById = new Map(items.map((i) => [i.id, i]));

        // Validar TODO antes de aplicar nada: si un solo ítem pide recibir de
        // más, ninguna recepción de este request se aplica.
        for (const line of dto.items) {
          const item = itemsById.get(line.purchaseItemId);
          if (!item || item.purchaseId !== purchaseId) {
            throw new BadRequestException(
              `Ítem de compra ${line.purchaseItemId} no pertenece a esta orden`,
            );
          }
          const qty = money(line.quantity);
          const pending = money(item.quantity).sub(
            money(item.receivedQuantity),
          );
          if (qty.gt(pending)) {
            throw new BadRequestException(
              `No se puede recibir ${qty.toFixed(2)} del producto ${item.productId}: pendiente por recibir ${pending.toFixed(2)}`,
            );
          }
        }

        const receipt = await tx.purchaseReceipt.create({
          data: {
            organizationId,
            purchaseId,
            idempotencyKey: dto.idempotencyKey,
            notes: dto.notes,
            receivedById: actorUserId,
          },
        });

        for (const line of dto.items) {
          const item = itemsById.get(line.purchaseItemId)!;
          const qty = money(line.quantity);

          await this.inventory.applyMovement(tx, {
            organizationId,
            warehouseId: locked.warehouseId,
            productId: item.productId,
            type: 'IN',
            direction: 'INCREASE',
            quantity: qty,
            reason: 'Recepción de compra',
            reference: purchaseId,
            userId: actorUserId,
          });

          await tx.purchaseItem.update({
            where: { id: item.id },
            data: { receivedQuantity: money(item.receivedQuantity).add(qty) },
          });

          await tx.purchaseReceiptItem.create({
            data: {
              organizationId,
              purchaseReceiptId: receipt.id,
              purchaseItemId: item.id,
              quantity: qty,
            },
          });
        }

        const refreshedItems = await tx.purchaseItem.findMany({
          where: { purchaseId, organizationId },
        });
        const allReceived = refreshedItems.every((i) =>
          money(i.receivedQuantity).gte(money(i.quantity)),
        );
        // Siempre true en la práctica (acabamos de recibir algo), pero se
        // valida igual en vez de asumirlo.
        const anyReceived = refreshedItems.some((i) =>
          money(i.receivedQuantity).gt(ZERO_MONEY),
        );
        const newStatus: 'RECEIVED' | 'PARTIALLY_RECEIVED' | 'CONFIRMED' =
          allReceived
            ? 'RECEIVED'
            : anyReceived
              ? 'PARTIALLY_RECEIVED'
              : 'CONFIRMED';

        await tx.purchase.update({
          where: { id: purchaseId },
          data: {
            status: newStatus,
            ...(allReceived ? { receivedAt: new Date() } : {}),
          },
        });

        await this.growOrCreatePayable(
          tx,
          organizationId,
          locked,
          refreshedItems,
        );

        return this.loadFull(tx, organizationId, purchaseId);
      },
    );

    await this.audit.log({
      organizationId,
      userId: actorUserId,
      action: 'purchases.receive',
      entityType: 'Purchase',
      entityId: purchaseId,
      metadata: { items: dto.items },
    });

    return result;
  }

  /**
   * Devolución al proveedor: genera salida de inventario (mismo
   * InventoryService, tipo OUT) y reduce la Payable proporcionalmente.
   * Nunca borra ni reescribe la compra/recepción original — solo
   * incrementa PurchaseItem.returnedQuantity y crea un PurchaseReturn.
   *
   * Dependencia documentada de Caja/Pagos (sección 4 del pedido): si la
   * Payable ya estaba pagada más allá de lo que quedaría deberse tras la
   * devolución, eso implicaría que el proveedor nos debe dinero — no
   * existe todavía ningún concepto de "crédito a favor frente a un
   * proveedor" ni módulo de Caja para resolverlo, así que esta operación
   * se RECHAZA explícitamente en ese caso en vez de inventar una solución
   * temporal (ver docs/PROJECT_PLAN.md).
   */
  async returnToSupplier(
    organizationId: string,
    purchaseId: string,
    dto: ReturnPurchaseDto,
    actorUserId: string,
  ) {
    const result = await this.runOrResolveReturnConflict(
      organizationId,
      purchaseId,
      dto.idempotencyKey,
      async (tx) => {
        const locked = await this.lockPurchase(tx, organizationId, purchaseId);
        if (!locked) throw new NotFoundException('Compra no encontrada');

        const existingReturn = await tx.purchaseReturn.findUnique({
          where: { idempotencyKey: dto.idempotencyKey },
        });
        if (existingReturn) {
          if (existingReturn.purchaseId !== purchaseId) {
            throw new ConflictException(
              'Esta idempotencyKey ya fue usada en otra compra',
            );
          }
          return this.loadFull(tx, organizationId, purchaseId);
        }

        if (!RETURNABLE_STATUSES.includes(locked.status)) {
          throw new ConflictException(
            `Solo se puede devolver mercadería de una orden recibida (estado actual: ${locked.status})`,
          );
        }
        if (!locked.warehouseId)
          throw new BadRequestException('La orden no tiene almacén asignado');

        const items = await tx.purchaseItem.findMany({
          where: { purchaseId, organizationId },
        });
        const itemsById = new Map(items.map((i) => [i.id, i]));

        for (const line of dto.items) {
          const item = itemsById.get(line.purchaseItemId);
          if (!item || item.purchaseId !== purchaseId) {
            throw new BadRequestException(
              `Ítem de compra ${line.purchaseItemId} no pertenece a esta orden`,
            );
          }
          const qty = money(line.quantity);
          const returnable = money(item.receivedQuantity).sub(
            money(item.returnedQuantity),
          );
          if (qty.gt(returnable)) {
            throw new BadRequestException(
              `No se puede devolver ${qty.toFixed(2)} del producto ${item.productId}: recibido y no devuelto todavía ${returnable.toFixed(2)}`,
            );
          }
        }

        const payable = await tx.payable.findUnique({ where: { purchaseId } });
        if (!payable) {
          throw new ConflictException(
            'No existe una cuenta por pagar para esta compra todavía (no se ha recibido nada)',
          );
        }
        const paidSoFar = await this.paidAmountFor(tx, payable.id);

        const purchaseLevelFactor = money(locked.total).div(
          money(locked.subtotal),
        );
        let returnedValue = ZERO_MONEY;
        for (const line of dto.items) {
          const item = itemsById.get(line.purchaseItemId)!;
          const qty = money(line.quantity);
          const perUnitNet = money(item.subtotal).div(money(item.quantity));
          returnedValue = returnedValue.add(qty.mul(perUnitNet));
        }
        const payableReduction = money(returnedValue.mul(purchaseLevelFactor));
        const newPayableAmount = money(payable.amount).sub(payableReduction);

        if (newPayableAmount.lt(paidSoFar)) {
          throw new ConflictException(
            `Esta devolución dejaría la cuenta por pagar (Bs. ${newPayableAmount.toFixed(2)}) por debajo de lo ya pagado ` +
              `(Bs. ${paidSoFar.toFixed(2)}) — implicaría que el proveedor nos debe dinero, algo que todavía no se modela ` +
              `(depende de la fase de Caja/Cuentas). No se puede procesar esta devolución todavía.`,
          );
        }

        const purchaseReturn = await tx.purchaseReturn.create({
          data: {
            organizationId,
            purchaseId,
            idempotencyKey: dto.idempotencyKey,
            reason: dto.reason,
            createdById: actorUserId,
          },
        });

        for (const line of dto.items) {
          const item = itemsById.get(line.purchaseItemId)!;
          const qty = money(line.quantity);

          await this.inventory.applyMovement(tx, {
            organizationId,
            warehouseId: locked.warehouseId,
            productId: item.productId,
            type: 'OUT',
            direction: 'DECREASE',
            quantity: qty,
            reason: 'Devolución a proveedor',
            reference: purchaseId,
            userId: actorUserId,
          });

          await tx.purchaseItem.update({
            where: { id: item.id },
            data: { returnedQuantity: money(item.returnedQuantity).add(qty) },
          });

          await tx.purchaseReturnItem.create({
            data: {
              organizationId,
              purchaseReturnId: purchaseReturn.id,
              purchaseItemId: item.id,
              quantity: qty,
            },
          });
        }

        const newStatus = newPayableAmount.lte(paidSoFar)
          ? 'PAID'
          : payable.status === 'PAID'
            ? 'PENDING'
            : payable.status;
        await tx.payable.update({
          where: { id: payable.id },
          data: { amount: newPayableAmount, status: newStatus },
        });

        return this.loadFull(tx, organizationId, purchaseId);
      },
    );

    await this.audit.log({
      organizationId,
      userId: actorUserId,
      action: 'purchases.return',
      entityType: 'Purchase',
      entityId: purchaseId,
      metadata: { items: dto.items },
    });

    return result;
  }

  // ---------------------------------------------------------------------

  private async validateSupplierAndWarehouse(
    tx: Tx,
    organizationId: string,
    supplierId: string,
    warehouseId: string,
  ) {
    const supplier = await tx.supplier.findFirst({
      where: { id: supplierId, organizationId },
    });
    if (!supplier) throw new BadRequestException('Proveedor no encontrado');
    const warehouse = await tx.warehouse.findFirst({
      where: { id: warehouseId, organizationId },
    });
    if (!warehouse) throw new BadRequestException('Almacén no encontrado');
  }

  private async buildItems(
    tx: Tx,
    organizationId: string,
    dto: CreatePurchaseDto,
  ): Promise<{
    itemsData: ValidatedItem[];
    subtotal: Prisma.Decimal;
    discount: Prisma.Decimal;
    total: Prisma.Decimal;
  }> {
    const productIds = [...new Set(dto.items.map((i) => i.productId))];
    const products = await tx.product.findMany({
      where: { id: { in: productIds }, organizationId },
    });
    const productsById = new Map(products.map((p) => [p.id, p]));
    if (productsById.size !== productIds.length) {
      throw new BadRequestException(
        'Uno o más productos no existen en esta organización',
      );
    }

    let subtotal = ZERO_MONEY;
    const itemsData = dto.items.map((item) => {
      const product = productsById.get(item.productId)!;
      const quantity = money(item.quantity);
      const unitCost = money(item.unitCost ?? product.cost);
      const itemDiscount = money(item.discount ?? 0);
      const lineGross = quantity.mul(unitCost);
      if (itemDiscount.gt(lineGross)) {
        throw new BadRequestException(
          `El descuento del producto "${product.name}" no puede superar su subtotal`,
        );
      }
      const lineSubtotal = money(lineGross.sub(itemDiscount));
      subtotal = subtotal.add(lineSubtotal);
      return {
        organizationId,
        productId: item.productId,
        quantity,
        unitCost,
        discount: itemDiscount,
        subtotal: lineSubtotal,
      };
    });

    const discount = money(dto.discount ?? 0);
    if (discount.gt(subtotal)) {
      throw new BadRequestException(
        'El descuento de la orden no puede superar el subtotal',
      );
    }
    const total = money(subtotal.sub(discount));

    return { itemsData, subtotal, discount, total };
  }

  /**
   * Crece (o crea) la Payable de la compra a partir de lo recibido hasta
   * ahora. El valor recibido se calcula proporcionalmente al costo neto
   * por unidad de cada ítem (subtotal del ítem / cantidad ordenada, que ya
   * neta el descuento de ese ítem), y luego se escala por
   * `purchase.total / purchase.subtotal` para repartir también el
   * descuento a nivel de orden — así, cuando todo llega, la Payable
   * termina siendo exactamente `purchase.total`.
   */
  private async growOrCreatePayable(
    tx: Tx,
    organizationId: string,
    purchase: {
      id: string;
      supplierId: string;
      subtotal: Prisma.Decimal;
      total: Prisma.Decimal;
    },
    items: Array<{
      quantity: Prisma.Decimal;
      receivedQuantity: Prisma.Decimal;
      subtotal: Prisma.Decimal;
    }>,
  ) {
    const purchaseLevelFactor = money(purchase.total).div(
      money(purchase.subtotal),
    );
    let receivedValue = ZERO_MONEY;
    for (const item of items) {
      const perUnitNet = money(item.subtotal).div(money(item.quantity));
      receivedValue = receivedValue.add(
        money(item.receivedQuantity).mul(perUnitNet),
      );
    }
    const newAmount = money(receivedValue.mul(purchaseLevelFactor));

    const existing = await tx.payable.findUnique({
      where: { purchaseId: purchase.id },
    });
    if (!existing) {
      await tx.payable.create({
        data: {
          organizationId,
          supplierId: purchase.supplierId,
          purchaseId: purchase.id,
          amount: newAmount,
          dueDate: new Date(),
          status: 'PENDING',
        },
      });
      return;
    }

    const paidSoFar = await this.paidAmountFor(tx, existing.id);
    const newStatus = newAmount.lte(paidSoFar) ? 'PAID' : 'PENDING';
    await tx.payable.update({
      where: { id: existing.id },
      data: { amount: newAmount, status: newStatus },
    });
  }

  private async paidAmountFor(
    tx: Tx,
    payableId: string,
  ): Promise<Prisma.Decimal> {
    const agg = await tx.payment.aggregate({
      where: { payableId },
      _sum: { amount: true },
    });
    return money(agg._sum.amount ?? 0);
  }

  private async lockPurchase(
    tx: Tx,
    organizationId: string,
    purchaseId: string,
  ) {
    const rows = await tx.$queryRaw<
      Array<{
        id: string;
        status: string;
        warehouseId: string | null;
        subtotal: Prisma.Decimal;
        total: Prisma.Decimal;
        supplierId: string;
      }>
    >`SELECT id, status, "warehouseId", subtotal, total, "supplierId" FROM purchases WHERE id = ${purchaseId} AND "organizationId" = ${organizationId} FOR UPDATE`;
    return rows[0] ?? null;
  }

  /**
   * Igual que SalesService.attachBalance: la Payable embebida en la
   * respuesta de una compra necesita `paidTotal`/`balance` calculados para
   * que el frontend pueda mostrar/decidir sobre el saldo real, no solo el
   * monto original. `PayablesService.findOne` (el endpoint dedicado
   * `/payables/:id`) hace lo mismo de forma independiente.
   */
  private async loadFull(tx: Tx, organizationId: string, purchaseId: string) {
    const purchase = await tx.purchase.findFirstOrThrow({
      where: { id: purchaseId, organizationId },
      include: {
        items: {
          include: { product: { select: { id: true, name: true, sku: true } } },
        },
        supplier: { select: { id: true, name: true } },
        payables: { include: { payments: { orderBy: { createdAt: 'asc' } } } },
        receipts: { include: { items: true }, orderBy: { createdAt: 'asc' } },
        returns: { include: { items: true }, orderBy: { createdAt: 'asc' } },
      },
    });

    return {
      ...purchase,
      payables: purchase.payables.map((payable) => {
        const paidTotal = sumMoney(payable.payments.map((p) => p.amount));
        const balance = money(payable.amount).sub(paidTotal);
        return { ...payable, paidTotal, balance };
      }),
    };
  }

  /** Mismo patrón que SalesService.runOrResolvePaymentConflict — ver ese comentario para el detalle de por qué no se atrapa dentro de la misma transacción. */
  private async runOrResolveReceiptConflict<T>(
    organizationId: string,
    purchaseId: string,
    idempotencyKey: string,
    fn: (tx: Tx) => Promise<T>,
  ): Promise<T> {
    try {
      return await this.tenantPrisma.run(organizationId, fn);
    } catch (err) {
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === 'P2002'
      ) {
        return this.tenantPrisma.run(organizationId, async (tx) => {
          const conflicting = await tx.purchaseReceipt.findUnique({
            where: { idempotencyKey },
          });
          if (conflicting && conflicting.purchaseId !== purchaseId) {
            throw new ConflictException(
              'Esta idempotencyKey ya fue usada en otra compra',
            );
          }
          return this.loadFull(tx, organizationId, purchaseId) as unknown as T;
        });
      }
      throw err;
    }
  }

  private async runOrResolveReturnConflict<T>(
    organizationId: string,
    purchaseId: string,
    idempotencyKey: string,
    fn: (tx: Tx) => Promise<T>,
  ): Promise<T> {
    try {
      return await this.tenantPrisma.run(organizationId, fn);
    } catch (err) {
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === 'P2002'
      ) {
        return this.tenantPrisma.run(organizationId, async (tx) => {
          const conflicting = await tx.purchaseReturn.findUnique({
            where: { idempotencyKey },
          });
          if (conflicting && conflicting.purchaseId !== purchaseId) {
            throw new ConflictException(
              'Esta idempotencyKey ya fue usada en otra compra',
            );
          }
          return this.loadFull(tx, organizationId, purchaseId) as unknown as T;
        });
      }
      throw err;
    }
  }
}
