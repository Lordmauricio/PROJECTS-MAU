import { Injectable, NotFoundException } from '@nestjs/common';
import { TenantPrismaService } from '../prisma/tenant-prisma.service';
import { CreateBranchDto, UpdateBranchDto } from './dto/branch.dto';

@Injectable()
export class BranchesService {
  constructor(private readonly tenantPrisma: TenantPrismaService) {}

  list(organizationId: string) {
    return this.tenantPrisma.run(organizationId, (tx) =>
      tx.branch.findMany({ where: { organizationId }, orderBy: { createdAt: 'asc' } }),
    );
  }

  async create(organizationId: string, dto: CreateBranchDto) {
    return this.tenantPrisma.run(organizationId, (tx) =>
      tx.branch.create({ data: { organizationId, ...dto } }),
    );
  }

  async update(organizationId: string, branchId: string, dto: UpdateBranchDto) {
    return this.tenantPrisma.run(organizationId, async (tx) => {
      const existing = await tx.branch.findFirst({ where: { id: branchId, organizationId } });
      if (!existing) throw new NotFoundException('Sucursal no encontrada');
      return tx.branch.update({ where: { id: branchId }, data: dto });
    });
  }
}
