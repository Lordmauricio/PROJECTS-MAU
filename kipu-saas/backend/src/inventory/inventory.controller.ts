import { Body, Controller, Get, Post, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '../common/guards/permissions.guard';
import { RequirePermissions } from '../common/decorators/permissions.decorator';
import { CurrentAuth } from '../common/decorators/current-auth.decorator';
import type { AccessTokenPayload } from '../auth/auth.service';
import { InventoryService } from './inventory.service';
import { CreateInventoryMovementDto } from './dto/inventory-movement.dto';

@Controller('inventory')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class InventoryController {
  constructor(private readonly inventory: InventoryService) {}

  @Get()
  @RequirePermissions('inventory.read')
  listStock(
    @CurrentAuth() auth: AccessTokenPayload,
    @Query('warehouseId') warehouseId?: string,
  ) {
    return this.inventory.listStock(auth.organizationId, warehouseId);
  }

  @Get('movements')
  @RequirePermissions('inventory.read')
  listMovements(
    @CurrentAuth() auth: AccessTokenPayload,
    @Query('warehouseId') warehouseId?: string,
    @Query('productId') productId?: string,
  ) {
    return this.inventory.listMovements(auth.organizationId, {
      warehouseId,
      productId,
    });
  }

  @Post('movements')
  @RequirePermissions('inventory.manage')
  createMovement(
    @CurrentAuth() auth: AccessTokenPayload,
    @Body() dto: CreateInventoryMovementDto,
  ) {
    return this.inventory.registerManualMovement(
      auth.organizationId,
      dto,
      auth.sub,
    );
  }
}
