import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { TenantPrismaService } from '../prisma/tenant-prisma.service';
import { AuditService } from '../audit/audit.service';

@Injectable()
export class RolesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantPrisma: TenantPrismaService,
    private readonly audit: AuditService,
  ) {}

  list(organizationId: string) {
    return this.tenantPrisma.run(organizationId, (tx) =>
      tx.role.findMany({
        where: { organizationId },
        include: { rolePermissions: { include: { permission: true } } },
        orderBy: { name: 'asc' },
      }),
    );
  }

  listPermissionCatalog() {
    return this.prisma.permission.findMany({ orderBy: [{ module: 'asc' }, { key: 'asc' }] });
  }

  async setRolePermissions(
    organizationId: string,
    roleId: string,
    permissionKeys: string[],
    actorUserId: string,
  ) {
    const updated = await this.tenantPrisma.run(organizationId, async (tx) => {
      const role = await tx.role.findFirst({ where: { id: roleId, organizationId } });
      if (!role) throw new NotFoundException('Rol no encontrado');

      const permissions = await this.prisma.permission.findMany({
        where: { key: { in: permissionKeys } },
      });

      await tx.rolePermission.deleteMany({ where: { roleId, organizationId } });
      if (permissions.length > 0) {
        await tx.rolePermission.createMany({
          data: permissions.map((p) => ({ organizationId, roleId, permissionId: p.id })),
        });
      }

      return tx.role.findUniqueOrThrow({
        where: { id: roleId },
        include: { rolePermissions: { include: { permission: true } } },
      });
    });

    await this.audit.log({
      organizationId,
      userId: actorUserId,
      action: 'role.permissions.update',
      entityType: 'Role',
      entityId: roleId,
      metadata: { permissionKeys },
    });

    return updated;
  }
}
