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
const STYLES: Record<ConnectionState, { symbol: string; label: string; className: string }> = {
  ONLINE: { symbol: "●", label: "En línea", className: "bg-emerald-50 text-emerald-700" },
  OFFLINE: { symbol: "▲", label: "Sin conexión", className: "bg-amber-50 text-amber-700" },
  SYNCING: { symbol: "↻", label: "Sincronizando…", className: "bg-sky-50 text-sky-700" },
  PENDING: { symbol: "●", label: "pendientes", className: "bg-amber-50 text-amber-700" },
  ERROR: { symbol: "✕", label: "Error de sincronización", className: "bg-red-50 text-red-700" },
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
