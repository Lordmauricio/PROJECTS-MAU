import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { CashService } from './cash.service';
import { CashController } from './cash.controller';
import { ExpensesController } from './expenses.controller';

@Module({
  imports: [AuditModule],
  controllers: [CashController, ExpensesController],
  providers: [CashService],
  exports: [CashService],
})
export class CashModule {}
