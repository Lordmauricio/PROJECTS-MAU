import { Body, Controller, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '../common/guards/permissions.guard';
import { RequirePermissions } from '../common/decorators/permissions.decorator';
import { CurrentAuth } from '../common/decorators/current-auth.decorator';
import type { AccessTokenPayload } from '../auth/auth.service';
import { ProductCategoriesService } from './product-categories.service';
import { CreateProductCategoryDto, UpdateProductCategoryDto } from './dto/product-category.dto';

@Controller('product-categories')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class ProductCategoriesController {
  constructor(private readonly categories: ProductCategoriesService) {}

  @Get()
  @RequirePermissions('products.read')
  list(@CurrentAuth() auth: AccessTokenPayload) {
    return this.categories.list(auth.organizationId);
  }

  @Post()
  @RequirePermissions('products.create')
  create(@CurrentAuth() auth: AccessTokenPayload, @Body() dto: CreateProductCategoryDto) {
    return this.categories.create(auth.organizationId, dto, auth.sub);
  }

  @Patch(':id')
  @RequirePermissions('products.update')
  update(
    @CurrentAuth() auth: AccessTokenPayload,
    @Param('id') id: string,
    @Body() dto: UpdateProductCategoryDto,
  ) {
    return this.categories.update(auth.organizationId, id, dto, auth.sub);
  }
}
