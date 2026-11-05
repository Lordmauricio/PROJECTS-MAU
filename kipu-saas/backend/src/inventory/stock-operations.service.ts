import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { createHash } from 'node:crypto';
import { TenantPrismaService } from '../prisma/tenant-prisma.service';
import { InventoryService } from './inventory.service';
import { StockOperationDto } from './stock-operations.dto';
import { money, ZERO_MONEY } from '../common/money';
import {
  businessDate,
  dateOnly,
  stockLock,
  usableBalances,
} from './lot-ledger';
@Injectable()
export class StockOperationsService {
  constructor(
    private readonly tenant: TenantPrismaService,
    private readonly inventory: InventoryService,
  ) {}
  history(org: string, lotId: string) {
    return this.tenant.run(org, async (tx) => {
      const lot = await tx.stockLot.findFirst({
        where: { id: lotId, organizationId: org },
      });
      if (!lot) throw new NotFoundException('Lote no encontrado');
      return tx.lotAllocation.findMany({
        where: { organizationId: org, lotId },
        include: { movement: true },
        orderBy: { id: 'desc' },
        take: 100,
      });
    });
  }
  list(org: string, warehouseId?: string) {
    return this.tenant.run(org, async (tx) => ({
      stocks: await usableBalances(tx, org, warehouseId),
      lots: await tx.stockLot.findMany({
        where: { organizationId: org, ...(warehouseId ? { warehouseId } : {}) },
        include: { product: { select: { name: true } } },
        orderBy: [{ expiresOn: { sort: 'asc', nulls: 'last' } }, { id: 'asc' }],
      }),
      operations: await tx.stockOperation.findMany({
        where: { organizationId: org, ...(warehouseId ? { warehouseId } : {}) },
        orderBy: { createdAt: 'desc' },
        take: 100,
      }),
      businessDate: businessDate(),
    }));
  }
  tracking(org: string, actor: string, id: string, required: boolean) {
    return this.tenant.run(org, async (tx) => {
      await stockLock(tx, org, id);
      const p = await tx.product.findFirst({
        where: { id, organizationId: org },
      });
      if (!p) throw new NotFoundException('Producto no encontrado');
      const balances = await usableBalances(tx, org);
      if (
        required &&
        balances.some((r) => r.productId === id && r.untrackedQuantity.gt(0))
      )
        throw new ConflictException(
          'Clasifica primero todo el stock sin lote en cada almacén',
        );
      // Known lots remain enforced by FEFO even when strict reception is disabled.
      const result = await tx.product.update({
        where: { id },
        data: { requireLots: required },
      });
      await tx.auditLog.create({
        data: {
          organizationId: org,
          userId: actor,
          entityType: 'Product',
          entityId: id,
          action: 'stock.tracking',
          metadata: { required },
        },
      });
      return result;
    });
  }
  register(org: string, actor: string, d: StockOperationDto) {
    const hash = createHash('sha256')
      .update(
        JSON.stringify([
          d.warehouseId,
          d.productId,
          d.kind,
          d.quantity,
          d.lotId ?? null,
          d.lotCode?.trim() ?? null,
          d.expiresOn ?? null,
          d.expectedQuantity ?? null,
          d.reason.trim(),
        ]),
      )
      .digest('hex');
    return this.tenant.run(org, async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${org}),hashtext(${d.requestKey}))`;
      const existing = await tx.stockOperation.findUnique({
        where: {
          organizationId_requestKey: {
            organizationId: org,
            requestKey: d.requestKey,
          },
        },
      });
      if (existing) {
        if (existing.requestHash !== hash)
          throw new ConflictException('La clave pertenece a otra operación');
        return existing;
      }
      const product = await tx.product.findFirst({
        where: { id: d.productId, organizationId: org },
      });
      const warehouse = await tx.warehouse.findFirst({
        where: { id: d.warehouseId, organizationId: org },
      });
      if (!product || !warehouse || !d.reason.trim())
        throw new BadRequestException('Producto, almacén o motivo inválidos');
      if (d.lotId && d.lotCode)
        throw new BadRequestException(
          'Selecciona lote existente o código nuevo, no ambos',
        );
      if (d.expiresOn && !d.lotCode)
        throw new BadRequestException(
          'El vencimiento solo se declara al ingresar un lote nuevo',
        );
      if (d.lotCode && !['RECEIPT', 'CLASSIFY'].includes(d.kind))
        throw new BadRequestException(
          'Usa un lote existente para conteos y salidas',
        );
      await stockLock(tx, org, d.productId);
      const stock = await tx.inventory.findUnique({
        where: {
          warehouseId_productId: {
            warehouseId: d.warehouseId,
            productId: d.productId,
          },
        },
      });
      const lot = d.lotId
        ? await tx.stockLot.findFirst({
            where: {
              id: d.lotId,
              organizationId: org,
              warehouseId: d.warehouseId,
              productId: d.productId,
            },
          })
        : null;
      if (d.lotId && !lot) throw new BadRequestException('Lote inválido');
      const physical = stock?.quantity ?? ZERO_MONEY;
      const before = lot?.quantity ?? physical;
      const amount = money(d.quantity);
      let delta = amount;
      let resultQuantity = before;
      const operation = await tx.stockOperation.create({
        data: {
          organizationId: org,
          warehouseId: d.warehouseId,
          productId: d.productId,
          kind: d.kind,
          requestKey: d.requestKey,
          requestHash: hash,
          actorUserId: actor,
          snapshot: {},
        },
      });
      if (d.kind === 'CLASSIFY') {
        if (lot || !d.lotCode?.trim() || amount.lte(0))
          throw new BadRequestException(
            'Indica un código nuevo y cantidad para clasificar',
          );
        const lots = await tx.stockLot.findMany({
          where: {
            organizationId: org,
            warehouseId: d.warehouseId,
            productId: d.productId,
          },
        });
        const free = physical.sub(
          lots.reduce((s, l) => s.add(l.quantity), ZERO_MONEY),
        );
        if (amount.gt(free))
          throw new ConflictException(
            'No hay suficiente existencia sin lote para clasificar',
          );
        if (lots.some((l) => l.code === d.lotCode!.trim()))
          throw new ConflictException(
            'Ese código ya existe; una clasificación requiere código nuevo',
          );
        const created = await tx.stockLot.create({
          data: {
            organizationId: org,
            warehouseId: d.warehouseId,
            productId: d.productId,
            code: d.lotCode.trim(),
            expiresOn: dateOnly(d.expiresOn),
            quantity: amount,
          },
        });
        await tx.stockOperation.update({
          where: { id: operation.id },
          data: {
            snapshot: {
              productName: product.name,
              lotId: created.id,
              lotCode: created.code,
              quantity: amount.toFixed(2),
              reason: d.reason,
              physicalQuantity: physical.toFixed(2),
              stockChanged: false,
            },
          },
        });
      } else {
        if (d.kind === 'COUNT') {
          if (
            d.expectedQuantity === undefined ||
            !money(d.expectedQuantity).eq(before)
          )
            throw new ConflictException(
              'La existencia cambió desde el conteo. Actualiza y vuelve a contar',
            );
          const lots = await tx.stockLot.count({
            where: {
              organizationId: org,
              warehouseId: d.warehouseId,
              productId: d.productId,
              quantity: { gt: 0 },
            },
          });
          if (!lot && (product.requireLots || lots > 0))
            throw new BadRequestException(
              'Cuenta cada lote individualmente cuando hay trazabilidad',
            );
          delta = amount.sub(before);
          resultQuantity = amount;
        } else {
          if (amount.lte(0))
            throw new BadRequestException('La cantidad debe ser positiva');
          delta = d.kind === 'RECEIPT' ? amount : amount.neg();
          resultQuantity =
            d.kind === 'RECEIPT' ? before.add(amount) : before.sub(amount);
        }
        if (!delta.eq(0))
          await this.inventory.applyMovement(tx, {
            organizationId: org,
            warehouseId: d.warehouseId,
            productId: d.productId,
            type:
              d.kind === 'RECEIPT'
                ? 'IN'
                : d.kind === 'COUNT'
                  ? 'ADJUSTMENT'
                  : 'OUT',
            direction:
              d.kind === 'RECEIPT' || (d.kind === 'COUNT' && delta.gt(0))
                ? 'INCREASE'
                : 'DECREASE',
            quantity: delta.abs(),
            lotId: d.lotId,
            ...(d.lotCode
              ? {
                  lotInputs: [
                    {
                      code: d.lotCode,
                      expiresOn: d.expiresOn,
                      quantity: delta.abs().toFixed(2),
                    },
                  ],
                }
              : {}),
            allowExpired: d.kind === 'WASTE' || d.kind === 'COUNT',
            reason: `${d.kind}: ${d.reason.trim()}`,
            reference: operation.id,
            userId: actor,
          });
        await tx.stockOperation.update({
          where: { id: operation.id },
          data: {
            snapshot: {
              productName: product.name,
              lotId: d.lotId ?? null,
              lotCode: d.lotCode ?? lot?.code ?? null,
              quantity: amount.toFixed(2),
              before: before.toFixed(2),
              after: resultQuantity.toFixed(2),
              delta: delta.toFixed(2),
              referenceCost: money(delta.abs().mul(product.cost)).toFixed(2),
              reason: d.reason.trim(),
            },
          },
        });
      }
      await tx.auditLog.create({
        data: {
          organizationId: org,
          userId: actor,
          action: `stock.${d.kind.toLowerCase()}`,
          entityType: 'StockOperation',
          entityId: operation.id,
        },
      });
      return tx.stockOperation.findUniqueOrThrow({
        where: { id: operation.id },
      });
    });
  }
}
