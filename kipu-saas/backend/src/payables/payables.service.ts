import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '../../generated/prisma/client';
import { TenantPrismaService } from '../prisma/tenant-prisma.service';
import { AuditService } from '../audit/audit.service';
import { money, sumMoney } from '../common/money';
import { CreatePayablePaymentDto } from './dto/payable-payment.dto';
import { ListPayablesQueryDto } from './dto/list-payables-query.dto';

type Tx = Prisma.TransactionClient;

@Injectable()
export class PayablesService {
  constructor(
    private readonly tenantPrisma: TenantPrismaService,
    private readonly audit: AuditService,
  ) {}

  list(organizationId: string, filters: ListPayablesQueryDto) {
    return this.tenantPrisma.run(organizationId, (tx) =>
      tx.payable.findMany({
        where: {
          organizationId,
          ...(filters.status ? { status: filters.status } : {}),
          ...(filters.supplierId ? { supplierId: filters.supplierId } : {}),
        },
        include: {
          supplier: { select: { id: true, name: true } },
          purchase: { select: { id: true } },
        },
        orderBy: { createdAt: 'desc' },
        take: 100,
      }),
    );
  }

  async findOne(organizationId: string, payableId: string) {
    const payable = await this.tenantPrisma.run(organizationId, (tx) =>
      this.loadFull(tx, organizationId, payableId),
    );
    return this.attachBalance(payable);
  }

  async addPayment(
    organizationId: string,
    payableId: string,
    dto: CreatePayablePaymentDto,
    actorUserId: string,
  ) {
    const result = await this.runOrResolveConflict(
      organizationId,
      payableId,
      dto.idempotencyKey,
      async (tx) => {
        const locked = await this.lockPayable(tx, organizationId, payableId);
        if (!locked)
          throw new NotFoundException('Cuenta por pagar no encontrada');

        const existingPayment = await tx.payment.findUnique({
          where: { idempotencyKey: dto.idempotencyKey },
        });
        if (existingPayment) {
          if (existingPayment.payableId !== payableId) {
            throw new ConflictException(
              'Esta idempotencyKey ya fue usada en otro pago',
            );
          }
          return this.loadFull(tx, organizationId, payableId);
        }

        if (locked.status === 'CANCELLED') {
          throw new ConflictException(
            'No se pueden registrar pagos sobre una cuenta por pagar cancelada',
          );
        }

        const agg = await tx.payment.aggregate({
          where: { payableId, organizationId },
          _sum: { amount: true },
        });
        const alreadyPaid = money(agg._sum.amount ?? 0);
        const balance = money(locked.amount).sub(alreadyPaid);
        const amount = money(dto.amount);
        if (amount.gt(balance)) {
          throw new BadRequestException(
            `El monto (${amount.toFixed(2)}) supera el saldo pendiente (${balance.toFixed(2)})`,
          );
        }

        // Puede lanzar P2002 (carrera cross-payable/cross-sale sobre la misma
        // key) — se deja propagar a propósito, igual que en SalesService.
        await tx.payment.create({
          data: {
            organizationId,
            payableId,
            method: dto.method,
            amount,
            idempotencyKey: dto.idempotencyKey,
            createdById: actorUserId,
          },
        });

        const newPaid = alreadyPaid.add(amount);
        const newStatus = newPaid.gte(money(locked.amount))
          ? 'PAID'
          : 'PENDING';
        await tx.payable.update({
          where: { id: payableId },
          data: { status: newStatus },
        });

        return this.loadFull(tx, organizationId, payableId);
      },
    );

    await this.audit.log({
      organizationId,
      userId: actorUserId,
      action: 'payables.payment.create',
      entityType: 'Payable',
      entityId: payableId,
      metadata: { amount: dto.amount, method: dto.method },
    });

    return this.attachBalance(result);
  }

  // ---------------------------------------------------------------------

  private async lockPayable(tx: Tx, organizationId: string, payableId: string) {
    const rows = await tx.$queryRaw<
      Array<{ id: string; status: string; amount: Prisma.Decimal }>
    >`
      SELECT id, status, amount FROM payables WHERE id = ${payableId} AND "organizationId" = ${organizationId} FOR UPDATE
    `;
    return rows[0] ?? null;
  }

  private async loadFull(tx: Tx, organizationId: string, payableId: string) {
    const found = await tx.payable.findFirst({
      where: { id: payableId, organizationId },
      include: {
        supplier: { select: { id: true, name: true } },
        purchase: { select: { id: true, total: true } },
        payments: { orderBy: { createdAt: 'asc' } },
      },
    });
    if (!found) throw new NotFoundException('Cuenta por pagar no encontrada');
    return found;
  }

  private attachBalance<
    T extends {
      amount: Prisma.Decimal;
      payments?: { amount: Prisma.Decimal }[];
    },
  >(payable: T) {
    const paidTotal = sumMoney((payable.payments ?? []).map((p) => p.amount));
    const balance = money(payable.amount).sub(paidTotal);
    return { ...payable, paidTotal, balance };
  }

  private async runOrResolveConflict<T>(
    organizationId: string,
    payableId: string,
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
          const conflicting = await tx.payment.findUnique({
            where: { idempotencyKey },
          });
          if (conflicting && conflicting.payableId !== payableId) {
            throw new ConflictException(
              'Esta idempotencyKey ya fue usada en otro pago',
            );
          }
          return this.loadFull(tx, organizationId, payableId) as unknown as T;
        });
      }
      throw err;
    }
  }
}
