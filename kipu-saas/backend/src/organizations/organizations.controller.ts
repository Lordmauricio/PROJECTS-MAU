import { Controller, Get, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '../common/guards/permissions.guard';
import { NoPermissionRequired } from '../common/decorators/no-permission-required.decorator';
import { CurrentAuth } from '../common/decorators/current-auth.decorator';
import type { AccessTokenPayload } from '../auth/auth.service';
import { OrganizationsService } from './organizations.service';

@Controller('organizations')
@UseGuards(JwtAuthGuard, PermissionsGuard)
@NoPermissionRequired()
export class OrganizationsController {
  constructor(private readonly organizations: OrganizationsService) {}

  @Get('me')
  getMine(@CurrentAuth() auth: AccessTokenPayload) {
    return this.organizations.findById(auth.organizationId);
  }

  @Get('me/dashboard')
  getDashboard(@CurrentAuth() auth: AccessTokenPayload) {
    return this.organizations.getDashboardSummary(auth.organizationId);
  }
}
