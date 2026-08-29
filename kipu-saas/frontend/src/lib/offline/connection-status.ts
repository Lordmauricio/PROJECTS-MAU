import type { ConnectionState } from "./types";

/**
 * Única fuente de verdad del estado de conexión/sincronización — nada más
 * en la app debe leer `navigator.onLine` directamente ni mantener su propia
 * variable de "¿hay red?". Agnóstico de React a propósito: una futura
 * pantalla puede suscribirse (`onChange`) sin que esta capa dependa de
 * ningún framework de UI.
 *
 * Reglas de derivación (`recompute`):
 * - `navigator.onLine === false` → OFFLINE, siempre gana sobre cualquier
 *   otra señal (es la más barata de confiar cuando dice que no hay red).
 * - Un Sync Engine procesando activamente → SYNCING.
 * - Hay operaciones pendientes en la cola pero el engine no está corriendo
 *   ahora mismo (esperando reconexión o backoff) → PENDING.
 * - El último intento de sync terminó en un error que necesita atención
 *   humana (CONFLICT o un FAILED ya sin reintentos automáticos) → ERROR.
 * - Si nada de lo anterior aplica y hay señal de red → ONLINE.
 */
class ConnectionStatusStore {
  private state: ConnectionState = "ONLINE";
  private syncing = false;
  private pendingCount = 0;
  private hasBlockingError = false;
  private listeners = new Set<(state: ConnectionState) => void>();

  constructor() {
    if (typeof window !== "undefined") {
      window.addEventListener("online", () => this.recompute());
      window.addEventListener("offline", () => this.recompute());
    }
    this.recompute();
  }

  private isBrowserOnline(): boolean {
    if (typeof navigator === "undefined") return true;
    return navigator.onLine;
  }

  private recompute(): void {
    let next: ConnectionState;
    if (!this.isBrowserOnline()) {
      next = "OFFLINE";
    } else if (this.syncing) {
      next = "SYNCING";
    } else if (this.hasBlockingError) {
      next = "ERROR";
    } else if (this.pendingCount > 0) {
      next = "PENDING";
    } else {
      next = "ONLINE";
    }
    if (next !== this.state) {
      this.state = next;
      for (const listener of this.listeners) listener(this.state);
    }
  }

  getState(): ConnectionState {
    return this.state;
  }

  setSyncing(syncing: boolean): void {
    this.syncing = syncing;
    this.recompute();
  }

  setPendingCount(count: number): void {
    this.pendingCount = count;
    this.recompute();
  }

  setBlockingError(hasError: boolean): void {
    this.hasBlockingError = hasError;
    this.recompute();
  }

  onChange(listener: (state: ConnectionState) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
}

export const connectionStatus = new ConnectionStatusStore();
