import { Module } from '@nestjs/common';
import { POSTerminalsService } from './pos-terminals.service';
import { POSTerminalsController } from './pos-terminals.controller';
import { AuditModule } from '../audit/audit.module';

@Module({
  imports: [AuditModule],
  providers: [POSTerminalsService],
  controllers: [POSTerminalsController],
})
export class POSTerminalsModule {}
