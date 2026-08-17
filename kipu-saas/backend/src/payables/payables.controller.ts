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
import { PayablesService } from './payables.service';
import { CreatePayablePaymentDto } from './dto/payable-payment.dto';
import { ListPayablesQueryDto } from './dto/list-payables-query.dto';

@Controller('payables')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class PayablesController {
  constructor(private readonly payables: PayablesService) {}

  @Get()
  @RequirePermissions('payables.read')
  list(
    @CurrentAuth() auth: AccessTokenPayload,
    @Query() query: ListPayablesQueryDto,
  ) {
    return this.payables.list(auth.organizationId, query);
  }

  @Get(':id')
  @RequirePermissions('payables.read')
  findOne(@CurrentAuth() auth: AccessTokenPayload, @Param('id') id: string) {
    return this.payables.findOne(auth.organizationId, id);
  }

  @Post(':id/payments')
  @RequirePermissions('payables.manage')
  addPayment(
    @CurrentAuth() auth: AccessTokenPayload,
    @Param('id') id: string,
    @Body() dto: CreatePayablePaymentDto,
  ) {
    return this.payables.addPayment(auth.organizationId, id, dto, auth.sub);
  }
}
