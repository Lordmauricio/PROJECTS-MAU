import { Module } from '@nestjs/common';
import { ProductUnitsService } from './product-units.service';
import { ProductUnitsController } from './product-units.controller';
import { AuditModule } from '../audit/audit.module';

@Module({
  imports: [AuditModule],
  providers: [ProductUnitsService],
  controllers: [ProductUnitsController],
})
export class ProductUnitsModule {}
