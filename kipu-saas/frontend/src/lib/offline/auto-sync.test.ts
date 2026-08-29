import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getLocalDb, resetLocalDbCache } from "./db";
import { createSaleOffline } from "./sales-repo";
import {
  triggerSync,
  resetAutoSyncGuard,
  isSessionRevoked,
  clearSessionRevoked,
} from "./auto-sync";
import { uniqueOrgId } from "./test-support/unique";

function jsonResponse(status: number, body: unknown) {
  return new Response(JSON.stringify(body), { status });
}

describe("auto-sync — no dispara dos Sync Engine a la vez en la misma pestaña", () => {
  beforeEach(() => {
    resetLocalDbCache();
    resetAutoSyncGuard();
    localStorage.clear();
    localStorage.setItem("kipu_token", "access-vigente");
    localStorage.setItem("kipu_refresh_token", "refresh-vigente");
    vi.restoreAllMocks();
  });
  afterEach(() => vi.unstubAllGlobals());

  it("dos triggerSync superpuestos para la MISMA organización: el segundo no hace nada (null)", async () => {
    const org = uniqueOrgId();
    const db = getLocalDb(org);
    await createSaleOffline(db, {
      organizationId: org,
      posTerminalId: "pos-1",
      warehouseId: "wh-1",
      items: [{ productId: "prod-1", quantity: "1", unitPrice: "10.00", discount: "0" }],
    });

    let resolveFetch!: (v: Response) => void;
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation(() => new Promise<Response>((r) => (resolveFetch = r))),
    );

    const first = triggerSync(db, org); // arranca y se queda "colgado" (fetch no resuelve todavía)
    await new Promise((r) => setTimeout(r, 10));
    const second = await triggerSync(db, org); // dispara mientras el primero sigue corriendo

    expect(second).toBeNull();

    resolveFetch(jsonResponse(201, { id: "server-1" }));
    const firstResult = await first;
    expect(firstResult).not.toBeNull();
  });

  it("dos organizaciones distintas SÍ pueden sincronizar en paralelo (no es un lock global)", async () => {
    const orgA = uniqueOrgId("org-a");
    const orgB = uniqueOrgId("org-b");
    const dbA = getLocalDb(orgA);
    const dbB = getLocalDb(orgB);
    await createSaleOffline(dbA, {
      organizationId: orgA,
      posTerminalId: "pos-1",
      warehouseId: "wh-1",
      items: [{ productId: "prod-1", quantity: "1", unitPrice: "10.00", discount: "0" }],
    });
    await createSaleOffline(dbB, {
      organizationId: orgB,
      posTerminalId: "pos-2",
      warehouseId: "wh-2",
      items: [{ productId: "prod-2", quantity: "1", unitPrice: "5.00", discount: "0" }],
    });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(201, { id: "server-x" })));

    const [resultA, resultB] = await Promise.all([triggerSync(dbA, orgA), triggerSync(dbB, orgB)]);
    expect(resultA).not.toBeNull();
    expect(resultB).not.toBeNull();
  });
});

describe("auto-sync — reconexión real (force) ignora el backoff pendiente", () => {
  beforeEach(() => {
    resetLocalDbCache();
    resetAutoSyncGuard();
    localStorage.clear();
    localStorage.setItem("kipu_token", "access-vigente");
    localStorage.setItem("kipu_refresh_token", "refresh-vigente");
    vi.restoreAllMocks();
  });
  afterEach(() => vi.unstubAllGlobals());

  it("sin force, una operación con backoff vigente no se reintenta todavía", async () => {
    const org = uniqueOrgId();
    const db = getLocalDb(org);
    await createSaleOffline(db, {
      organizationId: org,
      posTerminalId: "pos-1",
      warehouseId: "wh-1",
      items: [{ productId: "prod-1", quantity: "1", unitPrice: "10.00", discount: "0" }],
    });
    // Primer intento: falla, queda con backoff.
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("sin red")));
    const first = await triggerSync(db, org);
    expect(first?.failedTransient).toBe(1);

    // Segundo intento inmediato SIN force: el backoff todavía no venció.
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(201, { id: "server-1" })));
    const second = await triggerSync(db, org);
    expect(second?.processed).toBe(0);
  });

  it("con force: true (evento online real), reintenta de inmediato aunque el backoff siga vigente", async () => {
    const org = uniqueOrgId();
    const db = getLocalDb(org);
    await createSaleOffline(db, {
      organizationId: org,
      posTerminalId: "pos-1",
      warehouseId: "wh-1",
      items: [{ productId: "prod-1", quantity: "1", unitPrice: "10.00", discount: "0" }],
    });
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("sin red")));
    await triggerSync(db, org);

    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(201, { id: "server-1" })));
    const reconnected = await triggerSync(db, org, { force: true });
    expect(reconnected?.synced).toBe(1);
  });
});

describe("auto-sync — sesión revocada: deja de intentar autenticarse solo hasta un nuevo login", () => {
  beforeEach(() => {
    resetLocalDbCache();
    resetAutoSyncGuard();
    localStorage.clear();
    localStorage.setItem("kipu_token", "access-viejo");
    localStorage.setItem("kipu_refresh_token", "refresh-revocado");
    vi.restoreAllMocks();
  });
  afterEach(() => vi.unstubAllGlobals());

  it("tras descubrir la sesión revocada, los triggerSync siguientes no vuelven a golpear la API", async () => {
    const org = uniqueOrgId();
    const db = getLocalDb(org);
    await createSaleOffline(db, {
      organizationId: org,
      posTerminalId: "pos-1",
      warehouseId: "wh-1",
      items: [{ productId: "prod-1", quantity: "1", unitPrice: "10.00", discount: "0" }],
    });

    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(401, {}));
    vi.stubGlobal("fetch", fetchMock);

    const first = await triggerSync(db, org, { force: true });
    expect(first?.sessionRevoked).toBe(true);
    expect(isSessionRevoked(org)).toBe(true);
    const callsAfterFirst = fetchMock.mock.calls.length;
    expect(callsAfterFirst).toBeGreaterThan(0);

    // Un evento `online`, el respaldo periódico, o un nuevo montaje de
    // `useAutoSync` pueden disparar `triggerSync` de nuevo — mientras la
    // sesión siga marcada como revocada, no debe volver a llamar a la API
    // (pedido explícito: "no continuar intentando autenticarse indefinidamente").
    const second = await triggerSync(db, org, { force: true });
    expect(second).toBeNull();
    expect(fetchMock.mock.calls.length).toBe(callsAfterFirst);

    // El usuario vuelve a loguearse (nuevo token): `useAutoSync` llama
    // `clearSessionRevoked` al detectarlo, dándole al engine otra oportunidad.
    clearSessionRevoked(org);
    expect(isSessionRevoked(org)).toBe(false);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(201, { id: "server-1" })));
    const afterRelogin = await triggerSync(db, org, { force: true });
    expect(afterRelogin).not.toBeNull();
    expect(afterRelogin?.sessionRevoked).toBe(false);
  });
});
