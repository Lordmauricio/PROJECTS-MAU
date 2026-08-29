import type { KipuLocalDB } from "./db";
import { newIdempotencyKey, newLocalId } from "./ids";
import { enqueue } from "./sync-queue";
import type { LocalSale, LocalSaleItem, LocalSalePayment } from "./types";

export interface CreateSaleOfflineInput {
  organizationId: string;
  posTerminalId: string;
  warehouseId: string;
  customerId?: string | null;
  discount?: string;
  items: LocalSaleItem[];
}

/**
 * Crea una venta offline: escribe el borrador local Y encola la operación
 * `sales.create` en la MISMA transacción Dexie — si la escritura del
 * borrador falla, la operación nunca queda encolada sin su venta, y
 * viceversa (todo-o-nada, mismo principio que las transacciones de
 * Postgres del backend, aplicado acá al par escritura-local+cola).
 *
 * `idempotencyKey` se genera UNA vez acá y viaja tal cual en el payload
 * (`Sale.idempotencyKey`, infraestructura de Fase Offline 1) — el Sync
 * Engine la reenvía sin cambios en cada reintento de ESTA misma fila de
 * cola, nunca genera una nueva.
 */
export async function createSaleOffline(
  db: KipuLocalDB,
  input: CreateSaleOfflineInput,
): Promise<LocalSale> {
  if (input.items.length === 0) {
    throw new Error("La venta necesita al menos un ítem");
  }

  const localId = newLocalId();
  const idempotencyKey = newIdempotencyKey();
  const createdAt = new Date().toISOString();

  const sale: LocalSale = {
    id: localId,
    organizationId: input.organizationId,
    serverId: null,
    status: "DRAFT_LOCAL",
    posTerminalId: input.posTerminalId,
    warehouseId: input.warehouseId,
    customerId: input.customerId ?? null,
    discount: input.discount ?? "0",
    items: input.items,
    payments: [],
    createSyncOperationId: "",
    confirmSyncOperationId: null,
    createdAt,
  };

  await db.transaction("rw", db.sales, db.syncQueue, async () => {
    await db.sales.add(sale);
    const op = await enqueue(db, {
      organizationId: input.organizationId,
      operation: "sales.create",
      entity: "Sale",
      entityId: localId,
      idempotencyKey,
      path: "/sales",
      payload: {
        posTerminalId: input.posTerminalId,
        warehouseId: input.warehouseId,
        customerId: input.customerId || undefined,
        discount: Number(input.discount ?? "0"),
        items: input.items.map((i) => ({
          productId: i.productId,
          quantity: Number(i.quantity),
          unitPrice: Number(i.unitPrice),
          discount: Number(i.discount),
        })),
        idempotencyKey,
      },
    });
    sale.createSyncOperationId = op.id;
    await db.sales.update(localId, { createSyncOperationId: op.id });
  });

  return sale;
}

export interface ConfirmSaleOfflineInput {
  localSaleId: string;
  payments: LocalSalePayment[];
}

/**
 * Encola la confirmación de una venta ya creada offline (`sales.confirm`).
 * `dependsOn: [createSyncOperationId]` es lo que garantiza que el Sync
 * Engine NUNCA envíe la confirmación antes de que la creación haya
 * sincronizado y resuelto el `serverId` real — sin esto, `/sales/{id}
 * /confirm` no tendría ningún id de servidor válido con el que armar la
 * URL. Ver `sync-engine.ts#resolvePath`.
 *
 * Cada `LocalSalePayment` trae su PROPIA `idempotencyKey` (mismo patrón que
 * ya usa `sales/pos/page.tsx` hoy online) — es esa key, no una del nivel
 * de la operación de cola, la que el backend usa para proteger cada pago
 * individual contra duplicados. La `idempotencyKey` de esta fila de cola
 * es puramente de bookkeeping local (identificar el reintento como "la
 * misma operación de cola"), sin significado propio del lado del
 * servidor — `confirm()` ya es idempotente por diseño (lock +
 * verificación de estado, ver `docs/architecture.md` Fase Comercial 2).
 */
export async function confirmSaleOffline(
  db: KipuLocalDB,
  input: ConfirmSaleOfflineInput,
): Promise<void> {
  const sale = await db.sales.get(input.localSaleId);
  if (!sale) throw new Error("Venta local no encontrada");
  if (sale.confirmSyncOperationId) {
    throw new Error("Esta venta ya tiene una confirmación encolada");
  }

  const payments = input.payments.map((p) => ({
    ...p,
    idempotencyKey: p.idempotencyKey || newIdempotencyKey(),
  }));

  await db.transaction("rw", db.sales, db.syncQueue, async () => {
    const op = await enqueue(db, {
      organizationId: sale.organizationId,
      operation: "sales.confirm",
      entity: "Sale",
      entityId: sale.id,
      idempotencyKey: newIdempotencyKey(),
      path: "/sales/{serverId}/confirm",
      payload: { payments },
      dependsOn: [sale.createSyncOperationId],
    });
    await db.sales.update(sale.id, {
      payments,
      confirmSyncOperationId: op.id,
    });
  });
}
