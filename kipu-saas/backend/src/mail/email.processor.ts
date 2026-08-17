import { Inject, Logger } from '@nestjs/common';
import { OnWorkerEvent, Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { Prisma } from '../../generated/prisma/client';
import { TenantPrismaService } from '../prisma/tenant-prisma.service';
import { EMAIL_QUEUE, EmailJobPayload } from './email.types';
import type { EmailSender } from './email-sender.interface';
import { EMAIL_SENDER } from './email-sender.interface';

/**
 * Ejecuta el envío real. `MailService` nunca llama al proveedor
 * directamente: encola el job y este processor (mismo patrón que
 * `AuditProcessor`) es quien invoca `EmailSender.send(...)` fuera del
 * ciclo de vida del request HTTP que lo originó.
 *
 * `EmailLog` la crea y actualiza ÚNICAMENTE este processor, nunca
 * `MailService`: algunos llamadores (p.ej. `MembersService.invite`)
 * encolan el job desde dentro de una transacción de negocio, y esa
 * transacción puede hacer rollback después de que el job ya quedó en
 * Redis (el `queue.add` no participa de la transacción de Postgres). Si
 * `MailService` escribiera el `EmailLog` sincrónicamente ahí, quedaría un
 * registro "fantasma" de un email que en realidad nunca se encoló. Al
 * dejar que el processor sea la única fuente de verdad, `EmailLog`
 * siempre refleja jobs que realmente se ejecutaron.
 */
@Processor(EMAIL_QUEUE)
export class EmailProcessor extends WorkerHost {
  private readonly logger = new Logger(EmailProcessor.name);

  constructor(
    @Inject(EMAIL_SENDER) private readonly sender: EmailSender,
    private readonly tenantPrisma: TenantPrismaService,
  ) {
    super();
  }

  async process(job: Job<EmailJobPayload>): Promise<void> {
    const {
      to,
      subject,
      html,
      text,
      attachments,
      template,
      organizationId,
      idempotencyKey,
      relatedEntityType,
      relatedEntityId,
    } = job.data;

    if (organizationId && idempotencyKey) {
      const alreadySent = await this.tenantPrisma.run(organizationId, (tx) =>
        tx.emailLog.findUnique({ where: { idempotencyKey } }),
      );
      if (alreadySent?.status === 'SENT') {
        this.logger.log(
          `Email "${template}" a ${to} ya fue enviado antes (idempotencyKey=${idempotencyKey}), se omite.`,
        );
        return;
      }
    }

    const result = await this.sender.send({
      to,
      subject,
      html,
      text,
      attachments: attachments?.map((a) => ({
        filename: a.filename,
        content: Buffer.from(a.contentBase64, 'base64'),
        contentType: a.contentType,
      })),
    });

    if (organizationId) {
      await this.recordLog(organizationId, {
        to,
        template,
        status: 'SENT',
        provider: result.provider,
        attempts: job.attemptsMade,
        sentAt: new Date(),
        idempotencyKey,
        relatedEntityType,
        relatedEntityId,
      });
    }

    this.logger.log(
      `Email "${template}" enviado a ${to} vía ${result.provider}`,
    );
  }

  @OnWorkerEvent('failed')
  async onFailed(
    job: Job<EmailJobPayload> | undefined,
    error: Error,
  ): Promise<void> {
    if (!job) return;
    const attempts = job.opts.attempts ?? 1;
    const exhausted = job.attemptsMade >= attempts;

    if (!exhausted) {
      this.logger.warn(
        `Envío de email "${job.data.template}" a ${job.data.to} falló (intento ${job.attemptsMade}/${attempts}), reintentará: ${error.message}`,
      );
      return;
    }

    this.logger.error(
      `Envío de email "${job.data.template}" a ${job.data.to} agotó reintentos (${job.attemptsMade}/${attempts})`,
      error.stack,
    );

    const {
      organizationId,
      template,
      to,
      idempotencyKey,
      relatedEntityType,
      relatedEntityId,
    } = job.data;
    if (organizationId) {
      await this.recordLog(organizationId, {
        to,
        template,
        status: 'FAILED',
        error: error.message.slice(0, 1000),
        attempts: job.attemptsMade,
        idempotencyKey,
        relatedEntityType,
        relatedEntityId,
      });
    }
  }

  /** Upsert manual sobre `idempotencyKey` (nullable-unique, así que no admite `upsert` nativo con `undefined`). */
  private async recordLog(
    organizationId: string,
    data: {
      to: string;
      template: string;
      status: 'SENT' | 'FAILED';
      provider?: string;
      error?: string;
      attempts: number;
      sentAt?: Date;
      idempotencyKey?: string;
      relatedEntityType?: string;
      relatedEntityId?: string;
    },
  ): Promise<void> {
    await this.tenantPrisma.run(organizationId, async (tx) => {
      const existing = data.idempotencyKey
        ? await tx.emailLog.findUnique({
            where: { idempotencyKey: data.idempotencyKey },
          })
        : null;

      if (existing) {
        await tx.emailLog.update({
          where: { id: existing.id },
          data: {
            status: data.status,
            provider: data.provider,
            error: data.error ?? null,
            attempts: data.attempts,
            sentAt: data.sentAt,
          },
        });
        return;
      }

      try {
        await tx.emailLog.create({
          data: {
            organizationId,
            to: data.to,
            template: data.template,
            status: data.status,
            provider: data.provider,
            error: data.error,
            attempts: data.attempts,
            sentAt: data.sentAt,
            idempotencyKey: data.idempotencyKey,
            relatedEntityType: data.relatedEntityType,
            relatedEntityId: data.relatedEntityId,
          },
        });
      } catch (err) {
        // Carrera con otro intento del mismo job que ganó la creación primero.
        if (
          err instanceof Prisma.PrismaClientKnownRequestError &&
          err.code === 'P2002'
        ) {
          return;
        }
        throw err;
      }
    });
  }
}
