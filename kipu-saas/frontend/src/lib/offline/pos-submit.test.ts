import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getLocalDb, resetLocalDbCache } from "./db";
import { resetAutoSyncGuard } from "./auto-sync";
import { retrySale, submitSaleOffline } from "./pos-submit";
import { uniqueOrgId } from "./test-support/unique";

function jsonResponse(status: number, body: unknown) {
  return new Response(JSON.stringify(body), { status });
}

function baseInput(orgId: string) {
  return {
    organizationId: orgId,
    posTerminalId: "pos-1",
    warehouseId: "wh-1",
    discount: 0,
    items: [{ productId: "prod-1", quantity: 2, unitPrice: 10, discount: 0 }],
    payments: [{ method: "CASH" as const, amount: 20, idempotencyKey: "pay-1" }],
  };
}

describe("pos-submit — el único camino para registrar una venta desde el POS", () => {
  beforeEach(() => {
    resetLocalDbCache();
    resetAutoSyncGuard();
    localStorage.clear();
    localStorage.setItem("kipu_token", "access-vigente");
    localStorage.setItem("kipu_refresh_token", "refresh-vigente");
    vi.restoreAllMocks();
  });
  afterEach(() => vi.unstubAllGlobals());

  it("con conexión: sincroniza al instante y devuelve el resumen real del servidor", async () => {
    const org = uniqueOrgId();
    const db = getLocalDb(org);
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation((url: string) => {
        if (url.endsWith("/sales")) return Promise.resolve(jsonResponse(201, { id: "server-1" }));
        return Promise.resolve(
          jsonResponse(201, { id: "server-1", status: "PAID", total: "20.00", paidTotal: "20.00", balance: "0.00" }),
        );
      }),
    );

    const result = await submitSaleOffline(db, baseInput(org));
    expect(result.outcome).toBe("synced");
    expect(result.summary?.status).toBe("PAID");
  });

  it("sin conexión: queda guardada localmente y encolada, nunca se muestra como error", async () => {
    const org = uniqueOrgId();
    const db = getLocalDb(org);
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("sin red")));

    const result = await submitSaleOffline(db, baseInput(org));
    expect(result.outcome).toBe("offline-pending");

    const sale = await db.sales.get(result.localSaleId);
    expect(sale).toBeDefined(); // la venta existe localmente, no se perdió
  });

  it("conflicto real (stock insuficiente): outcome conflict con el mensaje del servidor", async () => {
    const org = uniqueOrgId();
    const db = getLocalDb(org);
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(jsonResponse(409, { message: "Stock insuficiente" })),
    );

    const result = await submitSaleOffline(db, baseInput(org));
    expect(result.outcome).toBe("conflict");
    expect(result.message).toContain("Stock insuficiente");
  });

  it("retrySale reintenta manualmente una venta en conflicto y refleja el nuevo resultado", async () => {
    const org = uniqueOrgId();
    const db = getLocalDb(org);
    // La creación (POST /sales) siempre tiene éxito; el CONFLICTO real
    // ocurre al confirmar (ahí es donde el backend descuenta stock) — el
    // primer intento de confirmar da 409, el reintento manual da éxito.
    let confirmAttempts = 0;
    const fetchMock = vi.fn().mockImplementation((url: string) => {
      if (url.endsWith("/sales")) {
        return Promise.resolve(jsonResponse(201, { id: "server-2" }));
      }
      confirmAttempts += 1;
      if (confirmAttempts === 1) {
        return Promise.resolve(jsonResponse(409, { message: "Stock insuficiente" }));
      }
      return Promise.resolve(
        jsonResponse(201, { id: "server-2", status: "PAID", total: "20.00", paidTotal: "20.00", balance: "0.00" }),
      );
    });
    vi.stubGlobal("fetch", fetchMock);

    const first = await submitSaleOffline(db, baseInput(org));
    expect(first.outcome).toBe("conflict");

    const retried = await retrySale(db, org, first.localSaleId);
    expect(retried.outcome).toBe("synced");
    expect(confirmAttempts).toBe(2);
  });
});
