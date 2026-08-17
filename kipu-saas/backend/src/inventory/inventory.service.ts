import {
  BadRequestException,
  ConflictException,
  Injectable,
} from '@nestjs/common';
import { Prisma } from '../../generated/prisma/client';
import { TenantPrismaService } from '../prisma/tenant-prisma.service';
import { AuditService } from '../audit/audit.service';
import { money } from '../common/money';
import { CreateInventoryMovementDto } from './dto/inventory-movement.dto';

type Tx = Prisma.TransactionClient;

export type CoreMovementType = 'IN' | 'OUT' | 'RETURN';

export interface ApplyMovementParams {
  organizationId: string;
  warehouseId: string;
  productId: string;
  type: CoreMovementType;
  /** Siempre positiva: la dirección la decide `type` (IN/RETURN suman, OUT resta). */
  quantity: Prisma.Decimal | string | number;
  reason?: string;
  reference?: string;
  userId?: string;
}

@Injectable()
export class InventoryService {
  constructor(
    private readonly tenantPrisma: TenantPrismaService,
    private readonly audit: AuditService,
  ) {}

  /**
   * Núcleo atómico de movimientos de inventario. SIEMPRE debe recibir un
   * `tx` que ya viene de una transacción abierta por
   * `TenantPrismaService.run` — nunca abre una propia. Esto es lo que
   * permite que SalesService descuente stock y confirme la venta como una
   * sola unidad atómica: si el stock no alcanza para un ítem, se lanza acá
   * y toda la transacción (incluida la venta) se revierte, no solo el
   * movimiento fallido.
   *
   * Para OUT, el decremento es una única sentencia SQL condicional
   * (`quantity >= cantidad`) vía `updateMany`. Es lo que evita overselling
   * bajo concurrencia sin necesitar un lock explícito: si dos ventas
   * compiten por la última unidad, Postgres serializa los `UPDATE` sobre la
   * misma fila de `inventories` — la segunda transacción espera a que la
   * primera cierre, ve el stock ya descontado, y su propio `UPDATE` afecta
   * 0 filas → `ConflictException`. Exactamente 1 de las 2 gana.
   */
  async applyMovement(tx: Tx, params: ApplyMovementParams) {
    const qty = money(params.quantity);
    if (qty.lte(0)) {
      throw new BadRequestException(
        'La cantidad del movimiento debe ser mayor a 0',
      );
    }

    if (params.type === 'OUT') {
      const result = await tx.inventory.updateMany({
        where: {
          organizationId: params.organizationId,
          warehouseId: params.warehouseId,
          productId: params.productId,
          quantity: { gte: qty },
        },
        data: { quantity: { decrement: qty } },
      });
      if (result.count === 0) {
        throw new ConflictException(
          `Stock insuficiente para el producto ${params.productId}`,
        );
      }
    } else {
      // IN / RETURN: incremento atómico (SET quantity = quantity + $1),
      // seguro bajo concurrencia por el mismo motivo — es una expresión
      // relativa evaluada por Postgres, no un read-modify-write en la app.
      await tx.inventory.upsert({
        where: {
          warehouseId_productId: {
            warehouseId: params.warehouseId,
            productId: params.productId,
          },
        },
        update: { quantity: { increment: qty } },
        create: {
          organizationId: params.organizationId,
          warehouseId: params.warehouseId,
          productId: params.productId,
          quantity: qty,
        },
      });
    }

    const row = await tx.inventory.findUniqueOrThrow({
      where: {
        warehouseId_productId: {
          warehouseId: params.warehouseId,
          productId: params.productId,
        },
      },
    });
    const stockAfter = row.quantity;
    const stockBefore =
      params.type === 'OUT' ? stockAfter.add(qty) : stockAfter.sub(qty);

    const movement = await tx.inventoryMovement.create({
      data: {
        organizationId: params.organizationId,
        warehouseId: params.warehouseId,
        productId: params.productId,
        type: params.type,
        quantity: qty,
        reason: params.reason,
        reference: params.reference,
        userId: params.userId,
      },
    });

    return { movement, stockBefore, stockAfter };
  }

  listStock(organizationId: string, warehouseId?: string) {
    return this.tenantPrisma.run(organizationId, (tx) =>
      tx.inventory.findMany({
        where: { organizationId, ...(warehouseId ? { warehouseId } : {}) },
        include: {
          product: { select: { id: true, name: true, sku: true } },
          warehouse: { select: { id: true, name: true } },
        },
        orderBy: { updatedAt: 'desc' },
        take: 200,
      }),
    );
  }

  listMovements(
    organizationId: string,
    filters: { warehouseId?: string; productId?: string },
  ) {
    return this.tenantPrisma.run(organizationId, (tx) =>
      tx.inventoryMovement.findMany({
        where: {
          organizationId,
          ...(filters.warehouseId ? { warehouseId: filters.warehouseId } : {}),
          ...(filters.productId ? { productId: filters.productId } : {}),
        },
        include: {
          product: { select: { id: true, name: true, sku: true } },
          warehouse: { select: { id: true, name: true } },
        },
        orderBy: { createdAt: 'desc' },
        take: 200,
      }),
    );
  }

  /**
   * Entrada manual de stock (IN) o ajuste con signo (ADJUSTMENT), para
   * poder operar el POS mientras no exista el módulo de Compras (Fase
   * Comercial 3). No es el motor de inventario avanzado — eso es Fase 4.
   */
  async registerManualMovement(
    organizationId: string,
    dto: CreateInventoryMovementDto,
    actorUserId: string,
  ) {
    if (dto.type === 'ADJUSTMENT' && !dto.direction) {
      throw new BadRequestException(
        'Un ajuste requiere indicar direction: INCREASE o DECREASE',
      );
    }
    const coreType: CoreMovementType =
      dto.type === 'IN' || dto.direction === 'INCREASE' ? 'IN' : 'OUT';

    const result = await this.tenantPrisma.run(organizationId, async (tx) => {
      const warehouse = await tx.warehouse.findFirst({
        where: { id: dto.warehouseId, organizationId },
      });
      if (!warehouse) throw new BadRequestException('Almacén no encontrado');
      const product = await tx.product.findFirst({
        where: { id: dto.productId, organizationId },
      });
      if (!product) throw new BadRequestException('Producto no encontrado');

      return this.applyMovement(tx, {
        organizationId,
        warehouseId: dto.warehouseId,
        productId: dto.productId,
        type: coreType,
        quantity: dto.quantity,
        reason:
          dto.reason ??
          (dto.type === 'IN'
            ? 'Entrada manual'
            : `Ajuste manual (${dto.direction})`),
        userId: actorUserId,
      });
    });

    await this.audit.log({
      organizationId,
      userId: actorUserId,
      action: 'inventory.movement.create',
      entityType: 'InventoryMovement',
      entityId: result.movement.id,
      metadata: {
        type: coreType,
        productId: dto.productId,
        warehouseId: dto.warehouseId,
        quantity: dto.quantity,
      },
    });

    return result;
  }
}
