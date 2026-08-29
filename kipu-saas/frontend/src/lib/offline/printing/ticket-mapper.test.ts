import { describe, expect, it } from "vitest";
import { ticketFromLocalSale, ticketFromReceiptSnapshot, type ReceiptSnapshotLike } from "./ticket-mapper";
import type { LocalSale } from "../types";

function baseSale(overrides: Partial<LocalSale> = {}): LocalSale {
  return {
    id: "local-sale-1",
    organizationId: "org-1",
    serverId: null,
    status: "DRAFT_LOCAL",
    posTerminalId: "pos-1",
    warehouseId: "wh-1",
    customerId: null,
    discount: "0",
    items: [{ productId: "prod-1", quantity: "2", unitPrice: "15.00", discount: "0" }],
    payments: [{ method: "CASH", amount: "30.00", idempotencyKey: "idem-1" }],
    createSyncOperationId: "op-create-1",
    confirmSyncOperationId: "op-confirm-1",
    createdAt: "2026-01-01T10:00:00.000Z",
    serverSummary: null,
    ...overrides,
  };
}

const PRODUCTS = new Map([["prod-1", { name: "Coca Cola 2L", sku: "COCA" }]]);

describe("ticketFromLocalSale — LocalSale → TicketData", () => {
  it("mapea negocio/sucursal/pos desde el contexto provisto por el caller", () => {
    const ticket = ticketFromLocalSale(
      baseSale(),
      {
        organizationName: "Mi Negocio",
        branchName: "Sucursal Centro",
        posTerminalName: "Caja 1",
        posTerminalCode: "POS-1",
        cashierName: "Ana",
        customer: null,
        products: PRODUCTS,
      },
      "pending-sync",
    );
    expect(ticket.business.name).toBe("Mi Negocio");
    expect(ticket.branch).toEqual({ name: "Sucursal Centro", address: null });
    expect(ticket.posTerminal).toEqual({ name: "Caja 1", code: "POS-1" });
    expect(ticket.operation.cashierName).toBe("Ana");
  });

  it("resuelve nombre/sku de producto desde el mapa provisto (LocalSaleItem solo tiene el id)", () => {
    const ticket = ticketFromLocalSale(
      baseSale(),
      { organizationName: "N", cashierName: null, customer: null, products: PRODUCTS },
      "pending-sync",
    );
    expect(ticket.items).toHaveLength(1);
    expect(ticket.items[0].productName).toBe("Coca Cola 2L");
    expect(ticket.items[0].sku).toBe("COCA");
    expect(ticket.items[0].subtotal).toBe("30.00"); // 2 x 15.00
  });

  it("producto no encontrado en el mapa: usa un nombre de respaldo legible, nunca lanza", () => {
    const ticket = ticketFromLocalSale(
      baseSale({ items: [{ productId: "prod-desconocido", quantity: "1", unitPrice: "5.00", discount: "0" }] }),
      { organizationName: "N", cashierName: null, customer: null, products: new Map() },
      "pending-sync",
    );
    expect(ticket.items[0].productName).toContain("prod-desconocido");
  });

  // 14 — venta offline: nunca inventa un folio del servidor
  it("venta offline (pending-sync): operation.fullNumber es SIEMPRE null, usa el id local", () => {
    const ticket = ticketFromLocalSale(
      baseSale(),
      { organizationName: "N", cashierName: null, customer: null, products: PRODUCTS },
      "pending-sync",
    );
    expect(ticket.operation.fullNumber).toBeNull();
    expect(ticket.operation.localId).toBe("local-sale-1");
    expect(ticket.syncStatus).toBe("pending-sync");
  });

  it("venta offline sin serverSummary: los totales se calculan localmente a partir del carrito", () => {
    const ticket = ticketFromLocalSale(
      baseSale({ discount: "5.00" }),
      { organizationName: "N", cashierName: null, customer: null, products: PRODUCTS },
      "pending-sync",
    );
    // 2 x 15.00 = 30.00 subtotal, -5.00 descuento = 25.00 total; pagó 30.00 (queda de más, balance se recorta a 0).
    expect(ticket.totals.subtotal).toBe("30.00");
    expect(ticket.totals.discount).toBe("5.00");
    expect(ticket.totals.total).toBe("25.00");
    expect(ticket.payments.paidTotal).toBe("30.00");
    expect(ticket.payments.balance).toBe("0.00");
  });

  it("venta ya CONFIRM_SYNCED con serverSummary: usa los totales REALES del servidor, nunca los recalcula", () => {
    const ticket = ticketFromLocalSale(
      baseSale({
        status: "CONFIRM_SYNCED",
        serverSummary: { status: "PAID", total: "999.99", paidTotal: "999.99", balance: "0.00" },
      }),
      { organizationName: "N", cashierName: null, customer: null, products: PRODUCTS },
      "synced",
    );
    // 999.99 es deliberadamente distinto de lo que el carrito local calcularía (30.00) —
    // prueba que el mapper usa el valor del servidor tal cual, sin tocarlo.
    expect(ticket.totals.total).toBe("999.99");
    expect(ticket.payments.paidTotal).toBe("999.99");
    expect(ticket.syncStatus).toBe("synced");
    // fullNumber sigue null: una LocalSale nunca tiene folio de recibo, sincronizada o no.
    expect(ticket.operation.fullNumber).toBeNull();
  });

  it("agrupa pagos por método (dos líneas del mismo método se suman)", () => {
    const ticket = ticketFromLocalSale(
      baseSale({
        payments: [
          { method: "CASH", amount: "10.00", idempotencyKey: "a" },
          { method: "CASH", amount: "5.00", idempotencyKey: "b" },
        ],
      }),
      { organizationName: "N", cashierName: null, customer: null, products: PRODUCTS },
      "pending-sync",
    );
    expect(ticket.payments.methods).toEqual([{ method: "CASH", amount: "15.00" }]);
  });

  it("siempre marca DOCUMENTO COMERCIAL NO FISCAL, sin importar el estado de sync", () => {
    const ticket = ticketFromLocalSale(
      baseSale(),
      { organizationName: "N", cashierName: null, customer: null, products: PRODUCTS },
      "synced",
    );
    expect(ticket.documentType).toBe("DOCUMENTO COMERCIAL NO FISCAL");
  });

  it("cliente: se refleja tal cual lo resolvió el caller", () => {
    const ticket = ticketFromLocalSale(
      baseSale(),
      {
        organizationName: "N",
        cashierName: null,
        customer: { name: "Juan Pérez", documentType: "CI", documentNumber: "12345" },
        products: PRODUCTS,
      },
      "pending-sync",
    );
    expect(ticket.customer).toEqual({ name: "Juan Pérez", documentType: "CI", documentNumber: "12345" });
  });
});

