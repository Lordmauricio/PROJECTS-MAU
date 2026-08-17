import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '../common/guards/permissions.guard';
import { RequirePermissions } from '../common/decorators/permissions.decorator';
import { CurrentAuth } from '../common/decorators/current-auth.decorator';
import type { AccessTokenPayload } from '../auth/auth.service';
import { PurchasesService } from './purchases.service';
import {
  CreatePurchaseDto,
  UpdatePurchaseDto,
} from './dto/create-purchase.dto';
import { ReceivePurchaseDto } from './dto/receive-purchase.dto';
import { ReturnPurchaseDto } from './dto/return-purchase.dto';
import { ListPurchasesQueryDto } from './dto/list-purchases-query.dto';

@Controller('purchases')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class PurchasesController {
  constructor(private readonly purchases: PurchasesService) {}

  @Get()
  @RequirePermissions('purchases.read')
  list(
    @CurrentAuth() auth: AccessTokenPayload,
    @Query() query: ListPurchasesQueryDto,
  ) {
    return this.purchases.list(auth.organizationId, query);
  }

  @Get(':id')
  @RequirePermissions('purchases.read')
  findOne(@CurrentAuth() auth: AccessTokenPayload, @Param('id') id: string) {
    return this.purchases.findOne(auth.organizationId, id);
  }

  @Post()
  @RequirePermissions('purchases.manage')
  create(
    @CurrentAuth() auth: AccessTokenPayload,
    @Body() dto: CreatePurchaseDto,
  ) {
    return this.purchases.create(auth.organizationId, dto, auth.sub);
  }

  @Patch(':id')
  @RequirePermissions('purchases.manage')
  update(
    @CurrentAuth() auth: AccessTokenPayload,
    @Param('id') id: string,
    @Body() dto: UpdatePurchaseDto,
  ) {
    return this.purchases.update(auth.organizationId, id, dto, auth.sub);
  }

  @Post(':id/confirm')
  @RequirePermissions('purchases.manage')
  confirm(@CurrentAuth() auth: AccessTokenPayload, @Param('id') id: string) {
    return this.purchases.confirm(auth.organizationId, id, auth.sub);
  }

  @Post(':id/receive')
  @RequirePermissions('purchases.manage')
  receive(
    @CurrentAuth() auth: AccessTokenPayload,
    @Param('id') id: string,
    @Body() dto: ReceivePurchaseDto,
  ) {
    return this.purchases.receive(auth.organizationId, id, dto, auth.sub);
  }

  @Post(':id/return')
  @RequirePermissions('purchases.manage')
  returnToSupplier(
    @CurrentAuth() auth: AccessTokenPayload,
    @Param('id') id: string,
    @Body() dto: ReturnPurchaseDto,
  ) {
    return this.purchases.returnToSupplier(
      auth.organizationId,
      id,
      dto,
      auth.sub,
    );
  }

  @Post(':id/cancel')
  @RequirePermissions('purchases.manage')
  cancel(@CurrentAuth() auth: AccessTokenPayload, @Param('id') id: string) {
    return this.purchases.cancel(auth.organizationId, id, auth.sub);
  }
}
