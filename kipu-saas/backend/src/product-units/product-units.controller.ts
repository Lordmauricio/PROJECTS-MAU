import { Body, Controller, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '../common/guards/permissions.guard';
import { RequirePermissions } from '../common/decorators/permissions.decorator';
import { CurrentAuth } from '../common/decorators/current-auth.decorator';
import type { AccessTokenPayload } from '../auth/auth.service';
import { ProductUnitsService } from './product-units.service';
import { CreateProductUnitDto, UpdateProductUnitDto } from './dto/product-unit.dto';

@Controller('product-units')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class ProductUnitsController {
  constructor(private readonly units: ProductUnitsService) {}

  @Get()
  @RequirePermissions('products.read')
  list(@CurrentAuth() auth: AccessTokenPayload) {
    return this.units.list(auth.organizationId);
  }

  @Post()
  @RequirePermissions('products.create')
  create(@CurrentAuth() auth: AccessTokenPayload, @Body() dto: CreateProductUnitDto) {
    return this.units.create(auth.organizationId, dto, auth.sub);
  }

  @Patch(':id')
  @RequirePermissions('products.update')
  update(@CurrentAuth() auth: AccessTokenPayload, @Param('id') id: string, @Body() dto: UpdateProductUnitDto) {
    return this.units.update(auth.organizationId, id, dto, auth.sub);
  }
}
