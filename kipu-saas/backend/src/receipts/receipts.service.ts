import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'crypto';
import { Prisma } from '../../generated/prisma/client';
import { TenantPrismaService } from '../prisma/tenant-prisma.service';
import { AuditService } from '../audit/audit.service';
import { MailService } from '../mail/mail.service';
import { money, sumMoney } from '../common/money';
import { ReceiptSnapshot, buildReceiptSnapshot } from './receipt-snapshot';
import { renderReceiptPdf } from './receipt-pdf.util';

type Tx = Prisma.TransactionClient;

// Recibo comercial NO FISCAL — ver docs/architecture.md sección 14. Nunca
// importa nada de `fiscal/` (ese módulo no existe todavía, ver
// docs/PROJECT_PLAN.md) y `sales/` nunca importa `receipts/`: la relación
// es de un solo sentido, `ReceiptsService` lee `Sale` a través de su
// propia tenantPrisma, Sales no sabe que Receipts existe.
//
// Estados de Sale que admiten emitir recibo: una venta CONFIRMADA es una
// venta real (mercadería entregada, stock ya descontado desde
// SalesService.confirm) sin importar si ya se pagó del todo — por eso
// PARTIALLY_PAID también califica (el recibo puede mostrar "saldo
// pendiente"). DRAFT nunca calificó (ni siquiera existe como operación
// real todavía). CANCELLED nunca calificó (la venta nunca se concretó).
// REFUNDED se excluye deliberadamente para EMITIR un recibo nuevo — la
// venta ya se revirtió comercialmente — pero un recibo ya emitido ANTES
// del reembolso sigue siendo un documento histórico válido (su snapshot
// no cambia; ver `SalesService.returnSale`, que nunca toca
// `commercial_receipts`).
const ELIGIBLE_SALE_STATUSES = ['CONFIRMED', 'PARTIALLY_PAID', 'PAID'];

@Injectable()
export class ReceiptsService {
  constructor(
    private readonly tenantPrisma: TenantPrismaService,
    private readonly audit: AuditService,
    private readonly mail: MailService,
  ) {}

  /**
   * Emite el recibo comercial de una venta. Idempotente por `saleId`
   * (`@@unique` en `commercial_receipts`): un doble click o un retry
   * exacto devuelve SIEMPRE el mismo recibo, nunca crea uno segundo ni
   * consume un número nuevo de la secuencia — ver `runOrResolveConflict`.
   */
  async issue(organizationId: string, saleId: string, actorUserId: string) {
    const receipt = await this.runOrResolveConflict(
      organizationId,
      saleId,
      async (tx) => {
        const existing = await tx.commercialReceipt.findUnique({
          where: { saleId },
        });
        if (existing) return existing;

        const sale = await tx.sale.findFirst({
          where: { id: saleId, organizationId },
          include: {
            items: {
              include: {
                product: { select: { id: true, name: true, sku: true } },
              },
            },
            payments: { orderBy: { createdAt: 'asc' } },
            customer: true,
            warehouse: { include: { branch: true } },
            posTerminal: { include: { branch: true } },
          },
        });
        if (!sale) throw new NotFoundException('Venta no encontrada');
        if (!ELIGIBLE_SALE_STATUSES.includes(sale.status)) {
          throw new ConflictException(
            `No se puede emitir un recibo comercial para una venta en estado ${sale.status} ` +
              `(solo se admite CONFIRMED, PARTIALLY_PAID o PAID)`,
          );
        }

        const organization = await tx.organization.findUniqueOrThrow({
          where: { id: organizationId },
        });
        const issuedBy = await tx.organizationUser.findFirst({
          where: { organizationId, userId: actorUserId },
          include: { user: { select: { name: true } } },
        });

        const paidTotal = sumMoney(sale.payments.map((p) => p.amount));
        const balance = money(sale.total).sub(paidTotal);

        const { series, number } = await this.nextReceiptNumber(
          tx,
          organizationId,
        );

        const snapshot: ReceiptSnapshot = buildReceiptSnapshot({
          organization,
          sale,
          paidTotal,
          balance,
          issuedByName: issuedBy?.user.name ?? null,
          series,
          number,
        });

        return tx.commercialReceipt.create({
          data: {
            organizationId,
            saleId,
            series,
            number,
            snapshot: snapshot as unknown as Prisma.InputJsonValue,
            issuedById: actorUserId,
          },
        });
      },
    );

    await this.audit.log({
      organizationId,
      userId: actorUserId,
      action: 'receipts.issue',
      entityType: 'CommercialReceipt',
      entityId: receipt.id,
      metadata: { saleId, series: receipt.series, number: receipt.number },
    });

    return receipt;
  }

  /** `null` si la venta todavía no tiene recibo — nunca un error, es un estado válido. */
  async findBySale(organizationId: string, saleId: string) {
    return this.tenantPrisma.run(organizationId, (tx) =>
      tx.commercialReceipt.findFirst({ where: { organizationId, saleId } }),
    );
  }

