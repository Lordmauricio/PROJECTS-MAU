import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { MailModule } from '../mail/mail.module';
import { ReceiptsService } from './receipts.service';
import { ReceiptsController } from './receipts.controller';

// Deliberadamente NO importa nada de `fiscal/` (no existe todavía, ver
// docs/PROJECT_PLAN.md) ni de `sales/` — `ReceiptsService` lee `Sale` vía
// su propio `TenantPrismaService`, nunca inyecta `SalesService`, así que
// `SalesModule` no necesita saber que `ReceiptsModule` existe.
@Module({
  imports: [AuditModule, MailModule],
  controllers: [ReceiptsController],
  providers: [ReceiptsService],
  exports: [ReceiptsService],
})
export class ReceiptsModule {}
