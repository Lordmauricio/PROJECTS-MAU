import { Injectable, NotFoundException } from '@nestjs/common';
import { TenantPrismaService } from '../prisma/tenant-prisma.service';
import { AuditService } from '../audit/audit.service';
import { CreateBranchDto, UpdateBranchDto } from './dto/branch.dto';

@Injectable()
export class BranchesService {
  constructor(
    private readonly tenantPrisma: TenantPrismaService,
    private readonly audit: AuditService,
  ) {}

  list(organizationId: string) {
    return this.tenantPrisma.run(organizationId, (tx) =>
      tx.branch.findMany({
        where: { organizationId },
        include: { warehouses: true, posTerminals: true },
        orderBy: { createdAt: 'asc' },
      }),
    );
  }

  async create(organizationId: string, dto: CreateBranchDto, actorUserId: string) {
    const branch = await this.tenantPrisma.run(organizationId, (tx) =>
      tx.branch.create({ data: { organizationId, ...dto } }),
    );
    await this.audit.log({
      organizationId,
      userId: actorUserId,
      action: 'branches.create',
      entityType: 'Branch',
      entityId: branch.id,
    });
    return branch;
  }

  async update(organizationId: string, branchId: string, dto: UpdateBranchDto, actorUserId: string) {
    const updated = await this.tenantPrisma.run(organizationId, async (tx) => {
      const existing = await tx.branch.findFirst({ where: { id: branchId, organizationId } });
      if (!existing) throw new NotFoundException('Sucursal no encontrada');
      return tx.branch.update({ where: { id: branchId }, data: dto });
    });
    await this.audit.log({
      organizationId,
      userId: actorUserId,
      action: 'branches.update',
      entityType: 'Branch',
      entityId: branchId,
    });
    return updated;
  }
}
