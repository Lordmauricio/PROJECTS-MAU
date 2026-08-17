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
import { SalesService } from './sales.service';
import { CreateSaleDto } from './dto/create-sale.dto';
import { ConfirmSaleDto, CreatePaymentDto } from './dto/payment.dto';
import { ListSalesQueryDto } from './dto/list-sales-query.dto';
import { ReturnSaleDto } from './dto/return-sale.dto';

@Controller('sales')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class SalesController {
  constructor(private readonly sales: SalesService) {}

  @Get()
  @RequirePermissions('sales.read')
  list(
    @CurrentAuth() auth: AccessTokenPayload,
    @Query() query: ListSalesQueryDto,
  ) {
    return this.sales.list(auth.organizationId, query);
  }

  @Get(':id')
  @RequirePermissions('sales.read')
  findOne(@CurrentAuth() auth: AccessTokenPayload, @Param('id') id: string) {
    return this.sales.findOne(auth.organizationId, id);
  }

  @Post()
  @RequirePermissions('sales.create')
  create(@CurrentAuth() auth: AccessTokenPayload, @Body() dto: CreateSaleDto) {
    return this.sales.create(auth.organizationId, dto, auth.sub);
  }

  @Post(':id/confirm')
  @RequirePermissions('sales.create')
  confirm(
    @CurrentAuth() auth: AccessTokenPayload,
    @Param('id') id: string,
    @Body() dto: ConfirmSaleDto,
  ) {
    return this.sales.confirm(auth.organizationId, id, dto, auth.sub);
  }

  @Post(':id/payments')
  @RequirePermissions('sales.create')
  addPayment(
    @CurrentAuth() auth: AccessTokenPayload,
    @Param('id') id: string,
    @Body() dto: CreatePaymentDto,
  ) {
    return this.sales.addPayment(auth.organizationId, id, dto, auth.sub);
  }

  @Post(':id/cancel')
  @RequirePermissions('sales.delete')
  cancel(@CurrentAuth() auth: AccessTokenPayload, @Param('id') id: string) {
    return this.sales.cancel(auth.organizationId, id, auth.sub);
  }

  @Post(':id/return')
  @RequirePermissions('sales.delete')
  returnSale(
    @CurrentAuth() auth: AccessTokenPayload,
    @Param('id') id: string,
    @Body() dto: ReturnSaleDto,
  ) {
    return this.sales.returnSale(auth.organizationId, id, dto, auth.sub);
  }
}
