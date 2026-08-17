import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { SalesModule } from '../sales/sales.module';
import { ReceivablesService } from './receivables.service';
import { ReceivablesController } from './receivables.controller';

@Module({
  imports: [AuditModule, SalesModule],
  controllers: [ReceivablesController],
  providers: [ReceivablesService],
})
export class ReceivablesModule {}
