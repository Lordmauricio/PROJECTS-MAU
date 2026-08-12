import { Body, Controller, Get, Param, Put, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '../common/guards/permissions.guard';
import { RequirePermissions } from '../common/decorators/permissions.decorator';
import { CurrentAuth } from '../common/decorators/current-auth.decorator';
import type { AccessTokenPayload } from '../auth/auth.service';
import { RolesService } from './roles.service';
import { SetRolePermissionsDto } from './dto/set-role-permissions.dto';

@Controller('roles')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class RolesController {
  constructor(private readonly roles: RolesService) {}

  @Get()
  list(@CurrentAuth() auth: AccessTokenPayload) {
    return this.roles.list(auth.organizationId);
  }

  @Get('permissions-catalog')
  catalog() {
    return this.roles.listPermissionCatalog();
  }

  @Put(':id/permissions')
  @RequirePermissions('organization.roles.manage')
  setPermissions(
    @CurrentAuth() auth: AccessTokenPayload,
    @Param('id') id: string,
    @Body() dto: SetRolePermissionsDto,
  ) {
    return this.roles.setRolePermissions(auth.organizationId, id, dto.permissionKeys, auth.sub);
  }
}
