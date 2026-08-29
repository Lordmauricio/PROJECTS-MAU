import { beforeEach, describe, expect, it } from "vitest";
import { getLocalDb, resetLocalDbCache } from "./db";
import { confirmSaleOffline, createSaleOffline } from "./sales-repo";
import { uniqueOrgId } from "./test-support/unique";

describe("sales-repo — escritura local + encolado atómico", () => {
  beforeEach(() => resetLocalDbCache());

  it("createSaleOffline escribe el borrador Y encola sales.create en la misma operación", async () => {
    const org = uniqueOrgId();
    const db = getLocalDb(org);
    const sale = await createSaleOffline(db, {
      organizationId: org,
      posTerminalId: "pos-1",
      warehouseId: "wh-1",
      items: [{ productId: "prod-1", quantity: "1", unitPrice: "10.00", discount: "0" }],
    });

    expect(sale.status).toBe("DRAFT_LOCAL");
    expect(sale.serverId).toBeNull();
    const queueItem = await db.syncQueue.get(sale.createSyncOperationId);
    expect(queueItem?.operation).toBe("sales.create");
    expect(queueItem?.entityId).toBe(sale.id);
  });

  it("una venta sin ítems se rechaza antes de tocar la base (nunca una venta vacía en cola)", async () => {
    const org = uniqueOrgId();
    const db = getLocalDb(org);
    await expect(
      createSaleOffline(db, {
        organizationId: org,
        posTerminalId: "pos-1",
        warehouseId: "wh-1",
        items: [],
      }),
    ).rejects.toThrow();
    expect(await db.syncQueue.count()).toBe(0);
  });

  it("confirmSaleOffline encola sales.confirm con dependsOn apuntando a la operación de creación", async () => {
    const org = uniqueOrgId();
    const db = getLocalDb(org);
    const sale = await createSaleOffline(db, {
      organizationId: org,
      posTerminalId: "pos-1",
      warehouseId: "wh-1",
      items: [{ productId: "prod-1", quantity: "1", unitPrice: "10.00", discount: "0" }],
    });

    await confirmSaleOffline(db, {
      localSaleId: sale.id,
      payments: [{ method: "CASH", amount: "10.00", idempotencyKey: "pay-x" }],
    });

    const updated = await db.sales.get(sale.id);
    const confirmOp = await db.syncQueue.get(updated!.confirmSyncOperationId!);
    expect(confirmOp?.dependsOn).toEqual([sale.createSyncOperationId]);
  });

  it("no permite encolar una segunda confirmación para la misma venta local", async () => {
    const org = uniqueOrgId();
    const db = getLocalDb(org);
    const sale = await createSaleOffline(db, {
      organizationId: org,
      posTerminalId: "pos-1",
      warehouseId: "wh-1",
      items: [{ productId: "prod-1", quantity: "1", unitPrice: "10.00", discount: "0" }],
    });
    await confirmSaleOffline(db, {
      localSaleId: sale.id,
      payments: [{ method: "CASH", amount: "10.00", idempotencyKey: "pay-1" }],
    });

    await expect(
      confirmSaleOffline(db, {
        localSaleId: sale.id,
        payments: [{ method: "CASH", amount: "10.00", idempotencyKey: "pay-2" }],
      }),
    ).rejects.toThrow();

    // Solo una operación de confirmación en la cola, nunca dos.
    const confirmOps = (await db.syncQueue.toArray()).filter((o) => o.operation === "sales.confirm");
    expect(confirmOps).toHaveLength(1);
  });

  it("cada pago de la confirmación conserva su propia idempotencyKey (nunca la de la operación de cola)", async () => {
    const org = uniqueOrgId();
    const db = getLocalDb(org);
    const sale = await createSaleOffline(db, {
      organizationId: org,
      posTerminalId: "pos-1",
      warehouseId: "wh-1",
      items: [{ productId: "prod-1", quantity: "1", unitPrice: "10.00", discount: "0" }],
    });
    await confirmSaleOffline(db, {
      localSaleId: sale.id,
      payments: [{ method: "CASH", amount: "10.00", idempotencyKey: "pago-propio-123" }],
    });

    const updated = await db.sales.get(sale.id);
    const confirmOp = await db.syncQueue.get(updated!.confirmSyncOperationId!);
    const payload = confirmOp!.payload as { payments: { idempotencyKey: string }[] };
    expect(payload.payments[0].idempotencyKey).toBe("pago-propio-123");
    expect(confirmOp!.idempotencyKey).not.toBe("pago-propio-123"); // conceptos distintos, ver ids.ts
  });
});
