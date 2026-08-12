import { Injectable } from '@nestjs/common';
import { Prisma } from '../../generated/prisma/client';
import { PrismaService } from './prisma.service';

/**
 * Ejecuta operaciones sobre tablas tenant-scoped dentro de una transacción
 * que primero fija `app.current_tenant` para la sesión de esa transacción.
 * Las policies de RLS comparan `organizationId` contra ese valor, así que
 * TODA lectura/escritura de datos de una organización debe pasar por acá.
 *
 * Por qué una transacción y no `SET` a secas: `SET LOCAL` (vía
 * `set_config(..., true)`) solo vive dentro de la transacción actual, y una
 * transacción está pineada a una única conexión física del pool. Sin la
 * transacción, dos queries sucesivas podrían ejecutarse en conexiones
 * distintas y la segunda perdería el `current_tenant` de la primera —o peor,
 * heredaría el de otra request que reusó esa conexión.
 */
@Injectable()
export class TenantPrismaService {
  constructor(private readonly prisma: PrismaService) {}

  async run<T>(
    organizationId: string,
    fn: (tx: Prisma.TransactionClient) => Promise<T>,
  ): Promise<T> {
    if (!organizationId) {
      throw new Error('TenantPrismaService.run requiere un organizationId');
    }
    return this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.current_tenant', ${organizationId}, true)`;
      return fn(tx);
    });
  }
}
