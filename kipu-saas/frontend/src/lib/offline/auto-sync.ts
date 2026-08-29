import type { KipuLocalDB } from "./db";
import { runSyncOnce, type SyncRunSummary } from "./sync-engine";
import { resetBackoff } from "./sync-queue";

// Organizaciones cuyo Sync Engine está corriendo AHORA MISMO en esta
// pestaña — evita disparos redundantes desde varios triggers superpuestos
// (el evento `online`, el intervalo de respaldo, y un `useEffect` de
// montaje pueden coincidir). La protección real contra dos Sync Engines de
// DOS PESTAÑAS (o dos dispositivos) distintas ya la da el lock de
// `sync-queue.ts#claimNext` (transacciones de IndexedDB serializadas por
// el navegador) — esto es una capa adicional, barata, para no hacer
// trabajo redundante dentro del mismo tab.
const runningFor = new Set<string>();

// Organizaciones cuya sesión el último intento de sincronización encontró
// revocada/expirada sin poder renovarse. Mientras estén acá, `triggerSync`
// no vuelve a intentar autenticarse solo — instrucción explícita del
// pedido ("no continuar intentando autenticarse indefinidamente"). Se
// limpia con `clearSessionRevoked` cuando el usuario vuelve a loguearse
// (ver `useAutoSync`, que la llama al detectar un access token nuevo).
const sessionRevokedFor = new Set<string>();

/**
 * Dispara un pase del Sync Engine para una organización si no hay uno ya
 * corriendo en esta pestaña, y si la última sincronización no descubrió
 * que la sesión está revocada. Nunca lanza — cualquier error de red real
 * ya lo captura `runSyncOnce`/`syncRequest` y lo deja reflejado en la
 * cola, no como una excepción hacia el llamador.
 */
export async function triggerSync(
  db: KipuLocalDB,
  organizationId: string,
  opts: { force?: boolean } = {},
): Promise<SyncRunSummary | null> {
  if (runningFor.has(organizationId)) return null;
  if (sessionRevokedFor.has(organizationId)) return null;
  runningFor.add(organizationId);
  try {
    // `force` (ej. venimos de un evento `online` real) ignora el backoff
    // pendiente de intentos previos — ver `sync-queue.ts#resetBackoff`.
    if (opts.force) await resetBackoff(db);
    const summary = await runSyncOnce(db);
    if (summary.sessionRevoked) {
      sessionRevokedFor.add(organizationId);
    }
    return summary;
  } finally {
    runningFor.delete(organizationId);
  }
}

export function isSessionRevoked(organizationId: string): boolean {
  return sessionRevokedFor.has(organizationId);
}

/** Se llama al detectar una sesión nueva (login/refresh manual) — le da al Sync Engine otra oportunidad de autenticarse. */
export function clearSessionRevoked(organizationId: string): void {
  sessionRevokedFor.delete(organizationId);
}

/** Solo para tests. */
export function resetAutoSyncGuard(): void {
  runningFor.clear();
  sessionRevokedFor.clear();
}
