import { Body, Controller, Delete, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '../common/guards/permissions.guard';
import { RequirePermissions } from '../common/decorators/permissions.decorator';
import { CurrentAuth } from '../common/decorators/current-auth.decorator';
import type { AccessTokenPayload } from '../auth/auth.service';
import { ProductsService } from './products.service';
import { CreateProductDto, UpdateProductDto } from './dto/product.dto';

@Controller('products')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class ProductsController {
  constructor(private readonly products: ProductsService) {}

  @Get()
  @RequirePermissions('products.read')
  list(@CurrentAuth() auth: AccessTokenPayload, @Query('q') q?: string) {
    return this.products.list(auth.organizationId, q);
  }

  @Get(':id')
  @RequirePermissions('products.read')
  findOne(@CurrentAuth() auth: AccessTokenPayload, @Param('id') id: string) {
    return this.products.findOne(auth.organizationId, id);
  }

  @Post()
  @RequirePermissions('products.create')
  create(@CurrentAuth() auth: AccessTokenPayload, @Body() dto: CreateProductDto) {
    return this.products.create(auth.organizationId, dto, auth.sub);
  }

  @Post(':id/duplicate')
  @RequirePermissions('products.create')
  duplicate(@CurrentAuth() auth: AccessTokenPayload, @Param('id') id: string) {
    return this.products.duplicate(auth.organizationId, id, auth.sub);
  }

  @Patch(':id')
  @RequirePermissions('products.update')
  update(@CurrentAuth() auth: AccessTokenPayload, @Param('id') id: string, @Body() dto: UpdateProductDto) {
    return this.products.update(auth.organizationId, id, dto, auth.sub);
  }

  @Delete(':id')
  @RequirePermissions('products.update')
  async remove(@CurrentAuth() auth: AccessTokenPayload, @Param('id') id: string) {
    await this.products.remove(auth.organizationId, id, auth.sub);
    return { ok: true };
  }
}
