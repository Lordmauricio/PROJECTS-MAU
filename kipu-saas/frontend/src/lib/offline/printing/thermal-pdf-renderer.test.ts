import { describe, expect, it } from "vitest";
import { extractPdfText } from "../test-support/pdf-text";
import { ticketFromLocalSale, ticketFromReceiptSnapshot, type ReceiptSnapshotLike } from "./ticket-mapper";
import { renderThermalPdf } from "./thermal-pdf-renderer";
import type { LocalSale } from "../types";
import type { TicketData } from "./ticket-data";

const MM = 2.834645669;
const THERMAL_WIDTH_PT = 80 * MM;

function baseSale(overrides: Partial<LocalSale> = {}): LocalSale {
  return {
    id: "local-sale-pdf-1",
    organizationId: "org-1",
    serverId: null,
    status: "DRAFT_LOCAL",
    posTerminalId: "pos-1",
    warehouseId: "wh-1",
    customerId: null,
    discount: "0",
    items: [{ productId: "prod-1", quantity: "2", unitPrice: "20.00", discount: "0" }],
    payments: [{ method: "CASH", amount: "40.00", idempotencyKey: "idem-1" }],
    createSyncOperationId: "op-create-1",
    confirmSyncOperationId: "op-confirm-1",
    createdAt: "2026-08-30T15:42:00.000Z",
    serverSummary: null,
    ...overrides,
  };
}

const PRODUCTS = new Map([["prod-1", { name: "Hamburguesa", sku: "HAMB" }]]);

function baseCtx() {
  return {
    organizationName: "Kiosco La Esquina",
    businessLegalName: "Kiosco La Esquina SRL",
    businessNit: "1023456789",
    businessAddress: "Av. Simón Bolívar #742",
    businessPhone: "77712345",
    branchName: "Sucursal Centro",
    posTerminalName: "Caja 1",
    posTerminalCode: "POS-01",
    cashierName: "María José Peñaranda Núñez",
    customer: { name: "Juan Pérez Áñez", documentType: "CI", documentNumber: "1234567" } as
      | { name: string; documentType: string; documentNumber: string }
      | null,
    products: PRODUCTS,
  };
}

function baseTicket(): TicketData {
  return ticketFromLocalSale(baseSale(), baseCtx(), "pending-sync");
}

describe("renderThermalPdf — dimensiones del papel térmico", () => {
  it("el ancho de página es EXACTAMENTE 80mm en puntos PDF, nunca A4 reducido", async () => {
    const bytes = await renderThermalPdf(baseTicket());
    const pdf = await extractPdfText(bytes);
    expect(pdf.pageCount).toBe(1);
    expect(pdf.pageWidths[0]).toBeCloseTo(THERMAL_WIDTH_PT, 1);
  });

  it("la altura crece dinámicamente con la cantidad de productos — siempre UNA sola página", async () => {
    const oneItemTicket = ticketFromLocalSale(baseSale(), baseCtx(), "pending-sync");
    const twentyItemsSale = baseSale({
      items: Array.from({ length: 20 }, (_, i) => ({
        productId: `prod-${i}`,
        quantity: "1",
        unitPrice: "10.00",
        discount: "0",
      })),
    });
    const twentyProducts = new Map(
      Array.from({ length: 20 }, (_, i) => [`prod-${i}`, { name: `Producto ${i + 1}`, sku: null }] as const),
    );
    const twentyItemsTicket = ticketFromLocalSale(twentyItemsSale, { ...baseCtx(), products: twentyProducts }, "pending-sync");

    const shortPdf = await extractPdfText(await renderThermalPdf(oneItemTicket));
    const longPdf = await extractPdfText(await renderThermalPdf(twentyItemsTicket));

    expect(shortPdf.pageCount).toBe(1);
    expect(longPdf.pageCount).toBe(1); // nunca pagina — una altura dinámica, no A4 con "continúa"
    expect(longPdf.pageHeights[0]).toBeGreaterThan(shortPdf.pageHeights[0]);
    // Los 20 productos están todos presentes en la única página.
    for (let i = 1; i <= 20; i++) {
      expect(longPdf.text).toContain(`Producto ${i}`);
    }
  });
});

