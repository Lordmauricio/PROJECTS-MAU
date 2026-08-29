import { beforeEach, describe, expect, it } from "vitest";
import { getLocalDb, resetLocalDbCache } from "./db";
import { uniqueOrgId } from "./test-support/unique";
import type { LocalProduct } from "./types";

function sampleProduct(
  organizationId: string,
  overrides: Partial<LocalProduct> = {},
): LocalProduct {
  return {
    id: "prod-1",
    organizationId,
    name: "Coca Cola 2L",
    sku: "COCA-2L",
    barcode: null,
    price: "15.00",
    active: true,
    updatedAt: new Date().toISOString(),
    cachedAt: new Date().toISOString(),
    ...overrides,
  };
}

describe("Base local — CRUD de entidades cacheadas", () => {
  beforeEach(() => resetLocalDbCache());

  it("guarda y recupera una entidad", async () => {
    const org = uniqueOrgId();
    const db = getLocalDb(org);
    await db.products.add(sampleProduct(org));
    const found = await db.products.get("prod-1");
    expect(found?.name).toBe("Coca Cola 2L");
    expect(found?.price).toBe("15.00");
  });

  it("actualiza una entidad ya guardada", async () => {
    const org = uniqueOrgId();
    const db = getLocalDb(org);
    await db.products.add(sampleProduct(org));
    await db.products.update("prod-1", { price: "17.50", active: false });
    const found = await db.products.get("prod-1");
    expect(found?.price).toBe("17.50");
    expect(found?.active).toBe(false);
  });

  it("elimina (invalida) una entidad", async () => {
    const org = uniqueOrgId();
    const db = getLocalDb(org);
    await db.products.add(sampleProduct(org));
    await db.products.delete("prod-1");
    const found = await db.products.get("prod-1");
    expect(found).toBeUndefined();
  });

  it("recuperar una entidad inexistente no lanza, devuelve undefined", async () => {
    const db = getLocalDb(uniqueOrgId());
    const found = await db.products.get("no-existe");
    expect(found).toBeUndefined();
  });
});

describe("Base local — aislamiento multi-tenant (una base física por organización)", () => {
  beforeEach(() => resetLocalDbCache());

  it("dos organizaciones nunca comparten filas, incluso con el mismo id de producto", async () => {
    const orgA = uniqueOrgId("org-a");
    const orgB = uniqueOrgId("org-b");
    const dbA = getLocalDb(orgA);
    const dbB = getLocalDb(orgB);

    await dbA.products.add(sampleProduct(orgA, { name: "Producto de A" }));
    await dbB.products.add(sampleProduct(orgB, { name: "Producto de B" }));

    const fromA = await dbA.products.get("prod-1");
    const fromB = await dbB.products.get("prod-1");

    expect(fromA?.name).toBe("Producto de A");
    expect(fromB?.name).toBe("Producto de B");

    // Vaciar la base de A no puede afectar a B — son bases físicas distintas.
    await dbA.products.clear();
    expect(await dbA.products.get("prod-1")).toBeUndefined();
    expect((await dbB.products.get("prod-1"))?.name).toBe("Producto de B");
  });

  it("pedir la misma organización dos veces devuelve la MISMA instancia (sin conexiones redundantes)", () => {
    const org = uniqueOrgId();
    const first = getLocalDb(org);
    const second = getLocalDb(org);
    expect(first).toBe(second);
  });

  it("organizationId vacío se rechaza explícitamente (nunca una base 'sin organización')", () => {
    expect(() => getLocalDb("")).toThrow();
  });
});
