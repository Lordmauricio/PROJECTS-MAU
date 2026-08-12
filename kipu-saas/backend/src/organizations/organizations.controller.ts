import { Controller, Get, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentAuth } from '../common/decorators/current-auth.decorator';
import type { AccessTokenPayload } from '../auth/auth.service';
import { OrganizationsService } from './organizations.service';

@Controller('organizations')
@UseGuards(JwtAuthGuard)
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

  @Get('me/subscription')
  getSubscription(@CurrentAuth() auth: AccessTokenPayload) {
    return this.organizations.getSubscription(auth.organizationId);
  }
}
