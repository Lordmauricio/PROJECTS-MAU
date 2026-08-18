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
import { CreateInventoryTransferDto } from './dto/inventory-transfer.dto';
import { KardexQueryDto } from './dto/kardex-query.dto';

type Tx = Prisma.TransactionClient;

/** El tipo que efectivamente se persiste en `inventory_movements.type` — el enum completo del schema. */
export type InventoryMovementType =
  'IN' | 'OUT' | 'TRANSFER' | 'ADJUSTMENT' | 'RETURN';
export type MovementDirection = 'INCREASE' | 'DECREASE';

export interface ApplyMovementParams {
  organizationId: string;
  warehouseId: string;
  productId: string;
  /** Qué se guarda en el kardex — IN/OUT/RETURN (Ventas y Compras), TRANSFER o ADJUSTMENT. */
  type: InventoryMovementType;
  /** Hacia dónde mueve el stock — separado de `type` a propósito: un TRANSFER tiene una pierna INCREASE y otra DECREASE con el mismo `type`. */
  direction: MovementDirection;
  /** Siempre positiva: el signo lo decide `direction`, nunca el valor. */
  quantity: Prisma.Decimal | string | number;
  reason?: string;
  reference?: string;
  userId?: string;
  /** Solo para movimientos registrados directamente (no los que dispara Ventas/Compras, que ya tienen su propia idempotencia a nivel de operación padre). */
  idempotencyKey?: string;
}

@Injectable()
export class InventoryService {
  constructor(
    private readonly tenantPrisma: TenantPrismaService,
    private readonly audit: AuditService,
  ) {}

