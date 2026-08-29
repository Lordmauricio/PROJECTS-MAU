import type { KipuLocalDB } from "./db";
import { MAX_AUTOMATIC_ATTEMPTS } from "./sync-queue";
import type { LocalSale, SyncQueueItem } from "./types";

export type SaleSyncState =
  | { kind: "synced"; summary: NonNullable<LocalSale["serverSummary"]> }
  // En cola, esperando conexión o su próximo reintento automático — nunca
  // necesita que el usuario haga nada todavía.
  | { kind: "offline-pending" }
  | { kind: "syncing" }
  // 409 de negocio (ej. stock insuficiente) o `idempotencyKey` reusada con
  // datos distintos — el backend rechazó la operación tal cual está,
  // nunca se reintenta sola.
  | { kind: "conflict"; message: string }
  // Error de validación permanente (400) o un error transitorio que ya
  // agotó sus reintentos automáticos — necesita revisión humana, pero a
  // diferencia de `conflict` no es necesariamente un rechazo de negocio.
  | { kind: "error"; message: string };

/**
 * Traduce el estado de las filas de `sync_queue` asociadas a una venta
 * local al estado que la UI necesita mostrar — nunca inventa un estado
 * "éxito" sin una confirmación real del servidor (`serverSummary` solo se
 * completa cuando `sales.confirm` sincronizó de verdad, ver
 * `sync-engine.ts#reconcileEntity`).
 */
export async function getSaleSyncState(
  db: KipuLocalDB,
  localSaleId: string,
): Promise<SaleSyncState> {
  const sale = await db.sales.get(localSaleId);
  if (!sale) throw new Error("Venta local no encontrada");

  const ops: SyncQueueItem[] = [];
  const createOp = await db.syncQueue.get(sale.createSyncOperationId);
  if (createOp) ops.push(createOp);
  if (sale.confirmSyncOperationId) {
    const confirmOp = await db.syncQueue.get(sale.confirmSyncOperationId);
    if (confirmOp) ops.push(confirmOp);
  }

  return deriveState(sale, ops);
}

function deriveState(sale: LocalSale, ops: SyncQueueItem[]): SaleSyncState {
  const conflict = ops.find((o) => o.status === "CONFLICT");
  if (conflict) {
    return { kind: "conflict", message: conflict.error ?? "Conflicto al sincronizar" };
  }

  const exhaustedFailure = ops.find(
    (o) => o.status === "FAILED" && o.attempts >= MAX_AUTOMATIC_ATTEMPTS,
  );
  if (exhaustedFailure) {
    return {
      kind: "error",
      message: exhaustedFailure.error ?? "No se pudo sincronizar tras varios intentos",
    };
  }

  if (ops.some((o) => o.status === "SYNCING")) {
    return { kind: "syncing" };
  }

  const allSynced = ops.length > 0 && ops.every((o) => o.status === "SYNCED");
  if (allSynced && sale.status === "CONFIRM_SYNCED" && sale.serverSummary) {
    return { kind: "synced", summary: sale.serverSummary };
  }

  // PENDING, o FAILED todavía con reintentos automáticos disponibles.
  return { kind: "offline-pending" };
}

export interface LocalSaleWithState {
  sale: LocalSale;
  state: SaleSyncState;
}

/** Historial local para la UI de "ventas creadas offline" — más recientes primero. */
export async function listLocalSalesWithState(
  db: KipuLocalDB,
  limit = 50,
): Promise<LocalSaleWithState[]> {
  const sales = await db.sales.orderBy("createdAt").reverse().limit(limit).toArray();
  return Promise.all(
    sales.map(async (sale) => ({ sale, state: await getSaleSyncState(db, sale.id) })),
  );
}
