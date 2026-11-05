import { BadRequestException, ConflictException } from '@nestjs/common';
import { Prisma } from '../../generated/prisma/client';
import { money, ZERO_MONEY } from '../common/money';
import type { ApplyMovementParams } from './inventory.service';
export interface LotInput {
  code: string;
  expiresOn?: string | null;
  blocked?: boolean;
  quantity: string;
}
export interface Allocation {
  lotId: string | null;
  quantity: Prisma.Decimal;
  code?: string;
  expiresOn?: string | null;
  blocked?: boolean;
}
export function businessDate() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/La_Paz',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}
export function dateOnly(value?: string | null) {
  if (!value) return null;
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(value) ||
    Number.isNaN(new Date(value + 'T00:00:00Z').getTime()) ||
    new Date(value + 'T00:00:00Z').toISOString().slice(0, 10) !== value
  )
    throw new BadRequestException('Fecha de vencimiento inválida');
  return new Date(value + 'T00:00:00Z');
}
export async function stockLock(
  tx: Prisma.TransactionClient,
  org: string,
  productId: string,
) {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${org}),hashtext(${'stock:' + productId}))`;
}
export async function allocateLots(
  tx: Prisma.TransactionClient,
  p: ApplyMovementParams,
  before: Prisma.Decimal,
): Promise<Allocation[]> {
  const qty = money(p.quantity);
  const where = {
    organizationId: p.organizationId,
    warehouseId: p.warehouseId,
    productId: p.productId,
  };
  const product = await tx.product.findFirstOrThrow({
    where: { id: p.productId, organizationId: p.organizationId },
  });
  const lots = await tx.stockLot.findMany({
    where,
    orderBy: [
      { expiresOn: { sort: 'asc', nulls: 'last' } },
      { createdAt: 'asc' },
      { id: 'asc' },
    ],
  });
  const tracked = lots.reduce((s, l) => s.add(l.quantity), ZERO_MONEY);
  const untracked = money(before.sub(tracked));
  if (untracked.lt(0))
    throw new ConflictException(
      'El saldo de lotes no coincide con el inventario',
    );
  const result: Allocation[] = [];
  const take = async (
    lotId: string | null,
    amount: Prisma.Decimal,
    sign: 'increment' | 'decrement',
  ) => {
    if (amount.lte(0)) return;
    const lot = lotId
      ? await tx.stockLot.update({
          where: { id: lotId },
          data: { quantity: { [sign]: amount } },
        })
      : null;
    result.push({
      lotId,
      quantity: amount,
      ...(lot
        ? {
            code: lot.code,
            expiresOn: lot.expiresOn?.toISOString().slice(0, 10) ?? null,
            blocked: lot.blocked,
          }
        : {}),
    });
  };
  if (p.direction === 'DECREASE') {
    let remaining = qty;
    const today = businessDate();
    const candidates = lots.filter(
      (l) =>
        (!p.lotId || l.id === p.lotId) &&
        (p.allowExpired ||
          (!l.blocked &&
            (!l.expiresOn || l.expiresOn.toISOString().slice(0, 10) >= today))),
    );
    if (p.lotId && !lots.some((l) => l.id === p.lotId))
      throw new BadRequestException(
        'Lote no pertenece a este producto y almacén',
      );
    for (const lot of candidates) {
      const amount = Prisma.Decimal.min(lot.quantity, remaining);
      await take(lot.id, amount, 'decrement');
      remaining = remaining.sub(amount);
      if (remaining.eq(0)) break;
    }
    if (remaining.gt(0) && !p.lotId && !product.requireLots) {
      const amount = Prisma.Decimal.min(untracked, remaining);
      await take(null, amount, 'decrement');
      remaining = remaining.sub(amount);
    }
    if (remaining.gt(0))
      throw new ConflictException(
        'Stock utilizable insuficiente: revisa lotes vencidos, bloqueados o sin identificar',
      );
    return result;
  }
  if (p.lotId) {
    if (!lots.some((l) => l.id === p.lotId))
      throw new BadRequestException(
        'Lote no pertenece a este producto y almacén',
      );
    await take(p.lotId, qty, 'increment');
    return result;
  }
  let inputs = p.lotInputs;
  // Refunds restore the original consumed lots, never turn expired stock into fresh stock.
  if (!inputs && p.type === 'RETURN' && p.reference) {
    const original = await tx.lotAllocation.findMany({
      where: {
        organizationId: p.organizationId,
        movement: { ...where, reference: p.reference, type: 'OUT' },
        direction: 'DECREASE',
      },
      include: { lot: true },
      orderBy: { id: 'asc' },
    });
    const restored = await tx.lotAllocation.findMany({
      where: {
        organizationId: p.organizationId,
        movement: { ...where, reference: p.reference, type: 'RETURN' },
        direction: 'INCREASE',
      },
    });
    const used = new Map<string | null, Prisma.Decimal>();
    for (const r of restored)
      used.set(r.lotId, (used.get(r.lotId) ?? ZERO_MONEY).add(r.quantity));
    inputs = [];
    let remaining = qty;
    for (const a of original) {
      let amount = a.quantity;
      const already = used.get(a.lotId) ?? ZERO_MONEY;
      const skip = Prisma.Decimal.min(already, amount);
      used.set(a.lotId, already.sub(skip));
      amount = Prisma.Decimal.min(amount.sub(skip), remaining);
      if (amount.gt(0)) {
        if (a.lot)
          inputs.push({
            code: a.lot.code,
            expiresOn: a.lot.expiresOn?.toISOString().slice(0, 10),
            blocked: a.lot.blocked,
            quantity: amount.toFixed(2),
          });
        else if (product.requireLots)
          inputs.push({
            code: 'DEVOLUCION-SIN-LOTE',
            blocked: true,
            quantity: amount.toFixed(2),
          });
        remaining = remaining.sub(amount);
      }
      if (remaining.eq(0)) break;
    }
    if (remaining.gt(0) && product.requireLots)
      inputs.push({
        code: 'DEVOLUCION-SIN-LOTE',
        blocked: true,
        quantity: remaining.toFixed(2),
      });
  }
  if (inputs) {
    let assigned = ZERO_MONEY;
    for (const input of inputs) {
      const amount = money(input.quantity);
      if (amount.lte(0) || !input.code.trim())
        throw new BadRequestException('Lote y cantidad inválidos');
      assigned = assigned.add(amount);
      const expiresOn = dateOnly(input.expiresOn);
      let lot = await tx.stockLot.findUnique({
        where: {
          warehouseId_productId_code: {
            warehouseId: p.warehouseId,
            productId: p.productId,
            code: input.code.trim(),
          },
        },
      });
      if (
        lot &&
        (lot.expiresOn?.toISOString().slice(0, 10) ?? null) !==
          (input.expiresOn || null)
      )
        throw new ConflictException(
          'Un lote existente no puede cambiar de vencimiento',
        );
      if (lot && input.blocked !== undefined && lot.blocked !== input.blocked)
        throw new ConflictException(
          'No se puede cambiar el bloqueo de un lote',
        );
      lot ??= await tx.stockLot.create({
        data: {
          ...where,
          code: input.code.trim(),
          expiresOn,
          blocked: input.blocked ?? false,
        },
      });
      await take(lot.id, amount, 'increment');
    }
    if (assigned.gt(qty) || (product.requireLots && !assigned.eq(qty)))
      throw new BadRequestException(
        'La cantidad de lotes debe cubrir la entrada',
      );
    if (assigned.lt(qty)) await take(null, qty.sub(assigned), 'increment');
    return result;
  }
  if (product.requireLots)
    throw new BadRequestException('Este producto exige lote en sus entradas');
  await take(null, qty, 'increment');
  return result;
}
export async function usableBalances(
  tx: Prisma.TransactionClient,
  org: string,
  warehouseId?: string,
) {
  const rows = await tx.inventory.findMany({
    where: { organizationId: org, ...(warehouseId ? { warehouseId } : {}) },
    include: { product: { select: { requireLots: true } } },
  });
  const lots = await tx.stockLot.findMany({
    where: { organizationId: org, ...(warehouseId ? { warehouseId } : {}) },
  });
  const today = businessDate();
  return rows.map((row) => {
    const own = lots.filter(
      (l) => l.warehouseId === row.warehouseId && l.productId === row.productId,
    );
    const tracked = own.reduce((s, l) => s.add(l.quantity), ZERO_MONEY);
    const blocked = own
      .filter(
        (l) =>
          l.blocked ||
          (l.expiresOn && l.expiresOn.toISOString().slice(0, 10) < today),
      )
      .reduce((s, l) => s.add(l.quantity), ZERO_MONEY);
    const unidentified = Prisma.Decimal.max(0, row.quantity.sub(tracked));
    return {
      ...row,
      untrackedQuantity: unidentified,
      unavailableQuantity: blocked,
      availableQuantity: Prisma.Decimal.max(
        0,
        row.quantity
          .sub(blocked)
          .sub(row.product.requireLots ? unidentified : 0),
      ),
    };
  });
}
