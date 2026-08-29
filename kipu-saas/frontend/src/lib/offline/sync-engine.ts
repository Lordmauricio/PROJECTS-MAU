import type { KipuLocalDB } from "./db";
import { newLocalId } from "./ids";
import { syncRequest } from "./sync-client";
import { connectionStatus } from "./connection-status";
import {
  claimNext,
  countPending,
  markConflict,
  markFailedTransient,
  markSynced,
} from "./sync-queue";
import type { SyncQueueItem } from "./types";

interface SaleServerResponse {
  id?: string;
  status?: string;
  total?: string;
  paidTotal?: string;
  balance?: string;
}

function resolvePath(path: string, resultServerId: string | undefined): string {
  if (!path.includes("{serverId}")) return path;
  if (!resultServerId) {
    throw new Error(
      `La operación depende de un serverId que todavía no se resolvió (path: ${path})`,
    );
  }
  return path.replace("{serverId}", resultServerId);
}

/**
 * Aplica el efecto de una operación ya SINCRONIZADA sobre la entidad local
 * que representa (`LocalSale`) — el único punto que traduce "la API
 * respondió esto" a "así queda la copia local". V1 solo conoce `Sale`
 * (`sales.create`/`sales.confirm`); una fase futura que agregue más
 * entidades offline extendería este switch, nunca el resto del engine.
 */
async function reconcileEntity(
  db: KipuLocalDB,
  item: SyncQueueItem,
  response: SaleServerResponse,
): Promise<void> {
  if (item.entity !== "Sale") return;
  const sale = await db.sales.get(item.entityId);
  if (!sale) return;

  if (item.operation === "sales.create") {
    await db.sales.update(item.entityId, {
      serverId: response.id ?? sale.serverId,
      status: "CREATE_SYNCED",
    });
  } else if (item.operation === "sales.confirm") {
    await db.sales.update(item.entityId, {
      status: "CONFIRM_SYNCED",
      // Se guarda tal cual la respuesta real del servidor — nunca se
      // recalcula localmente (nada de aritmética financiera en esta
      // capa, ver `docs/architecture.md` sección 18/19).
      serverSummary:
        response.status !== undefined
          ? {
              status: response.status,
              total: response.total ?? "0",
              paidTotal: response.paidTotal ?? "0",
              balance: response.balance ?? "0",
            }
          : null,
    });
  }
}

export interface SyncRunSummary {
  processed: number;
  synced: number;
  failedTransient: number;
  conflicts: number;
  sessionRevoked: boolean;
}

/**
 * Procesa la cola de UNA organización hasta que no queda ninguna operación
 * elegible en este pase (agotó lo que había PENDING/FAILED-vencido, o topó
 * con una que depende de otra que todavía no sincronizó). Nunca procesa dos
 * operaciones en paralelo — instrucción explícita del pedido ("no
 * sincronices en paralelo operaciones que tengan dependencias"): la forma
 * más simple de cumplirla sin tener que razonar sobre qué operaciones son
 * independientes es no paralelizar NINGUNA, apropiado para el volumen real
 * de un comercio chico (decenas de operaciones en cola, no miles).
 *
 * Se detiene inmediatamente si el servidor indica que la sesión ya no es
 * válida (revocada o expirada sin poder renovarse) — ninguna operación
 * restante va a poder sincronizar sin sesión, así que seguir intentando
 * solo quemaría reintentos contra un error que no es transitorio.
 */
export async function runSyncOnce(
  db: KipuLocalDB,
  engineId: string = newLocalId(),
): Promise<SyncRunSummary> {
  const summary: SyncRunSummary = {
    processed: 0,
    synced: 0,
    failedTransient: 0,
    conflicts: 0,
    sessionRevoked: false,
  };

  connectionStatus.setSyncing(true);
  try {
    for (;;) {
      const item = await claimNext(db, engineId);
      if (!item) break;
      summary.processed += 1;

      let resolvedPath: string;
      try {
        resolvedPath = resolvePath(item.path, item.dependsOn?.length ? await resolveDependencyServerId(db, item) : undefined);
      } catch (err) {
        // No debería ocurrir (claimNext ya exige dependsOn SYNCED antes de
        // entregar la fila) — si pasa, es un bug de datos, no algo
        // reintentable a ciegas: se trata como conflicto para que quede
        // visible, nunca en bucle silencioso.
        await markConflict(db, item.id, err instanceof Error ? err.message : String(err));
        summary.conflicts += 1;
        continue;
      }

      const result = await syncRequest(resolvedPath, item.payload);

      switch (result.kind) {
        case "success": {
          const body = (result.body ?? {}) as SaleServerResponse;
          await reconcileEntity(db, item, body);
          await markSynced(db, item.id, body.id ?? null);
          summary.synced += 1;
          break;
        }
        case "conflict": {
          await markConflict(db, item.id, extractMessage(result.body) ?? "Conflicto (409)");
          summary.conflicts += 1;
          break;
        }
        case "validation-error": {
          await markConflict(
            db,
            item.id,
            extractMessage(result.body) ?? "Error de validación (400)",
          );
          summary.conflicts += 1;
          break;
        }
        case "transient-error": {
          await markFailedTransient(db, item.id, result.message);
          summary.failedTransient += 1;
          break;
        }
        case "session-revoked": {
          await markFailedTransient(db, item.id, "Sesión revocada o expirada");
          summary.sessionRevoked = true;
          connectionStatus.setBlockingError(true);
          await refreshPendingCount(db);
          return summary; // dejar de procesar: nada más va a poder sincronizar
        }
      }
    }
  } finally {
    connectionStatus.setSyncing(false);
    await refreshPendingCount(db);
  }
  return summary;
}

async function resolveDependencyServerId(
  db: KipuLocalDB,
  item: SyncQueueItem,
): Promise<string | undefined> {
  // V1: a lo sumo una dependencia real por operación (confirm depende de
  // create para la MISMA venta) — se resuelve leyendo el serverId ya
  // reconciliado en la entidad local, no releyendo la fila de la cola de
  // la dependencia (que ya pudo haberse limpiado en una fase futura).
  const sale = await db.sales.get(item.entityId);
  return sale?.serverId ?? undefined;
}

function extractMessage(body: unknown): string | null {
  if (body && typeof body === "object" && "message" in body) {
    const msg = (body as { message?: unknown }).message;
    if (typeof msg === "string") return msg;
    if (Array.isArray(msg)) return msg.join(", ");
  }
  return null;
}

async function refreshPendingCount(db: KipuLocalDB): Promise<void> {
  connectionStatus.setPendingCount(await countPending(db));
}
