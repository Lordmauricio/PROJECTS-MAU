import { Injectable, NotFoundException } from '@nestjs/common';
import { TenantPrismaService } from '../prisma/tenant-prisma.service';
import { AuditService } from '../audit/audit.service';
import { CreateProductCategoryDto, UpdateProductCategoryDto } from './dto/product-category.dto';

@Injectable()
export class ProductCategoriesService {
  constructor(
    private readonly tenantPrisma: TenantPrismaService,
    private readonly audit: AuditService,
  ) {}

  list(organizationId: string) {
    return this.tenantPrisma.run(organizationId, (tx) =>
      tx.productCategory.findMany({ where: { organizationId, active: true }, orderBy: { sortOrder: 'asc' } }),
    );
  }

  async create(organizationId: string, dto: CreateProductCategoryDto, actorUserId: string) {
    const category = await this.tenantPrisma.run(organizationId, (tx) =>
      tx.productCategory.create({ data: { organizationId, ...dto } }),
    );
    await this.audit.log({
      organizationId,
      userId: actorUserId,
      action: 'product_categories.create',
      entityType: 'ProductCategory',
      entityId: category.id,
    });
    return category;
  }

  async update(organizationId: string, id: string, dto: UpdateProductCategoryDto, actorUserId: string) {
    const updated = await this.tenantPrisma.run(organizationId, async (tx) => {
      const existing = await tx.productCategory.findFirst({ where: { id, organizationId } });
      if (!existing) throw new NotFoundException('Categoría no encontrada');
      return tx.productCategory.update({ where: { id }, data: dto });
    });
    await this.audit.log({
      organizationId,
      userId: actorUserId,
      action: 'product_categories.update',
      entityType: 'ProductCategory',
      entityId: id,
    });
    return updated;
  }
}
