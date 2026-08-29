import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getLocalDb, resetLocalDbCache } from "./db";
import { listKnownOrganizations, resetAppMetaDbCache } from "./app-meta-db";
import { runFullInitialSync, runIncrementalSync } from "./catalog-sync";
import { uniqueOrgId } from "./test-support/unique";

function jsonResponse(body: unknown) {
  return new Response(JSON.stringify(body), { status: 200 });
}

/** Primer URL de la primera llamada al mock de `fetch` que matchea `predicate` — evita repetir el casteo de `mock.calls` (tipado `any[][]` por vitest) en cada test. */
function findCallUrl(calls: unknown[][], predicate: (url: string) => boolean): string {
  const call = calls.find((c) => predicate(c[0] as string));
  if (!call) throw new Error("Ninguna llamada a fetch matcheó el predicado");
  return call[0] as string;
}

describe("Catalog sync — full initial sync (V1)", () => {
  beforeEach(() => {
    resetLocalDbCache();
    resetAppMetaDbCache();
    localStorage.clear();
    localStorage.setItem("kipu_token", "access-vigente");
    vi.restoreAllMocks();
  });
  afterEach(() => vi.unstubAllGlobals());

  it("descarga productos/clientes/sucursal y los deja disponibles localmente, reutilizando los endpoints ya existentes", async () => {
    const org = uniqueOrgId();
    const fetchMock = vi.fn().mockImplementation((url: string) => {
      if (url.endsWith("/products")) {
        return Promise.resolve(
          jsonResponse([
            {
              id: "prod-1",
              organizationId: org,
              name: "Coca Cola",
              sku: "COCA",
              barcode: null,
              price: "15.00",
              active: true,
              updatedAt: "2026-01-01T00:00:00.000Z",
            },
          ]),
        );
      }
      if (url.endsWith("/customers")) {
        return Promise.resolve(
          jsonResponse([
            {
              id: "cust-1",
              organizationId: org,
              name: "Cliente Ocasional",
              documentType: "CI",
              documentNumber: "12345",
              phone: null,
              email: null,
              active: true,
              updatedAt: "2026-01-01T00:00:00.000Z",
            },
          ]),
        );
      }
      if (url.endsWith("/branches")) {
        return Promise.resolve(
          jsonResponse([
            { id: "branch-1", warehouses: [{ id: "wh-1" }], posTerminals: [{ id: "pos-1" }] },
          ]),
        );
      }
      throw new Error(`URL inesperada: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const db = getLocalDb(org);
    const result = await runFullInitialSync(db, {
      organizationId: org,
      organizationName: "Mi Negocio",
      userId: "user-1",
      userName: "Dueño",
      roleKey: "OWNER",
    });

    expect(result).toEqual({ productsCount: 1, customersCount: 1, hasBranchConfigured: true });
    expect((await db.products.get("prod-1"))?.name).toBe("Coca Cola");
    expect((await db.customers.get("cust-1"))?.name).toBe("Cliente Ocasional");
    const context = await db.orgContext.get(org);
    expect(context?.posTerminalId).toBe("pos-1");
    expect(context?.warehouseId).toBe("wh-1");
  });

  it("registra la organización como 'conocida' en este dispositivo tras sincronizar", async () => {
    const org = uniqueOrgId();
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation((url: string) => {
        if (url.endsWith("/branches")) return Promise.resolve(jsonResponse([]));
        return Promise.resolve(jsonResponse([]));
      }),
    );
    await runFullInitialSync(getLocalDb(org), {
      organizationId: org,
      organizationName: "Negocio X",
      userId: "u1",
      userName: "U",
      roleKey: "OWNER",
    });
    const known = await listKnownOrganizations();
    expect(known.some((k) => k.organizationId === org)).toBe(true);
  });

  it("un segundo sync de la MISMA organización reemplaza el catálogo (no lo duplica ni lo acumula)", async () => {
    const org = uniqueOrgId();
    let call = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation((url: string) => {
        if (url.endsWith("/products")) {
          call += 1;
          const name = call === 1 ? "Versión 1" : "Versión 2";
          return Promise.resolve(
            jsonResponse([
              {
                id: "prod-1",
                organizationId: org,
                name,
                sku: null,
                barcode: null,
                price: "10.00",
                active: true,
                updatedAt: new Date().toISOString(),
              },
            ]),
          );
        }
        return Promise.resolve(jsonResponse([]));
      }),
    );

    const db = getLocalDb(org);
    const input = {
      organizationId: org,
      organizationName: "Negocio",
      userId: "u1",
      userName: "U",
      roleKey: "OWNER",
    };
    await runFullInitialSync(db, input);
    await runFullInitialSync(db, input);

    const all = await db.products.toArray();
    expect(all).toHaveLength(1);
    expect(all[0].name).toBe("Versión 2");
  });

  it("aislamiento: sincronizar dos organizaciones distintas nunca mezcla su catálogo", async () => {
    const orgA = uniqueOrgId("org-a");
    const orgB = uniqueOrgId("org-b");

    function fetchFor(orgId: string, productName: string) {
      return vi.fn().mockImplementation((url: string) => {
        if (url.endsWith("/products")) {
          return Promise.resolve(
            jsonResponse([
              {
                id: "prod-shared-id",
                organizationId: orgId,
                name: productName,
                sku: null,
                barcode: null,
                price: "1.00",
                active: true,
                updatedAt: new Date().toISOString(),
              },
            ]),
          );
        }
        return Promise.resolve(jsonResponse([]));
      });
    }

    vi.stubGlobal("fetch", fetchFor(orgA, "Producto de A"));
    await runFullInitialSync(getLocalDb(orgA), {
      organizationId: orgA,
      organizationName: "A",
      userId: "u1",
      userName: "U",
      roleKey: "OWNER",
    });

    vi.stubGlobal("fetch", fetchFor(orgB, "Producto de B"));
    await runFullInitialSync(getLocalDb(orgB), {
      organizationId: orgB,
      organizationName: "B",
      userId: "u2",
      userName: "U2",
      roleKey: "OWNER",
    });

    expect((await getLocalDb(orgA).products.get("prod-shared-id"))?.name).toBe("Producto de A");
    expect((await getLocalDb(orgB).products.get("prod-shared-id"))?.name).toBe("Producto de B");
  });
});

function product(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: "prod-1",
    organizationId: "org",
    name: "Producto",
    sku: null,
    barcode: null,
    price: "10.00",
    active: true,
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

function customer(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: "cust-1",
    organizationId: "org",
    name: "Cliente",
    documentType: "CI",
    documentNumber: "1",
    phone: null,
    email: null,
    active: true,
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

const BASE_INPUT = { userId: "u1", userName: "U", roleKey: "OWNER" as string | null };

describe("Catalog sync — sincronización incremental (Offline 4.3)", () => {
  beforeEach(() => {
    resetLocalDbCache();
    resetAppMetaDbCache();
    localStorage.clear();
    localStorage.setItem("kipu_token", "access-vigente");
    vi.restoreAllMocks();
  });
  afterEach(() => vi.unstubAllGlobals());

  // 1
  it("sin cursor previo (dispositivo nuevo), el incremental cae al full sync", async () => {
    const org = uniqueOrgId();
    const fetchMock = vi.fn().mockImplementation((url: string) => {
      if (url.endsWith("/products")) return Promise.resolve(jsonResponse([product({ organizationId: org })]));
      if (url.endsWith("/branches"))
        return Promise.resolve(jsonResponse([{ id: "b1", warehouses: [{ id: "w1" }], posTerminals: [{ id: "p1" }] }]));
      return Promise.resolve(jsonResponse([]));
    });
    vi.stubGlobal("fetch", fetchMock);

    const db = getLocalDb(org);
    const result = await runIncrementalSync(db, { organizationId: org, organizationName: "N", ...BASE_INPUT });

    expect(result.mode).toBe("full");
    // El fetch NUNCA llevó `updatedSince` — es un full sync real, no un incremental "vacío".
    const productsUrl = findCallUrl(fetchMock.mock.calls, (url) => url.endsWith("/products"));
    expect(productsUrl).not.toContain("updatedSince");
    expect((await db.products.get("prod-1"))?.name).toBe("Producto");
  });

  // 2, 9 — segundo sync usa el cursor guardado por el full sync anterior; el cursor queda registrado
  it("después de un full sync, el incremental manda el `updatedSince` guardado como cursor", async () => {
    const org = uniqueOrgId();
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation((url: string) => {
        if (url.endsWith("/products"))
          return Promise.resolve(jsonResponse([product({ organizationId: org, updatedAt: "2026-03-01T10:00:00.000Z" })]));
        return Promise.resolve(jsonResponse([]));
      }),
    );
    const db = getLocalDb(org);
    await runFullInitialSync(db, { organizationId: org, organizationName: "N", ...BASE_INPUT });

    const state = await db.syncState.get(org);
    expect(state?.productsUpdatedAt).toBe("2026-03-01T10:00:00.000Z");

    // `mockImplementation` (no `mockResolvedValue`): products y customers
    // se piden en paralelo (`Promise.all`) — reusar una única instancia de
    // `Response` entre ambos rompería, porque el body de una `Response`
    // solo se puede leer una vez.
    const fetchMock = vi.fn().mockImplementation(() => Promise.resolve(jsonResponse([])));
    vi.stubGlobal("fetch", fetchMock);
    const result = await runIncrementalSync(db, { organizationId: org, organizationName: "N", ...BASE_INPUT });

    expect(result.mode).toBe("incremental");
    const productsUrl = findCallUrl(fetchMock.mock.calls, (url) => url.includes("/products"));
    expect(productsUrl).toContain(
      `/products?updatedSince=${encodeURIComponent("2026-03-01T10:00:00.000Z")}`,
    );
  });

  // 3, 7 — nunca hace clear(): un producto que no cambió permanece intacto
  it("el incremental NUNCA hace clear() — un producto que no vino en la respuesta permanece intacto", async () => {
    const org = uniqueOrgId();
    const db = getLocalDb(org);
    await db.products.add(product({ id: "prod-intacto", name: "No Cambia" }) as never);
    await db.syncState.put({
      organizationId: org,
      productsUpdatedAt: "2026-01-01T00:00:00.000Z",
      customersUpdatedAt: "2026-01-01T00:00:00.000Z",
      lastFullSyncAt: "2026-01-01T00:00:00.000Z",
      lastIncrementalSyncAt: null,
    });

    // La respuesta incremental trae SOLO un producto DISTINTO — "prod-intacto" no aparece.
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation((url: string) => {
        if (url.includes("/products"))
          return Promise.resolve(
            jsonResponse([product({ id: "prod-otro", name: "Otro Producto", updatedAt: "2026-02-01T00:00:00.000Z" })]),
          );
        return Promise.resolve(jsonResponse([]));
      }),
    );
    await runIncrementalSync(db, { organizationId: org, organizationName: "N", ...BASE_INPUT });

    const intacto = await db.products.get("prod-intacto");
    expect(intacto?.name).toBe("No Cambia"); // 7: permanece intacto
    const otro = await db.products.get("prod-otro");
    expect(otro?.name).toBe("Otro Producto"); // 4: nuevo se agrega
    expect(await db.products.count()).toBe(2); // nunca se borró nada — no hubo clear()
  });

  // 5 — producto modificado se actualiza (upsert, no duplica)
  it("producto modificado: el incremental actualiza la copia local existente (bulkPut, no duplica)", async () => {
    const org = uniqueOrgId();
    const db = getLocalDb(org);
    await db.products.add(product({ id: "prod-1", name: "Nombre Viejo", price: "10.00" }) as never);
    await db.syncState.put({
      organizationId: org,
      productsUpdatedAt: "2026-01-01T00:00:00.000Z",
      customersUpdatedAt: "2026-01-01T00:00:00.000Z",
      lastFullSyncAt: "2026-01-01T00:00:00.000Z",
      lastIncrementalSyncAt: null,
    });
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation((url: string) => {
        if (url.includes("/products"))
          return Promise.resolve(
            jsonResponse([product({ id: "prod-1", name: "Nombre Nuevo", price: "12.50", updatedAt: "2026-02-01T00:00:00.000Z" })]),
          );
        return Promise.resolve(jsonResponse([]));
      }),
    );
    await runIncrementalSync(db, { organizationId: org, organizationName: "N", ...BASE_INPUT });

    expect(await db.products.count()).toBe(1); // nunca duplica
    const updated = await db.products.get("prod-1");
    expect(updated?.name).toBe("Nombre Nuevo");
    expect(updated?.price).toBe("12.50");
  });

  // 6, 21 (TEST DE FALLA CRÍTICO) — producto desactivado pasa a active=false, nunca se borra físicamente
  it("TEST DE FALLA CRÍTICO — un producto que se desactiva en el servidor pasa a active=false localmente, SIN eliminarse físicamente", async () => {
    const org = uniqueOrgId();
    const db = getLocalDb(org);
    await db.products.add(product({ id: "prod-1", name: "Se Desactiva", active: true }) as never);
    await db.syncState.put({
      organizationId: org,
      productsUpdatedAt: "2026-01-01T00:00:00.000Z",
      customersUpdatedAt: "2026-01-01T00:00:00.000Z",
      lastFullSyncAt: "2026-01-01T00:00:00.000Z",
      lastIncrementalSyncAt: null,
    });
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation((url: string) => {
        if (url.includes("/products"))
          return Promise.resolve(
            jsonResponse([product({ id: "prod-1", name: "Se Desactiva", active: false, updatedAt: "2026-02-01T00:00:00.000Z" })]),
          );
        return Promise.resolve(jsonResponse([]));
      }),
    );
    await runIncrementalSync(db, { organizationId: org, organizationName: "N", ...BASE_INPUT });

    // El producto deja de ser vendible (active=false)...
    const found = await db.products.get("prod-1");
    expect(found).toBeDefined(); // ...pero el registro local NUNCA se elimina físicamente.
    expect(found?.active).toBe(false);
    expect(await db.products.count()).toBe(1);
  });

  // 8 — cliente modificado se actualiza
  it("cliente modificado: el incremental actualiza la copia local existente", async () => {
    const org = uniqueOrgId();
    const db = getLocalDb(org);
    await db.customers.add(customer({ id: "cust-1", name: "Nombre Viejo" }) as never);
    await db.syncState.put({
      organizationId: org,
      productsUpdatedAt: "2026-01-01T00:00:00.000Z",
      customersUpdatedAt: "2026-01-01T00:00:00.000Z",
      lastFullSyncAt: "2026-01-01T00:00:00.000Z",
      lastIncrementalSyncAt: null,
    });
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation((url: string) => {
        if (url.includes("/customers"))
          return Promise.resolve(
            jsonResponse([customer({ id: "cust-1", name: "Nombre Nuevo", updatedAt: "2026-02-01T00:00:00.000Z" })]),
          );
        return Promise.resolve(jsonResponse([]));
      }),
    );
    await runIncrementalSync(db, { organizationId: org, organizationName: "N", ...BASE_INPUT });
    expect((await db.customers.get("cust-1"))?.name).toBe("Nombre Nuevo");
  });

  // 22 (TEST DE CONSISTENCIA DEL CURSOR) — si la persistencia local falla, el cursor NO avanza; un reintento posterior sí aplica los cambios y avanza el cursor
  it("TEST DE CONSISTENCIA DEL CURSOR — si falla la aplicación local, el cursor NO avanza; el reintento sí aplica y avanza", async () => {
    const org = uniqueOrgId();
    const db = getLocalDb(org);
    await db.syncState.put({
      organizationId: org,
      productsUpdatedAt: "2026-01-01T00:00:00.000Z",
      customersUpdatedAt: "2026-01-01T00:00:00.000Z",
      lastFullSyncAt: "2026-01-01T00:00:00.000Z",
      lastIncrementalSyncAt: null,
    });
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation((url: string) => {
        if (url.includes("/products"))
          return Promise.resolve(
            jsonResponse([product({ id: "prod-1", name: "Nuevo", updatedAt: "2026-02-01T00:00:00.000Z" })]),
          );
        return Promise.resolve(jsonResponse([]));
      }),
    );

    // Simula que la escritura local falla A MITAD de la transacción (ej.
    // QuotaExceededError, o cualquier error real de IndexedDB) — Dexie
    // aborta TODA la transacción, incluida la actualización del cursor.
    const putSpy = vi.spyOn(db.syncState, "put").mockRejectedValueOnce(new Error("fallo simulado de persistencia"));
    await expect(runIncrementalSync(db, { organizationId: org, organizationName: "N", ...BASE_INPUT })).rejects.toThrow();
    putSpy.mockRestore();

    // El producto NUNCA se aplicó (la transacción abortó completa)...
    expect(await db.products.get("prod-1")).toBeUndefined();
    // ...y el cursor sigue exactamente donde estaba antes del intento fallido.
    const stateAfterFailure = await db.syncState.get(org);
    expect(stateAfterFailure?.productsUpdatedAt).toBe("2026-01-01T00:00:00.000Z");

    // Reintento (11): sin el mock que fallaba, la MISMA operación esta vez sí se aplica.
    const result = await runIncrementalSync(db, { organizationId: org, organizationName: "N", ...BASE_INPUT });
    expect(result.mode).toBe("incremental");
    expect((await db.products.get("prod-1"))?.name).toBe("Nuevo");
    const stateAfterRetry = await db.syncState.get(org);
    expect(stateAfterRetry?.productsUpdatedAt).toBe("2026-02-01T00:00:00.000Z"); // el cursor SÍ avanzó
  });

  // "Error de red" — sin persistencia tocada en absoluto, cursor intacto
  it("error de red durante el incremental: nunca toca la base local, el cursor no avanza, se puede reintentar", async () => {
    const org = uniqueOrgId();
    const db = getLocalDb(org);
    await db.products.add(product({ id: "prod-existente" }) as never);
    await db.syncState.put({
      organizationId: org,
      productsUpdatedAt: "2026-01-01T00:00:00.000Z",
      customersUpdatedAt: "2026-01-01T00:00:00.000Z",
      lastFullSyncAt: "2026-01-01T00:00:00.000Z",
      lastIncrementalSyncAt: null,
    });
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("sin conexión")));

    await expect(runIncrementalSync(db, { organizationId: org, organizationName: "N", ...BASE_INPUT })).rejects.toThrow();

    expect(await db.products.count()).toBe(1); // nada cambió
    const state = await db.syncState.get(org);
    expect(state?.productsUpdatedAt).toBe("2026-01-01T00:00:00.000Z"); // el cursor no avanzó
  });

  // 12 — organización A y B mantienen cursores independientes
  it("organización A y B mantienen cursores de sincronización completamente independientes", async () => {
    const orgA = uniqueOrgId("org-a");
    const orgB = uniqueOrgId("org-b");
    const dbA = getLocalDb(orgA);
    const dbB = getLocalDb(orgB);

    await dbA.syncState.put({
      organizationId: orgA,
      productsUpdatedAt: "2026-01-01T00:00:00.000Z",
      customersUpdatedAt: "2026-01-01T00:00:00.000Z",
      lastFullSyncAt: "2026-01-01T00:00:00.000Z",
      lastIncrementalSyncAt: null,
    });
    await dbB.syncState.put({
      organizationId: orgB,
      productsUpdatedAt: "2026-06-01T00:00:00.000Z",
      customersUpdatedAt: "2026-06-01T00:00:00.000Z",
      lastFullSyncAt: "2026-06-01T00:00:00.000Z",
      lastIncrementalSyncAt: null,
    });

    // Cambiar de organización y volver: cada base física conserva su
    // propio cursor — nunca se mezclan ni se pisan entre sí.
    const stateA = await dbA.syncState.get(orgA);
    const stateB = await dbB.syncState.get(orgB);
    expect(stateA?.productsUpdatedAt).toBe("2026-01-01T00:00:00.000Z");
    expect(stateB?.productsUpdatedAt).toBe("2026-06-01T00:00:00.000Z");

    // La tabla `syncState` de la base de A ni siquiera contiene una fila para B.
    expect(await dbA.syncState.get(orgB)).toBeUndefined();
    expect(await dbB.syncState.get(orgA)).toBeUndefined();
  });

  it("paginación: si la primera página viene completa (page size), pide otra página avanzando el cursor hasta agotar los cambios", async () => {
    const org = uniqueOrgId();
    const db = getLocalDb(org);
    await db.syncState.put({
      organizationId: org,
      productsUpdatedAt: "2026-01-01T00:00:00.000Z",
      customersUpdatedAt: "2026-01-01T00:00:00.000Z",
      lastFullSyncAt: "2026-01-01T00:00:00.000Z",
      lastIncrementalSyncAt: null,
    });

    // PRODUCTS_PAGE_SIZE es 200 (debe coincidir con el backend) — se simula
    // una primera página LLENA (200 filas, todas con el mismo updatedAt
    // salvo la última) seguida de una segunda página más chica.
    const page1 = Array.from({ length: 200 }, (_, i) =>
      product({ id: `prod-page1-${i}`, updatedAt: "2026-02-01T00:00:00.000Z" }),
    );
    const page2 = [product({ id: "prod-page2-0", updatedAt: "2026-03-01T00:00:00.000Z" })];
    let productsCalls = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation((url: string) => {
        if (url.includes("/products")) {
          productsCalls += 1;
          return Promise.resolve(jsonResponse(productsCalls === 1 ? page1 : page2));
        }
        return Promise.resolve(jsonResponse([]));
      }),
    );

    const result = await runIncrementalSync(db, { organizationId: org, organizationName: "N", ...BASE_INPUT });
    expect(productsCalls).toBe(2); // pidió una segunda página porque la primera vino completa
    expect(result.productsChanged).toBe(201);
    expect(await db.products.count()).toBe(201);
    const state = await db.syncState.get(org);
    expect(state?.productsUpdatedAt).toBe("2026-03-01T00:00:00.000Z");
  });
});
