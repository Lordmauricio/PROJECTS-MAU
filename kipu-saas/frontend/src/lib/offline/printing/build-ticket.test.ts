import { describe, expect, it } from "vitest";
import { getLocalDb, resetLocalDbCache } from "../db";
import { resetAppMetaDbCache } from "../app-meta-db";
import { createSaleOffline, confirmSaleOffline } from "../sales-repo";
import { uniqueOrgId } from "../test-support/unique";
import { extractPdfText } from "../test-support/pdf-text";
import type { LocalOrgContext } from "../types";
import { buildTicketFromLocalSale } from "./build-ticket";
import { renderThermalPdf } from "./thermal-pdf-renderer";

function orgContext(org: string, overrides: Partial<LocalOrgContext> = {}): LocalOrgContext {
  return {
    organizationId: org,
    organizationName: "Negocio",
    businessLegalName: "Negocio SRL",
    businessNit: "111",
    businessAddress: null,
    businessPhone: null,
    businessLogoUrl: null,
    branchId: "branch-1",
    branchName: "Sucursal",
    branchAddress: null,
    warehouseId: "wh-1",
    posTerminalId: "pos-1",
    posTerminalName: "Caja 1",
    posTerminalCode: "POS-01",
    userId: "user-1",
    userName: "Cajera",
    roleKey: "CASHIER",
    fetchedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("buildTicketFromLocalSale — arma TicketData desde IndexedDB, sin red", () => {
  it("resuelve producto/cliente reales de Dexie y refleja pending-sync para una venta recién creada", async () => {
    resetLocalDbCache();
    resetAppMetaDbCache();
    const org = uniqueOrgId();
    const db = getLocalDb(org);
    await db.products.add({
      id: "prod-1",
      organizationId: org,
      name: "Coca Cola 2L",
      sku: "COCA",
      barcode: null,
      price: "15.00",
      active: true,
      updatedAt: "2026-01-01T00:00:00.000Z",
      cachedAt: "2026-01-01T00:00:00.000Z",
    });
    await db.customers.add({
      id: "cust-1",
      organizationId: org,
      name: "Juan Pérez",
      documentType: "CI",
      documentNumber: "12345",
      phone: null,
      email: null,
      active: true,
      updatedAt: "2026-01-01T00:00:00.000Z",
      cachedAt: "2026-01-01T00:00:00.000Z",
    });
    const ctx = orgContext(org);
    await db.orgContext.put(ctx);

    const sale = await createSaleOffline(db, {
      organizationId: org,
      posTerminalId: ctx.posTerminalId,
      warehouseId: ctx.warehouseId,
      customerId: "cust-1",
      items: [{ productId: "prod-1", quantity: "2", unitPrice: "15.00", discount: "0" }],
    });
    await confirmSaleOffline(db, { localSaleId: sale.id, payments: [{ method: "CASH", amount: "30.00", idempotencyKey: "idem-1" }] });

    const ticket = await buildTicketFromLocalSale(db, ctx, sale.id);
    expect(ticket.syncStatus).toBe("pending-sync");
    expect(ticket.operation.fullNumber).toBeNull();
    expect(ticket.items[0].productName).toBe("Coca Cola 2L");
    expect(ticket.customer).toEqual({ name: "Juan Pérez", documentType: "CI", documentNumber: "12345" });
    expect(ticket.operation.cashierName).toBe("Cajera");
  });

  it("venta CONFIRM_SYNCED con serverSummary real: el ticket refleja synced", async () => {
    resetLocalDbCache();
    resetAppMetaDbCache();
    const org = uniqueOrgId();
    const db = getLocalDb(org);
    await db.products.add({
      id: "prod-1",
      organizationId: org,
      name: "Producto",
      sku: null,
      barcode: null,
      price: "10.00",
      active: true,
      updatedAt: "2026-01-01T00:00:00.000Z",
      cachedAt: "2026-01-01T00:00:00.000Z",
    });
    const ctx = orgContext(org);
    await db.orgContext.put(ctx);

    const sale = await createSaleOffline(db, {
      organizationId: org,
      posTerminalId: ctx.posTerminalId,
      warehouseId: ctx.warehouseId,
      customerId: null,
      items: [{ productId: "prod-1", quantity: "1", unitPrice: "10.00", discount: "0" }],
    });
    await confirmSaleOffline(db, { localSaleId: sale.id, payments: [{ method: "CASH", amount: "10.00", idempotencyKey: "idem-2" }] });

    // Simula lo que el Sync Engine real escribe al reconciliar
    // `sales.confirm` con el servidor (Offline 1/3) — sin llamar a la red.
    await db.sales.update(sale.id, {
      status: "CONFIRM_SYNCED",
      serverId: "server-sale-1",
      serverSummary: { status: "PAID", total: "10.00", paidTotal: "10.00", balance: "0.00" },
    });
    const opCreate = await db.syncQueue.get(sale.createSyncOperationId);
    if (opCreate) await db.syncQueue.update(opCreate.id, { status: "SYNCED" });
    const freshSale = await db.sales.get(sale.id);
    if (freshSale?.confirmSyncOperationId) {
      await db.syncQueue.update(freshSale.confirmSyncOperationId, { status: "SYNCED" });
    }

    const ticket = await buildTicketFromLocalSale(db, ctx, sale.id);
    expect(ticket.syncStatus).toBe("synced");
    expect(ticket.operation.fullNumber).toBeNull(); // LocalSale nunca emite folio, sincronizada o no
    expect(ticket.totals.total).toBe("10.00");
  });

  it("venta sin cliente: el ticket refleja customer null, nunca inventa uno", async () => {
    resetLocalDbCache();
    resetAppMetaDbCache();
    const org = uniqueOrgId();
    const db = getLocalDb(org);
    await db.products.add({
      id: "prod-1",
      organizationId: org,
      name: "Producto",
      sku: null,
      barcode: null,
      price: "5.00",
      active: true,
      updatedAt: "2026-01-01T00:00:00.000Z",
      cachedAt: "2026-01-01T00:00:00.000Z",
    });
    const ctx = orgContext(org);
    await db.orgContext.put(ctx);
    const sale = await createSaleOffline(db, {
      organizationId: org,
      posTerminalId: ctx.posTerminalId,
      warehouseId: ctx.warehouseId,
      customerId: null,
      items: [{ productId: "prod-1", quantity: "1", unitPrice: "5.00", discount: "0" }],
    });

    const ticket = await buildTicketFromLocalSale(db, ctx, sale.id);
    expect(ticket.customer).toBeNull();
  });

  it("venta local inexistente: lanza un error claro en vez de devolver un ticket incompleto", async () => {
    resetLocalDbCache();
    resetAppMetaDbCache();
    const org = uniqueOrgId();
    const db = getLocalDb(org);
    const ctx = orgContext(org);
    await expect(buildTicketFromLocalSale(db, ctx, "no-existe")).rejects.toThrow();
  });
});

describe("buildTicketFromLocalSale — aislamiento multi-tenant (Offline 4.6B)", () => {
  it("dos organizaciones con el mismo id de producto/sucursal nunca mezclan su ticket final, ni siquiera vía el PDF generado", async () => {
    resetLocalDbCache();
    resetAppMetaDbCache();
    const orgA = uniqueOrgId("org-a");
    const orgB = uniqueOrgId("org-b");
    const dbA = getLocalDb(orgA);
    const dbB = getLocalDb(orgB);

    await dbA.products.add({
      id: "prod-compartido",
      organizationId: orgA,
      name: "Producto de A",
      sku: null,
      barcode: null,
      price: "10.00",
      active: true,
      updatedAt: "2026-01-01T00:00:00.000Z",
      cachedAt: "2026-01-01T00:00:00.000Z",
    });
    await dbB.products.add({
      id: "prod-compartido",
      organizationId: orgB,
      name: "Producto de B",
      sku: null,
      barcode: null,
      price: "999.00",
      active: true,
      updatedAt: "2026-01-01T00:00:00.000Z",
      cachedAt: "2026-01-01T00:00:00.000Z",
    });

    const ctxA = orgContext(orgA, { organizationName: "Negocio A", businessNit: "NIT-A", branchName: "Sucursal A" });
    const ctxB = orgContext(orgB, { organizationName: "Negocio B", businessNit: "NIT-B", branchName: "Sucursal B" });
    await dbA.orgContext.put(ctxA);
    await dbB.orgContext.put(ctxB);

    const saleA = await createSaleOffline(dbA, {
      organizationId: orgA,
      posTerminalId: ctxA.posTerminalId,
      warehouseId: ctxA.warehouseId,
      customerId: null,
      items: [{ productId: "prod-compartido", quantity: "1", unitPrice: "10.00", discount: "0" }],
    });
    const saleB = await createSaleOffline(dbB, {
      organizationId: orgB,
      posTerminalId: ctxB.posTerminalId,
      warehouseId: ctxB.warehouseId,
      customerId: null,
      items: [{ productId: "prod-compartido", quantity: "1", unitPrice: "999.00", discount: "0" }],
    });

    const ticketA = await buildTicketFromLocalSale(dbA, ctxA, saleA.id);
    const ticketB = await buildTicketFromLocalSale(dbB, ctxB, saleB.id);

    expect(ticketA.business.nit).toBe("NIT-A");
    expect(ticketA.branch?.name).toBe("Sucursal A");
    expect(ticketA.items[0].productName).toBe("Producto de A");
    expect(ticketB.business.nit).toBe("NIT-B");
    expect(ticketB.branch?.name).toBe("Sucursal B");
    expect(ticketB.items[0].productName).toBe("Producto de B");

    // La base de A ni siquiera contiene la venta de B, y viceversa.
    expect(await dbA.sales.get(saleB.id)).toBeUndefined();
    expect(await dbB.sales.get(saleA.id)).toBeUndefined();

    // Y el PDF final (lo que realmente ve el usuario) tampoco mezcla nada.
    const pdfA = await extractPdfText(await renderThermalPdf(ticketA));
    const pdfB = await extractPdfText(await renderThermalPdf(ticketB));
    expect(pdfA.text).toContain("Producto de A");
    expect(pdfA.text).not.toContain("Producto de B");
    expect(pdfA.text).not.toContain("NIT-B");
    expect(pdfB.text).toContain("Producto de B");
    expect(pdfB.text).not.toContain("Producto de A");
    expect(pdfB.text).not.toContain("NIT-A");
  });
});
