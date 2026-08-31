"use client";

import { useEffect, useMemo, useState } from "react";
import AppShell from "@/components/AppShell";
import ConnectionBadge from "@/components/ConnectionBadge";
import { useAuth } from "@/lib/auth-context";
import { useLocalDb } from "@/lib/offline/react/useLocalDb";
import { runFullInitialSync, runIncrementalSync } from "@/lib/offline/catalog-sync";
import {
  addToCart,
  computeCartTotals,
  removeCartLine,
  updateCartLine,
  type CartLine,
} from "@/lib/offline/pos-cart";
import { retrySale, submitSaleOffline } from "@/lib/offline/pos-submit";
import {
  listLocalSalesWithState,
  type LocalSaleWithState,
  type SaleSyncState,
} from "@/lib/offline/sale-sync-state";
import { newIdempotencyKey } from "@/lib/offline/ids";
import type { LocalOrgContext } from "@/lib/offline/types";
import { downloadPdfBytes, presentTicketPdf } from "@/lib/offline/printing/pdf-blob";

interface ProductView {
  id: string;
  name: string;
  sku: string | null;
  price: string;
  active: boolean;
}

interface CustomerView {
  id: string;
  name: string;
  active: boolean;
}

type PaymentMethod = "CASH" | "CARD" | "TRANSFER" | "QR";

interface PaymentLine {
  method: PaymentMethod;
  amount: string;
  idempotencyKey: string;
}

type Feedback = { kind: "synced" | "offline" | "conflict" | "error"; message: string };

const FEEDBACK_STYLES: Record<Feedback["kind"], string> = {
  synced: "bg-emerald-50 text-emerald-700",
  offline: "bg-amber-50 text-amber-800",
  conflict: "bg-red-50 text-red-700",
  error: "bg-red-50 text-red-700",
};

const SYNC_BADGE: Record<SaleSyncState["kind"], { label: string; className: string }> = {
  synced: { label: "Sincronizada", className: "bg-emerald-50 text-emerald-700" },
  "offline-pending": { label: "Pendiente de sincronizar", className: "bg-amber-50 text-amber-700" },
  syncing: { label: "Sincronizando…", className: "bg-sky-50 text-sky-700" },
  conflict: { label: "Conflicto", className: "bg-red-50 text-red-700" },
  error: { label: "Error", className: "bg-red-50 text-red-700" },
};

