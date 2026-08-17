import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { CashService } from './cash.service';
import { CashController } from './cash.controller';
import { ExpensesController } from './expenses.controller';

@Module({
  imports: [AuditModule, NotificationsModule],
  controllers: [CashController, ExpensesController],
  providers: [CashService],
  exports: [CashService],
})
export class CashModule {}
