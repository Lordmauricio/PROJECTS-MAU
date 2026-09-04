import type { LocalSalePayment } from "./types";

export type PaymentMethod = LocalSalePayment["method"];

/**
 * Los CUATRO métodos reales que acepta el backend (`CreateSalePaymentDto`)
 * y que el POS ya ofrecía — no un subconjunto. Una sola definición para el
 * selector del POS y para el historial: si mañana el backend agrega uno,
 * se agrega acá y las dos pantallas quedan al día juntas.
 */
export const PAYMENT_METHODS: PaymentMethod[] = ["CASH", "CARD", "TRANSFER", "QR"];

export const PAYMENT_METHOD_LABELS: Record<PaymentMethod, string> = {
  CASH: "Efectivo",
  CARD: "Tarjeta",
  TRANSFER: "Transferencia",
  QR: "QR",
};

/**
 * Etiqueta legible de un método guardado. Tolera un valor desconocido
 * (una venta vieja, o un método que el backend agregue antes que el
 * frontend) devolviéndolo tal cual en vez de romper la pantalla — nunca
 * lo traduce a un método que no es.
 */
export function paymentMethodLabel(method: string): string {
  return PAYMENT_METHOD_LABELS[method as PaymentMethod] ?? method;
}
