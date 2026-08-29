import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getLocalDb, resetLocalDbCache } from "./db";
import { confirmSaleOffline, createSaleOffline } from "./sales-repo";
import { runSyncOnce } from "./sync-engine";
import { getSaleSyncState, listLocalSalesWithState } from "./sale-sync-state";
import { uniqueOrgId } from "./test-support/unique";

function jsonResponse(status: number, body: unknown) {
  return new Response(JSON.stringify(body), { status });
}

async function makeLocalSale(orgId: string) {
  const db = getLocalDb(orgId);
  const sale = await createSaleOffline(db, {
    organizationId: orgId,
    posTerminalId: "pos-1",
    warehouseId: "wh-1",
    items: [{ productId: "prod-1", quantity: "1", unitPrice: "10.00", discount: "0" }],
  });
  return { db, sale };
}

describe("sale-sync-state — traduce la cola a un estado que la UI puede mostrar", () => {
  beforeEach(() => {
    resetLocalDbCache();
    localStorage.clear();
    localStorage.setItem("kipu_token", "access-vigente");
    localStorage.setItem("kipu_refresh_token", "refresh-vigente");
    vi.restoreAllMocks();
  });
  afterEach(() => vi.unstubAllGlobals());

  it("recién creada (todavía no se intentó sincronizar): offline-pending", async () => {
    const org = uniqueOrgId();
    const { db, sale } = await makeLocalSale(org);
    const state = await getSaleSyncState(db, sale.id);
    expect(state.kind).toBe("offline-pending");
  });

  it("tras sincronizar create+confirm con éxito: synced, con el resumen REAL del servidor", async () => {
    const org = uniqueOrgId();
    const { db, sale } = await makeLocalSale(org);
    await confirmSaleOffline(db, {
      localSaleId: sale.id,
      payments: [{ method: "CASH", amount: "10.00", idempotencyKey: "pay-1" }],
    });
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation((url: string) => {
        if (url.endsWith("/sales")) return Promise.resolve(jsonResponse(201, { id: "server-1" }));
        return Promise.resolve(
          jsonResponse(201, { id: "server-1", status: "PAID", total: "10.00", paidTotal: "10.00", balance: "0.00" }),
        );
      }),
    );
    await runSyncOnce(db);

    const state = await getSaleSyncState(db, sale.id);
    expect(state).toEqual({
      kind: "synced",
      summary: { status: "PAID", total: "10.00", paidTotal: "10.00", balance: "0.00" },
    });
  });

  it("conflicto de negocio (409): conflict, con el mensaje real del servidor", async () => {
    const org = uniqueOrgId();
    const { db, sale } = await makeLocalSale(org);
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(jsonResponse(409, { message: "Stock insuficiente" })),
    );
    await runSyncOnce(db);

    const state = await getSaleSyncState(db, sale.id);
    expect(state).toEqual({ kind: "conflict", message: "Stock insuficiente" });
  });

  it("listLocalSalesWithState devuelve las ventas más recientes primero, cada una con su estado", async () => {
    const org = uniqueOrgId();
    const db = getLocalDb(org);
    const { sale: first } = await makeLocalSale(org);
    await new Promise((r) => setTimeout(r, 5));
    const second = await createSaleOffline(db, {
      organizationId: org,
      posTerminalId: "pos-1",
      warehouseId: "wh-1",
      items: [{ productId: "prod-2", quantity: "1", unitPrice: "5.00", discount: "0" }],
    });

    const list = await listLocalSalesWithState(db);
    expect(list[0].sale.id).toBe(second.id);
    expect(list[1].sale.id).toBe(first.id);
    expect(list.every((x) => x.state.kind === "offline-pending")).toBe(true);
  });
});
