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
import { Badge, Button, Icon, IconButton, Sheet, EmptyState, ErrorState, type BadgeTone } from "@/components/ui";

/**
 * Offline 4.15 (rediseño Stitch) — ¿el viewport actual es de escritorio?
 *
 * Decide entre DOS layouts mutuamente excluyentes del carrito: panel
 * persistente en escritorio (`aside`) vs. barra flotante + bottom sheet en
 * móvil (`kipu_pos_m_vil_android`, la referencia visual de esta fase). Es
 * una decisión real de qué renderizar, no solo CSS (`hidden md:flex`
 * dejaría las DOS copias montadas en el DOM a la vez — mismos
 * aria-label/htmlFor duplicados, rompe `getByLabelText` en los tests Y la
 * accesibilidad real). Por eso se resuelve con `matchMedia`, con guarda
 * explícita: este entorno de test (jsdom) no lo implementa, así que el
 * valor por defecto (`false`, layout móvil) es exactamente el que ya
 * esperaban los 25 tests existentes de esta pantalla.
 */
function useIsDesktopViewport(breakpointPx = 768): boolean {
  // El valor inicial se lee en el inicializador perezoso de `useState`
  // (parte del render, no del efecto) — el efecto de abajo SOLO se suscribe
  // al evento `change` y llama a `setIsDesktop` desde ese callback, nunca de
  // forma síncrona en el cuerpo del efecto (evita
  // `react-hooks/set-state-in-effect`, que si se dispara acá SÍ es un error
  // nuevo de esta fase, no uno de los preexistentes).
  const [isDesktop, setIsDesktop] = useState(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return false;
    return window.matchMedia(`(min-width: ${breakpointPx}px)`).matches;
  });
  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return;
    const mq = window.matchMedia(`(min-width: ${breakpointPx}px)`);
    const handler = (e: MediaQueryListEvent) => setIsDesktop(e.matches);
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, [breakpointPx]);
  return isDesktop;
}

/** Iniciales para el placeholder del producto — Offline 4.15 decidió explícitamente NO mostrar fotos (sin sistema de imágenes real detrás). */
function productInitials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return "?";
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return (words[0][0] + words[1][0]).toUpperCase();
}

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
  synced: "bg-success-soft text-green-800",
  offline: "bg-warning-soft text-amber-800",
  conflict: "bg-danger-soft text-red-800",
  error: "bg-danger-soft text-red-800",
};

