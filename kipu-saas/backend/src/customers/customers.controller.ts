import { Body, Controller, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '../common/guards/permissions.guard';
import { RequirePermissions } from '../common/decorators/permissions.decorator';
import { CurrentAuth } from '../common/decorators/current-auth.decorator';
import type { AccessTokenPayload } from '../auth/auth.service';
import { CustomersService } from './customers.service';
import { CreateCustomerDto, UpdateCustomerDto } from './dto/customer.dto';

@Controller('customers')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class CustomersController {
  constructor(private readonly customers: CustomersService) {}

  @Get()
  @RequirePermissions('customers.read')
  list(@CurrentAuth() auth: AccessTokenPayload, @Query('q') q?: string) {
    return this.customers.list(auth.organizationId, q);
  }

  @Get(':id')
  @RequirePermissions('customers.read')
  findOne(@CurrentAuth() auth: AccessTokenPayload, @Param('id') id: string) {
    return this.customers.findOne(auth.organizationId, id);
  }

  @Post()
  @RequirePermissions('customers.manage')
  create(@CurrentAuth() auth: AccessTokenPayload, @Body() dto: CreateCustomerDto) {
    return this.customers.create(auth.organizationId, dto, auth.sub);
  }

  @Patch(':id')
  @RequirePermissions('customers.manage')
  update(@CurrentAuth() auth: AccessTokenPayload, @Param('id') id: string, @Body() dto: UpdateCustomerDto) {
    return this.customers.update(auth.organizationId, id, dto, auth.sub);
  }
}
