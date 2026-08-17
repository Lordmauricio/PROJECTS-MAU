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
import { CashService } from '../cash/cash.service';
import {
  NotificationsService,
  NOTIFICATION_TYPES,
} from '../notifications/notifications.service';
import { money, sumMoney, ZERO_MONEY } from '../common/money';
import { CreateSaleDto } from './dto/create-sale.dto';
import {
  ConfirmSaleDto,
  CreatePaymentDto,
  SalePaymentDto,
} from './dto/payment.dto';
import { ListSalesQueryDto } from './dto/list-sales-query.dto';
import { ReturnSaleDto } from './dto/return-sale.dto';

type Tx = Prisma.TransactionClient;

const OPEN_FOR_PAYMENT_STATUSES = ['CONFIRMED', 'PARTIALLY_PAID', 'PAID'];
const RETURNABLE_STATUSES = ['CONFIRMED', 'PARTIALLY_PAID', 'PAID'];

@Injectable()
export class SalesService {
  constructor(
    private readonly tenantPrisma: TenantPrismaService,
    private readonly inventory: InventoryService,
    private readonly cash: CashService,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
  ) {}

  list(organizationId: string, filters: ListSalesQueryDto) {
    const page = filters.page ?? 1;
    const pageSize = Math.min(filters.pageSize ?? 20, 100);
    return this.tenantPrisma.run(organizationId, (tx) =>
      tx.sale.findMany({
        where: {
          organizationId,
          ...(filters.status ? { status: filters.status } : {}),
          ...(filters.customerId ? { customerId: filters.customerId } : {}),
          ...(filters.posTerminalId
            ? { posTerminalId: filters.posTerminalId }
            : {}),
        },
        include: {
          customer: { select: { id: true, name: true } },
          _count: { select: { items: true, payments: true } },
        },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
    );
  }

  async findOne(organizationId: string, saleId: string) {
    const sale = await this.tenantPrisma.run(organizationId, async (tx) => {
      const found = await tx.sale.findFirst({
        where: { id: saleId, organizationId },
      });
      if (!found) throw new NotFoundException('Venta no encontrada');
      return this.loadFull(tx, organizationId, saleId);
    });
    return this.attachBalance(sale);
  }

  async create(
    organizationId: string,
    dto: CreateSaleDto,
    actorUserId: string,
  ) {
    const sale = await this.tenantPrisma.run(organizationId, async (tx) => {
      const posTerminal = await tx.pOSTerminal.findFirst({
        where: { id: dto.posTerminalId, organizationId },
      });
      if (!posTerminal)
        throw new BadRequestException('Punto de venta no encontrado');

      const warehouse = await tx.warehouse.findFirst({
        where: { id: dto.warehouseId, organizationId },
      });
      if (!warehouse) throw new BadRequestException('Almacén no encontrado');
      if (warehouse.branchId !== posTerminal.branchId) {
        throw new BadRequestException(
          'El almacén debe pertenecer a la misma sucursal que el punto de venta',
        );
      }

      if (dto.customerId) {
        const customer = await tx.customer.findFirst({
          where: { id: dto.customerId, organizationId },
        });
        if (!customer) throw new BadRequestException('Cliente no encontrado');
      }

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
        const unitPrice = money(item.unitPrice ?? product.price);
        const itemDiscount = money(item.discount ?? 0);
        const lineGross = quantity.mul(unitPrice);
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
          unitPrice,
          discount: itemDiscount,
          subtotal: lineSubtotal,
        };
      });

      const saleDiscount = money(dto.discount ?? 0);
      if (saleDiscount.gt(subtotal)) {
        throw new BadRequestException(
          'El descuento de la venta no puede superar el subtotal',
        );
      }
      const total = money(subtotal.sub(saleDiscount));

      return tx.sale.create({
        data: {
          organizationId,
          posTerminalId: dto.posTerminalId,
          warehouseId: dto.warehouseId,
          customerId: dto.customerId,
          type: 'SALE',
          status: 'DRAFT',
          subtotal,
          discount: saleDiscount,
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
      action: 'sales.create',
      entityType: 'Sale',
      entityId: sale.id,
      metadata: { total: sale.total.toString(), itemCount: sale.items.length },
    });

    return this.attachBalance(sale);
  }

  /**
   * Confirma una venta DRAFT: descuenta stock atómicamente (todo o nada) y,
   * opcionalmente, aplica pagos iniciales en la misma transacción.
   *
   * Idempotencia ante doble click/retry: la transición se decide dentro de
   * `SELECT ... FOR UPDATE`, así que dos confirmaciones concurrentes de la
   * MISMA venta quedan serializadas por Postgres — la segunda ve el status
   * ya cambiado (no DRAFT) y responde con el estado actual en vez de volver
   * a descontar stock o cobrar de nuevo.
   */
  async confirm(
    organizationId: string,
    saleId: string,
    dto: ConfirmSaleDto,
    actorUserId: string,
  ) {
    const candidateKeys = (dto.payments ?? []).map((p) => p.idempotencyKey);
    let receivableCreated = false;
    // Distingue una confirmación real de un replay idempotente (línea
    // "Ya estaba confirmada..." más abajo) — solo la primera dispara la
    // notificación de "venta confirmada" (ver punto 1 del pedido: "no
    // generar notificaciones innecesarias ni duplicadas").
    let saleConfirmedNow = false;
    const result = await this.runOrResolvePaymentConflict(
      organizationId,
      saleId,
      candidateKeys,
      async (tx) => {
        const locked = await this.lockSale(tx, organizationId, saleId);
        if (!locked) throw new NotFoundException('Venta no encontrada');

        if (locked.status !== 'DRAFT') {
          if (locked.status === 'CANCELLED' || locked.status === 'REFUNDED') {
            throw new ConflictException(
              `No se puede confirmar una venta en estado ${locked.status}`,
            );
          }
          // Ya estaba confirmada por un intento anterior (retry/doble click):
          // no se repite ningún efecto, se devuelve el estado actual.
          return this.loadFull(tx, organizationId, saleId);
        }

        if (!locked.warehouseId) {
          throw new BadRequestException('La venta no tiene almacén asignado');
        }

        const items = await tx.saleItem.findMany({
          where: { saleId, organizationId },
        });
        for (const item of items) {
          // Si el stock no alcanza para CUALQUIER ítem, applyMovement lanza y
          // toda la transacción se revierte: no queda descontado solo parte
          // del carrito.
          await this.inventory.applyMovement(tx, {
            organizationId,
            warehouseId: locked.warehouseId,
            productId: item.productId,
            type: 'OUT',
            direction: 'DECREASE',
            quantity: item.quantity,
            reason: 'Confirmación de venta',
            reference: saleId,
            userId: actorUserId,
          });
        }

        let paid = ZERO_MONEY;
        for (const paymentDto of dto.payments ?? []) {
          const applied = await this.applyPayment(
            tx,
            organizationId,
            saleId,
            locked.total,
            paid,
            paymentDto,
            actorUserId,
            locked.posTerminalId,
          );
          paid = paid.add(applied);
        }

        const status = paid.gte(locked.total)
          ? 'PAID'
          : paid.gt(ZERO_MONEY)
            ? 'PARTIALLY_PAID'
            : 'CONFIRMED';
        await tx.sale.update({
          where: { id: saleId },
          data: { status, confirmedAt: new Date() },
        });
        saleConfirmedNow = true;

        // Venta a crédito (saldo pendiente al confirmar): genera su
        // Receivable automáticamente, mismo momento en que Compras genera
        // la Payable (cuando la obligación se vuelve real) — ver
        // `createOrSyncReceivable`. Se guarda en una variable de closure en
        // vez de devolverla junto al Sale para no cambiar la forma de
        // retorno que espera `runOrResolvePaymentConflict` (compartida con
        // `addPayment`) — si este intento resulta ser un replay (P2002 o
        // "ya estaba confirmada"), `receivableCreated` simplemente queda en
        // `false`, que es la respuesta correcta (no se creó nada nuevo).
        const receivableOutcome = await this.createOrSyncReceivable(
          tx,
          organizationId,
          { id: saleId, customerId: locked.customerId, total: locked.total },
          status,
        );
        receivableCreated = receivableOutcome?.created ?? false;

        return this.loadFull(tx, organizationId, saleId);
      },
    );

    await this.audit.log({
      organizationId,
      userId: actorUserId,
      action: 'sales.confirm',
      entityType: 'Sale',
      entityId: saleId,
      metadata: { status: result.status },
    });

    if (receivableCreated) {
      const receivable = await this.tenantPrisma.run(organizationId, (tx) =>
        tx.receivable.findUnique({ where: { saleId } }),
      );
      if (receivable) {
        await this.audit.log({
          organizationId,
          userId: actorUserId,
          action: 'receivables.create',
          entityType: 'Receivable',
          entityId: receivable.id,
          metadata: { saleId, amount: receivable.amount.toString() },
        });
        await this.notifications.create(
          organizationId,
          actorUserId,
          NOTIFICATION_TYPES.RECEIVABLE_PENDING,
          'Cuenta por cobrar pendiente',
          `La venta ${saleId} quedó con saldo pendiente de Bs ${receivable.amount.toString()} por cobrar.`,
        );
      }
    }

    if (saleConfirmedNow) {
      await this.notifications.create(
        organizationId,
        actorUserId,
        NOTIFICATION_TYPES.SALE_CONFIRMED,
        'Venta confirmada',
        `Se confirmó la venta por un total de Bs ${result.total.toString()}.`,
      );
    }

    return this.attachBalance(result);
  }

  /** Pago adicional sobre una venta ya confirmada (p.ej. saldar una venta a crédito). */
  async addPayment(
    organizationId: string,
    saleId: string,
    dto: CreatePaymentDto,
    actorUserId: string,
  ) {
    let paymentRecorded = false;
    const result = await this.runOrResolvePaymentConflict(
      organizationId,
      saleId,
      [dto.idempotencyKey],
      async (tx) => {
        const locked = await this.lockSale(tx, organizationId, saleId);
        if (!locked) throw new NotFoundException('Venta no encontrada');

        const existingPayment = await tx.payment.findUnique({
          where: { idempotencyKey: dto.idempotencyKey },
        });
        if (existingPayment) {
          if (existingPayment.saleId !== saleId) {
            throw new ConflictException(
              'Esta idempotencyKey ya fue usada en otra venta',
            );
          }
          // Replay idempotente: mismo intento de cobro repetido, no se cobra dos veces.
          return this.loadFull(tx, organizationId, saleId);
        }

        if (!OPEN_FOR_PAYMENT_STATUSES.includes(locked.status)) {
          throw new ConflictException(
            `No se pueden registrar pagos sobre una venta en estado ${locked.status}`,
          );
        }

        const agg = await tx.payment.aggregate({
          where: { saleId, organizationId },
          _sum: { amount: true },
        });
        const alreadyPaid = money(agg._sum.amount ?? 0);
        await this.applyPayment(
          tx,
          organizationId,
          saleId,
          locked.total,
          alreadyPaid,
          dto,
          actorUserId,
          locked.posTerminalId,
        );

        const newPaid = alreadyPaid.add(money(dto.amount));
        const newStatus = newPaid.gte(locked.total) ? 'PAID' : 'PARTIALLY_PAID';
        await tx.sale.update({
          where: { id: saleId },
          data: { status: newStatus },
        });
        await this.syncReceivableStatus(tx, saleId, newStatus);
        paymentRecorded = true;

        return this.loadFull(tx, organizationId, saleId);
      },
    );

    await this.audit.log({
      organizationId,
      userId: actorUserId,
      action: 'sales.payment.create',
      entityType: 'Sale',
      entityId: saleId,
      metadata: { amount: dto.amount, method: dto.method },
    });

    if (paymentRecorded) {
      await this.notifications.create(
        organizationId,
        actorUserId,
        NOTIFICATION_TYPES.SALE_PAYMENT_RECEIVED,
        'Pago recibido',
        `Se registró un pago de Bs ${money(dto.amount).toString()} en la venta ${saleId}.`,
      );
    }

    return this.attachBalance(result);
  }

  async cancel(organizationId: string, saleId: string, actorUserId: string) {
    const result = await this.tenantPrisma.run(organizationId, async (tx) => {
      const locked = await this.lockSale(tx, organizationId, saleId);
      if (!locked) throw new NotFoundException('Venta no encontrada');
      if (locked.status === 'CANCELLED')
        return this.loadFull(tx, organizationId, saleId);
      if (locked.status !== 'DRAFT') {
        throw new ConflictException(
          'Solo se puede cancelar una venta en borrador; una venta confirmada se anula mediante devolución',
        );
      }
      await tx.sale.update({
        where: { id: saleId },
        data: { status: 'CANCELLED', cancelledAt: new Date() },
      });
      return this.loadFull(tx, organizationId, saleId);
    });

    await this.audit.log({
      organizationId,
      userId: actorUserId,
      action: 'sales.cancel',
      entityType: 'Sale',
      entityId: saleId,
    });

    return this.attachBalance(result);
  }

  /**
   * Devolución total de una venta confirmada: restaura el stock (movimiento
   * RETURN), genera el reembolso correspondiente si se había pagado algo, y
   * pasa la venta a REFUNDED. Nunca borra ni reescribe la venta original —
   * items, pagos y el Payment histórico quedan intactos para trazabilidad;
   * el reembolso es una fila nueva (`Refund`), nunca una resta sobre el
   * Payment original.
   *
   * Idempotencia: mismo patrón que `cancel()` — el lock + chequeo de estado
   * (`status === 'REFUNDED'` → responde el estado actual sin repetir ningún
   * efecto) ya garantiza que esto corre A LO SUMO UNA VEZ por venta, incluso
   * con dos requests concurrentes (el lock serializa, el segundo ve
   * `REFUNDED` tras el commit del primero). Por eso `Refund` no necesita su
   * propia `idempotencyKey`: nunca hay una carrera real que pueda crear dos.
   *
   * Modelo de reembolso: esta fase sigue tratando la devolución como
   * TOTAL (todos los ítems, ver `RETURNABLE_STATUSES`/el bucle de abajo) —
   * no se diseñó un modelo de devolución PARCIAL (ni de stock ni de dinero)
   * porque no fue pedido explícitamente; si se autoriza a futuro, el
   * reembolso parcial necesitaría su propio DTO con cantidades/montos por
   * ítem, documentado aparte.
   */
  async returnSale(
    organizationId: string,
    saleId: string,
    dto: ReturnSaleDto,
    actorUserId: string,
  ) {
    const result = await this.tenantPrisma.run(organizationId, async (tx) => {
      const locked = await this.lockSale(tx, organizationId, saleId);
      if (!locked) throw new NotFoundException('Venta no encontrada');
      if (locked.status === 'REFUNDED')
        return {
          sale: await this.loadFull(tx, organizationId, saleId),
          refund: null,
        };
      if (!RETURNABLE_STATUSES.includes(locked.status)) {
        throw new ConflictException(
          `Solo se puede devolver una venta confirmada (estado actual: ${locked.status})`,
        );
      }
      if (!locked.warehouseId)
        throw new BadRequestException('La venta no tiene almacén asignado');

      const items = await tx.saleItem.findMany({
        where: { saleId, organizationId },
      });
      for (const item of items) {
        await this.inventory.applyMovement(tx, {
          organizationId,
          warehouseId: locked.warehouseId,
          productId: item.productId,
          type: 'RETURN',
          direction: 'INCREASE',
          quantity: item.quantity,
          reason: 'Devolución de venta',
          reference: saleId,
          userId: actorUserId,
        });
      }

      // Reembolso: se le debe devolver al cliente lo efectivamente pagado
      // (nunca más que eso — no se "reembolsa" una venta a crédito impaga).
      const payments = await tx.payment.findMany({
        where: { saleId, organizationId },
      });
      const paidTotal = sumMoney(payments.map((p) => p.amount));
      let refund: { id: string; amount: Prisma.Decimal } | null = null;
      if (paidTotal.gt(ZERO_MONEY)) {
        refund = await tx.refund.create({
          data: {
            organizationId,
            saleId,
            amount: paidTotal,
            reason: dto.reason,
            createdById: actorUserId,
          },
        });

        // Del total reembolsado, solo la porción pagada en EFECTIVO mueve
        // caja física — un reembolso de una venta pagada con tarjeta no
        // saca billetes del cajón.
        const cashPortion = sumMoney(
          payments.filter((p) => p.method === 'CASH').map((p) => p.amount),
        );
        if (cashPortion.gt(ZERO_MONEY)) {
          await this.cash.registerSaleRefundMovement(tx, {
            organizationId,
            posTerminalId: dto.posTerminalId ?? locked.posTerminalId,
            saleId,
            refundId: refund.id,
            amount: cashPortion,
            actorUserId,
          });
        }
      }

      await tx.sale.update({
        where: { id: saleId },
        data: { status: 'REFUNDED', refundedAt: new Date() },
      });
      await this.cancelReceivableIfAny(tx, saleId);

      return { sale: await this.loadFull(tx, organizationId, saleId), refund };
    });

    await this.audit.log({
      organizationId,
      userId: actorUserId,
      action: 'sales.return',
      entityType: 'Sale',
      entityId: saleId,
    });

    if (result.refund) {
      await this.audit.log({
        organizationId,
        userId: actorUserId,
        action: 'sales.refund.create',
        entityType: 'Refund',
        entityId: result.refund.id,
        metadata: { saleId, amount: result.refund.amount.toString() },
      });
    }

    return this.attachBalance(result.sale);
  }

  // ---------------------------------------------------------------------

  private async lockSale(tx: Tx, organizationId: string, saleId: string) {
    const rows = await tx.$queryRaw<
      Array<{
        id: string;
        status: string;
        warehouseId: string | null;
        posTerminalId: string | null;
        customerId: string | null;
        total: Prisma.Decimal;
      }>
    >`SELECT id, status, "warehouseId", "posTerminalId", "customerId", total FROM sales WHERE id = ${saleId} AND "organizationId" = ${organizationId} FOR UPDATE`;
    return rows[0] ?? null;
  }

  private loadFull(tx: Tx, organizationId: string, saleId: string) {
    return tx.sale.findFirstOrThrow({
      where: { id: saleId, organizationId },
      include: {
        items: {
          include: { product: { select: { id: true, name: true, sku: true } } },
        },
        payments: { orderBy: { createdAt: 'asc' } },
        refunds: { orderBy: { createdAt: 'asc' } },
        customer: { select: { id: true, name: true } },
      },
    });
  }

  private attachBalance<
    T extends {
      total: Prisma.Decimal;
      payments?: { amount: Prisma.Decimal }[];
    },
  >(sale: T) {
    const paidTotal = sumMoney((sale.payments ?? []).map((p) => p.amount));
    const balance = money(sale.total).sub(paidTotal);
    return { ...sale, paidTotal, balance };
  }

  /**
   * Corre `fn` dentro de una transacción de tenant normal. Si `fn` lanza
   * P2002 sobre `payments_idempotencyKey_key` (única forma en que puede
   * fallar: dos requests concurrentes usando la misma idempotencyKey para
   * VENTAS DISTINTAS — el caso que el lock de `lockSale` NO serializa,
   * porque cada uno bloquea una fila de `sales` distinta), la transacción
   * ya se abortó y revirtió sola (stock/pago de ESTA venta nunca se
   * aplicaron a medias). Acá se abre una transacción nueva y limpia para
   * decidir la respuesta correcta.
   *
   * Por qué no atrapar el P2002 DENTRO de la misma transacción: aunque el
   * catch de JS evita que la excepción se propague, Postgres ya marcó esa
   * transacción como abortada en cuanto el INSERT chocó contra la unique
   * constraint — cualquier sentencia siguiente en esa misma transacción
   * (el UPDATE del estado de la venta, `loadFull`, etc.) falla con "current
   * transaction is aborted". Dejar que la excepción aborte la transacción
   * de verdad, y resolver afuera, es lo único correcto acá.
   */
  private async runOrResolvePaymentConflict<T>(
    organizationId: string,
    saleId: string,
    candidateKeys: string[],
    fn: (tx: Tx) => Promise<T>,
  ): Promise<T> {
    try {
      return await this.tenantPrisma.run(organizationId, fn);
    } catch (err) {
      if (
        candidateKeys.length > 0 &&
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === 'P2002'
      ) {
        return this.tenantPrisma.run(organizationId, async (tx) => {
          for (const key of candidateKeys) {
            const conflicting = await tx.payment.findUnique({
              where: { idempotencyKey: key },
            });
            if (conflicting && conflicting.saleId !== saleId) {
              throw new ConflictException(
                'Esta idempotencyKey ya fue usada en otra venta',
              );
            }
          }
          // No debería llegar acá en la práctica (el caso "misma venta" ya
          // lo resuelve el lock+precheck antes de intentar el INSERT), pero
          // ante cualquier ambigüedad se responde con el estado actual real
          // en vez de asumir.
          return this.loadFull(tx, organizationId, saleId) as unknown as T;
        });
      }
      throw err;
    }
  }

  /**
   * Inserta un Payment validando que no exceda el saldo pendiente
   * (total - ya pagado - lo aplicado en esta misma llamada) y devuelve el
   * monto efectivamente aplicado (0 si era un replay idempotente).
   */
  private async applyPayment(
    tx: Tx,
    organizationId: string,
    saleId: string,
    total: Prisma.Decimal,
    alreadyAppliedInThisCall: Prisma.Decimal,
    dto: SalePaymentDto,
    actorUserId: string,
    posTerminalId: string | null,
  ): Promise<Prisma.Decimal> {
    const existing = await tx.payment.findUnique({
      where: { idempotencyKey: dto.idempotencyKey },
    });
    if (existing) {
      if (existing.saleId !== saleId) {
        throw new ConflictException(
          'Esta idempotencyKey ya fue usada en otra venta',
        );
      }
      return ZERO_MONEY;
    }

    const amount = money(dto.amount);
    const balance = money(total.sub(alreadyAppliedInThisCall));
    if (amount.gt(balance)) {
      throw new BadRequestException(
        `El monto (${amount.toFixed(2)}) supera el saldo pendiente (${balance.toFixed(2)})`,
      );
    }

    // Puede lanzar P2002 (carrera cross-venta) — se deja propagar a
    // propósito, ver `runOrResolvePaymentConflict`.
    await tx.payment.create({
      data: {
        organizationId,
        saleId,
        method: dto.method,
        amount,
        idempotencyKey: dto.idempotencyKey,
        createdById: actorUserId,
      },
    });

    // Si el método es CASH y hay una caja OPEN para el punto de venta de
    // esta venta, registra el ingreso correspondiente — atómico con el
    // Payment de arriba (misma `tx`). Si no hay caja abierta, el pago se
    // aplica igual (ver `CashService.registerSalePaymentMovement`).
    await this.cash.registerSalePaymentMovement(tx, {
      organizationId,
      posTerminalId,
      saleId,
      method: dto.method,
      amount,
      actorUserId,
      idempotencyKey: dto.idempotencyKey,
    });

    return amount;
  }

  /**
   * Crea o sincroniza la Receivable de una venta, dentro de la MISMA
   * transacción que confirma la venta — mismo patrón que
   * `PurchasesService.growOrCreatePayable` (manipula `tx.receivable`
   * directamente vía Prisma, sin depender de un `ReceivablesModule`: evita
   * una dependencia circular, ya que `ReceivablesService.addPayment`
   * necesita llamar a `SalesService.addPayment`, nunca al revés).
   *
   * Solo se crea/mantiene si: (a) la venta tiene cliente asociado (una
   * Receivable siempre le pertenece a alguien) y (b) todavía queda saldo
   * pendiente (`status !== 'PAID'`) — una venta pagada por completo al
   * confirmar no es "a crédito", no genera Receivable. `@@unique([saleId])`
   * en el schema es la garantía de "nunca duplicada para la misma venta" a
   * nivel de base — acá además se verifica antes de insertar para no
   * depender solo del catch de un error.
   */
  private async createOrSyncReceivable(
    tx: Tx,
    organizationId: string,
    sale: { id: string; customerId: string | null; total: Prisma.Decimal },
    saleStatus: string,
  ): Promise<{ created: boolean } | null> {
    if (!sale.customerId) return null;
    if (saleStatus === 'PAID') return null;

    const existing = await tx.receivable.findUnique({
      where: { saleId: sale.id },
    });
    if (existing) {
      if (existing.status !== 'PENDING') {
        await tx.receivable.update({
          where: { id: existing.id },
          data: { status: 'PENDING' },
        });
      }
      return { created: false };
    }

    await tx.receivable.create({
      data: {
        organizationId,
        customerId: sale.customerId,
        saleId: sale.id,
        amount: sale.total,
        dueDate: new Date(),
        status: 'PENDING',
      },
    });
    return { created: true };
  }

  /** Refleja en la Receivable (si existe) el nuevo status de la venta tras un pago adicional. Nunca crea una Receivable nueva acá — eso solo pasa al confirmar. */
  private async syncReceivableStatus(
    tx: Tx,
    saleId: string,
    saleStatus: string,
  ) {
    const existing = await tx.receivable.findUnique({ where: { saleId } });
    if (!existing) return;
    const newStatus = saleStatus === 'PAID' ? 'PAID' : 'PENDING';
    if (existing.status !== newStatus) {
      await tx.receivable.update({
        where: { id: existing.id },
        data: { status: newStatus },
      });
    }
  }

  /** Al devolver una venta, su Receivable (si existía) deja de tener sentido — la deuda quedó anulada, no pagada. */
  private async cancelReceivableIfAny(tx: Tx, saleId: string) {
    const existing = await tx.receivable.findUnique({ where: { saleId } });
    if (!existing) return;
    if (existing.status === 'CANCELLED') return;
    await tx.receivable.update({
      where: { id: existing.id },
      data: { status: 'CANCELLED' },
    });
  }
}
