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
import { ReceivablesService } from './receivables.service';
import { CreatePaymentDto } from '../sales/dto/payment.dto';
import { ListReceivablesQueryDto } from './dto/list-receivables-query.dto';

@Controller('receivables')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class ReceivablesController {
  constructor(private readonly receivables: ReceivablesService) {}

  @Get()
  @RequirePermissions('receivables.read')
  list(
    @CurrentAuth() auth: AccessTokenPayload,
    @Query() query: ListReceivablesQueryDto,
  ) {
    return this.receivables.list(auth.organizationId, query);
  }

  @Get(':id')
  @RequirePermissions('receivables.read')
  findOne(@CurrentAuth() auth: AccessTokenPayload, @Param('id') id: string) {
    return this.receivables.findOne(auth.organizationId, id);
  }

  @Post(':id/payments')
  @RequirePermissions('receivables.manage')
  addPayment(
    @CurrentAuth() auth: AccessTokenPayload,
    @Param('id') id: string,
    @Body() dto: CreatePaymentDto,
  ) {
    return this.receivables.addPayment(auth.organizationId, id, dto, auth.sub);
  }
}
