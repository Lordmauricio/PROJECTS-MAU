import { describe, expect, it, vi } from "vitest";
import { getLocalDb, resetLocalDbCache } from "../db";
import { resetAppMetaDbCache } from "../app-meta-db";
import { runFullInitialSync } from "../catalog-sync";
import { createSaleOffline, confirmSaleOffline } from "../sales-repo";
import { uniqueOrgId } from "../test-support/unique";
import { computeCartTotals } from "../pos-cart";
import type { LocalOrgContext } from "../types";
import { FakePrinterTransport } from "./fake-printer-transport";
import { PrinterManager } from "./printer-manager";
import { ticketFromLocalSale, type TicketMapperContext } from "./ticket-mapper";
import type { PrinterCapability } from "./types";

/**
 * Offline 4.5 — "DATOS COMPLETOS PARA TICKET OFFLINE".
 *
 * Este archivo prueba el pipeline COMPLETO con datos realistas producidos
 * por `runFullInitialSync` (identidad real de negocio/sucursal/POS, Offline
 * 4.5) — a diferencia de `printing-integration.test.ts` (Offline 4.4), que
 * usa un `TicketMapperContext` armado a mano para probar la arquitectura de
 * impresión en sí. Acá el objetivo es demostrar que los datos que esta fase
 * agrega a `LocalOrgContext` son SUFICIENTES para construir, sin ninguna
 * llamada de red, un ticket comercial NO fiscal completo — nunca que hace
 * falta un endpoint nuevo.
 *
 * `ticket-mapper.ts` NO se modifica en esta fase — sigue siendo el caller
 * quien arma `TicketMapperContext` a partir de `LocalOrgContext` + cliente/
 * productos ya resueltos de Dexie (ver docstring de `TicketMapperContext`).
 * La función `contextFrom()` de este archivo es solo el equivalente de
 * pruebas de ese armado — no vive en `src/` porque wirear esto a la UI real
 * del POS es tarea de una fase futura (4.9+), fuera de este alcance.
 */

const ESC = 0x1b;
const GS = 0x1d;

function toReadableText(bytes: Uint8Array): string {
  let out = "";
  for (let i = 0; i < bytes.length; i++) {
    const b = bytes[i];
    if (b === ESC) {
      if (bytes[i + 1] === 0x40) i += 1;
      else i += 2;
      continue;
    }
    if (b === GS) {
      i += 2;
      continue;
    }
    out += String.fromCharCode(b);
  }
  return out;
}

function jsonResponse(body: unknown) {
  return new Response(JSON.stringify(body), { status: 200 });
}

const CAPABILITIES: PrinterCapability[] = ["text", "bold", "alignment", "textSize", "cut"];

/** Arma el `TicketMapperContext` que el caller (futura UI del POS) construiría a partir de `LocalOrgContext` + cliente/productos ya resueltos — sin tocar `ticket-mapper.ts`. */
function contextFrom(
  ctx: LocalOrgContext,
  extra: { customer: TicketMapperContext["customer"]; products: TicketMapperContext["products"] },
): TicketMapperContext {
  return {
    organizationName: ctx.organizationName,
    businessLegalName: ctx.businessLegalName,
    businessNit: ctx.businessNit,
    businessAddress: ctx.businessAddress,
    businessPhone: ctx.businessPhone,
    branchName: ctx.branchName,
    posTerminalName: ctx.posTerminalName,
    posTerminalCode: ctx.posTerminalCode,
    cashierName: ctx.userName,
    ...extra,
  };
}

