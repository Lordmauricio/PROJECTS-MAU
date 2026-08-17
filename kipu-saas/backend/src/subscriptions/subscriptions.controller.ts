import { Controller, Get, Post, Body, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '../common/guards/permissions.guard';
import { RequirePermissions } from '../common/decorators/permissions.decorator';
import { NoPermissionRequired } from '../common/decorators/no-permission-required.decorator';
import { CurrentAuth } from '../common/decorators/current-auth.decorator';
import type { AccessTokenPayload } from '../auth/auth.service';
import { SubscriptionsService } from './subscriptions.service';
import { ChangePlanDto } from './dto/change-plan.dto';

/**
 * Mismo prefijo (`organizations/me/subscription`) que ya usaba
 * `OrganizationsController#getSubscription` antes de esta fase — no cambia
 * la URL que el frontend ya consumía, solo mueve la lógica de negocio a un
 * módulo propio (`SubscriptionsModule`). Ver el resto en/`organizations/`
 * para lo que sigue viviendo ahí (perfil de la empresa, dashboard).
 */
@Controller('organizations/me/subscription')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class SubscriptionsController {
  constructor(private readonly subscriptions: SubscriptionsService) {}

  @Get()
  @NoPermissionRequired()
  getSummary(@CurrentAuth() auth: AccessTokenPayload) {
    return this.subscriptions.getSummary(auth.organizationId);
  }

  /** Catálogo de planes disponibles (para la UI de "cambiar de plan") — no depende de la organización, cualquier autenticado puede verlo. */
  @Get('plans')
  @NoPermissionRequired()
  listPlans() {
    return this.subscriptions.listPlans();
  }

  @Post('change-plan')
  @RequirePermissions('subscription.manage')
  changePlan(
    @CurrentAuth() auth: AccessTokenPayload,
    @Body() dto: ChangePlanDto,
  ) {
    return this.subscriptions.changePlan(
      auth.organizationId,
      dto.planKey,
      auth.sub,
    );
  }

  @Post('cancel')
  @RequirePermissions('subscription.manage')
  cancel(@CurrentAuth() auth: AccessTokenPayload) {
    return this.subscriptions.cancel(auth.organizationId, auth.sub);
  }

  @Post('renew')
  @RequirePermissions('subscription.manage')
  renew(@CurrentAuth() auth: AccessTokenPayload) {
    return this.subscriptions.renew(auth.organizationId, auth.sub);
  }
}
