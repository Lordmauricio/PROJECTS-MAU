"use client";

import { useSyncExternalStore } from "react";
import { connectionStatus } from "../connection-status";
import type { ConnectionState } from "../types";

/**
 * Única forma en que un componente debe leer el estado de conexión/sync —
 * nunca `navigator.onLine` directo, nunca un `useState` propio. Usa
 * `useSyncExternalStore` (la forma recomendada por React para suscribirse
 * a un store externo sin duplicar su estado) sobre el singleton de
 * `connection-status.ts`, que ya es agnóstico de React.
 */
export function useConnectionStatus(): ConnectionState {
  return useSyncExternalStore(
    (onStoreChange) => connectionStatus.onChange(onStoreChange),
    () => connectionStatus.getState(),
    () => "ONLINE", // snapshot del servidor (SSR/prerender): nunca se renderiza offline por defecto
  );
}