/** Stub de `GET /organizations/me` + `GET /branches` + `GET /products` + `GET /customers` con datos de UN negocio realista — reutilizable entre tests. */
function fetchForOrg(opts: {
  nit: string;
  legalName: string;
  address: string | null;
  phone: string | null;
  logoUrl: string | null;
  branchName: string;
  posName: string;
  posCode: string;
  products: Array<{ id: string; name: string; sku: string | null; price: string }>;
  customers: Array<{ id: string; name: string; documentType: string | null; documentNumber: string | null }>;
}) {
  return vi.fn().mockImplementation((url: string) => {
    if (url.endsWith("/organizations/me")) {
      return Promise.resolve(
        jsonResponse({
          name: opts.legalName,
          legalName: opts.legalName,
          nit: opts.nit,
          address: opts.address,
          phone: opts.phone,
          logoUrl: opts.logoUrl,
        }),
      );
    }
    if (url.endsWith("/branches")) {
      return Promise.resolve(
        jsonResponse([
          {
            id: "branch-1",
            name: opts.branchName,
            address: null,
            warehouses: [{ id: "wh-1" }],
            posTerminals: [{ id: "pos-1", name: opts.posName, code: opts.posCode }],
          },
        ]),
      );
    }
    if (url.endsWith("/products")) {
      return Promise.resolve(
        jsonResponse(
          opts.products.map((p) => ({
            id: p.id,
            organizationId: "org",
            name: p.name,
            sku: p.sku,
            barcode: null,
            price: p.price,
            active: true,
            updatedAt: "2026-01-01T00:00:00.000Z",
          })),
        ),
      );
    }
    if (url.endsWith("/customers")) {
      return Promise.resolve(
        jsonResponse(
          opts.customers.map((c) => ({
            id: c.id,
            organizationId: "org",
            name: c.name,
            documentType: c.documentType,
            documentNumber: c.documentNumber,
            phone: null,
            email: null,
            active: true,
            updatedAt: "2026-01-01T00:00:00.000Z",
          })),
        ),
      );
    }
    throw new Error(`URL inesperada en el stub: ${url}`);
  });
}

async function bootstrapOrg(
  org: string,
  input: {
    nit: string;
    legalName: string;
    address?: string | null;
    phone?: string | null;
    logoUrl?: string | null;
    branchName: string;
    posName: string;
    posCode: string;
    products: Array<{ id: string; name: string; sku: string | null; price: string }>;
    customers?: Array<{ id: string; name: string; documentType: string | null; documentNumber: string | null }>;
    userName?: string;
  },
) {
  vi.stubGlobal(
    "fetch",
    fetchForOrg({
      nit: input.nit,
      legalName: input.legalName,
      address: input.address ?? null,
      phone: input.phone ?? null,
      logoUrl: input.logoUrl ?? null,
      branchName: input.branchName,
      posName: input.posName,
      posCode: input.posCode,
      products: input.products,
      customers: input.customers ?? [],
    }),
  );
  const db = getLocalDb(org);
  await runFullInitialSync(db, {
    organizationId: org,
    organizationName: input.legalName,
    userId: "user-cajero-1",
    userName: input.userName ?? "Ana Cajera",
    roleKey: "CASHIER",
  });
  const ctx = await db.orgContext.get(org);
  if (!ctx) throw new Error("orgContext no se escribió — setup de test inválido");
  return { db, ctx };
}

