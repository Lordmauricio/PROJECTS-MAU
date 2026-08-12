import { Injectable, NotFoundException } from '@nestjs/common';
import { TenantPrismaService } from '../prisma/tenant-prisma.service';
import { AuditService } from '../audit/audit.service';
import { CreateSupplierDto, UpdateSupplierDto } from './dto/supplier.dto';

@Injectable()
export class SuppliersService {
  constructor(
    private readonly tenantPrisma: TenantPrismaService,
    private readonly audit: AuditService,
  ) {}

  list(organizationId: string, search?: string) {
    return this.tenantPrisma.run(organizationId, (tx) =>
      tx.supplier.findMany({
        where: {
          organizationId,
          ...(search ? { name: { contains: search, mode: 'insensitive' } } : {}),
        },
        orderBy: { createdAt: 'desc' },
        take: 100,
      }),
    );
  }

  async findOne(organizationId: string, supplierId: string) {
    return this.tenantPrisma.run(organizationId, async (tx) => {
      const supplier = await tx.supplier.findFirst({
        where: { id: supplierId, organizationId },
        include: {
          purchases: { orderBy: { createdAt: 'desc' }, take: 20 },
          payables: { orderBy: { dueDate: 'asc' } },
        },
      });
      if (!supplier) throw new NotFoundException('Proveedor no encontrado');
      return supplier;
    });
  }

  async create(organizationId: string, dto: CreateSupplierDto, actorUserId: string) {
    const supplier = await this.tenantPrisma.run(organizationId, (tx) =>
      tx.supplier.create({ data: { organizationId, ...dto } }),
    );
    await this.audit.log({
      organizationId,
      userId: actorUserId,
      action: 'suppliers.create',
      entityType: 'Supplier',
      entityId: supplier.id,
    });
    return supplier;
  }

  async update(organizationId: string, supplierId: string, dto: UpdateSupplierDto, actorUserId: string) {
    const updated = await this.tenantPrisma.run(organizationId, async (tx) => {
      const existing = await tx.supplier.findFirst({ where: { id: supplierId, organizationId } });
      if (!existing) throw new NotFoundException('Proveedor no encontrado');
      return tx.supplier.update({ where: { id: supplierId }, data: dto });
    });
    await this.audit.log({
      organizationId,
      userId: actorUserId,
      action: 'suppliers.update',
      entityType: 'Supplier',
      entityId: supplierId,
    });
    return updated;
  }
}
