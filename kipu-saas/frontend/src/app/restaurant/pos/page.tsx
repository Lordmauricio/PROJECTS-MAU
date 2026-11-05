"use client";
import { useCallback, useRef, useState } from "react";
import Link from "next/link";
import AppShell from "@/components/AppShell";
import { api, ApiError } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { useRemoteLoad } from "@/lib/use-remote-load";
import { useSubmitGuard } from "@/lib/use-submit-guard";
import {
  bolivianos,
  cents,
  control,
  primary,
  menuTitle,
  type OrderQuote,
  type MenuEntry,
  type RestaurantOrder,
} from "@/lib/restaurant";

interface Branch {
  id: string;
  name: string;
  warehouses: { id: string; name: string }[];
  posTerminals: { id: string; name: string }[];
}
interface CartLine {
  menuEntryId: string;
  name: string;
  quantity: number;
  optionIds: string[];
  optionNames: string[];
  unitCents: number;
}
interface CreateBody {
  posTerminalId: string;
  warehouseId: string;
  requestKey: string;
  service: "DINE_IN" | "TAKEAWAY";
  customerName: string;
  notes: string;
  discount: number;
  items: { menuEntryId: string; quantity: number; optionIds: string[] }[];
}
interface Payment {
  method: "CASH" | "QR" | "CARD" | "TRANSFER";
  amount: string;
  idempotencyKey: string;
}

