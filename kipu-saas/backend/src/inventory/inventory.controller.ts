import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '../common/guards/permissions.guard';
import { RequirePermissions } from '../common/decorators/permissions.decorator';
import { CurrentAuth } from '../common/decorators/current-auth.decorator';
import type { AccessTokenPayload } from '../auth/auth.service';
import { InventoryService } from './inventory.service';
import { CreateInventoryMovementDto } from './dto/inventory-movement.dto';
import { CreateInventoryTransferDto } from './dto/inventory-transfer.dto';
import { KardexQueryDto } from './dto/kardex-query.dto';

@Controller('inventory')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class InventoryController {
  constructor(private readonly inventory: InventoryService) {}

  @Get()
  @RequirePermissions('inventory.read')
  listStock(
    @CurrentAuth() auth: AccessTokenPayload,
    @Query('warehouseId') warehouseId?: string,
    @Query('productId') productId?: string,
  ) {
    return this.inventory.listStock(auth.organizationId, {
      warehouseId,
      productId,
    });
  }

  @Get('movements')
  @RequirePermissions('inventory.read')
  listMovements(
    @CurrentAuth() auth: AccessTokenPayload,
    @Query() query: KardexQueryDto,
  ) {
    return this.inventory.listMovements(auth.organizationId, query);
  }

  /** Kardex real: historial cronológico de UN producto en UN almacén, con saldo corriente. */
  @Get('kardex')
  @RequirePermissions('inventory.read')
  kardex(
    @CurrentAuth() auth: AccessTokenPayload,
    @Query('productId') productId?: string,
    @Query('warehouseId') warehouseId?: string,
    @Query('dateFrom') dateFrom?: string,
    @Query('dateTo') dateTo?: string,
  ) {
    if (!productId || !warehouseId) {
      throw new BadRequestException(
        'El kardex requiere productId y warehouseId',
      );
    }
    return this.inventory.kardex(auth.organizationId, productId, warehouseId, {
      dateFrom,
      dateTo,
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

  @Post('transfers')
  @RequirePermissions('inventory.manage')
  transfer(
    @CurrentAuth() auth: AccessTokenPayload,
    @Body() dto: CreateInventoryTransferDto,
  ) {
    return this.inventory.transfer(auth.organizationId, dto, auth.sub);
  }
}