  async findById(organizationId: string, id: string) {
    const found = await this.tenantPrisma.run(organizationId, (tx) =>
      tx.commercialReceipt.findFirst({ where: { id, organizationId } }),
    );
    if (!found) throw new NotFoundException('Recibo no encontrado');
    return found;
  }

  /**
   * Envía el recibo por email adjuntando el PDF. El PDF se genera EN VIVO
   * a partir de `receipt.snapshot` (mismo `renderReceiptPdf` que usa
   * `GET :id/pdf`) — nunca se reconstruye a partir de `Sale`/`Customer`
   * actuales, así que el adjunto es idéntico al que vería el cliente
   * descargando el PDF hoy mismo, sin importar cuánto haya cambiado la
   * venta o el cliente desde que se emitió. El envío en sí lo hace
   * `MailService` (encolado, asíncrono, con reintentos) — este método
   * nunca espera al proveedor de email.
   */
  async sendByEmail(
    organizationId: string,
    receiptId: string,
    actorUserId: string,
    overrideEmail?: string,
  ): Promise<void> {
    const receipt = await this.findById(organizationId, receiptId);
    const snapshot = receipt.snapshot as unknown as ReceiptSnapshot;

    const email =
      overrideEmail ??
      (await this.resolveCustomerEmail(organizationId, receipt.saleId));
    if (!email) {
      throw new BadRequestException(
        'El cliente de esta venta no tiene email registrado; indicá uno explícitamente',
      );
    }

    const pdf = await renderReceiptPdf(snapshot, 'a4');
    await this.mail.sendReceiptEmail(
      organizationId,
      email,
      {
        fullNumber: snapshot.operation.fullNumber,
        issuerName: snapshot.issuer.name,
        total: snapshot.totals.total,
        issuedAt: snapshot.operation.issuedAt,
      },
      pdf,
      receiptId,
    );

    await this.audit.log({
      organizationId,
      userId: actorUserId,
      action: 'receipts.email.send',
      entityType: 'CommercialReceipt',
      entityId: receiptId,
      metadata: { to: email },
    });
  }

  private async resolveCustomerEmail(
    organizationId: string,
    saleId: string,
  ): Promise<string | null> {
    const sale = await this.tenantPrisma.run(organizationId, (tx) =>
      tx.sale.findFirst({
        where: { id: saleId, organizationId },
        include: { customer: { select: { email: true } } },
      }),
    );
    return sale?.customer?.email ?? null;
  }

  async logDownload(
    organizationId: string,
    userId: string,
    receiptId: string,
    format: string,
  ) {
    await this.audit.log({
      organizationId,
      userId,
      action: 'receipts.pdf.download',
      entityType: 'CommercialReceipt',
      entityId: receiptId,
      metadata: { format },
    });
  }

  // -----------------------------------------------------------------------

  /**
   * Numeración atómica: UN `UPDATE ... RETURNING` (vía upsert nativo de
   * Postgres, `INSERT ... ON CONFLICT DO UPDATE`), nunca `MAX(number) + 1`.
   * Bajo concurrencia real, Postgres serializa las escrituras sobre la
   * misma fila (`organizationId` es `@unique`): la segunda transacción
   * espera a que la primera confirme (o revierta) antes de tomar su propio
   * número — nunca puede leer el mismo `lastNumber` que otra transacción
   * concurrente. Corre DENTRO de la misma transacción que el `create` del
   * recibo: si el `create` falla (p. ej. una carrera real que dispara
   * P2002 sobre `saleId`), TODA la transacción revierte, incluido este
   * incremento — nunca se "pierde" un número por una carrera perdida.
   */
  private async nextReceiptNumber(
    tx: Tx,
    organizationId: string,
  ): Promise<{ series: string; number: number }> {
    const rows = await tx.$queryRaw<
      Array<{ series: string; lastNumber: number }>
    >`
      INSERT INTO receipt_sequences (id, "organizationId", series, "lastNumber", "updatedAt")
      VALUES (${randomUUID()}, ${organizationId}, 'REC', 1, now())
      ON CONFLICT ("organizationId")
      DO UPDATE SET "lastNumber" = receipt_sequences."lastNumber" + 1, "updatedAt" = now()
      RETURNING series, "lastNumber"
    `;
    return { series: rows[0].series, number: rows[0].lastNumber };
  }

  /**
   * Mismo patrón que Sales/Purchases/Payables: si `fn` dispara P2002 sobre
   * `commercial_receipts_saleId_key` (dos requests concurrentes para la
   * MISMA venta, ninguno vio el `existing` del otro porque ambos
   * arrancaron antes de que el otro confirmara), la transacción ya se
   * abortó sola — se abre una nueva, limpia, para buscar el recibo que
   * SÍ ganó la carrera y devolverlo, en vez de propagar el error al
   * cliente que solo estaba reintentando.
   */
  private async runOrResolveConflict<T>(
    organizationId: string,
    saleId: string,
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
          const existing = await tx.commercialReceipt.findUnique({
            where: { saleId },
          });
          if (!existing) throw err;
          return existing as unknown as T;
        });
      }
      throw err;
    }
  }
}