describe("Offline 4.5 — datos completos para el ticket offline (end-to-end)", () => {
  it("PRUEBA PRINCIPAL — org → producto → cliente → LocalSale offline → ticketFromLocalSale → EscPosEncoder: todo sin ninguna llamada de red en el momento de imprimir", async () => {
    resetLocalDbCache();
    resetAppMetaDbCache();
    const org = uniqueOrgId();

    const { db, ctx } = await bootstrapOrg(org, {
      nit: "1023456789",
      legalName: "Kiosco La Esquina SRL",
      address: "Av. Siempre Viva 742",
      phone: "77712345",
      logoUrl: "https://cdn.example.com/logo.png",
      branchName: "Sucursal Centro",
      posName: "Caja 1",
      posCode: "POS-01",
      products: [
        { id: "prod-coca", name: "Coca Cola 2L", sku: "COCA", price: "15.00" },
        { id: "prod-pan", name: "Pan integral", sku: "PAN", price: "8.50" },
      ],
      customers: [{ id: "cust-1", name: "Juan Pérez", documentType: "CI", documentNumber: "1234567" }],
    });

    // A partir de acá, CERO llamadas de red — todo lo que sigue es Dexie +
    // lógica pura, exactamente como ocurriría con el dispositivo sin señal.
    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValue(new Error("no debería llamarse a la red en este punto del test")),
    );

    const sale = await createSaleOffline(db, {
      organizationId: org,
      posTerminalId: ctx.posTerminalId,
      warehouseId: ctx.warehouseId,
      customerId: "cust-1",
      discount: "2.00",
      items: [
        { productId: "prod-coca", quantity: "2", unitPrice: "15.00", discount: "0" },
        { productId: "prod-pan", quantity: "1", unitPrice: "8.50", discount: "0" },
      ],
    });
    await confirmSaleOffline(db, {
      localSaleId: sale.id,
      payments: [{ method: "CASH", amount: "36.50", idempotencyKey: "idem-principal-1" }],
    });
    const freshSale = await db.sales.get(sale.id);
    if (!freshSale) throw new Error("venta no encontrada tras confirmar");
    expect(freshSale.status).toBe("DRAFT_LOCAL"); // confirmar solo ENCOLA — nunca sincronizó (sin red)
    expect(freshSale.serverSummary).toBeNull();

    const products = await db.products.toArray();
    const customer = await db.customers.get("cust-1");
    if (!customer) throw new Error("cliente no encontrado");

    const ticketCtx = contextFrom(ctx, {
      customer: { name: customer.name, documentType: customer.documentType ?? "", documentNumber: customer.documentNumber ?? "" },
      products: new Map(products.map((p) => [p.id, { name: p.name, sku: p.sku }])),
    });
    const ticket = ticketFromLocalSale(freshSale, ticketCtx, "pending-sync");

    // El total del ticket es EXACTAMENTE el mismo que ya vio el usuario en
    // pantalla del POS (misma fórmula, `pos-cart.ts#computeCartTotals`) —
    // nunca una segunda cuenta.
    const cartTotals = computeCartTotals(
      [
        { productId: "prod-coca", name: "Coca Cola 2L", quantity: 2, unitPrice: 15, discount: 0 },
        { productId: "prod-pan", name: "Pan integral", quantity: 1, unitPrice: 8.5, discount: 0 },
      ],
      2,
    );
    expect(ticket.totals.total).toBe(cartTotals.total.toFixed(2));
    expect(ticket.totals.subtotal).toBe(cartTotals.subtotal.toFixed(2));

    const transport = new FakePrinterTransport("bluetooth");
    const manager = new PrinterManager({ db, organizationId: org, transportFactories: { bluetooth: () => transport } });
    const printer = await manager.save({
      name: "Impresora Caja 1",
      transportKind: "bluetooth",
      transportConfig: {},
      capabilities: CAPABILITIES,
      isDefault: true,
    });
    await manager.connect(printer.id);
    await manager.printTicket(ticket);
    const text = toReadableText(transport.getLastReceivedBytes()!);

    // Negocio.
    expect(text).toContain("Kiosco La Esquina SRL"); // razón social real (nunca inventada)
    expect(text).toContain("1023456789"); // NIT real
    // Sucursal / POS.
    expect(text).toContain("Sucursal Centro");
    expect(text).toContain("Caja 1");
    // Cajero real (usuario autenticado, no inventado).
    expect(text).toContain("Ana Cajera");
    // Cliente (el encoder ASCII-fallback transliteran diacríticos — "Pérez" → "Perez", ver `text-encoding.ts`).
    expect(text).toContain("Juan Perez");
    // Productos, cantidades, precios.
    expect(text).toContain("Coca Cola 2L");
    expect(text).toContain("2 x 15.00 = 30.00");
    expect(text).toContain("Pan integral");
    expect(text).toContain("1 x 8.50 = 8.50");
    // Descuento y total.
    expect(text).toContain("36.50"); // total (38.50 - 2.00 descuento)
    // Pago.
    expect(text).toContain("CASH");
    // Fecha: viene de `sale.createdAt`, nunca de una consulta al servidor.
    expect(ticket.operation.issuedAt).toBe(freshSale.createdAt);
    // Identificador local + estado pendiente — NUNCA un folio inventado.
    expect(ticket.operation.fullNumber).toBeNull();
    expect(text).toContain(`Venta local: ${sale.id}`);
    expect(text).toContain("PENDIENTE DE SINCRONIZAR");
    expect(text).toContain("DOCUMENTO COMERCIAL NO FISCAL");
    expect(text).not.toContain("Recibo N.:");
  });

  it("venta sin cliente (cliente ocasional): el ticket nunca muestra 'undefined', 'null' ni campos vacíos superfluos", async () => {
    resetLocalDbCache();
    resetAppMetaDbCache();
    const org = uniqueOrgId();
    const { db, ctx } = await bootstrapOrg(org, {
      nit: "111",
      legalName: "Negocio Sin Cliente SRL",
      branchName: "Sucursal Única",
      posName: "Caja 1",
      posCode: "POS-01",
      products: [{ id: "prod-1", name: "Agua 600ml", sku: "AGUA", price: "5.00" }],
    });

    const sale = await createSaleOffline(db, {
      organizationId: org,
      posTerminalId: ctx.posTerminalId,
      warehouseId: ctx.warehouseId,
      customerId: null,
      items: [{ productId: "prod-1", quantity: "1", unitPrice: "5.00", discount: "0" }],
    });
    await confirmSaleOffline(db, {
      localSaleId: sale.id,
      payments: [{ method: "CASH", amount: "5.00", idempotencyKey: "idem-sin-cliente" }],
    });
    const freshSale = await db.sales.get(sale.id);
    if (!freshSale) throw new Error("venta no encontrada");

    const products = await db.products.toArray();
    const ticket = ticketFromLocalSale(
      freshSale,
      contextFrom(ctx, { customer: null, products: new Map(products.map((p) => [p.id, { name: p.name, sku: p.sku }])) }),
      "pending-sync",
    );
    expect(ticket.customer).toBeNull();

    const transport = new FakePrinterTransport("bluetooth");
    const manager = new PrinterManager({ db, organizationId: org, transportFactories: { bluetooth: () => transport } });
    const printer = await manager.save({ name: "P", transportKind: "bluetooth", transportConfig: {}, capabilities: CAPABILITIES, isDefault: true });
    await manager.connect(printer.id);
    await manager.printTicket(ticket);
    const text = toReadableText(transport.getLastReceivedBytes()!);

    expect(text).not.toContain("undefined");
    expect(text).not.toContain("null");
    expect(text).toContain("Agua 600ml");
  });

  it("negocio sin logo cacheado (`logoUrl: null` real, nunca inventado): el ticket sigue siendo válido y legible sin sistema de imágenes", async () => {
    resetLocalDbCache();
    resetAppMetaDbCache();
    const org = uniqueOrgId();
    const { db, ctx } = await bootstrapOrg(org, {
      nit: "222",
      legalName: "Negocio Sin Logo SRL",
      logoUrl: null,
      branchName: "Sucursal Única",
      posName: "Caja 1",
      posCode: "POS-01",
      products: [{ id: "prod-1", name: "Pan", sku: null, price: "2.00" }],
    });
    expect(ctx.businessLogoUrl).toBeNull(); // dato real: este negocio no tiene logo cargado

    const sale = await createSaleOffline(db, {
      organizationId: org,
      posTerminalId: ctx.posTerminalId,
      warehouseId: ctx.warehouseId,
      customerId: null,
      items: [{ productId: "prod-1", quantity: "3", unitPrice: "2.00", discount: "0" }],
    });
    await confirmSaleOffline(db, { localSaleId: sale.id, payments: [{ method: "CASH", amount: "6.00", idempotencyKey: "idem-sin-logo" }] });
    const freshSale = await db.sales.get(sale.id);
    if (!freshSale) throw new Error("venta no encontrada");

    const products = await db.products.toArray();
    const ticket = ticketFromLocalSale(
      freshSale,
      contextFrom(ctx, { customer: null, products: new Map(products.map((p) => [p.id, { name: p.name, sku: p.sku }])) }),
      "pending-sync",
    );

    const transport = new FakePrinterTransport("bluetooth");
    const manager = new PrinterManager({ db, organizationId: org, transportFactories: { bluetooth: () => transport } });
    const printer = await manager.save({ name: "P", transportKind: "bluetooth", transportConfig: {}, capabilities: CAPABILITIES, isDefault: true });
    await manager.connect(printer.id);
    await manager.printTicket(ticket); // no lanza — el ticket es válido sin logo
    const text = toReadableText(transport.getLastReceivedBytes()!);
    expect(text).toContain("Negocio Sin Logo SRL");
    expect(text).toContain("TOTAL: 6.00");
  });

  it("aislamiento A/B: tickets de dos organizaciones nunca mezclan identidad de negocio/sucursal ni catálogo, aunque compartan ids de producto", async () => {
    resetLocalDbCache();
    resetAppMetaDbCache();
    const orgA = uniqueOrgId("org-a");
    const orgB = uniqueOrgId("org-b");

    const { db: dbA, ctx: ctxA } = await bootstrapOrg(orgA, {
      nit: "NIT-A",
      legalName: "Negocio A SRL",
      branchName: "Sucursal A",
      posName: "Caja A",
      posCode: "POS-A",
      products: [{ id: "prod-compartido", name: "Producto de A", sku: null, price: "10.00" }],
      userName: "Cajera A",
    });
    const { db: dbB, ctx: ctxB } = await bootstrapOrg(orgB, {
      nit: "NIT-B",
      legalName: "Negocio B SRL",
      branchName: "Sucursal B",
      posName: "Caja B",
      posCode: "POS-B",
      products: [{ id: "prod-compartido", name: "Producto de B", sku: null, price: "99.00" }],
      userName: "Cajera B",
    });

    const saleA = await createSaleOffline(dbA, {
      organizationId: orgA,
      posTerminalId: ctxA.posTerminalId,
      warehouseId: ctxA.warehouseId,
      customerId: null,
      items: [{ productId: "prod-compartido", quantity: "1", unitPrice: "10.00", discount: "0" }],
    });
    await confirmSaleOffline(dbA, { localSaleId: saleA.id, payments: [{ method: "CASH", amount: "10.00", idempotencyKey: "idem-a" }] });
    const freshSaleA = await dbA.sales.get(saleA.id);
    if (!freshSaleA) throw new Error("venta A no encontrada");
    const productsA = await dbA.products.toArray();
    const ticketA = ticketFromLocalSale(
      freshSaleA,
      contextFrom(ctxA, { customer: null, products: new Map(productsA.map((p) => [p.id, { name: p.name, sku: p.sku }])) }),
      "pending-sync",
    );

    expect(ticketA.business.name).toBe("Negocio A SRL");
    expect(ticketA.business.nit).toBe("NIT-A");
    expect(ticketA.branch).toEqual({ name: "Sucursal A", address: null });
    expect(ticketA.items[0].productName).toBe("Producto de A");
    expect(ticketA.operation.cashierName).toBe("Cajera A");

    // La base de B ni siquiera tiene esta venta.
    expect(await dbB.sales.get(saleA.id)).toBeUndefined();
    // El "mismo" id de producto resuelve a datos completamente distintos en B.
    const productInB = await dbB.products.get("prod-compartido");
    expect(productInB?.name).toBe("Producto de B");
    expect(ctxB.businessNit).toBe("NIT-B");
  });

  it("transición pending-sync → synced: el ticket dinamiza los totales del servidor y quita 'PENDIENTE', pero el folio SIGUE null (una LocalSale nunca inventa un recibo emitido)", async () => {
    resetLocalDbCache();
    resetAppMetaDbCache();
    const org = uniqueOrgId();
    const { db, ctx } = await bootstrapOrg(org, {
      nit: "333",
      legalName: "Negocio Transición SRL",
      branchName: "Sucursal Única",
      posName: "Caja 1",
      posCode: "POS-01",
      products: [{ id: "prod-1", name: "Producto", sku: null, price: "20.00" }],
    });

    const sale = await createSaleOffline(db, {
      organizationId: org,
      posTerminalId: ctx.posTerminalId,
      warehouseId: ctx.warehouseId,
      customerId: null,
      items: [{ productId: "prod-1", quantity: "1", unitPrice: "20.00", discount: "0" }],
    });
    await confirmSaleOffline(db, { localSaleId: sale.id, payments: [{ method: "CASH", amount: "20.00", idempotencyKey: "idem-transicion" }] });
    const products = await db.products.toArray();
    const productsMap = new Map(products.map((p) => [p.id, { name: p.name, sku: p.sku }]));

    const pendingSale = await db.sales.get(sale.id);
    if (!pendingSale) throw new Error("venta no encontrada");
    const pendingTicket = ticketFromLocalSale(pendingSale, contextFrom(ctx, { customer: null, products: productsMap }), "pending-sync");
    expect(pendingTicket.syncStatus).toBe("pending-sync");
    expect(pendingTicket.operation.fullNumber).toBeNull();

    // Simula lo que `sync-engine.ts#reconcileEntity` escribe al confirmar
    // realmente con el servidor (Offline 1/3) — nunca se llama a la red acá,
    // solo se reproduce el resultado ya cubierto por esos tests.
    await db.sales.update(sale.id, {
      status: "CONFIRM_SYNCED",
      serverId: "server-sale-real-1",
      serverSummary: { status: "PAID", total: "20.00", paidTotal: "20.00", balance: "0.00" },
    });
    const syncedSale = await db.sales.get(sale.id);
    if (!syncedSale) throw new Error("venta no encontrada");
    const syncedTicket = ticketFromLocalSale(syncedSale, contextFrom(ctx, { customer: null, products: productsMap }), "synced");

    expect(syncedTicket.syncStatus).toBe("synced");
    expect(syncedTicket.totals.total).toBe("20.00"); // del servidor, no recalculado
    // Sigue sin folio: eso solo existe vía `ticketFromReceiptSnapshot`, un
    // flujo completamente distinto (recibo YA emitido, `POST /receipts`).
    expect(syncedTicket.operation.fullNumber).toBeNull();
    expect(syncedTicket.operation.localId).toBe(sale.id);
  });
});