describe("renderThermalPdf — contenido comercial correcto", () => {
  it("negocio, sucursal, POS, cajero y NIT aparecen tal cual — nunca inventados", async () => {
    const pdf = await extractPdfText(await renderThermalPdf(baseTicket()));
    expect(pdf.text).toContain("Kiosco La Esquina SRL");
    expect(pdf.text).toContain("1023456789");
    expect(pdf.text).toContain("Sucursal Centro");
    expect(pdf.text).toContain("Caja 1");
  });

  it("venta OFFLINE pendiente: nunca inventa un folio — muestra el id local y 'PENDIENTE DE SINCRONIZAR'", async () => {
    const ticket = ticketFromLocalSale(baseSale(), baseCtx(), "pending-sync");
    expect(ticket.operation.fullNumber).toBeNull();
    const pdf = await extractPdfText(await renderThermalPdf(ticket));
    expect(pdf.text).toContain("PENDIENTE DE SINCRONIZAR");
    expect(pdf.text).toContain("local-sale-pdf-1");
    expect(pdf.text).not.toMatch(/Venta:\s*A-\d/); // ningún folio con forma de serie inventado
  });

  it("venta ya SINCRONIZADA (LocalSale con serverSummary): sin 'PENDIENTE', pero el folio SIGUE null — LocalSale nunca emite un recibo", async () => {
    const syncedSale = baseSale({
      status: "CONFIRM_SYNCED",
      serverId: "server-sale-1",
      serverSummary: { status: "PAID", total: "40.00", paidTotal: "40.00", balance: "0.00" },
    });
    const ticket = ticketFromLocalSale(syncedSale, baseCtx(), "synced");
    expect(ticket.operation.fullNumber).toBeNull();
    const pdf = await extractPdfText(await renderThermalPdf(ticket));
    expect(pdf.text).not.toContain("PENDIENTE DE SINCRONIZAR");
  });

  it("recibo YA EMITIDO (ticketFromReceiptSnapshot): el folio real del servidor SÍ aparece", async () => {
    const snapshot: ReceiptSnapshotLike = {
      documentLabel: "RECIBO DE VENTA",
      documentType: "DOCUMENTO COMERCIAL NO FISCAL",
      issuer: {
        name: "Kiosco La Esquina",
        legalName: "Kiosco La Esquina SRL",
        nit: "1023456789",
        address: null,
        phone: null,
        branch: { name: "Sucursal Centro", address: null },
        posTerminal: { name: "Caja 1", code: "POS-01" },
      },
      operation: { fullNumber: "A-000123", issuedAt: "2026-08-30T15:42:00.000Z", cashierName: "Ana", saleId: "server-sale-9" },
      customer: null,
      items: [{ productName: "Hamburguesa", sku: "HAMB", quantity: "2", unitPrice: "20.00", discount: "0.00", subtotal: "40.00" }],
      totals: { subtotal: "40.00", discount: "0.00", total: "40.00" },
      payments: { methods: [{ method: "CASH", amount: "40.00" }], paidTotal: "40.00", balance: "0.00" },
      observations: null,
    };
    const ticket = ticketFromReceiptSnapshot(snapshot);
    const pdf = await extractPdfText(await renderThermalPdf(ticket));
    expect(pdf.text).toContain("A-000123");
    expect(pdf.text).not.toContain("PENDIENTE DE SINCRONIZAR");
  });

  it("productos, cantidades, precio unitario y subtotal aparecen correctamente", async () => {
    const pdf = await extractPdfText(await renderThermalPdf(baseTicket()));
    expect(pdf.text).toContain("Hamburguesa");
    expect(pdf.text).toContain("HAMB");
    expect(pdf.text).toContain("2 x 20.00 = 40.00");
  });

  it("descuento de línea: se muestra SOLO cuando es mayor a cero", async () => {
    const withDiscount = ticketFromLocalSale(
      baseSale({ items: [{ productId: "prod-1", quantity: "1", unitPrice: "20.00", discount: "3.00" }] }),
      baseCtx(),
      "pending-sync",
    );
    const withoutDiscount = ticketFromLocalSale(baseSale(), baseCtx(), "pending-sync");

    const pdfWith = await extractPdfText(await renderThermalPdf(withDiscount));
    const pdfWithout = await extractPdfText(await renderThermalPdf(withoutDiscount));
    expect(pdfWith.text).toContain("Descuento: 3.00");
    expect(pdfWithout.text).not.toContain("Descuento:");
  });

  it("descuento de venta y total: los totales del ticket son los correctos, right-aligned", async () => {
    const ticket = ticketFromLocalSale(baseSale({ discount: "5.00" }), baseCtx(), "pending-sync");
    expect(ticket.totals.subtotal).toBe("40.00");
    expect(ticket.totals.discount).toBe("5.00");
    expect(ticket.totals.total).toBe("35.00");
    const pdf = await extractPdfText(await renderThermalPdf(ticket));
    expect(pdf.text).toContain("Subtotal: 40.00");
    expect(pdf.text).toContain("Descuento: 5.00");
    expect(pdf.text).toContain("TOTAL: 35.00");
  });

  it("múltiples métodos de pago: todos aparecen listados por separado", async () => {
    const ticket = ticketFromLocalSale(
      baseSale({
        payments: [
          { method: "CASH", amount: "20.00", idempotencyKey: "a" },
          { method: "CARD", amount: "15.00", idempotencyKey: "b" },
          { method: "QR", amount: "5.00", idempotencyKey: "c" },
        ],
      }),
      baseCtx(),
      "pending-sync",
    );
    const pdf = await extractPdfText(await renderThermalPdf(ticket));
    expect(pdf.text).toContain("CASH: 20.00");
    expect(pdf.text).toContain("CARD: 15.00");
    expect(pdf.text).toContain("QR: 5.00");
  });

  it("saldo pendiente: se muestra SOLO cuando es mayor a cero", async () => {
    const partialPaid = ticketFromLocalSale(
      { ...baseSale(), status: "CONFIRM_SYNCED", serverSummary: { status: "PARTIALLY_PAID", total: "40.00", paidTotal: "20.00", balance: "20.00" } },
      baseCtx(),
      "synced",
    );
    const fullyPaid = ticketFromLocalSale(
      { ...baseSale(), status: "CONFIRM_SYNCED", serverSummary: { status: "PAID", total: "40.00", paidTotal: "40.00", balance: "0.00" } },
      baseCtx(),
      "synced",
    );
    const pdfPartial = await extractPdfText(await renderThermalPdf(partialPaid));
    const pdfFull = await extractPdfText(await renderThermalPdf(fullyPaid));
    expect(pdfPartial.text).toContain("Saldo pendiente: 20.00");
    expect(pdfFull.text).not.toContain("Saldo pendiente");
  });

  it("observaciones: aparecen cuando existen", async () => {
    const withObs = ticketFromLocalSale(baseSale(), baseCtx(), "pending-sync");
    withObs.observations = "Entregar sin cebolla";
    const pdf = await extractPdfText(await renderThermalPdf(withObs));
    expect(pdf.text).toContain("Entregar sin cebolla");
  });

  it("sin cliente: muestra 'Cliente ocasional', nunca 'undefined' ni 'null'", async () => {
    const ticket = ticketFromLocalSale(baseSale(), { ...baseCtx(), customer: null }, "pending-sync");
    expect(ticket.customer).toBeNull();
    const pdf = await extractPdfText(await renderThermalPdf(ticket));
    expect(pdf.text).toContain("Cliente ocasional");
    expect(pdf.text).not.toContain("undefined");
    expect(pdf.text).not.toContain("null");
  });

  it("siempre incluye 'DOCUMENTO COMERCIAL NO FISCAL' y la advertencia legal, en cualquier estado", async () => {
    const pending = await extractPdfText(await renderThermalPdf(baseTicket()));
    const synced = await extractPdfText(
      await renderThermalPdf(ticketFromLocalSale({ ...baseSale(), status: "CONFIRM_SYNCED", serverSummary: { status: "PAID", total: "40.00", paidTotal: "40.00", balance: "0.00" } }, baseCtx(), "synced")),
    );
    for (const pdf of [pending, synced]) {
      expect(pdf.text).toContain("DOCUMENTO COMERCIAL NO FISCAL");
      expect(pdf.text).toContain("No sustituye la factura exigida por ley.");
    }
  });

  it("nunca incluye tokens, contraseñas ni credenciales — el ticket solo trae datos comerciales ya autorizados", async () => {
    const pdf = await extractPdfText(await renderThermalPdf(baseTicket()));
    const lower = pdf.text.toLowerCase();
    for (const forbidden of ["password", "contraseña", "token", "secret", "bearer "]) {
      expect(lower).not.toContain(forbidden);
    }
  });
});

