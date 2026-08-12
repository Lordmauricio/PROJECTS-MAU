import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { AuditService } from './audit.service';
import { AuditProcessor } from './audit.processor';
import { AUDIT_QUEUE } from './audit.types';

@Module({
  imports: [BullModule.registerQueue({ name: AUDIT_QUEUE })],
  providers: [AuditService, AuditProcessor],
  exports: [AuditService],
})
export class AuditModule {}
