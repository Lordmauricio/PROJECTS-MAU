import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '../../generated/prisma/client';
import { TenantPrismaService } from '../prisma/tenant-prisma.service';
import { AuditService } from '../audit/audit.service';
import { SalesService } from '../sales/sales.service';
import { money, sumMoney } from '../common/money';
import { CreatePaymentDto } from '../sales/dto/payment.dto';
import { ListReceivablesQueryDto } from './dto/list-receivables-query.dto';

type Tx = Prisma.TransactionClient;

/**
 * Cuentas por cobrar (Fase Comercial 6). A propósito, NO tiene su propio
 * ledger de pagos: una Receivable nace de una venta a crédito
 * (`saleId` único, ver `SalesService.createOrSyncReceivable`) y sus pagos
 * son literalmente los mismos `Payment` de esa venta — pagar una
 * Receivable ES pagar la venta asociada. `addPayment` delega en
 * `SalesService.addPayment`, reusando toda su atomicidad/idempotencia/
 * integración con Caja ya construidas y probadas, en vez de duplicar esa
 * lógica con un segundo ledger que podría desincronizarse del real.
 */
@Injectable()
export class ReceivablesService {
  constructor(
    private readonly tenantPrisma: TenantPrismaService,
    private readonly sales: SalesService,
    private readonly audit: AuditService,
  ) {}

  async list(organizationId: string, filters: ListReceivablesQueryDto) {
    const rows = await this.tenantPrisma.run(organizationId, (tx) =>
      tx.receivable.findMany({
        where: {
          organizationId,
          ...(filters.status ? { status: filters.status } : {}),
          ...(filters.customerId ? { customerId: filters.customerId } : {}),
        },
        include: {
          customer: { select: { id: true, name: true } },
          sale: {
            select: {
              id: true,
              total: true,
              status: true,
              payments: { select: { amount: true } },
            },
          },
        },
        orderBy: { createdAt: 'desc' },
        take: 100,
      }),
    );
    return rows.map((r) => this.attachBalance(r));
  }

  async findOne(organizationId: string, receivableId: string) {
    const receivable = await this.tenantPrisma.run(organizationId, (tx) =>
      this.loadFull(tx, organizationId, receivableId),
    );
    return this.attachBalance(receivable);
  }

  async addPayment(
    organizationId: string,
    receivableId: string,
    dto: CreatePaymentDto,
    actorUserId: string,
  ) {
    const receivable = await this.tenantPrisma.run(organizationId, (tx) =>
      tx.receivable.findFirst({ where: { id: receivableId, organizationId } }),
    );
    if (!receivable)
      throw new NotFoundException('Cuenta por cobrar no encontrada');
    if (!receivable.saleId) {
      // No debería poder pasar (toda Receivable nace de una venta), pero se
      // deja explícito en vez de un error genérico si algún día existiera
      // una Receivable manual sin venta asociada.
      throw new NotFoundException(
        'Esta cuenta por cobrar no tiene una venta asociada',
      );
    }

    // Delegar en SalesService.addPayment reusa TODO su manejo de
    // concurrencia/idempotencia/Caja — ver el comentario de la clase.
    await this.sales.addPayment(
      organizationId,
      receivable.saleId,
      dto,
      actorUserId,
    );

    await this.audit.log({
      organizationId,
      userId: actorUserId,
      action: 'receivables.payment.create',
      entityType: 'Receivable',
      entityId: receivableId,
      metadata: { amount: dto.amount, method: dto.method },
    });

    return this.findOne(organizationId, receivableId);
  }

  // ---------------------------------------------------------------------

  private async loadFull(tx: Tx, organizationId: string, receivableId: string) {
    const found = await tx.receivable.findFirst({
      where: { id: receivableId, organizationId },
      include: {
        customer: { select: { id: true, name: true } },
        sale: {
          select: {
            id: true,
            total: true,
            status: true,
            payments: { orderBy: { createdAt: 'asc' } },
          },
        },
      },
    });
    if (!found) throw new NotFoundException('Cuenta por cobrar no encontrada');
    return found;
  }

  private attachBalance<
    T extends {
      amount: Prisma.Decimal;
      sale?: { payments?: { amount: Prisma.Decimal }[] } | null;
    },
  >(receivable: T) {
    const paidTotal = sumMoney(
      (receivable.sale?.payments ?? []).map((p) => p.amount),
    );
    const balance = money(receivable.amount).sub(paidTotal);
    return { ...receivable, paidTotal, balance };
  }
}
