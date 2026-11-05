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
import { DiningService } from './dining.service';
import { RestaurantService } from './restaurant.service';
import { CreateOrderDto } from './restaurant.dto';
import { CreatePaymentDto } from '../sales/dto/payment.dto';
import {
  SaveTableDto,
  OpenAccountDto,
  MoveAccountDto,
  AssignWaiterDto,
  SplitAccountDto,
  MergeAccountDto,
  CloseAccountDto,
} from './dining.dto';
@Controller('restaurant/dining')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class DiningController {
  constructor(
    private readonly dining: DiningService,
    private readonly restaurant: RestaurantService,
  ) {}
  @Get('waiters')
  @RequirePermissions('dining.read')
  waiters(@CurrentAuth() a: AccessTokenPayload) {
    return this.dining.waiters(a.organizationId);
  }
  @Get('tables') @RequirePermissions('dining.read') tables(
    @CurrentAuth() a: AccessTokenPayload,
    @Query('branchId') b?: string,
  ) {
    return this.dining.tables(a.organizationId, b);
  }
  @Post('tables') @RequirePermissions('sales.update') table(
    @CurrentAuth() a: AccessTokenPayload,
    @Body() d: SaveTableDto,
  ) {
    return this.dining.saveTable(a.organizationId, a.sub, d);
  }
  @Patch('tables/:id') @RequirePermissions('sales.update') editTable(
    @CurrentAuth() a: AccessTokenPayload,
    @Param('id') id: string,
    @Body() d: SaveTableDto,
  ) {
    return this.dining.saveTable(a.organizationId, a.sub, d, id);
  }
  @Get('accounts') @RequirePermissions('dining.read') list(
    @CurrentAuth() a: AccessTokenPayload,
    @Query('branchId') b?: string,
  ) {
    return this.dining.list(a.organizationId, b);
  }
  @Get('accounts/:id') @RequirePermissions('dining.read') get(
    @CurrentAuth() a: AccessTokenPayload,
    @Param('id') id: string,
  ) {
    return this.dining.get(a.organizationId, id);
  }
  @Post('accounts') @RequirePermissions('dining.serve') open(
    @CurrentAuth() a: AccessTokenPayload,
    @Body() d: OpenAccountDto,
  ) {
    return this.dining.open(a.organizationId, a.sub, d);
  }
  @Post('accounts/:id/orders') @RequirePermissions('dining.serve') order(
    @CurrentAuth() a: AccessTokenPayload,
    @Param('id') id: string,
    @Body() d: CreateOrderDto,
  ) {
    return this.restaurant.create(a.organizationId, a.sub, d, id);
  }
  @Post('accounts/:id/orders/:orderId/dispatch')
  @RequirePermissions('dining.serve')
  dispatch(
    @CurrentAuth() a: AccessTokenPayload,
    @Param('id') id: string,
    @Param('orderId') oid: string,
  ) {
    return this.dining.dispatch(a.organizationId, a.sub, id, oid);
  }
  @Post('accounts/:id/orders/:orderId/payments')
  @RequirePermissions('sales.create')
  pay(
    @CurrentAuth() a: AccessTokenPayload,
    @Param('id') id: string,
    @Param('orderId') oid: string,
    @Body() d: CreatePaymentDto,
  ) {
    return this.dining.pay(a.organizationId, a.sub, id, oid, d);
  }
  @Post('accounts/:id/move') @RequirePermissions('dining.serve') move(
    @CurrentAuth() a: AccessTokenPayload,
    @Param('id') id: string,
    @Body() d: MoveAccountDto,
  ) {
    return this.dining.move(a.organizationId, a.sub, id, d);
  }
  @Post('accounts/:id/waiter') @RequirePermissions('sales.update') assign(
    @CurrentAuth() a: AccessTokenPayload,
    @Param('id') id: string,
    @Body() d: AssignWaiterDto,
  ) {
    return this.dining.assign(a.organizationId, a.sub, id, d);
  }
  @Post('accounts/:id/split') @RequirePermissions('dining.serve') split(
    @CurrentAuth() a: AccessTokenPayload,
    @Param('id') id: string,
    @Body() d: SplitAccountDto,
  ) {
    return this.dining.split(a.organizationId, a.sub, id, d);
  }
  @Post('accounts/:id/merge') @RequirePermissions('dining.serve') merge(
    @CurrentAuth() a: AccessTokenPayload,
    @Param('id') id: string,
    @Body() d: MergeAccountDto,
  ) {
    return this.dining.merge(a.organizationId, a.sub, id, d);
  }
  @Post('accounts/:id/close') @RequirePermissions('sales.create') close(
    @CurrentAuth() a: AccessTokenPayload,
    @Param('id') id: string,
    @Body() d: CloseAccountDto,
  ) {
    return this.dining.close(a.organizationId, a.sub, id, d);
  }
}
