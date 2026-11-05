import { Prisma } from '../../generated/prisma/client';
import { money } from '../common/money';

/** Only server-generated snapshots reach here; fail closed on malformed data. */
export function stockComponents(item: {
  productId: string;
  quantity: Prisma.Decimal;
  stockComponents: Prisma.JsonValue | null;
}) {
  if (item.stockComponents === null)
    return [{ productId: item.productId, quantity: item.quantity }];
  if (!Array.isArray(item.stockComponents) || item.stockComponents.length === 0)
    throw new Error('Composición histórica inválida');
  return item.stockComponents.map((component) => {
    if (
      !component ||
      typeof component !== 'object' ||
      Array.isArray(component) ||
      typeof component.productId !== 'string' ||
      typeof component.quantity !== 'string' ||
      !/^\d+(\.\d{1,2})?$/.test(component.quantity) ||
      !money(component.quantity).gt(0)
    )
      throw new Error('Composición histórica inválida');
    return {
      productId: component.productId,
      quantity: money(component.quantity).mul(item.quantity),
    };
  });
}
