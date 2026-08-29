import { beforeEach, describe, expect, it } from "vitest";
import { getLocalDb, resetLocalDbCache } from "./db";
import { enqueue } from "./sync-queue";
import { getPendingSyncSummary, isolatedLocalDbFor } from "./session-lifecycle";
import { uniqueOrgId } from "./test-support/unique";

describe("Logout — operaciones pendientes nunca se pierden ni se borran en silencio", () => {
  beforeEach(() => resetLocalDbCache());

  it("getPendingSyncSummary refleja lo que hay en cola, sin modificar nada", async () => {
    const org = uniqueOrgId();
    const db = getLocalDb(org);
    await enqueue(db, {
      organizationId: org,
      operation: "sales.create",
      entity: "Sale",
      entityId: "local-1",
      idempotencyKey: "k1",
      path: "/sales",
      payload: {},
    });

    const summary = await getPendingSyncSummary(org);
    expect(summary.pendingCount).toBe(1);
    expect(summary.conflictCount).toBe(0);

    // Pedir el resumen no debe alterar el estado de la cola.
    const again = await getPendingSyncSummary(org);
    expect(again.pendingCount).toBe(1);

    const stillThere = await db.syncQueue.toArray();
    expect(stillThere).toHaveLength(1);
  });

  it("una organización sin nada pendiente reporta cero, no un error", async () => {
    const summary = await getPendingSyncSummary(uniqueOrgId());
    expect(summary.pendingCount).toBe(0);
    expect(summary.conflictCount).toBe(0);
  });
});

describe("Cambio de organización — aislamiento sin ninguna migración necesaria", () => {
  beforeEach(() => resetLocalDbCache());

  it("pedir la base de otra organización nunca expone ni mezcla datos de la anterior", async () => {
    const orgA = uniqueOrgId("org-a");
    const orgB = uniqueOrgId("org-b");

    const dbA = isolatedLocalDbFor(orgA);
    await dbA.products.add({
      id: "p1",
      organizationId: orgA,
      name: "Solo en A",
      sku: null,
      barcode: null,
      price: "1.00",
      active: true,
      updatedAt: new Date().toISOString(),
      cachedAt: new Date().toISOString(),
    });

    const dbB = isolatedLocalDbFor(orgB);
    expect(await dbB.products.toArray()).toHaveLength(0);
    expect(await dbA.products.toArray()).toHaveLength(1);
  });
});
