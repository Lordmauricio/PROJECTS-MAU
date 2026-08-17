import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { InventoryModule } from '../inventory/inventory.module';
import { PurchasesService } from './purchases.service';
import { PurchasesController } from './purchases.controller';

@Module({
  imports: [AuditModule, InventoryModule],
  controllers: [PurchasesController],
  providers: [PurchasesService],
  exports: [PurchasesService],
})
export class PurchasesModule {}
