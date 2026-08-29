import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getLocalDb, resetLocalDbCache } from "./db";
import { connectionStatus } from "./connection-status";
import { confirmSaleOffline, createSaleOffline } from "./sales-repo";
import { runSyncOnce } from "./sync-engine";
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
    items: [{ productId: "prod-1", quantity: "2", unitPrice: "10.00", discount: "0" }],
  });
  return { db, sale };
}

describe("Sync Engine — flujo completo de una venta offline (crear → confirmar)", () => {
  beforeEach(() => {
    resetLocalDbCache();
    localStorage.clear();
    localStorage.setItem("kipu_token", "access-vigente");
    localStorage.setItem("kipu_refresh_token", "refresh-vigente");
    vi.restoreAllMocks();
  });
  afterEach(() => vi.unstubAllGlobals());

  it("crea la venta local, sincroniza sales.create, y sales.confirm usa el serverId real (nunca el localId)", async () => {
    const org = uniqueOrgId();
    const { db, sale } = await makeLocalSale(org);

    await confirmSaleOffline(db, {
      localSaleId: sale.id,
      payments: [{ method: "CASH", amount: "20.00", idempotencyKey: "pay-1" }],
    });

    const fetchMock = vi.fn().mockImplementation((url: string) => {
      if (url.endsWith("/sales")) {
        return Promise.resolve(jsonResponse(201, { id: "server-sale-real-id" }));
      }
      if (url.includes("/sales/server-sale-real-id/confirm")) {
        return Promise.resolve(jsonResponse(201, { id: "server-sale-real-id", status: "PAID" }));
      }
      throw new Error(`URL inesperada en el test: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const summary = await runSyncOnce(db);
    expect(summary.synced).toBe(2);
    expect(summary.conflicts).toBe(0);
    expect(summary.failedTransient).toBe(0);

    const finalSale = await db.sales.get(sale.id);
    expect(finalSale?.serverId).toBe("server-sale-real-id");
    expect(finalSale?.status).toBe("CONFIRM_SYNCED");

    // La confirmación se mandó contra el id REAL del servidor, nunca contra
    // el localId (que el backend jamás podría reconocer).
    const confirmCall = fetchMock.mock.calls.find((c) => String(c[0]).includes("/confirm"));
    expect(confirmCall?.[0]).toBe("http://localhost:4200/sales/server-sale-real-id/confirm");
  });

  it("no confirma antes de crear: si create todavía no sincronizó, confirm queda PENDING sin enviarse", async () => {
    const org = uniqueOrgId();
    const { db, sale } = await makeLocalSale(org);
    await confirmSaleOffline(db, {
      localSaleId: sale.id,
      payments: [{ method: "CASH", amount: "20.00", idempotencyKey: "pay-2" }],
    });

    // El request de creación nunca resuelve dentro de este pase (simula
    // que sigue en vuelo) — no debería ni intentarse pedir /confirm.
    const fetchMock = vi.fn().mockImplementation((url: string) => {
      if (url.endsWith("/sales")) {
        return new Promise(() => {}); // nunca resuelve en este test
      }
      throw new Error(`No debería llamarse todavía: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    // No esperamos el resultado completo (create queda colgado a propósito);
    // solo confirmamos que jamás se intentó /confirm.
    void runSyncOnce(db);
    await new Promise((r) => setTimeout(r, 20));
    const confirmAttempted = fetchMock.mock.calls.some((c) => String(c[0]).includes("/confirm"));
    expect(confirmAttempted).toBe(false);
  });
});

describe("Sync Engine — idempotencia ante reintentos/timeout", () => {
  beforeEach(() => {
    resetLocalDbCache();
    localStorage.clear();
    localStorage.setItem("kipu_token", "access-vigente");
    localStorage.setItem("kipu_refresh_token", "refresh-vigente");
    vi.restoreAllMocks();
  });
  afterEach(() => vi.unstubAllGlobals());

  it("timeout en el primer intento → el reintento usa EXACTAMENTE la misma idempotencyKey", async () => {
    const org = uniqueOrgId();
    const { db } = await makeLocalSale(org);

    const bodies: string[] = [];
    const fetchMock = vi
      .fn()
      .mockImplementationOnce((_url: string, opts: RequestInit) => {
        bodies.push(opts.body as string);
        return Promise.reject(new Error("timeout"));
      })
      .mockImplementationOnce((_url: string, opts: RequestInit) => {
        bodies.push(opts.body as string);
        return Promise.resolve(jsonResponse(201, { id: "server-1" }));
      });
    vi.stubGlobal("fetch", fetchMock);

    const first = await runSyncOnce(db);
    expect(first.failedTransient).toBe(1);

    // Fuerza que la operación vuelva a ser candidata sin esperar el backoff real.
    await db.syncQueue.toCollection().modify({ nextRetryAt: new Date(0).toISOString() });

    const second = await runSyncOnce(db);
    expect(second.synced).toBe(1);

    const keyFromFirst = JSON.parse(bodies[0]).idempotencyKey;
    const keyFromRetry = JSON.parse(bodies[1]).idempotencyKey;
    expect(keyFromRetry).toBe(keyFromFirst); // NUNCA una key nueva para el mismo intento
  });

  it("respuesta duplicada del servidor (el reintento SÍ llega a procesarse dos veces del lado del servidor) no rompe el cliente: igual queda una sola venta SYNCED", async () => {
    const org = uniqueOrgId();
    const { db, sale } = await makeLocalSale(org);

    // Simula que el servidor, al reusar la idempotencyKey, devuelve el
    // MISMO resultado en ambos intentos (comportamiento real ya verificado
    // en Fase Offline 1: `assertMatches` + replay idempotente) — desde la
    // perspectiva del cliente esto se ve simplemente como "success" dos
    // veces si el pase de sync se corriera dos veces.
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(201, { id: "server-mismo-id" }));
    vi.stubGlobal("fetch", fetchMock);

    await runSyncOnce(db);
    const afterFirst = await db.sales.get(sale.id);
    expect(afterFirst?.serverId).toBe("server-mismo-id");

    // Nada queda PENDING para un segundo pase — la operación ya está SYNCED,
    // así que no se reenvía ni una tercera vez.
    const second = await runSyncOnce(db);
    expect(second.processed).toBe(0);
  });

  it("requests concurrentes (dos pases de sync superpuestos) sobre la misma cola: la venta se sincroniza UNA sola vez", async () => {
    const org = uniqueOrgId();
    const { db } = await makeLocalSale(org);

    let callCount = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation(() => {
        callCount += 1;
        return Promise.resolve(jsonResponse(201, { id: "server-concurrente" }));
      }),
    );

    // Dos "engines" corriendo sobre la MISMA base al mismo tiempo.
    await Promise.all([runSyncOnce(db, "engine-1"), runSyncOnce(db, "engine-2")]);

    expect(callCount).toBe(1); // el lock de claimNext impide el doble envío
  });
});

describe("Sync Engine — conflictos y errores permanentes (nunca resolución automática)", () => {
  beforeEach(() => {
    resetLocalDbCache();
    localStorage.clear();
    localStorage.setItem("kipu_token", "access-vigente");
    localStorage.setItem("kipu_refresh_token", "refresh-vigente");
    vi.restoreAllMocks();
  });
  afterEach(() => vi.unstubAllGlobals());

  it("409 (ej. stock insuficiente al confirmar) queda CONFLICT, nunca se reintenta solo", async () => {
    const org = uniqueOrgId();
    const { db, sale } = await makeLocalSale(org);

    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(jsonResponse(409, { message: "Stock insuficiente" })),
    );

    const summary = await runSyncOnce(db);
    expect(summary.conflicts).toBe(1);
    expect(summary.synced).toBe(0);

    const item = (await db.syncQueue.toArray())[0];
    expect(item.status).toBe("CONFLICT");
    expect(item.error).toContain("Stock insuficiente");

    // Un segundo pase no vuelve a intentarlo por su cuenta.
    const second = await runSyncOnce(db);
    expect(second.processed).toBe(0);

    // La venta local NUNCA se marca como sincronizada con datos que no se confirmaron.
    const localSale = await db.sales.get(sale.id);
    expect(localSale?.status).toBe("DRAFT_LOCAL");
  });

  it("400 (error de validación permanente) tampoco se reintenta automáticamente", async () => {
    const org = uniqueOrgId();
    const { db } = await makeLocalSale(org);
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(jsonResponse(400, { message: "Producto no encontrado" })),
    );

    const summary = await runSyncOnce(db);
    expect(summary.conflicts).toBe(1);

    const second = await runSyncOnce(db);
    expect(second.processed).toBe(0);
  });
});

