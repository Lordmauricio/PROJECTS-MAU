import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '../../generated/prisma/client';
import { TenantPrismaService } from '../prisma/tenant-prisma.service';
import { AuditService } from '../audit/audit.service';
import { money } from '../common/money';
import { OpenCashRegisterDto } from './dto/open-cash-register.dto';
import { CloseCashRegisterDto } from './dto/close-cash-register.dto';
import { CreateCashMovementDto } from './dto/create-cash-movement.dto';
import { CreateExpenseDto } from './dto/create-expense.dto';
import {
  ListCashRegistersQueryDto,
  ListExpensesQueryDto,
} from './dto/list-cash-registers-query.dto';

type Tx = Prisma.TransactionClient;

// Qué tipos de `CashMovement` suman o restan del saldo de la caja. El
// signo NUNCA vive en `amount` (siempre positivo, igual que en
// `InventoryMovement`/`Payment`) — vive en `type`. `PAYABLE_PAYMENT`
// (Fase Comercial 6, pago a proveedor en efectivo) y `SALE_REFUND` (Fase
// Comercial 6, reembolso de venta en efectivo) se suman a los cuatro tipos
// ya existentes desde la Fase Comercial 5.
const CASH_INCREASE_TYPES = new Set(['CASH_IN', 'SALE_PAYMENT']);
const CASH_DECREASE_TYPES = new Set([
  'CASH_OUT',
  'EXPENSE',
  'PAYABLE_PAYMENT',
  'SALE_REFUND',
]);

interface LockedCashRegister {
  id: string;
  status: 'OPEN' | 'CLOSED';
  openingAmount: Prisma.Decimal;
  closingIdempotencyKey: string | null;
}

@Injectable()
export class CashService {
  constructor(
    private readonly tenantPrisma: TenantPrismaService,
    private readonly audit: AuditService,
  ) {}

  list(organizationId: string, filters: ListCashRegistersQueryDto) {
    return this.tenantPrisma.run(organizationId, (tx) =>
      tx.cashRegister.findMany({
        where: {
          organizationId,
          ...(filters.status ? { status: filters.status } : {}),
          ...(filters.posTerminalId
            ? { posTerminalId: filters.posTerminalId }
            : {}),
        },
        include: {
          posTerminal: { select: { id: true, name: true } },
          _count: { select: { movements: true, expenses: true } },
        },
        orderBy: { openedAt: 'desc' },
        take: 100,
      }),
    );
  }

  async findOne(organizationId: string, cashRegisterId: string) {
    const found = await this.tenantPrisma.run(organizationId, (tx) =>
      this.loadFull(tx, organizationId, cashRegisterId),
    );
    if (!found) throw new NotFoundException('Caja no encontrada');
    return found;
  }

  /** Caja actualmente OPEN para un punto de venta, o `null` si no hay ninguna — nunca un error. */
  async findActive(organizationId: string, posTerminalId: string) {
    return this.tenantPrisma.run(organizationId, (tx) =>
      tx.cashRegister.findFirst({
        where: { organizationId, posTerminalId, status: 'OPEN' },
        include: { posTerminal: { select: { id: true, name: true } } },
      }),
    );
  }

  /**
   * Abre una caja para un punto de venta. La atomicidad de "una sola OPEN
   * por terminal" NO depende de un chequeo previo (siempre corre la carrera
   * de leer-luego-escribir bajo concurrencia real) — depende del índice
   * único parcial `cash_registers_one_open_per_terminal` a nivel de
   * Postgres (`WHERE status = 'OPEN'`, ver la migración): dos INSERT
   * simultáneos para el mismo `posTerminalId` con status OPEN, uno de los
   * dos siempre viola el índice y aborta.
   */
  async open(
    organizationId: string,
    dto: OpenCashRegisterDto,
    actorUserId: string,
  ) {
    const result = await this.runOrResolveOpenConflict(
      organizationId,
      dto.idempotencyKey,
      async (tx) => {
        const existing = await tx.cashRegister.findUnique({
          where: { openingIdempotencyKey: dto.idempotencyKey },
        });
        if (existing) return existing;

        const terminal = await tx.pOSTerminal.findFirst({
          where: { id: dto.posTerminalId, organizationId },
        });
        if (!terminal) {
          throw new BadRequestException('Punto de venta no encontrado');
        }

        return tx.cashRegister.create({
          data: {
            organizationId,
            posTerminalId: dto.posTerminalId,
            openingAmount: money(dto.openingAmount ?? 0),
            openedById: actorUserId,
            openingIdempotencyKey: dto.idempotencyKey,
          },
        });
      },
    );

    await this.audit.log({
      organizationId,
      userId: actorUserId,
      action: 'cash.open',
      entityType: 'CashRegister',
      entityId: result.id,
      metadata: {
        posTerminalId: dto.posTerminalId,
        openingAmount: dto.openingAmount ?? 0,
      },
    });

    return result;
  }