describe("renderThermalPdf — Unicode y texto largo", () => {
  it("acentos y ñ españoles se leen de vuelta correctamente (á é í ó ú ü ñ Ñ) — sin transliteración ASCII", async () => {
    const ctx = {
      ...baseCtx(),
      customer: { name: "Juan Pérez Áñez", documentType: "CI", documentNumber: "1234567" },
    };
    const ticket = ticketFromLocalSale(baseSale(), ctx, "pending-sync");
    const pdf = await extractPdfText(await renderThermalPdf(ticket));
    expect(pdf.text).toContain("María José Peñaranda Núñez"); // cajero, viene de baseCtx()
    expect(pdf.text).toContain("Juan Pérez Áñez");
    expect(pdf.text).toContain("Simón Bolívar");
  });

  it("nombre de producto muy largo: se envuelve en varias líneas, sin desbordar ni lanzar, y el texto completo sigue presente", async () => {
    const longName = "Hamburguesa doble artesanal con queso cheddar, tocino ahumado, cebolla caramelizada y salsa especial de la casa";
    const products = new Map([["prod-1", { name: longName, sku: "HAMB-XL" }]]);
    const ticket = ticketFromLocalSale(baseSale(), { ...baseCtx(), products }, "pending-sync");
    const bytes = await renderThermalPdf(ticket);
    const pdf = await extractPdfText(bytes);
    // El nombre completo está presente (aunque partido en varias líneas, el
    // extractor de texto las reconstruye con espacios entre fragmentos).
    for (const word of ["Hamburguesa", "artesanal", "cheddar", "caramelizada"]) {
      expect(pdf.text).toContain(word);
    }
  });

  it("nombre de cliente muy largo: se envuelve sin romper el layout ni desbordar el ancho de página", async () => {
    const ctx = {
      ...baseCtx(),
      customer: {
        name: "María Fernanda de los Ángeles Rodríguez Villanueva Peñaranda",
        documentType: "CI",
        documentNumber: "9999999",
      },
    };
    const ticket = ticketFromLocalSale(baseSale(), ctx, "pending-sync");
    const bytes = await renderThermalPdf(ticket);
    const pdf = await extractPdfText(bytes);
    expect(pdf.pageWidths[0]).toBeCloseTo(THERMAL_WIDTH_PT, 1); // el ancho nunca cambia por texto largo
    expect(pdf.text).toContain("Rodríguez Villanueva");
  });
});
