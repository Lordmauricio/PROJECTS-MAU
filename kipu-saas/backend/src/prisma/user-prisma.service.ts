import { Injectable } from '@nestjs/common';
import { Prisma } from '../../generated/prisma/client';
import { PrismaService } from './prisma.service';

/**
 * Análogo a `TenantPrismaService`, pero para el único caso legítimo en que
 * hace falta leer datos de un usuario ANTES de conocer con qué organización
 * va a operar la request: resolver "¿a qué organizaciones pertenece este
 * usuario?" durante login/refresh, contra `organization_users` — tabla
 * tenant-scoped con RLS forzado por `organizationId`.
 *
 * La policy `tenant_isolation` de `organization_users` por sí sola no
 * alcanza acá: en login/refresh todavía no sabemos el `organizationId`, así
 * que no hay ningún valor de `app.current_tenant` que fijar. Por eso existe
 * una policy adicional (`own_memberships_readable`, ver migración) que
 * permite SELECT cuando `userId = current_setting('app.current_user_id')`
 * — un usuario siempre puede leer sus propias filas de membresía (cuáles
 * organizaciones integra y con qué rol), sin exponer datos de negocio de
 * ningún tenant. Esa policy es de solo lectura: los INSERT/UPDATE/DELETE de
 * `organization_users` siguen exigiendo `app.current_tenant` como siempre.
 */
@Injectable()
export class UserPrismaService {
  constructor(private readonly prisma: PrismaService) {}

  async run<T>(userId: string, fn: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
    if (!userId) {
      throw new Error('UserPrismaService.run requiere un userId');
    }
    return this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.current_user_id', ${userId}, true)`;
      return fn(tx);
    });
  }
}
