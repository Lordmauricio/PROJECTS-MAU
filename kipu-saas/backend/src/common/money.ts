import { Prisma } from '../../generated/prisma/client';

// Toda aritmética monetaria del sistema pasa por acá: nunca `number` de
// JavaScript para sumar/restar/comparar dinero. decimal.js (el motor detrás
// de Prisma.Decimal) redondea ROUND_HALF_UP por defecto en
// `toDecimalPlaces`/`toFixed`, que es exactamente el redondeo pedido — se
// pasa el modo explícito igual para no depender de config global mutable.
export type MoneyInput = Prisma.Decimal | string | number;

export function money(value: MoneyInput): Prisma.Decimal {
  return new Prisma.Decimal(value).toDecimalPlaces(
    2,
    Prisma.Decimal.ROUND_HALF_UP,
  );
}

export const ZERO_MONEY = money(0);

export function sumMoney(values: MoneyInput[]): Prisma.Decimal {
  return values.reduce<Prisma.Decimal>(
    (acc, v) => acc.add(money(v)),
    ZERO_MONEY,
  );
}