  /**
   * Núcleo atómico de movimientos de inventario (sin cambios de
   * comportamiento respecto a Fase Comercial 2 para quien ya lo llama con
   * `type` IN/OUT/RETURN — Ventas y Compras siguen intactas). SIEMPRE debe
   * recibir un `tx` que ya viene de una transacción abierta por
   * `TenantPrismaService.run` — nunca abre una propia.
   *
   * Para `direction: 'DECREASE'`, el decremento es una única sentencia SQL
   * condicional (`quantity >= cantidad`) vía `updateMany`. Es lo que evita
   * overselling/stock negativo bajo concurrencia sin necesitar un lock
   * explícito: si dos operaciones compiten por la misma unidad de stock,
   * Postgres serializa los `UPDATE` sobre la misma fila de `inventories` —
   * la segunda transacción espera a que la primera cierre, ve el stock ya
   * descontado, y su propio `UPDATE` afecta 0 filas → `ConflictException`.
   */
  async applyMovement(tx: Tx, params: ApplyMovementParams) {
    const qty = money(params.quantity);
    if (qty.lte(0)) {
      throw new BadRequestException(
        'La cantidad del movimiento debe ser mayor a 0',
      );
    }

    if (params.direction === 'DECREASE') {
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
      // INCREASE: SET quantity = quantity + $1, expresión relativa evaluada
      // por Postgres — segura bajo concurrencia por el mismo motivo que el
      // decremento condicional.
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
      params.direction === 'DECREASE'
        ? stockAfter.add(qty)
        : stockAfter.sub(qty);

    const movement = await tx.inventoryMovement.create({
      data: {
        organizationId: params.organizationId,
        warehouseId: params.warehouseId,
        productId: params.productId,
        type: params.type,
        quantity: qty,
        stockBefore,
        stockAfter,
        reason: params.reason,
        reference: params.reference,
        userId: params.userId,
        idempotencyKey: params.idempotencyKey,
      },
    });

    return { movement, stockBefore, stockAfter };
  }

  /**
   * `opts.maxRows` por defecto es 200 (vista normal). Pasar `undefined`
   * explícito vía `{ maxRows: undefined }` NO es lo mismo que omitir
   * `opts` — solo `ReportsService.inventoryReport` lo hace, para poder
   * calcular el `summary` (valorización total) sobre el inventario
   * COMPLETO de la organización y no solo sobre las 200 filas que se
   * muestran en pantalla (ver comentario en `inventoryReport`).
   */
  listStock(
    organizationId: string,
    filters: { warehouseId?: string; productId?: string },
    opts: { maxRows?: number } = { maxRows: 200 },
  ) {
    return this.tenantPrisma.run(organizationId, (tx) =>
      tx.inventory.findMany({
        where: {
          organizationId,
          ...(filters.warehouseId ? { warehouseId: filters.warehouseId } : {}),
          ...(filters.productId ? { productId: filters.productId } : {}),
        },
        include: {
          product: { select: { id: true, name: true, sku: true } },
          warehouse: { select: { id: true, name: true } },
        },
        orderBy: { updatedAt: 'desc' },
        take: opts.maxRows,
      }),
    );
  }

  /**
   * Historial de movimientos, filtrable por almacén/producto/tipo/período
   * — es la misma tabla que respalda el kardex (`kardex()` de abajo es un
   * caso particular: siempre filtrado por producto, orden cronológico
   * ascendente para leerse como una cuenta corriente).
   *
   * `opts.maxPageSize` (default 200) es lo que permite a
   * `ReportsService.movementsReport` pedir hasta `REPORT_EXPORT_MAX_ROWS`
   * filas al exportar — sin este override, el tope de 200 quedaba
   * hardcodeado acá y el `pageSize: REPORT_EXPORT_MAX_ROWS` que el
   * controller de reportes ya intentaba forzar no tenía ningún efecto
   * real, truncando el export del kardex en silencio.
   */
  listMovements(
    organizationId: string,
    filters: KardexQueryDto,
    opts: { maxPageSize?: number } = {},
  ) {
    const page = filters.page ?? 1;
    const pageSize = Math.min(filters.pageSize ?? 50, opts.maxPageSize ?? 200);
    return this.tenantPrisma.run(organizationId, (tx) =>
      tx.inventoryMovement.findMany({
        where: {
          organizationId,
          ...(filters.warehouseId ? { warehouseId: filters.warehouseId } : {}),
          ...(filters.productId ? { productId: filters.productId } : {}),
          ...(filters.type ? { type: filters.type } : {}),
          ...(filters.dateFrom || filters.dateTo
            ? {
                createdAt: {
                  ...(filters.dateFrom
                    ? { gte: new Date(filters.dateFrom) }
                    : {}),
                  ...(filters.dateTo ? { lte: new Date(filters.dateTo) } : {}),
                },
              }
            : {}),
        },
        include: {
          product: { select: { id: true, name: true, sku: true } },
          warehouse: { select: { id: true, name: true } },
        },
        // Desempate por `id`: `createdAt` se fija con el DEFAULT de Postgres,
        // que es el timestamp del BEGIN de la transacción, no el del INSERT.
        // Dos movimientos concurrentes sobre el mismo producto pueden
        // compartir `createdAt` (o incluso quedar invertidos respecto del
        // orden real de aplicación), y sin un segundo criterio el orden entre
        // ellos lo decide Postgres, que puede devolverlos distinto en cada
        // consulta — con paginación eso significa filas repetidas o
        // salteadas. `id` es un cuid monotónico, así que estabiliza el orden.
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
    );
  }

  /**
   * Kardex real: movimientos de UN producto en UN almacén, orden
   * cronológico ASCENDENTE (para leerse como una cuenta corriente:
   * `stockBefore` de la primera fila -> `stockAfter` de la última), con
   * filtro de período opcional.
   */
  kardex(
    organizationId: string,
    productId: string,
    warehouseId: string,
    filters: { dateFrom?: string; dateTo?: string },
  ) {
    return this.tenantPrisma.run(organizationId, (tx) =>
      tx.inventoryMovement.findMany({
        where: {
          organizationId,
          productId,
          warehouseId,
          ...(filters.dateFrom || filters.dateTo
            ? {
                createdAt: {
                  ...(filters.dateFrom
                    ? { gte: new Date(filters.dateFrom) }
                    : {}),
                  ...(filters.dateTo ? { lte: new Date(filters.dateTo) } : {}),
                },
              }
            : {}),
        },
        include: {
          product: { select: { id: true, name: true, sku: true } },
          warehouse: { select: { id: true, name: true } },
        },
        // Mismo desempate que en `listMovements`, acá además es lo que hace
        // legible la cadena `stockAfter[n] == stockBefore[n+1]`: sin él, dos
        // movimientos del mismo instante podían mostrarse en un orden que no
        // era el de aplicación y la cuenta corriente parecía inconsistente.
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        take: 500,
      }),
    );
  }

  /**
   * Entrada manual (IN), salida manual (OUT), o ajuste con signo
   * (ADJUSTMENT) — el núcleo mínimo de Fase Comercial 2 ampliado acá con
   * `idempotencyKey` obligatoria (antes no la pedía: un doble click real
   * habría creado dos movimientos y aplicado el cambio de stock dos
   * veces). Mismo patrón de "chequear existente antes, dejar que el
   * constraint único resuelva la carrera real" que Ventas/Compras.
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
    const direction: MovementDirection =
      dto.type === 'OUT'
        ? 'DECREASE'
        : dto.type === 'IN'
          ? 'INCREASE'
          : dto.direction!;

    // Si la misma idempotencyKey ya se usó para un movimiento con datos
    // DISTINTOS (otro producto/almacén/tipo/cantidad), no es un replay
    // idempotente sino una colisión real de claves — igual que
    // PurchasesService.runOrResolveReceiptConflict con `purchaseId`.
    // Devolver en silencio el movimiento equivocado sería peor que
    // rechazar: el cliente creería que SU movimiento se aplicó.
    const assertMatches = (existing: {
      productId: string;
      warehouseId: string;
      type: string;
      quantity: Prisma.Decimal;
    }) => {
      if (
        existing.productId !== dto.productId ||
        existing.warehouseId !== dto.warehouseId ||
        existing.type !== dto.type ||
        !existing.quantity.equals(money(dto.quantity))
      ) {
        throw new ConflictException(
          'Esta idempotencyKey ya fue usada con datos distintos',
        );
      }
    };

    const result = await this.runOrResolveMovementConflict(
      organizationId,
      dto.idempotencyKey,
      async (tx) => {
        const existing = await tx.inventoryMovement.findUnique({
          where: { idempotencyKey: dto.idempotencyKey },
        });
        if (existing) {
          assertMatches(existing);
          return {
            movement: existing,
            stockBefore: existing.stockBefore,
            stockAfter: existing.stockAfter,
          };
        }

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
          type: dto.type,
          direction,
          quantity: dto.quantity,
          reason: dto.reason ?? this.defaultReasonFor(dto.type, dto.direction),
          userId: actorUserId,
          idempotencyKey: dto.idempotencyKey,
        });
      },
      assertMatches,
    );

    await this.audit.log({
      organizationId,
      userId: actorUserId,
      action: 'inventory.movement.create',
      entityType: 'InventoryMovement',
      entityId: result.movement.id,
      metadata: {
        type: dto.type,
        direction,
        productId: dto.productId,
        warehouseId: dto.warehouseId,
        quantity: dto.quantity,
      },
    });

    return result;
  }

  /**
   * Transferencia atómica entre dos almacenes de la misma organización:
   * una salida (DECREASE) en el origen y una entrada (INCREASE) en el
   * destino, ambas `type: 'TRANSFER'`, dentro de LA MISMA transacción — si
   * la salida falla por stock insuficiente, la entrada nunca se aplica
   * (rollback completo). Nunca puede quedar una mitad aplicada.
   */
  async transfer(
    organizationId: string,
    dto: CreateInventoryTransferDto,
    actorUserId: string,
  ) {
    // Misma razón que en registerManualMovement: reusar la idempotencyKey
    // para una transferencia con OTROS datos es una colisión real, no un
    // replay — debe rechazarse, nunca devolver en silencio la transferencia
    // equivocada.
    const assertMatches = (existing: {
      productId: string;
      fromWarehouseId: string;
      toWarehouseId: string;
      quantity: Prisma.Decimal;
    }) => {
      if (
        existing.productId !== dto.productId ||
        existing.fromWarehouseId !== dto.fromWarehouseId ||
        existing.toWarehouseId !== dto.toWarehouseId ||
        !existing.quantity.equals(money(dto.quantity))
      ) {
        throw new ConflictException(
          'Esta idempotencyKey ya fue usada con datos distintos',
        );
      }
    };

    const result = await this.runOrResolveTransferConflict(
      organizationId,
      dto.idempotencyKey,
      async (tx) => {
        const existing = await tx.inventoryTransfer.findUnique({
          where: { idempotencyKey: dto.idempotencyKey },
        });
        if (existing) {
          assertMatches(existing);
          return existing;
        }

        if (dto.fromWarehouseId === dto.toWarehouseId) {
          throw new BadRequestException(
            'El almacén de origen y destino no pueden ser el mismo',
          );
        }
        const fromWarehouse = await tx.warehouse.findFirst({
          where: { id: dto.fromWarehouseId, organizationId },
        });
        if (!fromWarehouse)
          throw new BadRequestException('Almacén de origen no encontrado');
        const toWarehouse = await tx.warehouse.findFirst({
          where: { id: dto.toWarehouseId, organizationId },
        });
        if (!toWarehouse)
          throw new BadRequestException('Almacén de destino no encontrado');
        const product = await tx.product.findFirst({
          where: { id: dto.productId, organizationId },
        });
        if (!product) throw new BadRequestException('Producto no encontrado');

        const transferRecord = await tx.inventoryTransfer.create({
          data: {
            organizationId,
            productId: dto.productId,
            fromWarehouseId: dto.fromWarehouseId,
            toWarehouseId: dto.toWarehouseId,
            quantity: money(dto.quantity),
            reason: dto.reason,
            idempotencyKey: dto.idempotencyKey,
            createdById: actorUserId,
          },
        });

        const reason = dto.reason ?? 'Transferencia entre almacenes';
        await this.applyMovement(tx, {
          organizationId,
          warehouseId: dto.fromWarehouseId,
          productId: dto.productId,
          type: 'TRANSFER',
          direction: 'DECREASE',
          quantity: dto.quantity,
          reason,
          reference: transferRecord.id,
          userId: actorUserId,
        });
        await this.applyMovement(tx, {
          organizationId,
          warehouseId: dto.toWarehouseId,
          productId: dto.productId,
          type: 'TRANSFER',
          direction: 'INCREASE',
          quantity: dto.quantity,
          reason,
          reference: transferRecord.id,
          userId: actorUserId,
        });

        return transferRecord;
      },
      assertMatches,
    );

    await this.audit.log({
      organizationId,
      userId: actorUserId,
      action: 'inventory.transfer.create',
      entityType: 'InventoryTransfer',
      entityId: result.id,
      metadata: {
        productId: dto.productId,
        fromWarehouseId: dto.fromWarehouseId,
        toWarehouseId: dto.toWarehouseId,
        quantity: dto.quantity,
      },
    });

    return result;
  }

  // ---------------------------------------------------------------------

  private defaultReasonFor(
    type: CreateInventoryMovementDto['type'],
    direction?: 'INCREASE' | 'DECREASE',
  ): string {
    if (type === 'IN') return 'Entrada manual';
    if (type === 'OUT') return 'Salida manual';
    return `Ajuste manual (${direction})`;
  }

  /**
   * Mismo patrón que SalesService.runOrResolvePaymentConflict /
   * PurchasesService.runOrResolveReceiptConflict: si `fn` lanza P2002 sobre
   * `inventory_movements_idempotencyKey_key`, la transacción que lo generó
   * ya se abortó y revirtió sola — se resuelve en una transacción nueva y
   * limpia en vez de atrapar el error dentro de la misma (lo que dejaría
   * cualquier sentencia siguiente fallando por "transaction is aborted").
   */
  private async runOrResolveMovementConflict<T>(
    organizationId: string,
    idempotencyKey: string,
    fn: (tx: Tx) => Promise<T>,
    assertMatches: (existing: {
      productId: string;
      warehouseId: string;
      type: string;
      quantity: Prisma.Decimal;
    }) => void,
  ): Promise<T> {
    try {
      return await this.tenantPrisma.run(organizationId, fn);
    } catch (err) {
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === 'P2002'
      ) {
        return this.tenantPrisma.run(organizationId, async (tx) => {
          const existing = await tx.inventoryMovement.findUniqueOrThrow({
            where: { idempotencyKey },
          });
          assertMatches(existing);
          return {
            movement: existing,
            stockBefore: existing.stockBefore,
            stockAfter: existing.stockAfter,
          } as unknown as T;
        });
      }
      throw err;
    }
  }

  private async runOrResolveTransferConflict<T>(
    organizationId: string,
    idempotencyKey: string,
    fn: (tx: Tx) => Promise<T>,
    assertMatches: (existing: {
      productId: string;
      fromWarehouseId: string;
      toWarehouseId: string;
      quantity: Prisma.Decimal;
    }) => void,
  ): Promise<T> {
    try {
      return await this.tenantPrisma.run(organizationId, fn);
    } catch (err) {
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === 'P2002'
      ) {
        return this.tenantPrisma.run(organizationId, async (tx) => {
          const existing = await tx.inventoryTransfer.findUniqueOrThrow({
            where: { idempotencyKey },
          });
          assertMatches(existing);
          return existing as unknown as T;
        });
      }
      throw err;
    }
  }
}
