import { Body, Controller, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '../common/guards/permissions.guard';
import { RequirePermissions } from '../common/decorators/permissions.decorator';
import { CurrentAuth } from '../common/decorators/current-auth.decorator';
import type { AccessTokenPayload } from '../auth/auth.service';
import { POSTerminalsService } from './pos-terminals.service';
import { CreatePOSTerminalDto, UpdatePOSTerminalDto } from './dto/pos-terminal.dto';

@Controller('pos-terminals')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class POSTerminalsController {
  constructor(private readonly posTerminals: POSTerminalsService) {}

  @Get()
  list(@CurrentAuth() auth: AccessTokenPayload) {
    return this.posTerminals.list(auth.organizationId);
  }

  @Post()
  @RequirePermissions('organization.branches.manage')
  create(@CurrentAuth() auth: AccessTokenPayload, @Body() dto: CreatePOSTerminalDto) {
    return this.posTerminals.create(auth.organizationId, dto, auth.sub);
  }

  @Patch(':id')
  @RequirePermissions('organization.branches.manage')
  update(
    @CurrentAuth() auth: AccessTokenPayload,
    @Param('id') id: string,
    @Body() dto: UpdatePOSTerminalDto,
  ) {
    return this.posTerminals.update(auth.organizationId, id, dto, auth.sub);
  }
}
