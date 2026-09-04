"use client";

import { useState } from "react";
import { paymentMethodLabel } from "@/lib/offline/payment-methods";
import { computeLocalSaleTotals, paymentMethodTotals } from "@/lib/offline/sale-totals";
import type { LocalSaleWithState, SaleSyncState } from "@/lib/offline/sale-sync-state";
import { Badge, Button, EmptyState, Icon, type BadgeTone } from "@/components/ui";

/**
 * Offline 4.15 / UI-5 — historial de ventas de ESTE dispositivo.
 *
 * Rediseño visual de lo que ya existía embebido en el POS, tomando de la
 * pantalla `sales_history` de Stitch la composición (fila por venta:
 * fecha/hora, detalle, monto grande a la derecha, estado como chip) pero
 * NO sus datos ni sus funciones: Stitch muestra filtros, "Export" y un
 * folio por venta; KIPU no tiene nada de eso para una venta local, así que
 * no se dibujan.
 *
 * Este componente es PRESENTACIONAL a propósito: no abre Dexie ni llama a
 * `listLocalSalesWithState` por su cuenta. La página dueña de la pantalla
 * (el POS) sigue siendo la única que consulta esa fuente de verdad y la
 * refresca — así no aparece una segunda copia del historial que pueda
 * quedar desincronizada de la primera.
 *
 * Lo que se muestra sale todo de datos reales:
 *  - fecha/hora: `LocalSale.createdAt`
 *  - total: `sale-totals.ts` (el MISMO número que imprime el ticket —
 *    servidor si ya sincronizó, cálculo local si todavía no)
 *  - métodos de pago: `LocalSale.payments` (vacío = venta a crédito, que
 *    es exactamente lo que el POS permite registrar)
 *  - estado: `sale-sync-state.ts` — sincronizada / pendiente /
 *    sincronizando / conflicto / error, con el mensaje real del backend
 */

const SYNC_BADGE: Record<SaleSyncState["kind"], { label: string; tone: BadgeTone }> = {
  synced: { label: "Sincronizada", tone: "success" },
  "offline-pending": { label: "Pendiente de sincronizar", tone: "warning" },
  syncing: { label: "Sincronizando…", tone: "info" },
  conflict: { label: "Conflicto", tone: "danger" },
  error: { label: "Error", tone: "danger" },
};

function needsAttention(state: SaleSyncState): boolean {
  return state.kind === "conflict" || state.kind === "error";
}

