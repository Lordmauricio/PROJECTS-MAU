import { ForbiddenException, Injectable, UnauthorizedException } from '@nestjs/common';
import { CanActivate, ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { TenantPrismaService } from '../../prisma/tenant-prisma.service';
import { PERMISSIONS_KEY } from '../decorators/permissions.decorator';
import { NO_PERMISSION_REQUIRED_KEY } from '../decorators/no-permission-required.decorator';
import type { AccessTokenPayload } from '../../auth/auth.service';

/**
 * Verifica los permisos exigidos por `@RequirePermissions(...)` consultando
 * `role_permissions` en vivo (no confía en un snapshot embebido en el JWT),
 * para que revocar un permiso a un rol tenga efecto inmediato. La consulta
 * pasa por `TenantPrismaService`, así que también queda cubierta por RLS.
 *
 * Fail-closed por defecto: una ruta protegida por este guard DEBE declarar
 * explícitamente `@RequirePermissions(...)` o `@NoPermissionRequired()`. Si
 * no declara ninguno de los dos, se deniega el acceso — nunca se asume que
 * "sin decorador" significa "abierto a cualquier autenticado".
 */
@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly tenantPrisma: TenantPrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const required = this.reflector.getAllAndOverride<string[]>(PERMISSIONS_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    const noPermissionRequired = this.reflector.getAllAndOverride<boolean>(
      NO_PERMISSION_REQUIRED_KEY,
      [context.getHandler(), context.getClass()],
    );

    if ((!required || required.length === 0) && !noPermissionRequired) {
      throw new ForbiddenException(
        'Esta ruta no declara los permisos que requiere (@RequirePermissions) ni está ' +
          'marcada explícitamente como abierta a cualquier autenticado (@NoPermissionRequired). ' +
          'Acceso denegado por defecto.',
      );
    }

    const request = context.switchToHttp().getRequest();
    const auth: AccessTokenPayload | undefined = request.user;
    if (!auth) throw new UnauthorizedException();

    if (!required || required.length === 0) {
      // @NoPermissionRequired(): basta con estar autenticado.
      return true;
    }

    const grantedKeys = await this.tenantPrisma.run(auth.organizationId, (tx) =>
      tx.rolePermission
        .findMany({
          where: { roleId: auth.roleId, organizationId: auth.organizationId },
          include: { permission: true },
        })
        .then((rows) => rows.map((r) => r.permission.key)),
    );

    const hasAll = required.every((perm) => grantedKeys.includes(perm));
    if (!hasAll) {
      throw new ForbiddenException(
        `Permiso requerido: ${required.filter((p) => !grantedKeys.includes(p)).join(', ')}`,
      );
    }
    return true;
  }
}
