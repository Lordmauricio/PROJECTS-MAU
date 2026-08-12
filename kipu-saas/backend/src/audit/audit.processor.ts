import { Logger } from '@nestjs/common';
import { OnWorkerEvent, Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { TenantPrismaService } from '../prisma/tenant-prisma.service';
import { AUDIT_QUEUE, AuditJobPayload } from './audit.types';

@Processor(AUDIT_QUEUE)
export class AuditProcessor extends WorkerHost {
  private readonly logger = new Logger(AuditProcessor.name);

  constructor(private readonly tenantPrisma: TenantPrismaService) {
    super();
  }

  async process(job: Job<AuditJobPayload>): Promise<void> {
    const { organizationId, userId, action, entityType, entityId, metadata, ip, userAgent } = job.data;
    await this.tenantPrisma.run(organizationId, (tx) =>
      tx.auditLog.create({
        data: {
          organizationId,
          userId,
          action,
          entityType,
          entityId,
          metadata: metadata as never,
          ip,
          userAgent,
        },
      }),
    );
    this.logger.debug(`Auditoría registrada: ${action} (org=${organizationId})`);
  }

  @OnWorkerEvent('failed')
  onFailed(job: Job<AuditJobPayload> | undefined, error: Error): void {
    this.logger.error(
      `Job de auditoría agotó reintentos y se perdió: ` +
        `action=${job?.data?.action} org=${job?.data?.organizationId} ` +
        `userId=${job?.data?.userId} jobId=${job?.id} attemptsMade=${job?.attemptsMade}`,
      error.stack,
    );
  }
}
