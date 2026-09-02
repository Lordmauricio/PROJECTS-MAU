"use client";

import { useEffect, useState } from "react";
import { useConnectionStatus } from "@/lib/offline/react/useConnectionStatus";
import { useLocalDb } from "@/lib/offline/react/useLocalDb";
import { countPending } from "@/lib/offline/sync-queue";
import type { ConnectionState } from "@/lib/offline/types";

// Cada estado tiene un SÍMBOLO propio además del color — instrucción
// explícita del pedido ("no depender únicamente del color"): alguien con
// dificultad para distinguir colores, o mirando la pantalla con poca luz,
// igual puede diferenciar un círculo lleno de un triángulo o una X.
//
// Offline 4.15 (rediseño Stitch): los colores pasan a los tokens de marca
// (`bg-success-soft`/`bg-warning-soft`/etc., definidos en `globals.css`) en
// vez de clases `emerald-*`/`amber-*`/`sky-*` sueltas — es el mismo mapeo de
// tono que usa `Badge` (`components/ui/Badge.tsx`), para que este indicador
// y cualquier otra insignia de sincronización se vean como el MISMO sistema
// en vez de dos paletas de verde/ámbar/rojo ligeramente distintas
// conviviendo en la misma pantalla. Los símbolos y los estados en sí no
// cambian — sigue siendo la misma fuente (`useConnectionStatus`).
const STYLES: Record<ConnectionState, { symbol: string; label: string; className: string }> = {
  ONLINE: { symbol: "●", label: "En línea", className: "bg-success-soft text-green-800" },
  OFFLINE: { symbol: "▲", label: "Sin conexión", className: "bg-warning-soft text-amber-800" },
  SYNCING: { symbol: "↻", label: "Sincronizando…", className: "bg-info-soft text-sky-800" },
  PENDING: { symbol: "●", label: "pendientes", className: "bg-warning-soft text-amber-800" },
  ERROR: { symbol: "✕", label: "Error de sincronización", className: "bg-danger-soft text-red-800" },
};

/**
 * Indicador central de conexión/sincronización — la MISMA fuente
 * (`useConnectionStatus`) en cualquier pantalla que lo use, nunca un
 * cálculo propio. Se usa tanto en `AppShell` (siempre visible, compacto)
 * como en el POS (más prominente, junto a la acción de vender).
 */
export default function ConnectionBadge({ compact = false }: { compact?: boolean }) {
  const state = useConnectionStatus();
  const db = useLocalDb();
  const [pendingCount, setPendingCount] = useState(0);

  useEffect(() => {
    if (!db) return;
    let cancelled = false;
    countPending(db).then((n) => {
      if (!cancelled) setPendingCount(n);
    });
    return () => {
      cancelled = true;
    };
    // Se recalcula cada vez que cambia el estado (un pase de sync recién
    // terminado es el momento típico en que el conteo cambió).
  }, [db, state]);

  const style = STYLES[state];
  const label =
    state === "PENDING"
      ? `${pendingCount} ${pendingCount === 1 ? "operación pendiente" : "operaciones pendientes"}`
      : style.label;

  return (
    <span
      role="status"
      aria-live="polite"
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ${style.className}`}
    >
      <span aria-hidden="true">{style.symbol}</span>
      {!compact && <span>{label}</span>}
      {compact && <span className="sr-only">{label}</span>}
    </span>
  );
}
