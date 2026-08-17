import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { PayablesService } from './payables.service';
import { PayablesController } from './payables.controller';

@Module({
  imports: [AuditModule],
  controllers: [PayablesController],
  providers: [PayablesService],
})
export class PayablesModule {}