  /**
   * Cierre + arqueo en un solo paso (ver `docs/PROJECT_PLAN.md` — se decidió
   * no modelar un "arqueo" intermedio separado, la sección 4 del prompt
   * describe el arqueo como parte de lo que el cierre registra). Bloquea la
   * fila (mismo patrón que `lockSale`/`lockPurchase`/`lockPayable`): dos
   * cierres concurrentes de la MISMA caja quedan serializados por el lock,
   * y el segundo (tras el commit del primero) ve status=CLOSED. Si su
   * `idempotencyKey` coincide con la que ya cerró la caja, es un
   * retry/doble click → se responde con el resultado ya aplicado. Si NO
   * coincide, es un segundo cierre genuinamente distinto llegando tarde →
   * se rechaza con 409 en vez de devolver en silencio el arqueo de otro
   * usuario como si fuera el propio (mismo criterio ya aplicado en
   * Inventario — Fase Comercial 4 — para `idempotencyKey` reusada entre
   * operaciones distintas).
   */
  async close(
    organizationId: string,
    cashRegisterId: string,
    dto: CloseCashRegisterDto,
    actorUserId: string,
  ) {
    const result = await this.tenantPrisma.run(organizationId, async (tx) => {
      const locked = await this.lockCashRegister(
        tx,
        organizationId,
        cashRegisterId,
      );
      if (!locked) throw new NotFoundException('Caja no encontrada');

      if (locked.status === 'CLOSED') {
        if (locked.closingIdempotencyKey === dto.idempotencyKey) {
          return this.loadFull(tx, organizationId, cashRegisterId);
        }
        throw new ConflictException('La caja ya fue cerrada');
      }

      const expected = await this.computeBalance(
        tx,
        organizationId,
        cashRegisterId,
        locked.openingAmount,
      );
      const counted = money(dto.countedAmount);
      const difference = counted.sub(expected);

      await tx.cashRegister.update({
        where: { id: cashRegisterId },
        data: {
          status: 'CLOSED',
          closingAmount: counted,
          expectedAmount: expected,
          difference,
          closingObservation: dto.observation,
          closedById: actorUserId,
          closedAt: new Date(),
          closingIdempotencyKey: dto.idempotencyKey,
        },
      });
      return this.loadFull(tx, organizationId, cashRegisterId);
    });

    await this.audit.log({
      organizationId,
      userId: actorUserId,
      action: 'cash.close',
      entityType: 'CashRegister',
      entityId: cashRegisterId,
      metadata: {
        countedAmount: dto.countedAmount,
        expectedAmount: result?.expectedAmount?.toString(),
        difference: result?.difference?.toString(),
      },
    });

    return result;
  }

  /** Ingreso/egreso manual (CASH_IN/CASH_OUT) sobre una caja abierta. */
  async registerMovement(
    organizationId: string,
    cashRegisterId: string,
    dto: CreateCashMovementDto,
    actorUserId: string,
  ) {
    const assertMatches = (existing: {
      cashRegisterId: string;
      type: string;
      amount: Prisma.Decimal;
    }) => {
      if (
        existing.cashRegisterId !== cashRegisterId ||
        existing.type !== dto.type ||
        !existing.amount.equals(money(dto.amount))
      ) {
        throw new ConflictException(
          'Esta idempotencyKey ya fue usada con datos distintos',
        );
      }
    };

    const result = await this.runOrResolveMovementConflict(
      organizationId,
      dto.idempotencyKey,
      async (tx) => {
        const existing = await tx.cashMovement.findUnique({
          where: { idempotencyKey: dto.idempotencyKey },
        });
        if (existing) {
          assertMatches(existing);
          return existing;
        }

        const locked = await this.lockCashRegister(
          tx,
          organizationId,
          cashRegisterId,
        );
        if (!locked) throw new NotFoundException('Caja no encontrada');
        if (locked.status !== 'OPEN') {
          throw new ConflictException(
            'La caja está cerrada, no admite nuevos movimientos',
          );
        }

        const amount = money(dto.amount);
        if (dto.type === 'CASH_OUT') {
          const balance = await this.computeBalance(
            tx,
            organizationId,
            cashRegisterId,
            locked.openingAmount,
          );
          if (amount.gt(balance)) {
            throw new BadRequestException(
              `El egreso (${amount.toFixed(2)}) supera el saldo disponible en caja (${balance.toFixed(2)})`,
            );
          }
        }

        return tx.cashMovement.create({
          data: {
            organizationId,
            cashRegisterId,
            type: dto.type,
            amount,
            reason: dto.reason,
            createdById: actorUserId,
            idempotencyKey: dto.idempotencyKey,
          },
        });
      },
      assertMatches,
    );

    await this.audit.log({
      organizationId,
      userId: actorUserId,
      action: 'cash.movement.create',
      entityType: 'CashMovement',
      entityId: result.id,
      metadata: { type: dto.type, amount: dto.amount },
    });

    return result;
  }