/** Fecha y hora legibles en el idioma del dispositivo — nunca un formato inventado ni una zona horaria forzada. */
function formatDateTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString(undefined, {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export interface LocalSalesHistoryProps {
  sales: LocalSaleWithState[];
  /** Vuelve a leer el estado de sincronización desde Dexie. */
  onRefresh: () => void;
  refreshing?: boolean;
  onTicket: (localSaleId: string) => void;
  /** Id de la venta cuyo ticket se está generando, si hay alguna (para el texto del botón). */
  ticketBusyId?: string | null;
  /** Hay alguna generación de ticket en curso —incluso de otra pantalla, como el ticket de la última venta— y no conviene lanzar otra encima. */
  ticketBusy?: boolean;
  onRetry: (localSaleId: string) => void;
  retryingId?: string | null;
}

export function LocalSalesHistory({
  sales,
  onRefresh,
  refreshing = false,
  onTicket,
  ticketBusyId = null,
  ticketBusy = false,
  onRetry,
  retryingId = null,
}: LocalSalesHistoryProps) {
  const [open, setOpen] = useState(false);
  const anyTicketBusy = ticketBusy || ticketBusyId !== null;

  const attentionCount = sales.filter((s) => needsAttention(s.state)).length;
  const pendingCount = sales.filter((s) => s.state.kind === "offline-pending").length;

  // Una venta que necesita atención humana no puede quedar escondida detrás
  // de un panel plegado: el panel se abre solo. Regla que ya existía antes
  // del rediseño, se conserva tal cual.
  const expanded = open || attentionCount > 0;

  return (
    <section className="px-4 pb-6 md:px-6">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={expanded}
        className="flex w-full items-center justify-between gap-2 rounded-xl border border-border bg-surface px-4 py-3 text-left text-sm font-medium text-text"
      >
        <span className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
          <Icon name="receipt" size={18} className="text-text-muted" />
          Ventas de este dispositivo
          {pendingCount > 0 && (
            <span className="text-xs font-normal text-amber-700">
              · {pendingCount} pendiente{pendingCount !== 1 && "s"} de sincronizar
            </span>
          )}
          {attentionCount > 0 && (
            <span className="text-xs font-normal text-red-700">
              · {attentionCount} necesita{attentionCount === 1 ? "" : "n"} atención
            </span>
          )}
        </span>
        <Icon name={expanded ? "chevron-up" : "chevron-down"} size={18} />
      </button>

      {expanded && (
        <div className="rounded-b-xl border border-t-0 border-border bg-surface">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-2">
            <p className="text-xs text-text-muted">
              Se sincronizan solas cuando vuelve Internet. Ninguna se borra por no haber
              sincronizado.
            </p>
            <Button
              size="sm"
              variant="ghost"
              icon="sync"
              onClick={onRefresh}
              disabled={refreshing}
            >
              {refreshing ? "Actualizando…" : "Actualizar estado"}
            </Button>
          </div>

          {sales.length === 0 ? (
            <EmptyState
              icon="receipt"
              title="Todavía no se registró ninguna venta desde este dispositivo"
            />
          ) : (
            <ul className="divide-y divide-border">
              {sales.map(({ sale, state }) => {
                const totals = computeLocalSaleTotals(sale);
                const methods = paymentMethodTotals(sale);
                const badge = SYNC_BADGE[state.kind];
                return (
                  <li
                    key={sale.id}
                    className="flex flex-wrap items-start justify-between gap-x-3 gap-y-2 px-4 py-3"
                  >
                    <div className="min-w-0 flex-1 space-y-1.5">
                      <p className="text-sm text-text">
                        <time dateTime={sale.createdAt}>{formatDateTime(sale.createdAt)}</time>
                        <span className="text-text-muted">
                          {" "}
                          · {sale.items.length} {sale.items.length === 1 ? "ítem" : "ítems"}
                        </span>
                      </p>
                      <div className="flex flex-wrap items-center gap-1.5">
                        {methods.length === 0 ? (
                          <span className="text-xs text-text-muted">
                            Sin pago registrado (venta a crédito)
                          </span>
                        ) : (
                          methods.map((m) => (
                            <span
                              key={m.method}
                              className="rounded-md bg-zinc-100 px-1.5 py-0.5 text-xs text-zinc-700"
                            >
                              {paymentMethodLabel(m.method)} Bs. {m.amount}
                            </span>
                          ))
                        )}
                      </div>
                      {needsAttention(state) && "message" in state && (
                        <p className="text-xs text-danger">{state.message}</p>
                      )}
                    </div>

                    <div className="flex shrink-0 flex-col items-end gap-1.5">
                      <p className="text-base font-semibold text-text">Bs. {totals.total}</p>
                      <Badge tone={badge.tone} dot>
                        {badge.label}
                      </Badge>
                      <div className="flex flex-wrap justify-end gap-1">
                        <Button
                          size="sm"
                          variant="ghost"
                          icon="printer"
                          onClick={() => onTicket(sale.id)}
                          disabled={anyTicketBusy}
                        >
                          {ticketBusyId === sale.id ? "Generando…" : "Ver ticket"}
                        </Button>
                        {needsAttention(state) && (
                          <Button
                            size="sm"
                            variant="ghost"
                            icon="sync"
                            onClick={() => onRetry(sale.id)}
                            disabled={retryingId === sale.id}
                          >
                            {retryingId === sale.id ? "Reintentando…" : "Reintentar"}
                          </Button>
                        )}
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}
    </section>
  );
}

export default LocalSalesHistory;
