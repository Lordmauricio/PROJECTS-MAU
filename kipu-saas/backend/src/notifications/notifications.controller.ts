import {
  Controller,
  Get,
  Param,
  Patch,
  Query,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '../common/guards/permissions.guard';
import { NoPermissionRequired } from '../common/decorators/no-permission-required.decorator';
import { CurrentAuth } from '../common/decorators/current-auth.decorator';
import type { AccessTokenPayload } from '../auth/auth.service';
import { NotificationsService } from './notifications.service';
import { ListNotificationsQueryDto } from './dto/list-notifications-query.dto';

/**
 * Recurso personal (mis notificaciones), no un módulo de negocio con
 * permisos propios — mismo criterio que `OrganizationsController#me`:
 * `@NoPermissionRequired()` en vez de un permiso nuevo en el catálogo. La
 * pertenencia real la valida `NotificationsService` (userId del token
 * contra `Notification.userId`), no un rol.
 */
@Controller('notifications')
@UseGuards(JwtAuthGuard, PermissionsGuard)
@NoPermissionRequired()
export class NotificationsController {
  constructor(private readonly notifications: NotificationsService) {}

  @Get()
  list(
    @CurrentAuth() auth: AccessTokenPayload,
    @Query() query: ListNotificationsQueryDto,
  ) {
    return this.notifications.list(auth.organizationId, auth.sub, query);
  }

  @Get('unread-count')
  unreadCount(@CurrentAuth() auth: AccessTokenPayload) {
    return this.notifications
      .unreadCount(auth.organizationId, auth.sub)
      .then((count) => ({ count }));
  }

  @Patch('read-all')
  markAllRead(@CurrentAuth() auth: AccessTokenPayload) {
    return this.notifications.markAllRead(auth.organizationId, auth.sub);
  }

  @Patch(':id/read')
  markRead(@CurrentAuth() auth: AccessTokenPayload, @Param('id') id: string) {
    return this.notifications.markRead(auth.organizationId, auth.sub, id);
  }
}