export default function POSPage() {
  const { organization, user } = useAuth();
  const db = useLocalDb();

  const [products, setProducts] = useState<ProductView[]>([]);
  const [customers, setCustomers] = useState<CustomerView[]>([]);
  const [orgContext, setOrgContext] = useState<LocalOrgContext | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [neverSynced, setNeverSynced] = useState(false);

  const [search, setSearch] = useState("");
  const [cart, setCart] = useState<CartLine[]>([]);
  const [customerId, setCustomerId] = useState("");
  const [saleDiscount, setSaleDiscount] = useState("0");
  const [payments, setPayments] = useState<PaymentLine[]>([]);

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<Feedback | null>(null);

  const [localSales, setLocalSales] = useState<LocalSaleWithState[]>([]);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [retryingId, setRetryingId] = useState<string | null>(null);

  const [lastSaleId, setLastSaleId] = useState<string | null>(null);
  const [ticketBusy, setTicketBusy] = useState<string | null>(null);
  const [ticketError, setTicketError] = useState<string | null>(null);

  async function loadFromLocalDb() {
    if (!db) return;
    const [localProducts, localCustomers, contexts] = await Promise.all([
      db.products.toArray(),
      db.customers.toArray(),
      db.orgContext.toArray(),
    ]);
    setProducts(localProducts.filter((p) => p.active));
    setCustomers(localCustomers.filter((c) => c.active));
    setOrgContext(contexts[0] ?? null);
  }

  async function refreshHistory() {
    if (!db) return;
    setLocalSales(await listLocalSalesWithState(db));
  }

  useEffect(() => {
    if (!db || !organization || !user) return;
    let cancelled = false;

    async function bootstrap() {
      if (!db || !organization || !user) return;
      setLoadError(null);
      const [productCount, contextCount] = await Promise.all([
        db.products.count(),
        db.orgContext.count(),
      ]);
      const firstRun = productCount === 0 || contextCount === 0;

      // Primera vez que se abre el POS en este dispositivo (sin nada
      // todavía cacheado): sin catálogo no hay nada que vender, así que
      // acá SÍ hace falta esperar la descarga completa si hay conexión.
      // Si ya hay catálogo cacheado de una sesión anterior (Offline 4.3),
      // la actualización pide solo lo que cambió desde la última vez
      // (`runIncrementalSync`) en vez de volver a bajar todo — y sigue
      // siendo en segundo plano, nunca bloquea la pantalla: el POS tiene
      // que abrir rápido incluso sin red.
      if (navigator.onLine) {
        const syncInput = {
          organizationId: organization.id,
          organizationName: organization.name,
          userId: user.id,
          userName: user.name,
          roleKey: null,
        };
        const sync = (firstRun ? runFullInitialSync(db, syncInput) : runIncrementalSync(db, syncInput)).catch(
          (err) => {
            if (firstRun) {
              setLoadError(
                err instanceof Error ? err.message : "No se pudo descargar el catálogo",
              );
            }
            // Si ya había catálogo cacheado, un fallo de la actualización en
            // segundo plano no es un error visible — se sigue vendiendo con
            // lo que ya había.
          },
        );
        if (firstRun) await sync;
      }

      if (cancelled) return;
      await loadFromLocalDb();
      await refreshHistory();
      const stillNoContext = (await db.orgContext.count()) === 0;
      setNeverSynced(stillNoContext);
    }

    bootstrap();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [db, organization?.id, user?.id]);

  const filteredProducts = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return products.slice(0, 20);
    return products
      .filter((p) => p.name.toLowerCase().includes(q) || p.sku?.toLowerCase().includes(q))
      .slice(0, 20);
  }, [products, search]);

  const { subtotal, total } = computeCartTotals(cart, Number(saleDiscount) || 0);
  const paidSoFar = payments.reduce((acc, p) => acc + (Number(p.amount) || 0), 0);

  function handleAddToCart(product: ProductView) {
    setFeedback(null);
    setCart((prev) => addToCart(prev, product));
  }

  function handleUpdateLine(productId: string, patch: Partial<CartLine>) {
    setCart((prev) => updateCartLine(prev, productId, patch));
  }

  function handleRemoveLine(productId: string) {
    setCart((prev) => removeCartLine(prev, productId));
  }

  function addPaymentLine() {
    setPayments((prev) => [...prev, { method: "CASH", amount: "", idempotencyKey: newIdempotencyKey() }]);
  }

  function updatePaymentLine(index: number, patch: Partial<PaymentLine>) {
    setPayments((prev) => prev.map((p, i) => (i === index ? { ...p, ...patch } : p)));
  }

  function removePaymentLine(index: number) {
    setPayments((prev) => prev.filter((_, i) => i !== index));
  }

  function resetSale() {
    setCart([]);
    setCustomerId("");
    setSaleDiscount("0");
    setPayments([]);
    setError(null);
  }

  async function confirmSale() {
    if (!db || !organization) return;
    if (!orgContext) {
      setError(
        "Todavía no se descargó la configuración de tu sucursal — conectate a internet una vez para la primera sincronización.",
      );
      return;
    }
    if (cart.length === 0) {
      setError("El carrito está vacío");
      return;
    }
    setSubmitting(true);
    setError(null);
    setFeedback(null);
    setTicketError(null);
    try {
      const validPayments = payments.filter((p) => Number(p.amount) > 0);
      const result = await submitSaleOffline(db, {
        organizationId: organization.id,
        posTerminalId: orgContext.posTerminalId,
        warehouseId: orgContext.warehouseId,
        customerId: customerId || null,
        discount: Number(saleDiscount) || 0,
        items: cart.map((l) => ({
          productId: l.productId,
          quantity: l.quantity,
          unitPrice: l.unitPrice,
          discount: l.discount,
        })),
        payments: validPayments.map((p) => ({
          method: p.method,
          amount: Number(p.amount),
          idempotencyKey: p.idempotencyKey,
        })),
      });

      if (result.outcome === "synced" && result.summary) {
        const balance = Number(result.summary.balance);
        setFeedback({
          kind: "synced",
          message:
            `Venta confirmada (${result.summary.status}). Total Bs. ${Number(result.summary.total).toFixed(2)}` +
            (balance > 0 ? ` — saldo pendiente Bs. ${balance.toFixed(2)}` : ""),
        });
      } else if (result.outcome === "offline-pending") {
        setFeedback({
          kind: "offline",
          message: "Venta guardada sin conexión. Se sincronizará automáticamente cuando vuelva Internet.",
        });
      } else {
        setFeedback({
          kind: result.outcome,
          message: result.message ?? "No se pudo completar la venta.",
        });
      }
      setLastSaleId(result.localSaleId);
      resetSale();
      await refreshHistory();
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo registrar la venta");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleRetry(localSaleId: string) {
    if (!db || !organization) return;
    setRetryingId(localSaleId);
    try {
      await retrySale(db, organization.id, localSaleId);
      await refreshHistory();
    } finally {
      setRetryingId(null);
    }
  }

  /**
   * Genera el PDF térmico 100% offline (Offline 4.6B) y lo abre o lo
   * descarga — nunca depende del backend ni de que la venta ya haya
   * sincronizado. Un fallo acá (ej. datos corruptos, cuota de memoria)
   * nunca debe verse como un error técnico crudo — mensaje comprensible,
   * y la venta en sí queda intacta (la impresión es una operación
   * separada del commit comercial, ver docs/architecture.md).
   *
   * `pdf-lib` (~180KB gzip, medido en el build de producción) se importa
   * DINÁMICAMENTE acá adentro, no arriba del archivo — el POS tiene que
   * abrir rápido incluso sin red (prioridad ya establecida desde Offline
   * 3), y la enorme mayoría de aperturas del POS nunca llegan a generar
   * un ticket. `import()` sigue funcionando sin conexión: una vez que el
   * navegador cacheó el chunk (visita anterior, o el Service Worker que
   * llegue a futuro), no hace falta red para resolverlo.
   */
  async function handleTicket(localSaleId: string, action: "view" | "download") {
    if (!db || !orgContext) return;
    setTicketBusy(`${action}-${localSaleId}`);
    setTicketError(null);
    try {
      const [{ buildTicketFromLocalSale }, { renderThermalPdf }] = await Promise.all([
        import("@/lib/offline/printing/build-ticket"),
        import("@/lib/offline/printing/thermal-pdf-renderer"),
      ]);
      const ticket = await buildTicketFromLocalSale(db, orgContext, localSaleId);
      const bytes = await renderThermalPdf(ticket);
      const filename = `ticket-${localSaleId}.pdf`;
      if (action === "view") {
        // Offline 4.14.4: en Android abre la hoja del sistema (visor/
        // Imprimir/guardar); en escritorio, la pestaña de siempre. Ver
        // `pdf-blob.ts` para por qué no basta con `window.open`.
        await presentTicketPdf(bytes, filename);
      } else {
        downloadPdfBytes(bytes, filename);
      }
    } catch {
      setTicketError("No se pudo generar el ticket. Podés reintentar en un momento.");
    } finally {
      setTicketBusy(null);
    }
  }

  const attentionCount = localSales.filter(
    (s) => s.state.kind === "conflict" || s.state.kind === "error",
  ).length;
  const pendingCount = localSales.filter((s) => s.state.kind === "offline-pending").length;

  return (
    <AppShell>
      <div className="p-4 md:p-6 grid grid-cols-1 md:grid-cols-3 gap-4 md:gap-6">
        {/* 1) Búsqueda + 2) productos — primero en el orden del documento, así en celular aparecen arriba de todo. */}
        <div className="md:col-span-2 space-y-3">
          <div className="flex items-center justify-between gap-2">
            <h1 className="text-lg font-semibold">Punto de venta</h1>
            <ConnectionBadge />
          </div>
          {loadError && <p className="text-sm text-red-600 bg-red-50 rounded p-2">{loadError}</p>}
          {neverSynced && !loadError && (
            <p className="text-sm text-amber-800 bg-amber-50 rounded p-2">
              Necesitás conexión a internet una primera vez para descargar tu catálogo de
              productos y poder vender desde este dispositivo.
            </p>
          )}

          <label htmlFor="pos-search" className="sr-only">
            Buscar producto por nombre o SKU
          </label>
          <input
            id="pos-search"
            placeholder="Buscar producto por nombre o SKU..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full rounded border border-zinc-300 px-3 py-2.5 text-sm"
          />

          <div className="bg-white rounded-lg border border-zinc-200 divide-y divide-zinc-100 max-h-[50vh] md:max-h-[420px] overflow-y-auto">
            {filteredProducts.map((p) => (
              <button
                key={p.id}
                onClick={() => handleAddToCart(p)}
                className="w-full flex justify-between items-center gap-3 px-4 py-3 text-sm hover:bg-zinc-50 active:bg-zinc-100 text-left min-h-[44px]"
              >
                <span>
                  {p.name} {p.sku && <span className="text-zinc-400">({p.sku})</span>}
                </span>
                <span className="text-zinc-600 shrink-0">Bs. {Number(p.price).toFixed(2)}</span>
              </button>
            ))}
            {filteredProducts.length === 0 && (
              <p className="px-4 py-6 text-center text-zinc-400 text-sm">
                {products.length === 0 ? "Sin productos cacheados todavía" : "Sin resultados"}
              </p>
            )}
          </div>
        </div>

        {/* 3) Carrito + 4) total + 5) método de pago + 6) confirmar. */}
        <div className="space-y-4">
          <div className="bg-white rounded-lg border border-zinc-200 p-4 space-y-3">
            <h2 className="font-medium text-sm">Carrito</h2>
            {error && <p className="text-sm text-red-600 bg-red-50 rounded p-2">{error}</p>}
            {feedback && (
              <div className={`text-sm rounded p-2 ${FEEDBACK_STYLES[feedback.kind]}`}>
                <p>{feedback.message}</p>
                {lastSaleId && (feedback.kind === "synced" || feedback.kind === "offline") && (
                  <div className="mt-2 flex flex-wrap gap-2">
                    <button
                      onClick={() => handleTicket(lastSaleId, "view")}
                      disabled={ticketBusy !== null}
                      className="text-xs rounded border border-current px-2 py-1 disabled:opacity-50"
                    >
                      {ticketBusy === `view-${lastSaleId}` ? "Generando..." : "Ver / Imprimir ticket"}
                    </button>
                    <button
                      onClick={() => handleTicket(lastSaleId, "download")}
                      disabled={ticketBusy !== null}
                      className="text-xs rounded border border-current px-2 py-1 disabled:opacity-50"
                    >
                      {ticketBusy === `download-${lastSaleId}` ? "Descargando..." : "Descargar ticket"}
                    </button>
                  </div>
                )}
              </div>
            )}
            {ticketError && <p className="text-sm text-red-600 bg-red-50 rounded p-2">{ticketError}</p>}

            {cart.length === 0 && <p className="text-sm text-zinc-400">Agregá productos desde la lista</p>}
            {cart.map((line) => (
              <div key={line.productId} className="border-b border-zinc-100 pb-3 text-sm space-y-1.5">
                <div className="flex justify-between items-start gap-2">
                  <span>{line.name}</span>
                  <button
                    onClick={() => handleRemoveLine(line.productId)}
                    className="text-red-600 text-xs underline shrink-0 py-1"
                  >
                    Quitar
                  </button>
                </div>
                <div className="flex flex-wrap gap-2 items-center text-xs">
                  <span className="flex items-center gap-1">
                    <span className="text-zinc-500">Cant.</span>
                    <input
                      aria-label={`Cantidad de ${line.name}`}
                      type="number"
                      min={0.01}
                      step="0.01"
                      value={line.quantity}
                      onChange={(e) => handleUpdateLine(line.productId, { quantity: Number(e.target.value) })}
                      className="w-16 rounded border border-zinc-300 px-2 py-1.5"
                    />
                  </span>
                  <span className="flex items-center gap-1">
                    <span className="text-zinc-500">Precio</span>
                    <input
                      aria-label={`Precio de ${line.name}`}
                      type="number"
                      min={0}
                      step="0.01"
                      value={line.unitPrice}
                      onChange={(e) => handleUpdateLine(line.productId, { unitPrice: Number(e.target.value) })}
                      className="w-20 rounded border border-zinc-300 px-2 py-1.5"
                    />
                  </span>
                  <span className="flex items-center gap-1">
                    <span className="text-zinc-500">Desc.</span>
                    <input
                      aria-label={`Descuento de ${line.name}`}
                      type="number"
                      min={0}
                      step="0.01"
                      value={line.discount}
                      onChange={(e) => handleUpdateLine(line.productId, { discount: Number(e.target.value) })}
                      className="w-16 rounded border border-zinc-300 px-2 py-1.5"
                    />
                  </span>
                </div>
                <div className="text-right text-zinc-500">
                  Subtotal: Bs. {(line.quantity * line.unitPrice - line.discount).toFixed(2)}
                </div>
              </div>
            ))}

            <label htmlFor="pos-customer" className="sr-only">
              Cliente
            </label>
            <select
              id="pos-customer"
              value={customerId}
              onChange={(e) => setCustomerId(e.target.value)}
              className="w-full rounded border border-zinc-300 px-2 py-2 text-sm"
            >
              <option value="">Cliente ocasional</option>
              {customers.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>

            <div className="flex justify-between items-center text-sm">
              <label htmlFor="pos-sale-discount">Descuento venta</label>
              <input
                id="pos-sale-discount"
                type="number"
                min={0}
                step="0.01"
                value={saleDiscount}
                onChange={(e) => setSaleDiscount(e.target.value)}
                className="w-24 rounded border border-zinc-300 px-2 py-1.5"
              />
            </div>

            {/* El total es lo más visible de toda la pantalla — nunca compite en tamaño con nada más. */}
            <div className="flex justify-between items-baseline border-t border-zinc-200 pt-3">
              <span className="text-sm font-medium text-zinc-600">Total</span>
              <span className="text-2xl font-semibold tabular-nums">Bs. {total.toFixed(2)}</span>
            </div>
            {subtotal !== total && (
              <p className="text-xs text-zinc-400 text-right -mt-2">Subtotal Bs. {subtotal.toFixed(2)}</p>
            )}
          </div>

          <div className="bg-white rounded-lg border border-zinc-200 p-4 space-y-2">
            <div className="flex justify-between items-center">
              <h2 className="font-medium text-sm">Pago (opcional — vacío = venta a crédito)</h2>
              <button onClick={addPaymentLine} className="text-xs text-zinc-600 underline py-1">
                + método
              </button>
            </div>
            {payments.map((p, i) => (
              <div key={i} className="flex gap-2 items-center text-xs">
                <label className="sr-only" htmlFor={`pos-payment-method-${i}`}>
                  Método de pago
                </label>
                <select
                  id={`pos-payment-method-${i}`}
                  value={p.method}
                  onChange={(e) => updatePaymentLine(i, { method: e.target.value as PaymentMethod })}
                  className="rounded border border-zinc-300 px-2 py-1.5"
                >
                  <option value="CASH">Efectivo</option>
                  <option value="CARD">Tarjeta</option>
                  <option value="TRANSFER">Transferencia</option>
                  <option value="QR">QR</option>
                </select>
                <label className="sr-only" htmlFor={`pos-payment-amount-${i}`}>
                  Monto
                </label>
                <input
                  id={`pos-payment-amount-${i}`}
                  type="number"
                  min={0}
                  step="0.01"
                  placeholder="Monto"
                  value={p.amount}
                  onChange={(e) => updatePaymentLine(i, { amount: e.target.value })}
                  className="w-24 rounded border border-zinc-300 px-2 py-1.5"
                />
                <button onClick={() => removePaymentLine(i)} className="text-red-600 underline py-1.5">
                  Quitar
                </button>
              </div>
            ))}
            {payments.length > 0 && (
              <p className="text-xs text-zinc-500 text-right">
                Pagado: Bs. {paidSoFar.toFixed(2)} de Bs. {total.toFixed(2)}
              </p>
            )}
          </div>

          <div className="flex gap-2">
            <button
              onClick={confirmSale}
              disabled={submitting || cart.length === 0}
              className="flex-1 bg-zinc-900 text-white rounded px-3 py-3.5 text-sm font-medium disabled:opacity-50 min-h-[44px]"
            >
              {submitting ? "Confirmando..." : "Confirmar venta"}
            </button>
            <button
              onClick={resetSale}
              className="rounded border border-zinc-300 px-3 py-3.5 text-sm min-h-[44px]"
            >
              Limpiar
            </button>
          </div>
        </div>

        {/* Ventas creadas en ESTE dispositivo — sincronizadas o no. Nunca se borra una venta local porque no pudo sincronizar. */}
        <div className="md:col-span-3">
          <button
            onClick={() => setHistoryOpen((v) => !v)}
            className="w-full flex items-center justify-between bg-white rounded-lg border border-zinc-200 px-4 py-3 text-sm font-medium"
          >
            <span>
              Ventas de este dispositivo
              {pendingCount > 0 && (
                <span className="ml-2 text-xs font-normal text-amber-700">
                  · {pendingCount} pendiente{pendingCount !== 1 && "s"} de sincronizar
                </span>
              )}
              {attentionCount > 0 && (
                <span className="ml-2 text-xs font-normal text-red-700">
                  · {attentionCount} necesita{attentionCount === 1 ? "" : "n"} atención
                </span>
              )}
            </span>
            <span aria-hidden="true">{historyOpen ? "▲" : "▼"}</span>
          </button>
          {(historyOpen || attentionCount > 0) && (
            <div className="bg-white rounded-lg border border-zinc-200 border-t-0 rounded-t-none divide-y divide-zinc-100">
              {localSales.length === 0 && (
                <p className="px-4 py-6 text-center text-zinc-400 text-sm">
                  Todavía no se registró ninguna venta desde este dispositivo
                </p>
              )}
              {localSales.map(({ sale, state }) => (
                <div key={sale.id} className="px-4 py-3 flex items-center justify-between gap-3 text-sm">
                  <div>
                    <p>
                      {new Date(sale.createdAt).toLocaleString()} — {sale.items.length}{" "}
                      {sale.items.length === 1 ? "ítem" : "ítems"}
                    </p>
                    {(state.kind === "conflict" || state.kind === "error") && (
                      <p className="text-xs text-red-600 mt-0.5">{state.message}</p>
                    )}
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <span className={`rounded px-2 py-0.5 text-xs ${SYNC_BADGE[state.kind].className}`}>
                      {SYNC_BADGE[state.kind].label}
                    </span>
                    <button
                      onClick={() => handleTicket(sale.id, "view")}
                      disabled={ticketBusy !== null}
                      className="text-xs underline text-zinc-600 disabled:opacity-50"
                    >
                      {ticketBusy === `view-${sale.id}` ? "Generando…" : "Ver ticket"}
                    </button>
                    {(state.kind === "conflict" || state.kind === "error") && (
                      <button
                        onClick={() => handleRetry(sale.id)}
                        disabled={retryingId === sale.id}
                        className="text-xs underline text-zinc-600 disabled:opacity-50"
                      >
                        {retryingId === sale.id ? "Reintentando…" : "Reintentar"}
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </AppShell>
  );
}
