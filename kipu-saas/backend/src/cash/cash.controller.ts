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
import { CashService } from './cash.service';
import { OpenCashRegisterDto } from './dto/open-cash-register.dto';
import { CloseCashRegisterDto } from './dto/close-cash-register.dto';
import { CreateCashMovementDto } from './dto/create-cash-movement.dto';
import { ListCashRegistersQueryDto } from './dto/list-cash-registers-query.dto';

@Controller('cash-registers')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class CashController {
  constructor(private readonly cash: CashService) {}

  @Get()
  @RequirePermissions('cash.read')
  list(
    @CurrentAuth() auth: AccessTokenPayload,
    @Query() query: ListCashRegistersQueryDto,
  ) {
    return this.cash.list(auth.organizationId, query);
  }

  /** Caja actualmente abierta para un punto de venta, o null si no hay ninguna. */
  @Get('active')
  @RequirePermissions('cash.read')
  active(
    @CurrentAuth() auth: AccessTokenPayload,
    @Query('posTerminalId') posTerminalId: string,
  ) {
    return this.cash.findActive(auth.organizationId, posTerminalId);
  }

  @Get(':id')
  @RequirePermissions('cash.read')
  findOne(@CurrentAuth() auth: AccessTokenPayload, @Param('id') id: string) {
    return this.cash.findOne(auth.organizationId, id);
  }

  @Post()
  @RequirePermissions('cash.manage')
  open(
    @CurrentAuth() auth: AccessTokenPayload,
    @Body() dto: OpenCashRegisterDto,
  ) {
    return this.cash.open(auth.organizationId, dto, auth.sub);
  }

  @Post(':id/close')
  @RequirePermissions('cash.manage')
  close(
    @CurrentAuth() auth: AccessTokenPayload,
    @Param('id') id: string,
    @Body() dto: CloseCashRegisterDto,
  ) {
    return this.cash.close(auth.organizationId, id, dto, auth.sub);
  }

  @Post(':id/movements')
  @RequirePermissions('cash.manage')
  registerMovement(
    @CurrentAuth() auth: AccessTokenPayload,
    @Param('id') id: string,
    @Body() dto: CreateCashMovementDto,
  ) {
    return this.cash.registerMovement(auth.organizationId, id, dto, auth.sub);
  }
}
