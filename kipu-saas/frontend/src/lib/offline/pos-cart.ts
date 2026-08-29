/**
 * Lógica pura del carrito del POS — extraída tal cual del componente
 * original (`app/sales/pos/page.tsx`) para que sea testeable sin
 * necesidad de renderizar React, y reutilizable tanto en el flujo online
 * como offline (el carrito es idéntico en ambos casos, lo único que
 * cambia es qué pasa al confirmar — ver `pos-submit.ts`).
 *
 * Los montos viven como `number` acá a propósito (igual que la UI
 * original, donde vienen de `<input type="number">`) — la conversión a
 * `string` para persistencia/envío ocurre recién en el borde
 * (`pos-submit.ts`), nunca antes. Esta capa no decide precisión
 * financiera: es aritmética de PANTALLA (cuánto mostrar mientras se arma
 * el carrito), la verdad final siempre la calcula el backend con
 * `Prisma.Decimal`.
 */

export interface CartProduct {
  id: string;
  name: string;
  price: string;
}

export interface CartLine {
  productId: string;
  name: string;
  quantity: number;
  unitPrice: number;
  discount: number;
}

export function addToCart(cart: CartLine[], product: CartProduct): CartLine[] {
  const existing = cart.find((l) => l.productId === product.id);
  if (existing) {
    return cart.map((l) =>
      l.productId === product.id ? { ...l, quantity: l.quantity + 1 } : l,
    );
  }
  return [
    ...cart,
    { productId: product.id, name: product.name, quantity: 1, unitPrice: Number(product.price), discount: 0 },
  ];
}

export function updateCartLine(
  cart: CartLine[],
  productId: string,
  patch: Partial<CartLine>,
): CartLine[] {
  return cart.map((l) => (l.productId === productId ? { ...l, ...patch } : l));
}

export function removeCartLine(cart: CartLine[], productId: string): CartLine[] {
  return cart.filter((l) => l.productId !== productId);
}

export function lineSubtotal(line: CartLine): number {
  return line.quantity * line.unitPrice - line.discount;
}

export interface CartTotals {
  subtotal: number;
  total: number;
}

export function computeCartTotals(cart: CartLine[], saleDiscount: number): CartTotals {
  const subtotal = cart.reduce((acc, line) => acc + lineSubtotal(line), 0);
  const total = Math.max(0, subtotal - saleDiscount);
  return { subtotal, total };
}
