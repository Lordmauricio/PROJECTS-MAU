import { getLocalDb } from "./db";
import { listByStatus } from "./sync-queue";

export interface PendingSyncSummary {
  organizationId: string;
  pendingCount: number;
  conflictCount: number;
}

/**
 * Cuánto queda sin sincronizar para una organización — pensado para que
 * una futura pantalla de logout pueda avisar ("tenés 3 operaciones sin
 * sincronizar, ¿seguro que querés salir?") ANTES de que el usuario cierre
 * sesión. Esta fase construye el primitivo, no la pantalla — ver
 * `docs/architecture.md` sección 18, "qué queda para Offline 3".
 *
 * Deliberadamente de solo lectura: no borra nada, no bloquea nada. El
 * logout actual (`auth-context.tsx#logout`) ya es seguro por construcción
 * hoy — no toca IndexedDB en absoluto, así que ninguna operación pendiente
 * se pierde al cerrar sesión, con o sin este módulo.
 */
export async function getPendingSyncSummary(
  organizationId: string,
): Promise<PendingSyncSummary> {
  const db = getLocalDb(organizationId);
  const [pending, syncing, failed, conflicts] = await Promise.all([
    listByStatus(db, "PENDING"),
    listByStatus(db, "SYNCING"),
    listByStatus(db, "FAILED"),
    listByStatus(db, "CONFLICT"),
  ]);
  return {
    organizationId,
    pendingCount: pending.length + syncing.length + failed.length,
    conflictCount: conflicts.length,
  };
}

/**
 * Cambiar de organización NO requiere ninguna operación de "migración" o
 * "limpieza" en esta capa: cada organización ya vive en su propia base
 * IndexedDB física (`getLocalDb(organizationId)`, ver `db.ts`), así que
 * pedir la base de OTRA organización simplemente abre/devuelve una
 * instancia completamente separada — nunca hay datos de la organización
 * anterior visibles ni mezclados. Esta función existe únicamente para
 * dejar explícito, en un solo lugar, que "cambiar de organización" en la
 * capa offline es tan simple como esto — no hay ningún estado global
 * mutable que reapuntar.
 */
export function isolatedLocalDbFor(organizationId: string) {
  return getLocalDb(organizationId);
}
