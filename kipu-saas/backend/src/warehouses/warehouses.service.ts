import { Injectable, NotFoundException } from '@nestjs/common';
import { TenantPrismaService } from '../prisma/tenant-prisma.service';
import { AuditService } from '../audit/audit.service';
import { CreateWarehouseDto, UpdateWarehouseDto } from './dto/warehouse.dto';

@Injectable()
export class WarehousesService {
  constructor(
    private readonly tenantPrisma: TenantPrismaService,
    private readonly audit: AuditService,
  ) {}

  list(organizationId: string) {
    return this.tenantPrisma.run(organizationId, (tx) =>
      tx.warehouse.findMany({ where: { organizationId }, orderBy: { createdAt: 'asc' } }),
    );
  }

  async create(organizationId: string, dto: CreateWarehouseDto, actorUserId: string) {
    const warehouse = await this.tenantPrisma.run(organizationId, async (tx) => {
      const branch = await tx.branch.findFirst({ where: { id: dto.branchId, organizationId } });
      if (!branch) throw new NotFoundException('Sucursal no encontrada');
      return tx.warehouse.create({ data: { organizationId, branchId: dto.branchId, name: dto.name, address: dto.address } });
    });
    await this.audit.log({
      organizationId,
      userId: actorUserId,
      action: 'warehouses.create',
      entityType: 'Warehouse',
      entityId: warehouse.id,
    });
    return warehouse;
  }

  async update(organizationId: string, warehouseId: string, dto: UpdateWarehouseDto, actorUserId: string) {
    const updated = await this.tenantPrisma.run(organizationId, async (tx) => {
      const existing = await tx.warehouse.findFirst({ where: { id: warehouseId, organizationId } });
      if (!existing) throw new NotFoundException('Almacén no encontrado');
      return tx.warehouse.update({ where: { id: warehouseId }, data: dto });
    });
    await this.audit.log({
      organizationId,
      userId: actorUserId,
      action: 'warehouses.update',
      entityType: 'Warehouse',
      entityId: warehouseId,
    });
    return updated;
  }
}
