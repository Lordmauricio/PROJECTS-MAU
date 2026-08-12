import { SetMetadata } from '@nestjs/common';

export const NO_PERMISSION_REQUIRED_KEY = 'noPermissionRequired';

/**
 * Marca explícita de "esta ruta solo exige estar autenticado, no un permiso
 * específico". Existe para que `PermissionsGuard` pueda ser fail-closed por
 * defecto: una ruta sin `@RequirePermissions(...)` y sin este decorador es
 * denegada, en vez de quedar accesible por accidente.
 *
 * Uso: @NoPermissionRequired()
 */
export const NoPermissionRequired = () => SetMetadata(NO_PERMISSION_REQUIRED_KEY, true);
