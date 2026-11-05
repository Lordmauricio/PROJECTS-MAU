import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '../common/guards/permissions.guard';
import { RequirePermissions } from '../common/decorators/permissions.decorator';
import { CurrentAuth } from '../common/decorators/current-auth.decorator';
import type { AccessTokenPayload } from '../auth/auth.service';
import { StockOperationsService } from './stock-operations.service';
import { StockOperationDto, TrackingDto } from './stock-operations.dto';
@Controller('inventory/control')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class StockOperationsController {
  constructor(private readonly stock: StockOperationsService) {}
  @Get('lots/:id/movements')
  @RequirePermissions('inventory.read')
  history(@CurrentAuth() a: AccessTokenPayload, @Param('id') id: string) {
    return this.stock.history(a.organizationId, id);
  }
  @Get() @RequirePermissions('inventory.read') list(
    @CurrentAuth() a: AccessTokenPayload,
    @Query('warehouseId') w?: string,
  ) {
    return this.stock.list(a.organizationId, w);
  }
  @Post() @RequirePermissions('inventory.manage') register(
    @CurrentAuth() a: AccessTokenPayload,
    @Body() d: StockOperationDto,
  ) {
    return this.stock.register(a.organizationId, a.sub, d);
  }
  @Post('products/:id/tracking')
  @RequirePermissions('inventory.manage')
  tracking(
    @CurrentAuth() a: AccessTokenPayload,
    @Param('id') id: string,
    @Body() d: TrackingDto,
  ) {
    return this.stock.tracking(a.organizationId, a.sub, id, d.required);
  }
}
