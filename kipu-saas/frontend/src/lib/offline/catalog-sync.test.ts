import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getLocalDb, resetLocalDbCache } from "./db";
import { listKnownOrganizations, resetAppMetaDbCache } from "./app-meta-db";
import { runFullInitialSync } from "./catalog-sync";
import { uniqueOrgId } from "./test-support/unique";

function jsonResponse(body: unknown) {
  return new Response(JSON.stringify(body), { status: 200 });
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