export default function RestaurantPOS() {
  const { organization } = useAuth();
  const storageKey = `kipu-order-attempt:${organization?.id ?? ""}`;
  const [branches, setBranches] = useState<Branch[]>([]);
  const [branchId, setBranchId] = useState("");
  const [terminalId, setTerminalId] = useState("");
  const [warehouseId, setWarehouseId] = useState("");
  const [entries, setEntries] = useState<MenuEntry[]>([]);
  const [pending, setPending] = useState<RestaurantOrder[]>([]);
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("");
  const [selected, setSelected] = useState<MenuEntry | null>(null);
  const [optionIds, setOptionIds] = useState<string[]>([]);
  const [cart, setCart] = useState<CartLine[]>([]);
  const [service, setService] = useState<"DINE_IN" | "TAKEAWAY">("TAKEAWAY");
  const [customerName, setCustomerName] = useState("");
  const [notes, setNotes] = useState("");
  const [discount, setDiscount] = useState("0");
  const [order, setOrder] = useState<RestaurantOrder | null>(null);
  const [locked, setLocked] = useState(false);
  const attempt = useRef<CreateBody | null>(null);
  const [payments, setPayments] = useState<Payment[]>([]);
  const [received, setReceived] = useState("");
  const paymentAttempt = useRef<Payment[] | null>(null);
  const [paymentLocked, setPaymentLocked] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reviewed, setReviewed] = useState<{
    signature: string;
    result: OrderQuote;
  } | null>(null);

  const fetchBranches = useCallback(() => api<Branch[]>("/branches"), []);
  const receiveBranches = useCallback((data: Branch[]) => {
    setBranches(data);
    const first = data[0];
    if (first) {
      setBranchId(first.id);
      setTerminalId(first.posTerminals[0]?.id ?? "");
      setWarehouseId(first.warehouses[0]?.id ?? "");
    }
  }, []);
  const branchesLoad = useRemoteLoad(
    fetchBranches,
    receiveBranches,
    "No se pudo cargar la sucursal",
  );
  const fetchMenu = useCallback(
    () =>
      Promise.all([
        api<MenuEntry[]>(
          `/restaurant/menu${warehouseId ? `?warehouseId=${encodeURIComponent(warehouseId)}` : ""}`,
        ),
        api<RestaurantOrder[]>("/restaurant/orders?status=DRAFT"),
      ]),
    [warehouseId],
  );
  const receiveMenu = useCallback(
    ([menu, drafts]: Awaited<ReturnType<typeof fetchMenu>>) => {
      setEntries(menu.filter((e) => e.active));
      setPending(drafts);
    },
    [],
  );
  const menuLoad = useRemoteLoad(
    fetchMenu,
    receiveMenu,
    "No se pudo cargar el menú",
  );
  const branch = branches.find((b) => b.id === branchId);
  const totalCents = order
    ? cents(order.sale.total)
    : Math.max(
        0,
        cart.reduce((sum, line) => sum + line.unitCents * line.quantity, 0) -
          cents(discount || 0),
      );
  const paymentCents = payments.reduce(
    (sum, p) => sum + (Number.isFinite(Number(p.amount)) ? cents(p.amount) : 0),
    0,
  );
  const cashCents = payments
    .filter((p) => p.method === "CASH")
    .reduce((sum, p) => sum + cents(p.amount || 0), 0);
  const changeCents = Math.max(0, cents(received || 0) - cashCents);
  const categories = [...new Set(entries.map((entry) => entry.category))];
  const filtered = entries.filter(
    (entry) =>
      (!category || entry.category === category) &&
      menuTitle(entry).toLowerCase().includes(search.toLowerCase()),
  );

  function add(entry: MenuEntry, ids: string[]) {
    const options = entry.options.filter((o) => ids.includes(o.id));
    const key = [...ids].sort();
    setCart((previous) => {
      const index = previous.findIndex(
        (line) =>
          line.menuEntryId === entry.id && line.optionIds.join() === key.join(),
      );
      return index >= 0
        ? previous.map((line, i) =>
            i === index ? { ...line, quantity: line.quantity + 1 } : line,
          )
        : [
            ...previous,
            {
              menuEntryId: entry.id,
              name: menuTitle(entry),
              quantity: 1,
              optionIds: key,
              optionNames: options.map((o) => o.name),
              unitCents:
                cents(entry.price) +
                options.reduce((sum, o) => sum + cents(o.price), 0),
            },
          ];
    });
    setSelected(null);
    setOptionIds([]);
  }
  function setSavedOrder(next: RestaurantOrder) {
    setOrder(next);
    setService(next.service);
    setCustomerName(next.customerName ?? "");
    setNotes(next.notes ?? "");
    setDiscount(next.sale.discount ?? "0");
    setReceived("");
    paymentAttempt.current = null;
    setPaymentLocked(false);
    setLocked(true);
    setPayments(
      next.sale.status === "PAID" || cents(next.sale.total) === 0
        ? []
        : [
            {
              method: "CASH",
              amount: next.sale.total,
              idempotencyKey: crypto.randomUUID(),
            },
          ],
    );
    setError(null);
  }
  function clearAttempt() {
    attempt.current = null;
    try {
      sessionStorage.removeItem(storageKey);
    } catch {
      /* Server list also recovers saved orders. */
    }
  }
  function newOrder() {
    clearAttempt();
    setOrder(null);
    setLocked(false);
    setCart([]);
    setPayments([]);
    setReceived("");
    paymentAttempt.current = null;
    setPaymentLocked(false);
    setCustomerName("");
    setNotes("");
    setDiscount("0");
    setError(null);
    setReviewed(null);
    void menuLoad.reload();
  }
  function quoteBody() {
    return {
      posTerminalId: terminalId,
      warehouseId,
      service,
      customerName,
      notes,
      discount: Number(discount),
      items: cart.map((line) => ({
        menuEntryId: line.menuEntryId,
        quantity: line.quantity,
        optionIds: line.optionIds,
      })),
    };
  }
  const signature = JSON.stringify(quoteBody());
  const currentQuote =
    reviewed?.signature === signature ? reviewed.result : null;
  const review = useSubmitGuard(async () => {
    setError(null);
    try {
      const requested = quoteBody();
      const result = await api<OrderQuote>("/restaurant/quote", {
        method: "POST",
        body: requested,
      });
      setReviewed({ signature: JSON.stringify(requested), result });
    } catch (err) {
      setError(
        err instanceof ApiError
          ? err.message
          : "No se pudo revisar el pedido. Reintenta antes de guardarlo.",
      );
    }
  });
  const create = useSubmitGuard(async () => {
    setError(null);
    try {
      let body = attempt.current;
      if (!body) {
        try {
          const stored = sessionStorage.getItem(storageKey);
          if (stored) body = JSON.parse(stored) as CreateBody;
        } catch {
          /* Server validation rejects damaged attempts safely. */
        }
      }
      const recovering = Boolean(body);
      if (!body && !cart.length)
        throw new Error("No hay un pedido interrumpido en esta pestaña.");
      body ??= { ...quoteBody(), requestKey: crypto.randomUUID() };
      if (!recovering) {
        const requested = quoteBody();
        const result = await api<OrderQuote>("/restaurant/quote", {
          method: "POST",
          body: requested,
        });
        setReviewed({ signature: JSON.stringify(requested), result });
        if (!result.canFulfill) {
          setError(
            "No alcanza el stock para este pedido. Ajusta las cantidades o las opciones.",
          );
          return;
        }
      }
      attempt.current = body;
      try {
        sessionStorage.setItem(storageKey, JSON.stringify(body));
      } catch {
        /* Retry remains available in this tab. */
      }
      setLocked(true);
      const saved = await api<RestaurantOrder>("/restaurant/orders", {
        method: "POST",
        body,
      });
      setSavedOrder(saved);
      clearAttempt();
      await menuLoad.reload();
    } catch (err) {
      if (
        err instanceof ApiError &&
        [400, 403, 404, 422].includes(err.status)
      ) {
        clearAttempt();
        setLocked(false);
      }
      setError(
        err instanceof ApiError
          ? err.message
          : "Reintenta para recuperar el mismo pedido. Si acabas de abrir esta pestaña, consulta los pedidos pendientes.",
      );
    }
  });
  const checkout = useSubmitGuard(async () => {
    if (!order) return;
    if (
      order.sale.status !== "PAID" &&
      (paymentCents !== cents(order.sale.total) ||
        payments.some(
          (p) => !Number.isFinite(Number(p.amount)) || Number(p.amount) <= 0,
        ))
    ) {
      setError("Los pagos deben cubrir exactamente el total del pedido.");
      return;
    }
    if (cashCents > 0 && received && cents(received) < cashCents) {
      setError("El efectivo recibido no cubre el pago en efectivo.");
      return;
    }
    setError(null);
    const checkoutPayments = paymentAttempt.current ?? payments;
    paymentAttempt.current = checkoutPayments;
    setPaymentLocked(true);
    try {
      setOrder(
        await api<RestaurantOrder>(`/restaurant/orders/${order.id}/checkout`, {
          method: "POST",
          body: {
            payments: checkoutPayments.map((p) => ({
              ...p,
              amount: Number(p.amount),
            })),
          },
        }),
      );
      await menuLoad.reload();
    } catch (err) {
      if (
        err instanceof ApiError &&
        [400, 403, 409, 422].includes(err.status)
      ) {
        paymentAttempt.current = null;
        setPaymentLocked(false);
      }
      setError(
        err instanceof ApiError
          ? err.message
          : "No se recibió confirmación del cobro. Reintenta: se conservará el mismo pedido y pago.",
      );
    }
  });
  const cancel = useSubmitGuard(async () => {
    if (!order) return;
    try {
      await api(`/restaurant/orders/${order.id}/cancel`, {
        method: "POST",
        body: { reason: "Cancelado desde caja antes del cobro" },
      });
      newOrder();
    } catch (err) {
      setError(
        err instanceof ApiError ? err.message : "No se pudo cancelar el pedido",
      );
    }
  });
  const busy =
    review.submitting ||
    create.submitting ||
    checkout.submitting ||
    cancel.submitting;
  return (
    <AppShell>
      <div className="mx-auto max-w-[1600px] p-4 md:p-8">
        <header className="mb-6 flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-widest text-emerald-800">
              KIPU · Mostrador
            </p>
            <h1 className="mt-2 text-3xl font-semibold">
              ¿Qué vamos a servir?
            </h1>
            <p className="mt-2 text-sm text-zinc-500">
              Cochabamba · Precios en bolivianos
            </p>
          </div>
          <Link className={control} href="/restaurant/kitchen">
            Ver cocina →
          </Link>
        </header>
        {(branchesLoad.error || menuLoad.error) && (
          <div
            role="alert"
            className="mb-4 rounded-xl bg-red-50 p-4 text-red-800"
          >
            {branchesLoad.error || menuLoad.error}{" "}
            <button
              className="underline"
              onClick={() => {
                void branchesLoad.reload();
                void menuLoad.reload();
              }}
            >
              Reintentar carga
            </button>
          </div>
        )}
        <div className="grid items-start gap-6 md:grid-cols-[minmax(0,1fr)_340px] xl:grid-cols-[minmax(0,1fr)_380px]">
          <section className="min-w-0 space-y-5">
            <fieldset
              disabled={locked || busy}
              className="flex flex-wrap gap-3"
            >
              <label className="text-xs text-zinc-600">
                Sucursal
                <select
                  className={`${control} mt-1 block`}
                  value={branchId}
                  onChange={(e) => {
                    const b = branches.find((b) => b.id === e.target.value);
                    setBranchId(e.target.value);
                    setTerminalId(b?.posTerminals[0]?.id ?? "");
                    setWarehouseId(b?.warehouses[0]?.id ?? "");
                    setCart([]);
                  }}
                >
                  {branches.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="text-xs text-zinc-600">
                Punto de venta
                <select
                  className={`${control} mt-1 block`}
                  value={terminalId}
                  onChange={(e) => setTerminalId(e.target.value)}
                >
                  {branch?.posTerminals.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="text-xs text-zinc-600">
                Almacén
                <select
                  className={`${control} mt-1 block`}
                  value={warehouseId}
                  onChange={(e) => {
                    setWarehouseId(e.target.value);
                    setCart([]);
                  }}
                >
                  {branch?.warehouses.map((w) => (
                    <option key={w.id} value={w.id}>
                      {w.name}
                    </option>
                  ))}
                </select>
              </label>
            </fieldset>
            <label className="block">
              <span className="sr-only">Buscar plato</span>
              <input
                className={`${control} w-full`}
                placeholder="Buscar en el menú…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </label>
            <div className="flex flex-wrap gap-2" aria-label="Categorías">
              {["", ...categories].map((value) => (
                <button
                  key={value}
                  aria-pressed={category === value}
                  className={`${control} ${category === value ? "!border-emerald-800 !bg-emerald-50 text-emerald-900" : ""}`}
                  onClick={() => setCategory(value)}
                >
                  {value || "Todo el menú"}
                </button>
              ))}
            </div>
            {menuLoad.loading && (
              <p role="status">Cargando platos y disponibilidad…</p>
            )}
            {!menuLoad.loading && !filtered.length && (
              <div className="rounded-2xl border border-dashed border-zinc-300 p-8 text-center">
                <h2 className="font-semibold">
                  {entries.length
                    ? "No encontramos ese plato"
                    : "El menú aún está vacío"}
                </h2>
                <Link
                  href="/restaurant/menu"
                  className="mt-3 inline-block text-sm text-emerald-800 underline"
                >
                  Configurar menú y combos
                </Link>
              </div>
            )}
            <div
              className="grid gap-3"
              style={{
                gridTemplateColumns:
                  "repeat(auto-fit, minmax(min(100%, 220px), 1fr))",
              }}
            >
              {filtered.map((entry) => (
                <button
                  key={entry.id}
                  aria-label={`Agregar ${menuTitle(entry)}`}
                  disabled={
                    locked ||
                    busy ||
                    menuLoad.loading ||
                    (entry.available === 0 && !entry.customizable)
                  }
                  onClick={() =>
                    entry.options.length
                      ? (setSelected(entry), setOptionIds([]))
                      : add(entry, [])
                  }
                  className="flex min-h-40 flex-col justify-between rounded-2xl border border-zinc-200 bg-white p-5 text-left shadow-sm transition hover:border-emerald-700 hover:shadow-md disabled:cursor-not-allowed disabled:opacity-45"
                >
                  <div>
                    <p className="text-xs text-zinc-500">{entry.category}</p>
                    <h2 className="mt-2 text-lg font-semibold">
                      {menuTitle(entry)}
                    </h2>
                    <p className="mt-1 text-xs text-zinc-500">
                      {entry.station}
                      {entry.options.length ? " · Personalizable" : ""}
                    </p>
                  </div>
                  <div className="mt-5 flex items-end justify-between gap-2">
                    <span className="font-semibold text-emerald-900">
                      {bolivianos(entry.price)}
                    </span>
                    <span className="text-xs text-zinc-500">
                      {entry.available === 0
                        ? entry.customizable
                          ? "Revisar opciones"
                          : "Agotado"
                        : entry.available === null
                          ? ""
                          : `${entry.available} disponibles`}
                    </span>
                  </div>
                </button>
              ))}
            </div>
            {selected && (
              <section
                role="dialog"
                aria-label={`Personalizar ${menuTitle(selected)}`}
                className="space-y-3 rounded-2xl border-2 border-emerald-800 bg-white p-5"
              >
                <h2 className="text-lg font-semibold">{menuTitle(selected)}</h2>
                {selected.options.map((option) => (
                  <label
                    key={option.id}
                    className="flex min-h-12 items-center gap-3 rounded-xl bg-zinc-50 px-3"
                  >
                    <input
                      type="checkbox"
                      checked={optionIds.includes(option.id)}
                      onChange={(e) =>
                        setOptionIds((ids) =>
                          e.target.checked
                            ? [
                                ...ids.filter(
                                  (id) =>
                                    !option.replacesProductId ||
                                    selected.options.find((o) => o.id === id)
                                      ?.replacesProductId !==
                                      option.replacesProductId,
                                ),
                                option.id,
                              ]
                            : ids.filter((id) => id !== option.id),
                        )
                      }
                    />
                    <span className="flex-1 text-sm">
                      {option.name}
                      {option.replacesProductId && (
                        <small className="block text-zinc-500">
                          Sustitución
                        </small>
                      )}
                    </span>
                    <span className="text-sm">
                      + {bolivianos(option.price)}
                    </span>
                  </label>
                ))}
                <div className="flex gap-3">
                  <button
                    className={primary}
                    disabled={locked || busy}
                    onClick={() => add(selected, optionIds)}
                  >
                    Agregar al pedido
                  </button>
                  <button className={control} onClick={() => setSelected(null)}>
                    Cerrar opciones
                  </button>
                </div>
              </section>
            )}
            {pending.length > 0 && (
              <section className="rounded-2xl border border-zinc-200 p-5">
                <h2 className="font-semibold">Pedidos pendientes de cobro</h2>
                <div className="mt-3 flex flex-wrap gap-2">
                  {pending
                    .filter((p) => p.branchId === branchId)
                    .map((p) => (
                      <button
                        disabled={busy || locked || cart.length > 0}
                        key={p.id}
                        className={control}
                        onClick={() => setSavedOrder(p)}
                      >
                        Continuar {p.id.slice(-6)} · {bolivianos(p.sale.total)}
                      </button>
                    ))}
                </div>
              </section>
            )}
          </section>
          <aside
            id="pedido-actual"
            className="space-y-4 md:sticky md:top-4"
            aria-label="Pedido actual"
          >
            <div className="space-y-4 rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm">
              <div className="flex items-center justify-between">
                <h2 className="text-xl font-semibold">Tu pedido</h2>
                <span className="text-xs text-zinc-500">
                  {order
                    ? `#${order.id.slice(-6)}`
                    : `${cart.reduce((sum, l) => sum + l.quantity, 0)} unidades`}
                </span>
              </div>
              {error && (
                <p
                  role="alert"
                  className="rounded-xl bg-red-50 p-3 text-sm text-red-800"
                >
                  {error}
                </p>
              )}
              {order && order.status !== "DRAFT" ? (
                <div
                  role="status"
                  className="space-y-2 rounded-xl bg-emerald-50 p-4 text-emerald-900"
                >
                  <p className="font-semibold">
                    Pedido cobrado y enviado a cocina
                  </p>
                  <p className="text-sm">
                    {bolivianos(order.sale.total)} ·{" "}
                    {order.service === "DINE_IN" ? "Salón" : "Para llevar"}
                  </p>
                  {cashCents > 0 && (
                    <p>Cambio: {bolivianos(changeCents / 100)}</p>
                  )}
                  <Link
                    href={`/sales/${order.saleId}`}
                    className="inline-block text-sm underline"
                  >
                    Ver venta y emitir recibo no fiscal
                  </Link>
                  <button className={`${primary} w-full`} onClick={newOrder}>
                    Nuevo pedido
                  </button>
                </div>
              ) : (
                <>
                  {!cart.length && !order && (
                    <p className="py-5 text-sm text-zinc-500">
                      Elige un plato para comenzar.
                    </p>
                  )}
                  {order
                    ? order.snapshot.map((line, i) => (
                        <div
                          className="border-b border-zinc-100 pb-3 text-sm"
                          key={i}
                        >
                          <p className="font-medium">
                            {line.quantity} × {line.name}
                          </p>
                          <p className="text-xs text-zinc-500">
                            {line.options.map((o) => o.name).join(" · ")}
                          </p>
                          <p>{bolivianos(line.subtotal)}</p>
                        </div>
                      ))
                    : cart.map((line, i) => (
                        <div
                          key={i}
                          className="space-y-2 border-b border-zinc-100 pb-3"
                        >
                          <div className="flex justify-between gap-2 text-sm">
                            <span className="font-medium">{line.name}</span>
                            <span>
                              {bolivianos(
                                (line.unitCents * line.quantity) / 100,
                              )}
                            </span>
                          </div>
                          <p className="text-xs text-zinc-500">
                            {line.optionNames.join(" · ")}
                          </p>
                          <div className="flex items-center gap-3">
                            <button
                              disabled={locked || busy}
                              aria-label={`Restar ${line.name}`}
                              className={control}
                              onClick={() =>
                                setCart((lines) =>
                                  lines.flatMap((l, j) =>
                                    j !== i
                                      ? [l]
                                      : l.quantity > 1
                                        ? [{ ...l, quantity: l.quantity - 1 }]
                                        : [],
                                  ),
                                )
                              }
                            >
                              −
                            </button>
                            <span>{line.quantity}</span>
                            <button
                              disabled={locked || busy}
                              aria-label={`Sumar ${line.name}`}
                              className={control}
                              onClick={() =>
                                setCart((lines) =>
                                  lines.map((l, j) =>
                                    j === i
                                      ? { ...l, quantity: l.quantity + 1 }
                                      : l,
                                  ),
                                )
                              }
                            >
                              +
                            </button>
                          </div>
                        </div>
                      ))}
                  <fieldset disabled={locked || busy} className="space-y-3">
                    <label className="block text-sm">
                      Servicio
                      <select
                        className={`${control} mt-1 w-full`}
                        value={service}
                        onChange={(e) =>
                          setService(e.target.value as typeof service)
                        }
                      >
                        <option value="TAKEAWAY">Para llevar</option>
                        <option value="DINE_IN">Salón</option>
                      </select>
                    </label>
                    <label className="block text-sm">
                      Nombre para entregar
                      <input
                        maxLength={100}
                        className={`${control} mt-1 w-full`}
                        value={customerName}
                        onChange={(e) => setCustomerName(e.target.value)}
                      />
                    </label>
                    <label className="block text-sm">
                      Observaciones para cocina
                      <textarea
                        maxLength={500}
                        className={`${control} mt-1 w-full`}
                        value={notes}
                        onChange={(e) => setNotes(e.target.value)}
                      />
                    </label>
                  </fieldset>
                  <label className="block text-sm">
                    Descuento autorizado en Bs
                    <input
                      disabled={locked || busy}
                      className={`${control} mt-1 w-full`}
                      type="number"
                      min="0"
                      step="0.01"
                      value={discount}
                      onChange={(e) => setDiscount(e.target.value)}
                    />
                    <span className="mt-1 block text-xs text-zinc-500">
                      Requiere permiso de encargado.
                    </span>
                  </label>
                  <div className="flex justify-between border-t border-zinc-200 pt-4 text-xl font-semibold">
                    <span>Total</span>
                    <span>{bolivianos(totalCents / 100)}</span>
                  </div>
                  {!order && !locked && cart.length > 0 && (
                    <>
                      <button
                        className={`${control} w-full`}
                        disabled={busy}
                        onClick={review.onSubmit}
                      >
                        {review.submitting
                          ? "Revisando…"
                          : "Revisar disponibilidad y total"}
                      </button>
                      {currentQuote && (
                        <div
                          role="status"
                          className={`rounded-xl p-3 text-sm ${currentQuote.canFulfill ? "bg-emerald-50 text-emerald-950" : "bg-amber-50 text-amber-950"}`}
                        >
                          <p className="font-semibold">
                            Total revisado: {bolivianos(currentQuote.total)}
                          </p>
                          <p>
                            {currentQuote.canFulfill
                              ? "Hay disponibilidad para este pedido."
                              : "Faltan componentes para completar el pedido."}
                          </p>
                          {currentQuote.shortages.map((shortage) => (
                            <p key={shortage.productId}>
                              {shortage.name}: requiere {shortage.required};
                              disponible {shortage.available}.
                            </p>
                          ))}
                          <p className="mt-2 text-xs">
                            La revisión no reserva stock. Se comprueba
                            nuevamente al cobrar.
                          </p>
                        </div>
                      )}
                    </>
                  )}
                  {!order && (
                    <button
                      className={`${primary} w-full`}
                      disabled={
                        busy ||
                        (!locked &&
                          (!cart.length || !terminalId || !warehouseId))
                      }
                      onClick={create.onSubmit}
                    >
                      {create.submitting
                        ? "Guardando…"
                        : locked
                          ? "Recuperar el mismo pedido"
                          : "Guardar pedido"}
                    </button>
                  )}
                  {order && (
                    <>
                      <fieldset
                        disabled={busy || paymentLocked}
                        className="space-y-3"
                      >
                        <legend className="mb-2 font-semibold">Cobro</legend>
                        {payments.map((payment, i) => (
                          <div
                            key={payment.idempotencyKey}
                            className="flex gap-2"
                          >
                            <select
                              aria-label={`Método de pago ${i + 1}`}
                              className={`${control} min-w-0 flex-1`}
                              value={payment.method}
                              onChange={(e) =>
                                setPayments((ps) =>
                                  ps.map((p, j) =>
                                    j === i
                                      ? {
                                          ...p,
                                          method: e.target
                                            .value as Payment["method"],
                                        }
                                      : p,
                                  ),
                                )
                              }
                            >
                              <option value="CASH">Efectivo</option>
                              <option value="QR">QR manual</option>
                              <option value="CARD">Tarjeta</option>
                              <option value="TRANSFER">Transferencia</option>
                            </select>
                            <input
                              aria-label={`Monto de pago ${i + 1}`}
                              className={`${control} w-24`}
                              type="number"
                              min="0.01"
                              step="0.01"
                              value={payment.amount}
                              onChange={(e) =>
                                setPayments((ps) =>
                                  ps.map((p, j) =>
                                    j === i
                                      ? { ...p, amount: e.target.value }
                                      : p,
                                  ),
                                )
                              }
                            />
                            <button
                              aria-label={`Quitar pago ${i + 1}`}
                              className={control}
                              onClick={() =>
                                setPayments((ps) =>
                                  ps.filter((_, j) => j !== i),
                                )
                              }
                            >
                              ×
                            </button>
                          </div>
                        ))}
                        <button
                          className="min-h-11 text-sm text-emerald-800 underline"
                          onClick={() =>
                            setPayments((ps) => [
                              ...ps,
                              {
                                method: "CASH",
                                amount:
                                  Math.max(0, totalCents - paymentCents) / 100 +
                                  "",
                                idempotencyKey: crypto.randomUUID(),
                              },
                            ])
                          }
                        >
                          Agregar método de pago
                        </button>
                        {payments.some((p) => p.method === "QR") && (
                          <p className="rounded-xl bg-amber-50 p-3 text-xs text-amber-900">
                            QR manual: comprueba el abono en tu cuenta antes de
                            confirmar. KIPU no verifica el pago automáticamente.
                          </p>
                        )}
                        {cashCents > 0 && (
                          <label className="block text-sm">
                            Efectivo recibido
                            <input
                              className={`${control} mt-1 w-full`}
                              type="number"
                              min="0"
                              step="0.01"
                              placeholder={bolivianos(cashCents / 100)}
                              value={received}
                              onChange={(e) => setReceived(e.target.value)}
                            />
                            <span className="mt-1 block text-emerald-800">
                              Cambio: {bolivianos(changeCents / 100)}
                            </span>
                          </label>
                        )}
                      </fieldset>
                      <button
                        className={`${primary} w-full`}
                        disabled={busy}
                        onClick={checkout.onSubmit}
                      >
                        {checkout.submitting
                          ? "Confirmando cobro…"
                          : order.sale.status === "PAID"
                            ? "Enviar a cocina (ya pagado)"
                            : "Cobrar y enviar a cocina"}
                      </button>
                      <button
                        className={`${control} w-full text-red-700`}
                        disabled={busy}
                        onClick={cancel.onSubmit}
                      >
                        Cancelar pedido sin cobrar
                      </button>
                    </>
                  )}
                </>
              )}
            </div>
            {!order && !cart.length && !locked && (
              <button
                className={control}
                disabled={busy}
                onClick={create.onSubmit}
              >
                Recuperar pedido interrumpido
              </button>
            )}
            <p className="px-2 text-xs leading-relaxed text-zinc-500">
              Necesitas conexión para guardar y cobrar. Los precios finales y la
              disponibilidad se verifican en el servidor.
            </p>
          </aside>
        </div>
        {(cart.length > 0 || order?.status === "DRAFT") && (
          <a
            href="#pedido-actual"
            className="fixed bottom-4 right-4 z-20 rounded-full bg-emerald-800 px-4 py-3 text-sm font-medium text-white shadow-lg md:hidden"
          >
            Ver pedido · {bolivianos(totalCents / 100)}
          </a>
        )}
      </div>
    </AppShell>
  );
}
