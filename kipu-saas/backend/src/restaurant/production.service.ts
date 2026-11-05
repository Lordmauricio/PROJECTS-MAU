import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { createHash } from 'node:crypto';
import { Prisma } from '../../generated/prisma/client';
import { TenantPrismaService } from '../prisma/tenant-prisma.service';
import { InventoryService } from '../inventory/inventory.service';
import { money } from '../common/money';
import { BatchActionDto, CreateBatchDto } from './restaurant.dto';

@Injectable()
export class ProductionService {
  constructor(
    private readonly tenant: TenantPrismaService,
    private readonly inventory: InventoryService,
  ) {}

  list(organizationId: string, branchId?: string) {
    return this.tenant.run(organizationId, (tx) =>
      tx.productionBatch.findMany({
        where: { organizationId, ...(branchId ? { branchId } : {}) },
        orderBy: { createdAt: 'desc' },
        take: 100,
      }),
    );
  }

  create(organizationId: string, actorUserId: string, dto: CreateBatchDto) {
    const hash = createHash('sha256')
      .update(
        JSON.stringify([
          dto.warehouseId,
          dto.name.trim(),
          dto.station.trim(),
          dto.sourceProductId,
          dto.outputProductId,
          dto.sourceQuantity,
          dto.plannedQuantity,
        ]),
      )
      .digest('hex');
    return this.tenant.run(organizationId, async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${organizationId}), hashtext(${dto.requestKey}))`;
      const existing = await tx.productionBatch.findUnique({
        where: {
          organizationId_requestKey: {
            organizationId,
            requestKey: dto.requestKey,
          },
        },
      });
      if (existing) {
        if (existing.requestHash !== hash)
          throw new ConflictException('La clave ya pertenece a otra tanda');
        return existing;
      }
      if (!dto.name.trim() || !dto.station.trim())
        throw new BadRequestException('Nombre y estación son obligatorios');
      if (dto.sourceProductId === dto.outputProductId)
        throw new BadRequestException(
          'Usa productos distintos para crudo y preparado',
        );
      const warehouse = await tx.warehouse.findFirst({
        where: { organizationId, id: dto.warehouseId },
      });
      if (!warehouse) throw new BadRequestException('Almacén no encontrado');
      const products = await tx.product.findMany({
        where: {
          organizationId,
          active: true,
          id: { in: [dto.sourceProductId, dto.outputProductId] },
        },
      });
      if (products.length !== 2)
        throw new BadRequestException(
          'Los dos productos deben estar activos y pertenecer a esta empresa',
        );
      const batch = await tx.productionBatch.create({
        data: {
          organizationId,
          branchId: warehouse.branchId,
          warehouseId: warehouse.id,
          name: dto.name.trim(),
          station: dto.station.trim(),
          sourceProductId: dto.sourceProductId,
          sourceName: products.find((p) => p.id === dto.sourceProductId)!.name,
          outputProductId: dto.outputProductId,
          outputName: products.find((p) => p.id === dto.outputProductId)!.name,
          sourceQuantity: dto.sourceQuantity,
          plannedQuantity: dto.plannedQuantity,
          requestKey: dto.requestKey,
          requestHash: hash,
          createdById: actorUserId,
        },
      });
      await this.audit(
        tx,
        organizationId,
        actorUserId,
        batch.id,
        'production.create',
      );
      return batch;
    });
  }

  action(
    organizationId: string,
    actorUserId: string,
    id: string,
    dto: BatchActionDto,
  ) {
    return this.tenant.run(organizationId, async (tx) => {
      await tx.$queryRaw`SELECT id FROM production_batches WHERE id = ${id} AND "organizationId" = ${organizationId} FOR UPDATE`;
      const batch = await tx.productionBatch.findFirst({
        where: { id, organizationId },
      });
      if (!batch) throw new NotFoundException('Tanda no encontrada');
      const output = money(dto.producedQuantity ?? batch.plannedQuantity);
      const reason = dto.reason?.trim();
      if (batch.status === dto.status && batch.version === dto.version + 1) {
        if (dto.status === 'READY' && !output.eq(batch.producedQuantity!))
          throw new ConflictException(
            'La tanda ya se completó con otra cantidad',
          );
        if (dto.status === 'CANCELLED' && reason !== batch.cancelReason)
          throw new ConflictException('La tanda ya se canceló con otro motivo');
        return batch;
      }
      if (batch.version !== dto.version)
        throw new ConflictException(
          'La tanda cambió. Actualiza antes de continuar',
        );
      const now = new Date();
      if (dto.status === 'PREPARING') {
        if (batch.status !== 'DRAFT')
          throw new ConflictException(
            'Solo se puede iniciar una tanda planificada',
          );
        await this.inventory.applyMovement(tx, {
          organizationId,
          warehouseId: batch.warehouseId,
          productId: batch.sourceProductId,
          type: 'OUT',
          direction: 'DECREASE',
          quantity: batch.sourceQuantity,
          reason: 'Inicio de tanda',
          reference: batch.id,
          userId: actorUserId,
        });
      } else if (dto.status === 'READY') {
        if (batch.status !== 'PREPARING')
          throw new ConflictException(
            'Inicia la tanda antes de registrar su producción',
          );
        await this.inventory.applyMovement(tx, {
          organizationId,
          warehouseId: batch.warehouseId,
          productId: batch.outputProductId,
          type: 'IN',
          direction: 'INCREASE',
          quantity: output,
          reason: 'Tanda completada',
          reference: batch.id,
          userId: actorUserId,
        });
      } else {
        if (!['DRAFT', 'PREPARING'].includes(batch.status))
          throw new ConflictException(
            'Solo se cancela una tanda planificada o en preparación',
          );
        if (!reason)
          throw new BadRequestException('Indica el motivo de cancelación');
      }
      const updated = await tx.productionBatch.update({
        where: { id },
        data: {
          status: dto.status,
          version: { increment: 1 },
          ...(dto.status === 'PREPARING'
            ? { startedAt: now }
            : dto.status === 'READY'
              ? { readyAt: now, producedQuantity: output }
              : { cancelledAt: now, cancelReason: reason }),
        },
      });
      await this.audit(
        tx,
        organizationId,
        actorUserId,
        id,
        `production.${dto.status.toLowerCase()}`,
        {
          sourceQuantity: batch.sourceQuantity.toFixed(2),
          ...(dto.status === 'READY'
            ? { producedQuantity: output.toFixed(2) }
            : {}),
          ...(reason ? { reason } : {}),
          rawStockRestored: false,
        },
      );
      return updated;
    });
  }

  private audit(
    tx: Prisma.TransactionClient,
    organizationId: string,
    userId: string,
    entityId: string,
    action: string,
    metadata?: Prisma.InputJsonValue,
  ) {
    return tx.auditLog.create({
      data: {
        organizationId,
        userId,
        action,
        entityType: 'ProductionBatch',
        entityId,
        ...(metadata ? { metadata } : {}),
      },
    });
  }
}
