import type { KipuLocalDB } from "./db";
import { newSyncOperationId } from "./ids";
import type { SyncOperationName, SyncQueueItem, SyncStatus } from "./types";

// Una fila cuyo lock tiene más de este tiempo se considera abandonada (el
// tab/proceso que la reclamó murió a mitad de camino — cierre inesperado,
// pérdida de energía, crash) y vuelve a quedar disponible para que
// cualquier Sync Engine la reclame de nuevo. Ver `docs/architecture.md`
// sección 18 para la justificación del valor.
const STALE_LOCK_MS = 2 * 60_000;

const MAX_AUTOMATIC_ATTEMPTS = 8;

export interface EnqueueInput {
  organizationId: string;
  operation: SyncOperationName;
  entity: "Sale";
  entityId: string;
  idempotencyKey: string;
  path: string;
  payload: unknown;
  dependsOn?: string[];
}

export async function enqueue(
  db: KipuLocalDB,
  input: EnqueueInput,
): Promise<SyncQueueItem> {
  const item: SyncQueueItem = {
    id: newSyncOperationId(),
    organizationId: input.organizationId,
    operation: input.operation,
    entity: input.entity,
    entityId: input.entityId,
    idempotencyKey: input.idempotencyKey,
    method: "POST",
    path: input.path,
    payload: input.payload,
    dependsOn: input.dependsOn && input.dependsOn.length > 0 ? input.dependsOn : null,
    createdAt: new Date().toISOString(),
    attempts: 0,
    lastAttemptAt: null,
    status: "PENDING",
    error: null,
    nextRetryAt: null,
    lockedBy: null,
    lockedAt: null,
    resultServerId: null,
  };
  await db.syncQueue.add(item);
  return item;
}

export async function countPending(db: KipuLocalDB): Promise<number> {
  return db.syncQueue.where("status").anyOf("PENDING", "SYNCING", "FAILED").count();
}

export async function listByStatus(
  db: KipuLocalDB,
  status: SyncStatus,
): Promise<SyncQueueItem[]> {
  return db.syncQueue.where("status").equals(status).sortBy("createdAt");
}

function isLockStale(item: SyncQueueItem, now: number): boolean {
  if (!item.lockedAt) return true;
  return now - new Date(item.lockedAt).getTime() > STALE_LOCK_MS;
}

function isDue(item: SyncQueueItem, now: number): boolean {
  if (item.status === "PENDING") return true;
  if (item.status === "FAILED" && item.attempts < MAX_AUTOMATIC_ATTEMPTS) {
    return !item.nextRetryAt || new Date(item.nextRetryAt).getTime() <= now;
  }
  // Una fila que quedó SYNCING con un lock abandonado (el proceso que la
  // reclamó murió a mitad de camino — cierre inesperado, pérdida de
  // energía) vuelve a ser candidata una vez vencido el umbral. Sin esto,
  // una operación podría quedar bloqueada para siempre si nadie la libera
  // explícitamente. Ver `docs/architecture.md` sección 18.
  if (item.status === "SYNCING") return isLockStale(item, now);
  return false;
}

/**
 * Reclama la PRÓXIMA operación elegible para procesar — a lo sumo una por
 * llamada, nunca un lote. Elegible significa: PENDING, o FAILED con
 * intentos disponibles y `nextRetryAt` ya vencido; con TODAS sus
 * `dependsOn` en estado SYNCED; y sin un lock activo (o con un lock ya
 * abandonado). El claim (leer + marcar SYNCING con el `lockedBy` de este
 * engine) ocurre dentro de UNA transacción Dexie — las transacciones de
 * IndexedDB están serializadas por el navegador incluso entre pestañas del
 * mismo origen, así que dos Sync Engines corriendo en dos pestañas nunca
 * pueden reclamar la misma fila: es esa serialización, no un mecanismo de
 * lock inventado aparte, lo que da la exclusión mutua real. Ver
 * `docs/architecture.md` sección 18.
 */
