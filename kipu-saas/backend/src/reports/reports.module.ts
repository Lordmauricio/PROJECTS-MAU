import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { InventoryModule } from '../inventory/inventory.module';
import { ReportsService } from './reports.service';
import { ReportsController } from './reports.controller';

// Importa InventoryModule para reutilizar InventoryService.listStock/
// listMovements (nunca reimplementa el motor de stock). No importa
// CashModule: CASH_INCREASE_TYPES/CASH_DECREASE_TYPES son constantes
// exportadas directamente desde `cash.service.ts` (import de módulo ES
// normal, no inyección de Nest) — ReportsService lee esa misma
// clasificación, nunca instancia ni llama a CashService.
@Module({
  imports: [AuditModule, InventoryModule],
  controllers: [ReportsController],
  providers: [ReportsService],
  exports: [ReportsService],
})
export class ReportsModule {}
