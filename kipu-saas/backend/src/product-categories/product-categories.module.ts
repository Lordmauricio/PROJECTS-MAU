import { Module } from '@nestjs/common';
import { ProductCategoriesService } from './product-categories.service';
import { ProductCategoriesController } from './product-categories.controller';
import { AuditModule } from '../audit/audit.module';

@Module({
  imports: [AuditModule],
  providers: [ProductCategoriesService],
  controllers: [ProductCategoriesController],
})
export class ProductCategoriesModule {}