const SYNC_BADGE: Record<SaleSyncState["kind"], { label: string; tone: BadgeTone }> = {
  synced: { label: "Sincronizada", tone: "success" },
  "offline-pending": { label: "Pendiente de sincronizar", tone: "warning" },
  syncing: { label: "Sincronizando…", tone: "info" },
  conflict: { label: "Conflicto", tone: "danger" },
  error: { label: "Error", tone: "danger" },
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

  // Offline 4.15 — puramente visual: en escritorio el carrito es un panel
  // siempre visible (no usa este estado); en móvil vive en un bottom sheet
  // que arranca cerrado y se abre solo al agregar el primer producto.
  const [cartSheetOpen, setCartSheetOpen] = useState(false);
  const isDesktop = useIsDesktopViewport();

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
    setCartSheetOpen(true);
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
      <div className="flex h-full flex-col md:flex-row md:gap-6 md:p-6">
        {/* Columna principal: encabezado + buscador + grid de productos. */}
        <div className="flex min-w-0 flex-1 flex-col">
          <div className="flex items-center justify-between gap-2 px-4 py-3 md:px-0 md:py-0 md:pb-4">
            <h1 className="text-lg font-semibold text-text">Punto de venta</h1>
            <ConnectionBadge />
          </div>

          <div className="space-y-2 px-4 md:px-0">
            {loadError && <ErrorState message={loadError} />}
            {neverSynced && !loadError && (
              <div className="rounded-lg bg-warning-soft px-3 py-2.5 text-sm text-amber-800">
                Necesitás conexión a internet una primera vez para descargar tu catálogo de
                productos y poder vender desde este dispositivo.
              </div>
            )}
          </div>

          <div className="px-4 pt-3 md:px-0">
            <label htmlFor="pos-search" className="sr-only">
              Buscar producto por nombre o SKU
            </label>
            <div className="relative">
              <span className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-text-muted">
                <Icon name="search" size={18} />
              </span>
              <input
                id="pos-search"
                placeholder="Buscar producto por nombre o SKU..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="h-11 w-full rounded-lg border border-border bg-white pl-10 pr-3 text-sm text-text placeholder:text-text-muted focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary-soft"
              />
            </div>
          </div>

          {/*
            Offline 4.15 — deliberadamente SIN chips de categoría: Stitch las
            muestra, pero `LocalProduct` (Dexie) no trae categoría —
            `catalog-sync.ts` no la sincroniza todavía, solo vive en el
            backend. Un filtro que no filtra nada real sería peor que no
            tenerlo. Queda documentado en el informe de esta fase, no
            inventado acá.
          */}

          <div className="flex-1 overflow-y-auto px-4 py-3 pb-28 md:px-0 md:pb-3">
            {filteredProducts.length === 0 ? (
              <EmptyState
                icon="box"
                title={products.length === 0 ? "Sin productos cacheados todavía" : "Sin resultados"}
              />
            ) : (
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5">
                {filteredProducts.map((p) => {
                  const inCart = cart.find((l) => l.productId === p.id);
                  return (
                    <button
                      key={p.id}
                      onClick={() => handleAddToCart(p)}
                      className="relative flex min-h-[44px] flex-col items-start gap-2 rounded-xl border border-border bg-surface p-3 text-left transition-colors hover:border-primary hover:bg-page active:scale-[0.98]"
                    >
                      {inCart && (
                        <span
                          aria-hidden="true"
                          className="absolute right-2 top-2 flex h-5 min-w-5 items-center justify-center rounded-full bg-primary px-1 text-xs font-semibold text-white"
                        >
                          {inCart.quantity}
                        </span>
                      )}
                      {/* Placeholder sin foto (decisión ya tomada): iniciales del producto sobre un cuadro de color de marca. */}
                      <span
                        aria-hidden="true"
                        className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary-soft text-sm font-semibold text-green-800"
                      >
                        {productInitials(p.name)}
                      </span>
                      <span className="line-clamp-2 text-sm font-medium text-text">{p.name}</span>
                      {p.sku && <span className="text-xs text-text-muted">{p.sku}</span>}
                      <span className="text-sm font-semibold text-primary">
                        Bs. {Number(p.price).toFixed(2)}
                      </span>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        {/* Escritorio: panel de carrito siempre visible. Nunca coexiste en el DOM con el bottom sheet móvil (ver useIsDesktopViewport). */}
        {isDesktop && (
          <aside className="flex w-[380px] shrink-0 flex-col overflow-hidden rounded-xl border border-border bg-surface">
            <div className="flex items-center gap-2 border-b border-border px-4 py-3">
              <Icon name="cart" size={18} className="text-text-muted" />
              <h2 className="text-sm font-semibold text-text">
                Carrito{cart.length > 0 && ` (${cart.length})`}
              </h2>
            </div>
            <div className="flex-1 overflow-y-auto px-4 py-3">{renderCartFields()}</div>
          </aside>
        )}
      </div>

      {/* Móvil: barra flotante + bottom sheet. Ver useIsDesktopViewport — nunca montado junto con el <aside> de arriba. */}
      {!isDesktop && (
        <>
          <div className="fixed inset-x-0 bottom-0 z-30 border-t border-border bg-surface p-3 md:hidden">
            <button
              onClick={() => setCartSheetOpen(true)}
              className="flex min-h-[44px] w-full items-center justify-between rounded-xl bg-primary px-4 py-3.5 text-white"
            >
              <span className="flex items-center gap-2 font-medium">
                <Icon name="cart" />
                {cart.length > 0 && (
                  <span
                    aria-hidden="true"
                    className="flex h-5 min-w-5 items-center justify-center rounded-full bg-white/25 px-1 text-xs font-semibold"
                  >
                    {cart.length}
                  </span>
                )}
                Ver carrito
              </span>
              <span className="font-semibold tabular-nums">Bs. {total.toFixed(2)}</span>
            </button>
          </div>

          <Sheet
            variant="sheet"
            open={cartSheetOpen}
            onClose={() => setCartSheetOpen(false)}
            title={cart.length > 0 ? `Carrito (${cart.length})` : "Carrito"}
          >
            {renderCartFields()}
          </Sheet>
        </>
      )}

      {/* Ventas creadas en ESTE dispositivo — sincronizadas o no. Nunca se borra una venta local porque no pudo sincronizar. */}
      <div className="px-4 pb-6 md:px-6">
        <button
          onClick={() => setHistoryOpen((v) => !v)}
          className="flex w-full items-center justify-between rounded-xl border border-border bg-surface px-4 py-3 text-sm font-medium text-text"
        >
          <span className="flex items-center gap-2">
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
          <Icon name={historyOpen ? "chevron-up" : "chevron-down"} size={18} />
        </button>
        {(historyOpen || attentionCount > 0) && (
          <div className="divide-y divide-border rounded-b-xl border border-t-0 border-border bg-surface">
            {localSales.length === 0 && (
              <EmptyState icon="receipt" title="Todavía no se registró ninguna venta desde este dispositivo" />
            )}
            {localSales.map(({ sale, state }) => (
              <div key={sale.id} className="flex items-center justify-between gap-3 px-4 py-3 text-sm">
                <div>
                  <p className="text-text">
                    {new Date(sale.createdAt).toLocaleString()} — {sale.items.length}{" "}
                    {sale.items.length === 1 ? "ítem" : "ítems"}
                  </p>
                  {(state.kind === "conflict" || state.kind === "error") && (
                    <p className="mt-0.5 text-xs text-danger">{state.message}</p>
                  )}
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <Badge tone={SYNC_BADGE[state.kind].tone}>{SYNC_BADGE[state.kind].label}</Badge>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => handleTicket(sale.id, "view")}
                    disabled={ticketBusy !== null}
                  >
                    {ticketBusy === `view-${sale.id}` ? "Generando…" : "Ver ticket"}
                  </Button>
                  {(state.kind === "conflict" || state.kind === "error") && (
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => handleRetry(sale.id)}
                      disabled={retryingId === sale.id}
                    >
                      {retryingId === sale.id ? "Reintentando…" : "Reintentar"}
                    </Button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </AppShell>
  );

  /**
   * El contenido del carrito — líneas, cliente, descuento, total, pagos y
   * confirmar — es EXACTAMENTE el mismo nodo React sea que lo muestre el
   * `<aside>` de escritorio o el `<Sheet>` móvil (nunca los dos montados a
   * la vez, ver `useIsDesktopViewport`): una sola función local, cero
   * duplicación de marcado ni de lógica.
   */
  function renderCartFields() {
    return (
      <div className="flex h-full flex-col gap-3">
        {error && <ErrorState message={error} />}
        {feedback && (
          <div className={`rounded-lg px-3 py-2.5 text-sm ${FEEDBACK_STYLES[feedback.kind]}`}>
            <p>{feedback.message}</p>
            {lastSaleId && (feedback.kind === "synced" || feedback.kind === "offline") && (
              <div className="mt-2 flex flex-wrap gap-2">
                <Button
                  size="sm"
                  variant="secondary"
                  icon="printer"
                  onClick={() => handleTicket(lastSaleId, "view")}
                  disabled={ticketBusy !== null}
                >
                  {ticketBusy === `view-${lastSaleId}` ? "Generando..." : "Ver / Imprimir ticket"}
                </Button>
                <Button
                  size="sm"
                  variant="secondary"
                  icon="download"
                  onClick={() => handleTicket(lastSaleId, "download")}
                  disabled={ticketBusy !== null}
                >
                  {ticketBusy === `download-${lastSaleId}` ? "Descargando..." : "Descargar ticket"}
                </Button>
              </div>
            )}
          </div>
        )}
        {ticketError && <ErrorState message={ticketError} />}

        <div className="space-y-3">
          {cart.length === 0 && <p className="text-sm text-text-muted">Agregá productos desde la lista</p>}
          {cart.map((line) => (
            <div key={line.productId} className="space-y-2 border-b border-border pb-3 text-sm">
              <div className="flex items-start justify-between gap-2">
                <span className="font-medium text-text">{line.name}</span>
                <Button size="sm" variant="ghost" className="text-danger" onClick={() => handleRemoveLine(line.productId)}>
                  Quitar
                </Button>
              </div>
              <div className="flex flex-wrap items-center gap-2 text-xs">
                <div className="flex items-center gap-1 rounded-lg border border-border">
                  <IconButton
                    icon="minus"
                    label={`Restar una unidad de ${line.name}`}
                    size="sm"
                    variant="ghost"
                    onClick={() =>
                      handleUpdateLine(line.productId, { quantity: Math.max(0.01, line.quantity - 1) })
                    }
                  />
                  <input
                    aria-label={`Cantidad de ${line.name}`}
                    type="number"
                    min={0.01}
                    step="0.01"
                    value={line.quantity}
                    onChange={(e) => handleUpdateLine(line.productId, { quantity: Number(e.target.value) })}
                    className="w-12 border-none bg-transparent text-center text-sm focus:outline-none"
                  />
                  <IconButton
                    icon="plus"
                    label={`Sumar una unidad de ${line.name}`}
                    size="sm"
                    variant="ghost"
                    onClick={() => handleUpdateLine(line.productId, { quantity: line.quantity + 1 })}
                  />
                </div>
                <span className="flex items-center gap-1">
                  <span className="text-text-muted">Precio</span>
                  <input
                    aria-label={`Precio de ${line.name}`}
                    type="number"
                    min={0}
                    step="0.01"
                    value={line.unitPrice}
                    onChange={(e) => handleUpdateLine(line.productId, { unitPrice: Number(e.target.value) })}
                    className="w-20 rounded-lg border border-border px-2 py-1.5"
                  />
                </span>
                <span className="flex items-center gap-1">
                  <span className="text-text-muted">Desc.</span>
                  <input
                    aria-label={`Descuento de ${line.name}`}
                    type="number"
                    min={0}
                    step="0.01"
                    value={line.discount}
                    onChange={(e) => handleUpdateLine(line.productId, { discount: Number(e.target.value) })}
                    className="w-16 rounded-lg border border-border px-2 py-1.5"
                  />
                </span>
              </div>
              <div className="text-right text-text-muted">
                Subtotal: Bs. {(line.quantity * line.unitPrice - line.discount).toFixed(2)}
              </div>
            </div>
          ))}
        </div>

        <label htmlFor="pos-customer" className="sr-only">
          Cliente
        </label>
        <select
          id="pos-customer"
          value={customerId}
          onChange={(e) => setCustomerId(e.target.value)}
          className="h-11 w-full rounded-lg border border-border bg-white px-3 text-sm text-text focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary-soft"
        >
          <option value="">Cliente ocasional</option>
          {customers.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>

        <div className="flex items-center justify-between text-sm">
          <label htmlFor="pos-sale-discount" className="text-text-muted">
            Descuento venta
          </label>
          <input
            id="pos-sale-discount"
            type="number"
            min={0}
            step="0.01"
            value={saleDiscount}
            onChange={(e) => setSaleDiscount(e.target.value)}
            className="w-24 rounded-lg border border-border px-2 py-1.5 text-sm"
          />
        </div>

        {/* El total es lo más visible de todo el panel — nunca compite en tamaño con nada más. */}
        <div className="flex items-baseline justify-between border-t border-border pt-3">
          <span className="text-sm font-medium text-text-muted">Total</span>
          <span className="text-2xl font-semibold tabular-nums text-text">Bs. {total.toFixed(2)}</span>
        </div>
        {subtotal !== total && (
          <p className="-mt-2 text-right text-xs text-text-muted">Subtotal Bs. {subtotal.toFixed(2)}</p>
        )}

        <div className="space-y-2 border-t border-border pt-3">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-medium text-text">Pago (opcional — vacío = venta a crédito)</h2>
            <Button size="sm" variant="ghost" onClick={addPaymentLine}>
              + método
            </Button>
          </div>
          {/*
            Offline 4.15 — se mantienen los 4 métodos reales (CASH/CARD/
            TRANSFER/QR) y la posibilidad de varias líneas (pago dividido):
            Stitch muestra solo un toggle Efectivo/Tarjeta de UN método por
            venta, que no alcanza a representar lo que KIPU ya soporta.
          */}
          {payments.map((p, i) => (
            <div key={i} className="flex items-center gap-2">
              <label className="sr-only" htmlFor={`pos-payment-method-${i}`}>
                Método de pago
              </label>
              <select
                id={`pos-payment-method-${i}`}
                value={p.method}
                onChange={(e) => updatePaymentLine(i, { method: e.target.value as PaymentMethod })}
                className="h-10 rounded-lg border border-border bg-white px-2 text-xs text-text focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary-soft"
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
                className="h-10 w-24 rounded-lg border border-border px-2 text-xs"
              />
              <IconButton
                icon="trash"
                label="Quitar"
                size="sm"
                variant="ghost"
                className="text-danger"
                onClick={() => removePaymentLine(i)}
              />
            </div>
          ))}
          {payments.length > 0 && (
            <p className="text-right text-xs text-text-muted">
              Pagado: Bs. {paidSoFar.toFixed(2)} de Bs. {total.toFixed(2)}
            </p>
          )}
        </div>

        <div className="flex gap-2 pt-1">
          <Button size="lg" className="flex-1" onClick={confirmSale} disabled={submitting || cart.length === 0} loading={submitting}>
            {submitting ? "Confirmando..." : "Confirmar venta"}
          </Button>
          <Button size="lg" variant="secondary" onClick={resetSale}>
            Limpiar
          </Button>
        </div>
      </div>
    );
  }
}
