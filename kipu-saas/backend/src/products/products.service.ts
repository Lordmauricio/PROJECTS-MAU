import { Injectable, NotFoundException } from '@nestjs/common';
import { TenantPrismaService } from '../prisma/tenant-prisma.service';
import { AuditService } from '../audit/audit.service';
import { SubscriptionsService } from '../subscriptions/subscriptions.service';
import { CreateProductDto, UpdateProductDto } from './dto/product.dto';

@Injectable()
export class ProductsService {
  constructor(
    private readonly tenantPrisma: TenantPrismaService,
    private readonly audit: AuditService,
    private readonly subscriptions: SubscriptionsService,
  ) {}

  /**
   * `updatedSince` (Offline 4.3, sincronización incremental de catálogo):
   * cuando está presente, deja de filtrar `active: true` — el cliente
   * offline necesita enterarse también de los productos que ACABAN de
   * desactivarse (updatedAt reciente, active ahora false) para poder
   * actualizar su copia local, algo que el filtro de siempre le ocultaría
   * por completo. Sin `updatedSince`, el comportamiento es EXACTAMENTE el
   * de antes — se auditaron todos los callers reales (`inventory/products`,
   * `purchases`, `inventory/movements`, `reports`, el propio panel de
   * administración de productos) y ninguno envía este parámetro, así que
   * ninguno se ve afectado. Ver `docs/architecture.md` sección 22.
   *
   * `updatedAt >= updatedSince` (nunca `>` estricto) a propósito: usar `>`
   * arriesgaría perder para siempre una fila que comparte el mismo
   * instante que el cursor (dos productos actualizados en el mismo
   * milisegundo, o el propio límite de página) — `>=` puede traer de
   * vuelta la última fila ya aplicada, pero eso es inofensivo (reaplicar
   * el mismo dato no corrompe nada) mientras que perder una fila sí. El
   * orden pasa a `updatedAt asc` (en vez de `name asc`) para que el
   * cliente pueda paginar de forma segura avanzando su propio cursor al
   * `updatedAt` máximo visto en cada página — ver `catalog-sync.ts` del
   * frontend.
   */
  list(
    organizationId: string,
    query?: { search?: string; updatedSince?: string },
  ) {
    const search = query?.search;
    const updatedSince = query?.updatedSince;
    return this.tenantPrisma.run(organizationId, (tx) =>
      tx.product.findMany({
        where: {
          organizationId,
          ...(updatedSince ? {} : { active: true }),
          ...(updatedSince
            ? { updatedAt: { gte: new Date(updatedSince) } }
            : {}),
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
        orderBy: updatedSince ? { updatedAt: 'asc' } : { name: 'asc' },
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

  async create(
    organizationId: string,
    dto: CreateProductDto,
    actorUserId: string,
  ) {
    const product = await this.tenantPrisma.run(organizationId, async (tx) => {
      await this.subscriptions.assertWithinLimit(
        tx,
        organizationId,
        'products',
      );
      return tx.product.create({ data: { organizationId, ...dto } });
    });
    await this.audit.log({
      organizationId,
      userId: actorUserId,
      action: 'products.create',
      entityType: 'Product',
      entityId: product.id,
    });
    return product;
  }

  async update(
    organizationId: string,
    productId: string,
    dto: UpdateProductDto,
    actorUserId: string,
  ) {
    const updated = await this.tenantPrisma.run(organizationId, async (tx) => {
      const existing = await tx.product.findFirst({
        where: { id: productId, organizationId },
      });
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
      const existing = await tx.product.findFirst({
        where: { id: productId, organizationId },
      });
      if (!existing) throw new NotFoundException('Producto no encontrado');
      return tx.product.update({
        where: { id: productId },
        data: { active: false },
      });
    });
    await this.audit.log({
      organizationId,
      userId: actorUserId,
      action: 'products.delete',
      entityType: 'Product',
      entityId: productId,
    });
  }

  async duplicate(
    organizationId: string,
    productId: string,
    actorUserId: string,
  ) {
    const duplicated = await this.tenantPrisma.run(
      organizationId,
      async (tx) => {
        const existing = await tx.product.findFirst({
          where: { id: productId, organizationId },
        });
        if (!existing) throw new NotFoundException('Producto no encontrado');
        await this.subscriptions.assertWithinLimit(
          tx,
          organizationId,
          'products',
        );
        const {
          id: _id,
          createdAt: _createdAt,
          updatedAt: _updatedAt,
          ...rest
        } = existing;
        return tx.product.create({
          data: {
            ...rest,
            name: `${existing.name} (copia)`,
            sku: null,
            barcode: null,
          },
        });
      },
    );
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
