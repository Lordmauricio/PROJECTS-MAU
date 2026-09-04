import type { LocalSale, LocalSaleItem } from "./types";

/**
 * Totales de una venta LOCAL. Extraído de `printing/ticket-mapper.ts`
 * (Offline 4.6B), donde esta regla ya existía y seguía siendo la única
 * definición válida — el historial (Offline 4.15 / UI-5) necesita el
 * MISMO número que imprime el ticket, así que se comparte la función en
 * vez de recalcularlo en la UI. `ticket-mapper` ahora la consume: sigue
 * habiendo una sola implementación, no dos que puedan divergir.
 *
 * La regla, tal cual estaba: si la venta ya sincronizó, mandan los
 * totales del SERVIDOR (`serverSummary`) — nunca se recalculan
 * localmente; si todavía no sincronizó, se calculan a partir de la venta
 * guardada, que es lo mejor disponible sin red.
 */

/** Subtotal de una línea, redondeado a 2 decimales igual que en el ticket. */
export function localSaleItemSubtotal(item: LocalSaleItem): string {
  return (Number(item.quantity) * Number(item.unitPrice) - Number(item.discount)).toFixed(2);
}

export interface LocalSaleTotals {
  /** Suma de los subtotales de línea — SIEMPRE local (el servidor no devuelve subtotal en `serverSummary`). */
  subtotal: string;
  /** Descuento de la venta, tal cual se guardó. */
  discount: string;
  total: string;
  paidTotal: string;
  balance: string;
  /** `true` cuando `total`/`paidTotal`/`balance` vienen confirmados por el servidor, no calculados en el dispositivo. */
  fromServer: boolean;
}

export function computeLocalSaleTotals(sale: LocalSale): LocalSaleTotals {
  const localSubtotal = sale.items.reduce((acc, item) => acc + Number(localSaleItemSubtotal(item)), 0);
  const localTotal = Math.max(0, localSubtotal - Number(sale.discount));
  const localPaidTotal = sale.payments.reduce((acc, p) => acc + Number(p.amount), 0);
  const localBalance = Math.max(0, localTotal - localPaidTotal);

  const server = sale.serverSummary;
  return {
    subtotal: localSubtotal.toFixed(2),
    discount: Number(sale.discount).toFixed(2),
    total: server ? server.total : localTotal.toFixed(2),
    paidTotal: server ? server.paidTotal : localPaidTotal.toFixed(2),
    balance: server ? server.balance : localBalance.toFixed(2),
    fromServer: Boolean(server),
  };
}

export interface PaymentMethodTotal {
  method: string;
  amount: string;
}

/** Un renglón por método de pago realmente usado, sumando las líneas repetidas del mismo método (el POS permite pago dividido). */
export function paymentMethodTotals(sale: LocalSale): PaymentMethodTotal[] {
  const totals = new Map<string, number>();
  for (const p of sale.payments) {
    totals.set(p.method, (totals.get(p.method) ?? 0) + Number(p.amount));
  }
  return [...totals.entries()].map(([method, amount]) => ({ method, amount: amount.toFixed(2) }));
}