export async function claimNext(
  db: KipuLocalDB,
  engineId: string,
): Promise<SyncQueueItem | null> {
  return db.transaction("rw", db.syncQueue, async () => {
    const now = Date.now();
    const candidates = await db.syncQueue.orderBy("createdAt").toArray();

    const syncedIds = new Set(
      candidates.filter((c) => c.status === "SYNCED").map((c) => c.id),
    );

    for (const item of candidates) {
      if (!isDue(item, now)) continue;
      if (item.lockedBy && !isLockStale(item, now)) continue;
      const deps = item.dependsOn ?? [];
      const depsSatisfied = deps.every((depId) => syncedIds.has(depId));
      if (!depsSatisfied) continue;

      const claimed: SyncQueueItem = {
        ...item,
        status: "SYNCING",
        lockedBy: engineId,
        lockedAt: new Date(now).toISOString(),
      };
      await db.syncQueue.put(claimed);
      return claimed;
    }
    return null;
  });
}

/** Libera el lock sin cambiar `status` — usado si el engine se detiene antes de terminar de procesar una fila ya reclamada (nunca debería pasar en el camino feliz, pero deja la fila reclamable de nuevo en vez de bloqueada). */
export async function releaseLock(
  db: KipuLocalDB,
  syncOperationId: string,
): Promise<void> {
  await db.syncQueue.update(syncOperationId, { lockedBy: null, lockedAt: null });
}

export async function markSynced(
  db: KipuLocalDB,
  syncOperationId: string,
  resultServerId: string | null,
): Promise<void> {
  await db.syncQueue.update(syncOperationId, {
    status: "SYNCED",
    error: null,
    nextRetryAt: null,
    lockedBy: null,
    lockedAt: null,
    resultServerId,
    lastAttemptAt: new Date().toISOString(),
  });
}

/** Backoff exponencial con techo — mismo criterio de "no reintentos infinitos agresivos" pedido: 2s, 4s, 8s, ... hasta un techo de 5 minutos. */
function backoffMs(attempts: number): number {
  const base = 2_000 * 2 ** Math.min(attempts, 10);
  return Math.min(base, 5 * 60_000);
}

/** Fallo TRANSITORIO (red caída, timeout, 5xx) — sigue siendo candidato a reintento automático mientras no supere `MAX_AUTOMATIC_ATTEMPTS`. */
export async function markFailedTransient(
  db: KipuLocalDB,
  syncOperationId: string,
  error: string,
): Promise<void> {
  const current = await db.syncQueue.get(syncOperationId);
  const attempts = (current?.attempts ?? 0) + 1;
  await db.syncQueue.update(syncOperationId, {
    status: "FAILED",
    attempts,
    error,
    lastAttemptAt: new Date().toISOString(),
    nextRetryAt: new Date(Date.now() + backoffMs(attempts)).toISOString(),
    lockedBy: null,
    lockedAt: null,
  });
}

/**
 * Conflicto de NEGOCIO reportado por el servidor (409: idempotencyKey
 * reusada con datos distintos, stock insuficiente al confirmar, etc.) o un
 * error de validación permanente (400). Nunca se reintenta
 * automáticamente — instrucción explícita del pedido: "no inventes una
 * resolución automática que pueda alterar cantidades incorrectamente".
 * Solo un reintento MANUAL explícito (`retryManually`) puede volver a
 * intentarlo, típicamente después de que un humano revise qué pasó.
 */
export async function markConflict(
  db: KipuLocalDB,
  syncOperationId: string,
  error: string,
): Promise<void> {
  await db.syncQueue.update(syncOperationId, {
    status: "CONFLICT",
    error,
    lastAttemptAt: new Date().toISOString(),
    nextRetryAt: null,
    lockedBy: null,
    lockedAt: null,
  });
}

/** Recupera una operación FAILED (agotó los reintentos automáticos) o CONFLICT para un nuevo intento — acción explícita, nunca automática. */
export async function retryManually(
  db: KipuLocalDB,
  syncOperationId: string,
): Promise<void> {
  const current = await db.syncQueue.get(syncOperationId);
  if (!current) throw new Error("Operación de sincronización no encontrada");
  if (current.status !== "FAILED" && current.status !== "CONFLICT") {
    throw new Error(
      `Solo se puede reintentar manualmente una operación FAILED o CONFLICT (estado actual: ${current.status})`,
    );
  }
  await db.syncQueue.update(syncOperationId, {
    status: "PENDING",
    nextRetryAt: null,
    lockedBy: null,
    lockedAt: null,
  });
}
