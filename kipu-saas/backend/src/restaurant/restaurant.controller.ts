import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '../common/guards/permissions.guard';
import { RequirePermissions } from '../common/decorators/permissions.decorator';
import { CurrentAuth } from '../common/decorators/current-auth.decorator';
import type { AccessTokenPayload } from '../auth/auth.service';
import { ConfirmSaleDto } from '../sales/dto/payment.dto';
import {
  CancelOrderDto,
  CreateOrderDto,
  QuoteOrderDto,
  ListOrdersDto,
  SaveMenuEntryDto,
  TransitionOrderDto,
  PrintOrderDto,
  CreateBatchDto,
  BatchActionDto,
} from './restaurant.dto';
import { RestaurantService } from './restaurant.service';
import { ProductionService } from './production.service';

@Controller('restaurant')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class RestaurantController {
  constructor(
    private readonly restaurant: RestaurantService,
    private readonly production: ProductionService,
  ) {}
  @Get('batches')
  @RequirePermissions('inventory.read')
  batches(
    @CurrentAuth() auth: AccessTokenPayload,
    @Query('branchId') branchId?: string,
  ) {
    return this.production.list(auth.organizationId, branchId);
  }
  @Post('batches')
  @RequirePermissions('inventory.manage')
  createBatch(
    @CurrentAuth() auth: AccessTokenPayload,
    @Body() dto: CreateBatchDto,
  ) {
    return this.production.create(auth.organizationId, auth.sub, dto);
  }
  @Post('batches/:id/status')
  @RequirePermissions('inventory.manage')
  batchAction(
    @CurrentAuth() auth: AccessTokenPayload,
    @Param('id') id: string,
    @Body() dto: BatchActionDto,
  ) {
    return this.production.action(auth.organizationId, auth.sub, id, dto);
  }
  @Get('menu')
  @RequirePermissions('products.read')
  menu(
    @CurrentAuth() auth: AccessTokenPayload,
    @Query('warehouseId') warehouseId?: string,
  ) {
    return this.restaurant.menu(auth.organizationId, warehouseId);
  }
  @Post('menu')
  @RequirePermissions('products.create')
  createMenu(
    @CurrentAuth() auth: AccessTokenPayload,
    @Body() dto: SaveMenuEntryDto,
  ) {
    return this.restaurant.saveMenu(auth.organizationId, auth.sub, dto);
  }
  @Patch('menu/:id')
  @RequirePermissions('products.update')
  updateMenu(
    @CurrentAuth() auth: AccessTokenPayload,
    @Param('id') id: string,
    @Body() dto: SaveMenuEntryDto,
  ) {
    return this.restaurant.saveMenu(auth.organizationId, auth.sub, dto, id);
  }
  @Get('orders')
  @RequirePermissions('sales.read')
  list(@CurrentAuth() auth: AccessTokenPayload, @Query() dto: ListOrdersDto) {
    return this.restaurant.list(auth.organizationId, dto);
  }
  @Get('orders/:id')
  @RequirePermissions('sales.read')
  findOne(@CurrentAuth() auth: AccessTokenPayload, @Param('id') id: string) {
    return this.restaurant.findOne(auth.organizationId, id);
  }
  @Post('orders')
  @RequirePermissions('sales.create')
  create(@CurrentAuth() auth: AccessTokenPayload, @Body() dto: CreateOrderDto) {
    return this.restaurant.create(auth.organizationId, auth.sub, dto);
  }
  @Post('quote')
  @RequirePermissions('sales.create')
  quote(@CurrentAuth() auth: AccessTokenPayload, @Body() dto: QuoteOrderDto) {
    return this.restaurant.quote(auth.organizationId, auth.sub, dto);
  }
  @Post('orders/:id/checkout')
  @RequirePermissions('sales.create')
  checkout(
    @CurrentAuth() auth: AccessTokenPayload,
    @Param('id') id: string,
    @Body() dto: ConfirmSaleDto,
  ) {
    return this.restaurant.checkout(auth.organizationId, auth.sub, id, dto);
  }
  @Post('orders/:id/status')
  @RequirePermissions('sales.update')
  transition(
    @CurrentAuth() auth: AccessTokenPayload,
    @Param('id') id: string,
    @Body() dto: TransitionOrderDto,
  ) {
    return this.restaurant.transition(auth.organizationId, auth.sub, id, dto);
  }
  @Post('orders/:id/cancel')
  @RequirePermissions('sales.delete')
  cancel(
    @CurrentAuth() auth: AccessTokenPayload,
    @Param('id') id: string,
    @Body() dto: CancelOrderDto,
  ) {
    return this.restaurant.cancel(
      auth.organizationId,
      auth.sub,
      id,
      dto.reason,
    );
  }
  @Post('orders/:id/print')
  @RequirePermissions('sales.read')
  print(
    @CurrentAuth() auth: AccessTokenPayload,
    @Param('id') id: string,
    @Body() dto: PrintOrderDto,
  ) {
    return this.restaurant.print(
      auth.organizationId,
      auth.sub,
      id,
      dto.station,
    );
  }
}
