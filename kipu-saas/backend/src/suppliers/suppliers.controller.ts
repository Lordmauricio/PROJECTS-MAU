import { Body, Controller, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '../common/guards/permissions.guard';
import { RequirePermissions } from '../common/decorators/permissions.decorator';
import { CurrentAuth } from '../common/decorators/current-auth.decorator';
import type { AccessTokenPayload } from '../auth/auth.service';
import { SuppliersService } from './suppliers.service';
import { CreateSupplierDto, UpdateSupplierDto } from './dto/supplier.dto';

@Controller('suppliers')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class SuppliersController {
  constructor(private readonly suppliers: SuppliersService) {}

  @Get()
  @RequirePermissions('suppliers.read')
  list(@CurrentAuth() auth: AccessTokenPayload, @Query('q') q?: string) {
    return this.suppliers.list(auth.organizationId, q);
  }

  @Get(':id')
  @RequirePermissions('suppliers.read')
  findOne(@CurrentAuth() auth: AccessTokenPayload, @Param('id') id: string) {
    return this.suppliers.findOne(auth.organizationId, id);
  }

  @Post()
  @RequirePermissions('suppliers.manage')
  create(@CurrentAuth() auth: AccessTokenPayload, @Body() dto: CreateSupplierDto) {
    return this.suppliers.create(auth.organizationId, dto, auth.sub);
  }

  @Patch(':id')
  @RequirePermissions('suppliers.manage')
  update(@CurrentAuth() auth: AccessTokenPayload, @Param('id') id: string, @Body() dto: UpdateSupplierDto) {
    return this.suppliers.update(auth.organizationId, id, dto, auth.sub);
  }
}
