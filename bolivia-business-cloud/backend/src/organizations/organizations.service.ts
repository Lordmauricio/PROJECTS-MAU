import { Injectable } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { Prisma, type Role } from '../../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { TenantPrismaService } from '../prisma/tenant-prisma.service';
import {
  DEFAULT_ROLE_KEYS,
  DEFAULT_ROLE_NAMES,
  DEFAULT_ROLE_PERMISSIONS,
} from '../permissions/permissions.catalog';

export interface BootstrapOrganizationInput {
  organizationName: string;
  legalName: string;
  nit: string;
  branchName: string;
  ownerEmail: string;
  ownerName: string;
  ownerPasswordHash: string;
}

@Injectable()
export class OrganizationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantPrisma: TenantPrismaService,
  ) {}

  /**
   * Crea una organización nueva con su sucursal principal, sus roles por
   * defecto (clonados del catálogo global de permisos) y la membresía del
   * usuario dueño con rol "owner".
   *
   * Nota sobre RLS: `organizations` valida sus propias filas contra su
   * propio `id` (es la raíz del árbol de tenancy), así que hay que fijar
   * `app.current_tenant` a un id generado ANTES del INSERT para que la
   * policy `WITH CHECK` lo acepte. Las demás tablas (roles, branches,
   * organization_users) se validan contra `organizationId`, que ya
   * conocemos en este punto, así que no tienen ese problema de huevo y
   * gallina.
   *
   * El usuario dueño se crea DENTRO de esta misma transacción (la tabla
   * `users` no tiene RLS, así que `tx.user.create` funciona igual): si
   * cualquier paso posterior falla, toda la operación revierte, incluido el
   * usuario. Crearlo antes, en una transacción aparte, dejaría cuentas
   * huérfanas (usuario creado, sin organización) cuando el bootstrap falla.
   */
  async bootstrapOrganization(input: BootstrapOrganizationInput) {
    const organizationId = randomUUID();

    return this.tenantPrisma.run(organizationId, async (tx) => {
      const organization = await tx.organization.create({
        data: {
          id: organizationId,
          name: input.organizationName,
          legalName: input.legalName,
          nit: input.nit,
        },
      });

      const roles = await this.seedDefaultRoles(tx, organizationId);

      const branch = await tx.branch.create({
        data: {
          organizationId,
          name: input.branchName,
          isMainOffice: true,
        },
      });

      const user = await tx.user.create({
        data: {
          email: input.ownerEmail,
          name: input.ownerName,
          passwordHash: input.ownerPasswordHash,
        },
      });

      const ownerRole = roles.find((r) => r.key === 'owner')!;

      const membership = await tx.organizationUser.create({
        data: {
          organizationId,
          userId: user.id,
          roleId: ownerRole.id,
          status: 'ACTIVE',
          joinedAt: new Date(),
        },
      });

      return { organization, branch, membership, roles, user };
    });
  }

  private async seedDefaultRoles(tx: Prisma.TransactionClient, organizationId: string) {
    const allPermissions = await this.prisma.permission.findMany();
    const permissionByKey = new Map(allPermissions.map((p) => [p.key, p.id]));

    const roles: Role[] = [];
    for (const roleKey of DEFAULT_ROLE_KEYS) {
      const role = await tx.role.create({
        data: {
          organizationId,
          key: roleKey,
          name: DEFAULT_ROLE_NAMES[roleKey],
          isSystem: true,
        },
      });

      const grantedKeys = [...new Set(DEFAULT_ROLE_PERMISSIONS[roleKey])];
      const data = grantedKeys
        .map((key) => permissionByKey.get(key))
        .filter((id): id is string => Boolean(id))
        .map((permissionId) => ({
          organizationId,
          roleId: role.id,
          permissionId,
        }));

      if (data.length > 0) {
        await tx.rolePermission.createMany({ data });
      }

      roles.push(role);
    }
    return roles;
  }

  async findById(organizationId: string) {
    return this.tenantPrisma.run(organizationId, (tx) =>
      tx.organization.findUniqueOrThrow({ where: { id: organizationId } }),
    );
  }

  async listBranches(organizationId: string) {
    return this.tenantPrisma.run(organizationId, (tx) =>
      tx.branch.findMany({ where: { organizationId }, orderBy: { createdAt: 'asc' } }),
    );
  }
}
