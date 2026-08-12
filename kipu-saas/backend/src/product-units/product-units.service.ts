import { Injectable, NotFoundException } from '@nestjs/common';
import { TenantPrismaService } from '../prisma/tenant-prisma.service';
import { AuditService } from '../audit/audit.service';
import { CreateProductUnitDto, UpdateProductUnitDto } from './dto/product-unit.dto';

@Injectable()
export class ProductUnitsService {
  constructor(
    private readonly tenantPrisma: TenantPrismaService,
    private readonly audit: AuditService,
  ) {}

  list(organizationId: string) {
    return this.tenantPrisma.run(organizationId, (tx) =>
      tx.productUnit.findMany({ where: { organizationId, active: true }, orderBy: { name: 'asc' } }),
    );
  }

  async create(organizationId: string, dto: CreateProductUnitDto, actorUserId: string) {
    const unit = await this.tenantPrisma.run(organizationId, (tx) =>
      tx.productUnit.create({ data: { organizationId, ...dto } }),
    );
    await this.audit.log({
      organizationId,
      userId: actorUserId,
      action: 'product_units.create',
      entityType: 'ProductUnit',
      entityId: unit.id,
    });
    return unit;
  }

  async update(organizationId: string, id: string, dto: UpdateProductUnitDto, actorUserId: string) {
    const updated = await this.tenantPrisma.run(organizationId, async (tx) => {
      const existing = await tx.productUnit.findFirst({ where: { id, organizationId } });
      if (!existing) throw new NotFoundException('Unidad no encontrada');
      return tx.productUnit.update({ where: { id }, data: dto });
    });
    await this.audit.log({
      organizationId,
      userId: actorUserId,
      action: 'product_units.update',
      entityType: 'ProductUnit',
      entityId: id,
    });
    return updated;
  }
}