  listExpenses(organizationId: string, filters: ListExpensesQueryDto) {
    return this.tenantPrisma.run(organizationId, (tx) =>
      tx.expense.findMany({
        where: {
          organizationId,
          ...(filters.cashRegisterId
            ? { cashRegisterId: filters.cashRegisterId }
            : {}),
        },
        orderBy: { createdAt: 'desc' },
        take: 100,
      }),
    );
  }

  /** Gasto asociado a una caja abierta: crea el Expense y su CashMovement (EXPENSE) atómicamente. */
  async registerExpense(
    organizationId: string,
    dto: CreateExpenseDto,
    actorUserId: string,
  ) {
    const assertMatches = (existing: {
      cashRegisterId: string;
      amount: Prisma.Decimal;
    }) => {
      if (
        existing.cashRegisterId !== dto.cashRegisterId ||
        !existing.amount.equals(money(dto.amount))
      ) {
        throw new ConflictException(
          'Esta idempotencyKey ya fue usada con datos distintos',
        );
      }
    };

    const result = await this.runOrResolveExpenseConflict(
      organizationId,
      dto.idempotencyKey,
      async (tx) => {
        const existing = await tx.expense.findUnique({
          where: { idempotencyKey: dto.idempotencyKey },
        });
        if (existing) {
          assertMatches(existing);
          return existing;
        }

        const locked = await this.lockCashRegister(
          tx,
          organizationId,
          dto.cashRegisterId,
        );
        if (!locked) throw new NotFoundException('Caja no encontrada');
        if (locked.status !== 'OPEN') {
          throw new ConflictException(
            'La caja está cerrada, no admite nuevos gastos',
          );
        }

        const amount = money(dto.amount);
        const balance = await this.computeBalance(
          tx,
          organizationId,
          dto.cashRegisterId,
          locked.openingAmount,
        );
        if (amount.gt(balance)) {
          throw new BadRequestException(
            `El gasto (${amount.toFixed(2)}) supera el saldo disponible en caja (${balance.toFixed(2)})`,
          );
        }

        const expense = await tx.expense.create({
          data: {
            organizationId,
            cashRegisterId: dto.cashRegisterId,
            category: dto.category,
            amount,
            description: dto.description,
            observation: dto.observation,
            createdById: actorUserId,
            idempotencyKey: dto.idempotencyKey,
          },
        });

        await tx.cashMovement.create({
          data: {
            organizationId,
            cashRegisterId: dto.cashRegisterId,
            type: 'EXPENSE',
            amount,
            reason: dto.description ?? 'Gasto',
            reference: expense.id,
            createdById: actorUserId,
          },
        });

        return expense;
      },
      assertMatches,
    );

    await this.audit.log({
      organizationId,
      userId: actorUserId,
      action: 'expenses.create',
      entityType: 'Expense',
      entityId: result.id,
      metadata: {
        cashRegisterId: dto.cashRegisterId,
        amount: dto.amount,
        category: dto.category,
      },
    });

    return result;
  }

  /**
   * Llamado por `SalesService.applyPayment` DENTRO de su propia transacción
   * cuando un pago de venta es en efectivo. Si no hay caja OPEN para el
   * punto de venta de la venta (o la venta no tiene punto de venta), el pago
   * se registra igual — no se bloquea Ventas por no tener Caja abierta, es
   * una decisión explícita documentada en `docs/architecture.md` para no
   * romper el flujo de Ventas que ya funcionaba sin Caja desde la Fase
   * Comercial 2. Nunca abre su propia transacción: `tx` ya viene abierta.
   */
  async registerSalePaymentMovement(
    tx: Tx,
    params: {
      organizationId: string;
      posTerminalId: string | null;
      saleId: string;
      method: string;
      amount: Prisma.Decimal;
      actorUserId?: string;
      idempotencyKey: string;
    },
  ) {
    if (params.method !== 'CASH') return null;
    if (!params.posTerminalId) return null;

    const register = await tx.cashRegister.findFirst({
      where: {
        organizationId: params.organizationId,
        posTerminalId: params.posTerminalId,
        status: 'OPEN',
      },
    });
    if (!register) return null;

    return tx.cashMovement.create({
      data: {
        organizationId: params.organizationId,
        cashRegisterId: register.id,
        type: 'SALE_PAYMENT',
        amount: params.amount,
        reason: 'Cobro de venta en efectivo',
        reference: params.saleId,
        createdById: params.actorUserId,
        idempotencyKey: params.idempotencyKey,
      },
    });
  }

