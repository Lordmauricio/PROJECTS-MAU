import { Injectable, NotFoundException } from '@nestjs/common';
import { TenantPrismaService } from '../prisma/tenant-prisma.service';
import { AuditService } from '../audit/audit.service';
import { CreateProductDto, UpdateProductDto } from './dto/product.dto';

@Injectable()
export class ProductsService {
  constructor(
    private readonly tenantPrisma: TenantPrismaService,
    private readonly audit: AuditService,
  ) {}

  list(organizationId: string, search?: string) {
    return this.tenantPrisma.run(organizationId, (tx) =>
      tx.product.findMany({
        where: {
          organizationId,
          active: true,
          ...(search
            ? {
                OR: [
                  { name: { contains: search, mode: 'insensitive' } },
                  { sku: { contains: search, mode: 'insensitive' } },
                  { barcode: { contains: search } },
                ],
              }
            : {}),
        },
        include: { category: true, unit: true },
        orderBy: { name: 'asc' },
        take: 200,
      }),
    );
  }

  async findOne(organizationId: string, productId: string) {
    return this.tenantPrisma.run(organizationId, async (tx) => {
      const product = await tx.product.findFirst({
        where: { id: productId, organizationId },
        include: {
          category: true,
          unit: true,
          supplier: true,
          inventories: { include: { warehouse: true } },
          inventoryMovements: { orderBy: { createdAt: 'desc' }, take: 20 },
        },
      });
      if (!product) throw new NotFoundException('Producto no encontrado');
      return product;
    });
  }

  async create(organizationId: string, dto: CreateProductDto, actorUserId: string) {
    const product = await this.tenantPrisma.run(organizationId, (tx) =>
      tx.product.create({ data: { organizationId, ...dto } }),
    );
    await this.audit.log({
      organizationId,
      userId: actorUserId,
      action: 'products.create',
      entityType: 'Product',
      entityId: product.id,
    });
    return product;
  }

  async update(organizationId: string, productId: string, dto: UpdateProductDto, actorUserId: string) {
    const updated = await this.tenantPrisma.run(organizationId, async (tx) => {
      const existing = await tx.product.findFirst({ where: { id: productId, organizationId } });
      if (!existing) throw new NotFoundException('Producto no encontrado');
      return tx.product.update({ where: { id: productId }, data: dto });
    });
    await this.audit.log({
      organizationId,
      userId: actorUserId,
      action: 'products.update',
      entityType: 'Product',
      entityId: productId,
    });
    return updated;
  }

  async remove(organizationId: string, productId: string, actorUserId: string) {
    await this.tenantPrisma.run(organizationId, async (tx) => {
      const existing = await tx.product.findFirst({ where: { id: productId, organizationId } });
      if (!existing) throw new NotFoundException('Producto no encontrado');
      return tx.product.update({ where: { id: productId }, data: { active: false } });
    });
    await this.audit.log({
      organizationId,
      userId: actorUserId,
      action: 'products.delete',
      entityType: 'Product',
      entityId: productId,
    });
  }

  async duplicate(organizationId: string, productId: string, actorUserId: string) {
    const duplicated = await this.tenantPrisma.run(organizationId, async (tx) => {
      const existing = await tx.product.findFirst({ where: { id: productId, organizationId } });
      if (!existing) throw new NotFoundException('Producto no encontrado');
      const { id: _id, createdAt: _createdAt, updatedAt: _updatedAt, ...rest } = existing;
      return tx.product.create({
        data: { ...rest, name: `${existing.name} (copia)`, sku: null, barcode: null },
      });
    });
    await this.audit.log({
      organizationId,
      userId: actorUserId,
      action: 'products.duplicate',
      entityType: 'Product',
      entityId: duplicated.id,
      metadata: { sourceProductId: productId },
    });
    return duplicated;
  }
}
