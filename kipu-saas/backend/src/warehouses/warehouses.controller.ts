import { Body, Controller, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '../common/guards/permissions.guard';
import { RequirePermissions } from '../common/decorators/permissions.decorator';
import { CurrentAuth } from '../common/decorators/current-auth.decorator';
import type { AccessTokenPayload } from '../auth/auth.service';
import { WarehousesService } from './warehouses.service';
import { CreateWarehouseDto, UpdateWarehouseDto } from './dto/warehouse.dto';

@Controller('warehouses')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class WarehousesController {
  constructor(private readonly warehouses: WarehousesService) {}

  @Get()
  @RequirePermissions('organization.branches.read')
  list(@CurrentAuth() auth: AccessTokenPayload) {
    return this.warehouses.list(auth.organizationId);
  }

  @Post()
  @RequirePermissions('organization.branches.manage')
  create(@CurrentAuth() auth: AccessTokenPayload, @Body() dto: CreateWarehouseDto) {
    return this.warehouses.create(auth.organizationId, dto, auth.sub);
  }

  @Patch(':id')
  @RequirePermissions('organization.branches.manage')
  update(
    @CurrentAuth() auth: AccessTokenPayload,
    @Param('id') id: string,
    @Body() dto: UpdateWarehouseDto,
  ) {
    return this.warehouses.update(auth.organizationId, id, dto, auth.sub);
  }
}