describe("Sync Engine — sesión revocada mientras el dispositivo estaba offline", () => {
  beforeEach(() => {
    resetLocalDbCache();
    localStorage.clear();
    localStorage.setItem("kipu_token", "access-viejo");
    localStorage.setItem("kipu_refresh_token", "refresh-revocado");
    vi.restoreAllMocks();
    connectionStatus.setBlockingError(false);
  });
  afterEach(() => vi.unstubAllGlobals());

  it("al reconectar, si el refresh token fue revocado remotamente, el engine lo descubre y deja de procesar", async () => {
    const org = uniqueOrgId();
    const { db } = await makeLocalSale(org);

    const fetchMock = vi.fn().mockImplementation((url: string) => {
      if (url.endsWith("/auth/refresh")) {
        return Promise.resolve(
          jsonResponse(401, { message: "Refresh token inválido o expirado" }),
        );
      }
      // El request original de /sales también da 401 (token vencido).
      return Promise.resolve(jsonResponse(401, {}));
    });
    vi.stubGlobal("fetch", fetchMock);

    const summary = await runSyncOnce(db);
    expect(summary.sessionRevoked).toBe(true);
    expect(connectionStatus.getState()).toBe("ERROR");

    // La operación sigue en la cola (no se pierde) para cuando el usuario
    // vuelva a loguearse.
    const pending = await db.syncQueue.toArray();
    expect(pending).toHaveLength(1);
    expect(pending[0].status).not.toBe("SYNCED");
  });
});
