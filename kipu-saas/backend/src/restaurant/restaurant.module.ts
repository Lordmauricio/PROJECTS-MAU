import { DiningController } from './dining.controller';
import { DiningService } from './dining.service';
import { Module } from '@nestjs/common';
import { SalesModule } from '../sales/sales.module';
import { RestaurantController } from './restaurant.controller';
import { RestaurantService } from './restaurant.service';
import { ProductionService } from './production.service';
import { InventoryModule } from '../inventory/inventory.module';

@Module({
  imports: [SalesModule, InventoryModule],
  controllers: [RestaurantController, DiningController],
  providers: [RestaurantService, ProductionService, DiningService],
})
export class RestaurantModule {}
