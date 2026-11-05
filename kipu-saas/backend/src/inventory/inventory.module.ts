import { StockOperationsService } from './stock-operations.service';
import { StockOperationsController } from './stock-operations.controller';
import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { InventoryService } from './inventory.service';
import { InventoryController } from './inventory.controller';

@Module({
  imports: [AuditModule],
  controllers: [InventoryController, StockOperationsController],
  providers: [InventoryService, StockOperationsService],
  exports: [InventoryService],
})
export class InventoryModule {}