  /**
   * Llamado por `PayablesService.addPayment` cuando un pago a un proveedor
   * es en efectivo. A diferencia de `registerSalePaymentMovement` (un
   * ingreso, nunca necesita chequeo de saldo), esto es un EGRESO
   * discretionary — el usuario eligió explícitamente pagar desde ESTA
   * caja — así que se trata igual que un `CASH_OUT`/`EXPENSE` manual:
   * si el saldo de la caja no alcanza, se rechaza con `BadRequestException`
   * y el pago completo se revierte (misma `tx`), en vez de aplicar el pago
   * sin dejar rastro en caja. Decisión documentada en
   * `docs/architecture.md` sección 11. Si no hay caja OPEN para el
   * `posTerminalId` indicado, el pago se aplica igual sin movimiento de
   * caja (mismo criterio que Ventas desde la Fase Comercial 5).
   */
  async registerPayablePaymentMovement(
    tx: Tx,
    params: {
      organizationId: string;
      posTerminalId: string | null;
      payableId: string;
      amount: Prisma.Decimal;
      actorUserId?: string;
      idempotencyKey: string;
    },
  ) {
    if (!params.posTerminalId) return null;

    const register = await tx.cashRegister.findFirst({
      where: {
        organizationId: params.organizationId,
        posTerminalId: params.posTerminalId,
        status: 'OPEN',
      },
    });
    if (!register) return null;

    const locked = await this.lockCashRegister(
      tx,
      params.organizationId,
      register.id,
    );
    if (!locked || locked.status !== 'OPEN') return null; // se cerró justo entre el findFirst y acá

    const balance = await this.computeBalance(
      tx,
      params.organizationId,
      register.id,
      locked.openingAmount,
    );
    if (params.amount.gt(balance)) {
      throw new BadRequestException(
        `El pago en efectivo (${params.amount.toFixed(2)}) supera el saldo disponible en la caja seleccionada (${balance.toFixed(2)})`,
      );
    }

    return tx.cashMovement.create({
      data: {
        organizationId: params.organizationId,
        cashRegisterId: register.id,
        type: 'PAYABLE_PAYMENT',
        amount: params.amount,
        reason: 'Pago a proveedor en efectivo',
        reference: params.payableId,
        createdById: params.actorUserId,
        idempotencyKey: params.idempotencyKey,
      },
    });
  }

  /**
   * Llamado por `SalesService.returnSale` cuando una devolución reembolsa
   * dinero pagado en efectivo. A diferencia de `registerPayablePaymentMovement`,
   * ESTO NO bloquea la operación que lo originó si el saldo no alcanza: una
   * devolución de mercadería (restaurar inventario, anular la venta) debe
   * completarse siempre, nunca depender de que la caja tenga
   * suficiente efectivo en ESE momento — es un ajuste corrector, no un
   * egreso discrecional. Si el saldo no alcanza, o no hay caja OPEN, se
   * omite el movimiento de caja (se devuelve `null`) pero el `Refund` en sí
   * y el resto de la devolución SIEMPRE se aplican. Decisión documentada en
   * `docs/architecture.md` sección 11.
   */
  async registerSaleRefundMovement(
    tx: Tx,
    params: {
      organizationId: string;
      posTerminalId: string | null;
      saleId: string;
      refundId: string;
      amount: Prisma.Decimal;
      actorUserId?: string;
    },
  ) {
    if (!params.posTerminalId) return null;

    const register = await tx.cashRegister.findFirst({
      where: {
        organizationId: params.organizationId,
        posTerminalId: params.posTerminalId,
        status: 'OPEN',
      },
    });
    if (!register) return null;

    const locked = await this.lockCashRegister(
      tx,
      params.organizationId,
      register.id,
    );
    if (!locked || locked.status !== 'OPEN') return null;

    const balance = await this.computeBalance(
      tx,
      params.organizationId,
      register.id,
      locked.openingAmount,
    );
    if (params.amount.gt(balance)) return null; // ver comentario del método: se omite, no se bloquea la devolución

    return tx.cashMovement.create({
      data: {
        organizationId: params.organizationId,
        cashRegisterId: register.id,
        type: 'SALE_REFUND',
        amount: params.amount,
        reason: 'Reembolso de venta en efectivo',
        reference: params.refundId,
        createdById: params.actorUserId,
        idempotencyKey: `sale-refund-${params.saleId}`,
      },
    });
  }

