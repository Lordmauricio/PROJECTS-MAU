import { Module } from '@nestjs/common';
import { ReportsModule } from '../reports/reports.module';
import { OrganizationsService } from './organizations.service';
import { OrganizationsController } from './organizations.controller';

// Importa ReportsModule para reutilizar ReportsService.topProductsReport en
// el dashboard (Fase Comercial 7) — nunca reimplementa esa agregación acá.
@Module({
  imports: [ReportsModule],
  providers: [OrganizationsService],
  controllers: [OrganizationsController],
  exports: [OrganizationsService],
})
export class OrganizationsModule {}
