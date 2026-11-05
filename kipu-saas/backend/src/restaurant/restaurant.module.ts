import { Module } from '@nestjs/common';
import { SalesModule } from '../sales/sales.module';
import { RestaurantController } from './restaurant.controller';
import { RestaurantService } from './restaurant.service';
import { ProductionService } from './production.service';
import { InventoryModule } from '../inventory/inventory.module';

@Module({
  imports: [SalesModule, InventoryModule],
  controllers: [RestaurantController],
  providers: [RestaurantService, ProductionService],
})
export class RestaurantModule {}
