import { describe, expect, it } from "vitest";
import { computeLocalSaleTotals, localSaleItemSubtotal, paymentMethodTotals } from "./sale-totals";
import type { LocalSale } from "./types";

/**
 * `sale-totals.ts` es la regla de totales que ya vivía dentro de
 * `ticket-mapper.ts` y que ahora comparten el ticket y el historial
 * (UI-5). Lo que se fija acá es justamente lo que NO puede divergir entre
 * las dos pantallas: qué número es el total de una venta local.
 */

function makeSale(overrides: Partial<LocalSale> = {}): LocalSale {
  return {
    id: "local-1",
    organizationId: "org-1",
    serverId: null,
    status: "DRAFT_LOCAL",
    posTerminalId: "pos-1",
    warehouseId: "wh-1",
    customerId: null,
    discount: "0",
    items: [{ productId: "p1", quantity: "2", unitPrice: "15.00", discount: "0" }],
    payments: [],
    createSyncOperationId: "op-1",
    confirmSyncOperationId: null,
    createdAt: new Date().toISOString(),
    serverSummary: null,
    ...overrides,
  };
}

describe("sale-totals", () => {
  it("calcula el total local cuando la venta todavía no sincronizó", () => {
    const totals = computeLocalSaleTotals(makeSale({ discount: "5.00" }));
    expect(totals.subtotal).toBe("30.00");
    expect(totals.discount).toBe("5.00");
    expect(totals.total).toBe("25.00");
    expect(totals.fromServer).toBe(false);
  });

  it("usa los totales del SERVIDOR cuando la venta ya sincronizó — nunca los recalcula", () => {
    // El servidor es la autoridad: aunque el cálculo local diera 30.00, si
    // el backend confirmó 28.00 (ej. una regla de precio que el dispositivo
    // no conoce), manda el backend.
    const totals = computeLocalSaleTotals(
      makeSale({
        status: "CONFIRM_SYNCED",
        serverSummary: { status: "PAID", total: "28.00", paidTotal: "28.00", balance: "0.00" },
      }),
    );
    expect(totals.total).toBe("28.00");
    expect(totals.paidTotal).toBe("28.00");
    expect(totals.balance).toBe("0.00");
    expect(totals.fromServer).toBe(true);
  });

  it("nunca devuelve un total ni un saldo negativos", () => {
    const totals = computeLocalSaleTotals(
      makeSale({ discount: "999.00", payments: [{ method: "CASH", amount: "50.00", idempotencyKey: "k" }] }),
    );
    expect(totals.total).toBe("0.00");
    expect(totals.balance).toBe("0.00");
  });

  it("suma las líneas repetidas del mismo método de pago (pago dividido)", () => {
    const methods = paymentMethodTotals(
      makeSale({
        payments: [
          { method: "CASH", amount: "10.00", idempotencyKey: "k1" },
          { method: "QR", amount: "15.00", idempotencyKey: "k2" },
          { method: "CASH", amount: "5.00", idempotencyKey: "k3" },
        ],
      }),
    );
    expect(methods).toEqual([
      { method: "CASH", amount: "15.00" },
      { method: "QR", amount: "15.00" },
    ]);
  });

  it("una venta sin pagos (a crédito) no inventa un método", () => {
    expect(paymentMethodTotals(makeSale())).toEqual([]);
    expect(computeLocalSaleTotals(makeSale()).paidTotal).toBe("0.00");
  });

  it("el subtotal de línea descuenta el descuento de la línea", () => {
    expect(
      localSaleItemSubtotal({ productId: "p1", quantity: "3", unitPrice: "10.00", discount: "2.50" }),
    ).toBe("27.50");
  });
});