  // ---------------------------------------------------------------------

  private async lockCashRegister(
    tx: Tx,
    organizationId: string,
    cashRegisterId: string,
  ): Promise<LockedCashRegister | null> {
    const rows = await tx.$queryRaw<LockedCashRegister[]>`
      SELECT id, status, "openingAmount", "closingIdempotencyKey"
      FROM cash_registers
      WHERE id = ${cashRegisterId} AND "organizationId" = ${organizationId}
      FOR UPDATE
    `;
    return rows[0] ?? null;
  }

  private loadFull(tx: Tx, organizationId: string, cashRegisterId: string) {
    return tx.cashRegister.findFirst({
      where: { id: cashRegisterId, organizationId },
      include: {
        posTerminal: { select: { id: true, name: true } },
        movements: { orderBy: { createdAt: 'asc' } },
        expenses: { orderBy: { createdAt: 'asc' } },
      },
    });
  }

  /** Saldo actual (esperado) de la caja: saldo inicial + ingresos - egresos, calculado dentro de la MISMA transacción que la bloquea. */
  private async computeBalance(
    tx: Tx,
    organizationId: string,
    cashRegisterId: string,
    openingAmount: Prisma.Decimal,
  ): Promise<Prisma.Decimal> {
    const movements = await tx.cashMovement.findMany({
      where: { organizationId, cashRegisterId },
      select: { type: true, amount: true },
    });
    let balance = money(openingAmount);
    for (const m of movements) {
      if (CASH_INCREASE_TYPES.has(m.type)) {
        balance = balance.add(m.amount);
      } else if (CASH_DECREASE_TYPES.has(m.type)) {
        balance = balance.sub(m.amount);
      }
    }
    return balance;
  }

  /**
   * Mismo patrón que `InventoryService.runOrResolveTransferConflict`: si
   * `fn` lanza P2002, puede ser por dos causas distintas y ambas se
   * resuelven igual — (a) `openingIdempotencyKey` repetida (retry exacto de
   * ESTA apertura) o (b) el índice único parcial
   * `cash_registers_one_open_per_terminal` (una apertura AJENA ya ganó la
   * carrera para este terminal). Se distinguen buscando por la propia
   * `idempotencyKey`: si existe, es (a); si no, es (b) y se responde 409 en
   * vez de devolver en silencio la caja de otro.
   */
  private async runOrResolveOpenConflict<T>(
    organizationId: string,
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
          const existing = await tx.cashRegister.findUnique({
            where: { openingIdempotencyKey: idempotencyKey },
          });
          if (existing) return existing as unknown as T;
          throw new ConflictException(
            'Ya existe una caja abierta para este punto de venta',
          );
        });
      }
      throw err;
    }
  }

  private async runOrResolveMovementConflict<T>(
    organizationId: string,
    idempotencyKey: string,
    fn: (tx: Tx) => Promise<T>,
    assertMatches: (existing: {
      cashRegisterId: string;
      type: string;
      amount: Prisma.Decimal;
    }) => void,
  ): Promise<T> {
    try {
      return await this.tenantPrisma.run(organizationId, fn);
    } catch (err) {
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === 'P2002'
      ) {
        return this.tenantPrisma.run(organizationId, async (tx) => {
          const existing = await tx.cashMovement.findUniqueOrThrow({
            where: { idempotencyKey },
          });
          assertMatches(existing);
          return existing as unknown as T;
        });
      }
      throw err;
    }
  }

  private async runOrResolveExpenseConflict<T>(
    organizationId: string,
    idempotencyKey: string,
    fn: (tx: Tx) => Promise<T>,
    assertMatches: (existing: {
      cashRegisterId: string;
      amount: Prisma.Decimal;
    }) => void,
  ): Promise<T> {
    try {
      return await this.tenantPrisma.run(organizationId, fn);
    } catch (err) {
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === 'P2002'
      ) {
        return this.tenantPrisma.run(organizationId, async (tx) => {
          const existing = await tx.expense.findUniqueOrThrow({
            where: { idempotencyKey },
          });
          assertMatches(existing);
          return existing as unknown as T;
        });
      }
      throw err;
    }
  }
}
