import { Module } from '@nestjs/common';
import { ProductsService } from './products.service';
import { ProductsController } from './products.controller';
import { AuditModule } from '../audit/audit.module';
import { SubscriptionsModule } from '../subscriptions/subscriptions.module';

@Module({
  imports: [AuditModule, SubscriptionsModule],
  providers: [ProductsService],
  controllers: [ProductsController],
})
export class ProductsModule {}