describe("ticketFromReceiptSnapshot — ReceiptSnapshot (backend) → TicketData", () => {
  function baseSnapshot(overrides: Partial<ReceiptSnapshotLike> = {}): ReceiptSnapshotLike {
    return {
      documentLabel: "RECIBO DE VENTA",
      documentType: "DOCUMENTO COMERCIAL NO FISCAL",
      issuer: {
        name: "Mi Negocio",
        legalName: "Mi Negocio SRL",
        nit: "123456789",
        address: "Calle Falsa 123",
        phone: "70000000",
        branch: { name: "Sucursal Centro", address: null },
        posTerminal: { name: "Caja 1", code: "POS-1" },
      },
      operation: {
        fullNumber: "A-000123",
        issuedAt: "2026-01-01T10:00:00.000Z",
        cashierName: "Ana",
        saleId: "server-sale-1",
      },
      customer: null,
      items: [
        { productName: "Coca Cola 2L", sku: "COCA", quantity: "2", unitPrice: "15.00", discount: "0.00", subtotal: "30.00" },
      ],
      totals: { subtotal: "30.00", discount: "0.00", total: "30.00" },
      payments: { methods: [{ method: "CASH", amount: "30.00" }], paidTotal: "30.00", balance: "0.00" },
      observations: null,
      ...overrides,
    };
  }

  it("un recibo ya emitido siempre mapea a syncStatus 'synced', con el folio real del servidor", () => {
    const ticket = ticketFromReceiptSnapshot(baseSnapshot());
    expect(ticket.syncStatus).toBe("synced");
    expect(ticket.operation.fullNumber).toBe("A-000123");
    expect(ticket.operation.localId).toBe("server-sale-1");
  });

  it("conserva negocio/sucursal/pos/cliente/ítems/totales/pagos tal cual el snapshot — nunca recalcula nada", () => {
    const snapshot = baseSnapshot({
      customer: { name: "Juan Pérez", documentType: "CI", documentNumber: "12345" },
    });
    const ticket = ticketFromReceiptSnapshot(snapshot);
    expect(ticket.business).toEqual({
      name: "Mi Negocio",
      legalName: "Mi Negocio SRL",
      nit: "123456789",
      address: "Calle Falsa 123",
      phone: "70000000",
    });
    expect(ticket.branch).toEqual({ name: "Sucursal Centro", address: null });
    expect(ticket.customer).toEqual({ name: "Juan Pérez", documentType: "CI", documentNumber: "12345" });
    expect(ticket.items).toEqual(snapshot.items);
    expect(ticket.totals).toEqual(snapshot.totals);
    expect(ticket.payments).toEqual(snapshot.payments);
  });
});
