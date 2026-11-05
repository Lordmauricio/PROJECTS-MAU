"use client";
import { useCallback, useRef, useState } from "react";
import Link from "next/link";
import AppShell from "@/components/AppShell";
import { api, ApiError } from "@/lib/api";
import { useRemoteLoad } from "@/lib/use-remote-load";
import { useSubmitGuard } from "@/lib/use-submit-guard";
import {
  bolivianos,
  cents,
  control,
  primary,
  menuTitle,
  orderLabels,
  type MenuEntry,
  type RestaurantOrder,
} from "@/lib/restaurant";
interface Branch {
  id: string;
  name: string;
  warehouses: { id: string; name: string }[];
  posTerminals: { id: string; name: string }[];
}
interface Table {
  id: string;
  branchId: string;
  name: string;
  area: string;
  seats: number;
  accounts: { id: string; label: string; waiterName: string }[];
}
interface Account {
  id: string;
  tableId: string;
  branchId: string;
  posTerminalId: string;
  warehouseId: string;
  label: string;
  waiterId: string;
  waiterName: string;
  status: string;
  version: number;
  tipAmount: string;
  table: Table;
  orders: (RestaurantOrder & {
    sale: RestaurantOrder["sale"] & { payments: { amount: string }[] };
  })[];
}
interface Waiter {
  userId: string;
  user: { name: string };
}
interface Attempt {
  path: string;
  body: unknown;
  method: string;
}
const base = "/restaurant/dining";
export default function DiningPage() {
  const [tables, setTables] = useState<Table[]>([]),
    [accounts, setAccounts] = useState<Account[]>([]),
    [branches, setBranches] = useState<Branch[]>([]),
    [waiters, setWaiters] = useState<Waiter[]>([]),
    [menu, setMenu] = useState<MenuEntry[]>([]);
  const [selected, setSelected] = useState(""),
    [branchId, setBranchId] = useState(""),
    [tableId, setTableId] = useState(""),
    [terminalId, setTerminalId] = useState(""),
    [warehouseId, setWarehouseId] = useState(""),
    [label, setLabel] = useState("Cuenta principal");
  const [name, setName] = useState(""),
    [area, setArea] = useState("Salón"),
    [seats, setSeats] = useState("4"),
    [editTable, setEditTable] = useState("");
  const [entryId, setEntryId] = useState(""),
    [quantity, setQuantity] = useState("1"),
    [notes, setNotes] = useState(""),
    [options, setOptions] = useState<string[]>([]);
  const [picked, setPicked] = useState<string[]>([]),
    [splitLabel, setSplitLabel] = useState("Cuenta separada"),
    [targetTable, setTargetTable] = useState(""),
    [mergeId, setMergeId] = useState(""),
    [waiterId, setWaiterId] = useState("");
  const [payOrder, setPayOrder] = useState(""),
    [payAmount, setPayAmount] = useState(""),
    [payMethod, setPayMethod] = useState("CASH"),
    [tip, setTip] = useState("0"),
    [tipMethod, setTipMethod] = useState("CASH");
  const [error, setError] = useState<string | null>(null),
    [notice, setNotice] = useState<string | null>(null),
    [uncertain, setUncertain] = useState(false);
  const attempt = useRef<Attempt | null>(null);
  const fetchData = useCallback(
    () =>
      Promise.all([
        api<Table[]>(`${base}/tables`),
        api<Account[]>(`${base}/accounts`),
        api<Branch[]>("/branches"),
        api<Waiter[]>(`${base}/waiters`),
        api<MenuEntry[]>("/restaurant/menu"),
      ]),
    [],
  );
  const receive = useCallback(
    ([t, a, b, w, m]: Awaited<ReturnType<typeof fetchData>>) => {
      setTables(t);
      setAccounts(a);
      setBranches(b);
      setWaiters(w);
      setMenu(m.filter((e) => e.active));
      setBranchId((v) => v || b[0]?.id || "");
      setTerminalId((v) => v || b[0]?.posTerminals[0]?.id || "");
      setWarehouseId((v) => v || b[0]?.warehouses[0]?.id || "");
    },
    [],
  );
  const {
    loading,
    error: loadError,
    reload,
  } = useRemoteLoad(fetchData, receive, "No se pudo cargar el salón");
  const account = accounts.find((a) => a.id === selected);
  const branch = branches.find((b) => b.id === branchId);
  const entry = menu.find((m) => m.id === entryId);
  const run = useSubmitGuard(
    async (path: string, body: unknown, method: string = "POST") => {
      setError(null);
      setNotice(null);
      const request = attempt.current ?? { path, body, method };
      attempt.current = request;
      try {
        const result = await api<{ id?: string; tableId?: string }>(
          request.path,
          { method: request.method, body: request.body },
        );
        attempt.current = null;
        setUncertain(false);
        if (result.tableId && result.id) setSelected(result.id);
        setPicked([]);
        setNotice("status" in result && result.status === "CLOSED" ? "Cuenta cerrada. La mesa queda libre cuando no tiene otras cuentas abiertas." : "Operación registrada.");
        reload();
      } catch (e) {
        setError(e instanceof Error ? e.message : "No se pudo registrar");
        if (e instanceof ApiError && e.status < 500) {
          attempt.current = null;
          setUncertain(false);
          reload();
        } else setUncertain(true);
      }
    },
  );
  const busy = run.submitting || uncertain;
  const post = (path: string, body: unknown, method?: string) =>
    void run.onSubmit(path, body, method);
  const balance = (o: Account["orders"][number]) =>
    Math.max(
      0,
      cents(o.sale.total) -
        o.sale.payments.reduce((s, p) => s + cents(p.amount), 0),
    );
  const outstanding =
    account?.orders
      .filter((o) => !["CANCELLED", "REFUNDED"].includes(o.sale.status))
      .reduce((s, o) => s + balance(o), 0) ?? 0;
  function chooseAccount(id: string) {
    setSelected(id);
    setPicked([]);
    setPayOrder("");
    setPayAmount("");
    setTip("0");
    setError(null);
    setNotice(null);
  }
  return (
    <AppShell>
      <main className="mx-auto max-w-7xl space-y-6 p-4 sm:p-6">
        <header className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold">Salón y mesas</h1>
            <p className="text-sm text-zinc-600">
              Cuentas abiertas · cocina antes del cobro · importes en Bs
            </p>
          </div>
          <div className="flex gap-3">
            <Link className={control} href="/restaurant/kitchen">
              Ver cocina
            </Link>
            <button className={control} onClick={reload} disabled={busy}>
              Actualizar salón
            </button>
          </div>
        </header>
        {(error || loadError) && (
          <p role="alert" className="rounded-xl bg-red-50 p-3 text-red-800">
            {error || loadError}
          </p>
        )}
        {notice && (
          <p role="status" className="rounded-xl bg-emerald-50 p-3">
            {notice}
          </p>
        )}
        {uncertain && (
          <aside className="rounded-xl border border-amber-400 p-4">
            <p>
              La respuesta no se confirmó. Reintenta la misma operación antes de
              hacer otra.
            </p>
            <button
              className={primary}
              disabled={run.submitting}
              onClick={() =>
                attempt.current &&
                post(
                  attempt.current.path,
                  attempt.current.body,
                  attempt.current.method,
                )
              }
            >
              Reintentar operación
            </button>
          </aside>
        )}
        {loading && <p role="status">Cargando salón…</p>}
        <label className="block text-sm">
          Sucursal
          <select
            className={`${control} ml-2 max-w-full`}
            value={branchId}
            disabled={busy}
            onChange={(e) => {
              const b = branches.find((b) => b.id === e.target.value);
              setBranchId(e.target.value);
              setTerminalId(b?.posTerminals[0]?.id || "");
              setWarehouseId(b?.warehouses[0]?.id || "");
              setTableId("");
              setSelected("");
            }}
          >
            {branches.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </select>
        </label>
        <section
          aria-label="Mapa de mesas"
          className="grid grid-cols-2 gap-3 md:grid-cols-4"
        >
          {tables
            .filter((t) => t.branchId === branchId)
            .map((t) => (
              <article
                key={t.id}
                className={`rounded-2xl border p-4 ${t.accounts.length ? "border-amber-400 bg-amber-50" : "border-emerald-300 bg-emerald-50"}`}
              >
                <h2 className="font-bold">{t.name}</h2>
                <p className="text-sm">
                  {t.area} · {t.seats} personas
                </p>
                <p className="text-sm">
                  {t.accounts.length
                    ? `${t.accounts.length} cuenta(s) abierta(s)`
                    : "Libre"}
                </p>
                {t.accounts.map((a) => (
                  <button
                    key={a.id}
                    disabled={busy}
                    className="my-1 block min-h-11 w-full rounded-lg border bg-white p-2 text-left text-sm"
                    onClick={() => chooseAccount(a.id)}
                  >
                    {a.label} · {a.waiterName}
                  </button>
                ))}
                <button
                  className="mt-2 min-h-11 text-sm underline"
                  disabled={busy}
                  onClick={() => setTableId(t.id)}
                >
                  Abrir aquí
                </button>
              </article>
            ))}
        </section>
        <details className="rounded-2xl border p-4">
          <summary className="cursor-pointer font-semibold">
            Configurar mesas (encargado)
          </summary>
          <form
            className="mt-4"
            onSubmit={(e) => {
              e.preventDefault();
              post(
                `${base}/tables${editTable ? `/${editTable}` : ""}`,
                { branchId, name, area, seats: Number(seats) },
                editTable ? "PATCH" : "POST",
              );
            }}
          >
            <fieldset disabled={busy} className="grid gap-3 sm:grid-cols-2">
              <label>
                Editar mesa
                <select
                  className={`${control} block w-full`}
                  value={editTable}
                  onChange={(e) => {
                    setEditTable(e.target.value);
                    const t = tables.find((t) => t.id === e.target.value);
                    setName(t?.name || "");
                    setArea(t?.area || "Salón");
                    setSeats(String(t?.seats || 4));
                  }}
                >
                  <option value="">Nueva mesa</option>
                  {tables
                    .filter((t) => t.branchId === branchId)
                    .map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.name}
                      </option>
                    ))}
                </select>
              </label>
              <label>
                Nombre de mesa
                <input
                  className={`${control} block w-full`}
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  required
                  maxLength={60}
                />
              </label>
              <label>
                Zona
                <input
                  className={`${control} block w-full`}
                  value={area}
                  onChange={(e) => setArea(e.target.value)}
                  required
                  maxLength={60}
                />
              </label>
              <label>
                Capacidad
                <input
                  className={`${control} block w-full`}
                  type="number"
                  value={seats}
                  min="1"
                  max="100"
                  onChange={(e) => setSeats(e.target.value)}
                  required
                />
              </label>
              <button className={primary}>Guardar mesa</button>
            </fieldset>
          </form>
        </details>
        <form
          className="rounded-2xl border bg-white p-4"
          onSubmit={(e) => {
            e.preventDefault();
            post(`${base}/accounts`, {
              tableId,
              posTerminalId: terminalId,
              warehouseId,
              label,
              requestKey: crypto.randomUUID(),
            });
          }}
        >
          <h2 className="mb-3 font-semibold">Abrir cuenta</h2>
          <fieldset
            disabled={busy}
            className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4"
          >
            <label>
              Mesa
              <select
                className={`${control} block w-full`}
                required
                value={tableId}
                onChange={(e) => setTableId(e.target.value)}
              >
                <option value="">Selecciona mesa</option>
                {tables
                  .filter((t) => t.branchId === branchId)
                  .map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name}
                    </option>
                  ))}
              </select>
            </label>
            <label>
              Nombre de cuenta
              <input
                className={`${control} block w-full`}
                required
                maxLength={100}
                value={label}
                onChange={(e) => setLabel(e.target.value)}
              />
            </label>
            <label>
              Terminal
              <select
                className={`${control} block w-full`}
                required
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
            <label>
              Almacén
              <select
                className={`${control} block w-full`}
                required
                value={warehouseId}
                onChange={(e) => setWarehouseId(e.target.value)}
              >
                {branch?.warehouses.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </select>
            </label>
            <button className={primary}>Abrir cuenta de mesa</button>
          </fieldset>
        </form>
        <label className="block">
          Cuenta seleccionada
          <select
            className={`${control} block w-full`}
            disabled={busy}
            value={selected}
            onChange={(e) => chooseAccount(e.target.value)}
          >
            <option value="">Selecciona una cuenta</option>
            {accounts
              .filter((a) => a.branchId === branchId)
              .map((a) => (
                <option key={a.id} value={a.id}>
                  {a.table.name} · {a.label}
                </option>
              ))}
          </select>
        </label>
        {account && (
          <section className="space-y-5 rounded-2xl border p-4">
            <header>
              <h2 className="text-xl font-bold">
                {account.table.name} · {account.label}
              </h2>
              <p>Mesero: {account.waiterName}</p>
              <p className="text-lg font-semibold">
                Saldo pendiente: {bolivianos(outstanding / 100)}
              </p>
            </header>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                post(`${base}/accounts/${account.id}/orders`, {
                  posTerminalId: account.posTerminalId,
                  warehouseId: account.warehouseId,
                  service: "DINE_IN",
                  notes,
                  items: [
                    {
                      menuEntryId: entryId,
                      quantity: Number(quantity),
                      optionIds: options,
                    },
                  ],
                  requestKey: crypto.randomUUID(),
                });
              }}
            >
              <h3 className="mb-2 font-semibold">Agregar comanda</h3>
              <fieldset disabled={busy} className="grid gap-3 sm:grid-cols-2">
                <label>
                  Plato
                  <select
                    className={`${control} block w-full`}
                    required
                    value={entryId}
                    onChange={(e) => {
                      setEntryId(e.target.value);
                      setOptions([]);
                    }}
                  >
                    <option value="">Selecciona plato</option>
                    {menu.map((m) => (
                      <option key={m.id} value={m.id}>
                        {menuTitle(m)} · {bolivianos(m.price)}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Cantidad
                  <input
                    className={`${control} block w-full`}
                    required
                    type="number"
                    min="1"
                    max="1000"
                    step="1"
                    value={quantity}
                    onChange={(e) => setQuantity(e.target.value)}
                  />
                </label>
                {entry?.options.map((o) => (
                  <label
                    key={o.id}
                    className="flex min-h-11 items-center gap-2"
                  >
                    <input
                      type="checkbox"
                      checked={options.includes(o.id)}
                      onChange={(e) =>
                        setOptions((v) =>
                          e.target.checked
                            ? [...v, o.id]
                            : v.filter((id) => id !== o.id),
                        )
                      }
                    />
                    {o.name} + {bolivianos(o.price)}
                  </label>
                ))}
                <label className="sm:col-span-2">
                  Notas de cocina
                  <input
                    className={`${control} block w-full`}
                    maxLength={500}
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                  />
                </label>
                <button className={primary}>Guardar comanda</button>
              </fieldset>
            </form>
            <div className="space-y-3">
              {account.orders.map((o, i) => (
                <article
                  key={o.id}
                  aria-label={`Comanda ${i + 1}`}
                  className="rounded-xl border bg-zinc-50 p-3"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <label className="flex min-h-11 items-center gap-2">
                      <input
                        type="checkbox"
                        disabled={busy}
                        checked={picked.includes(o.id)}
                        onChange={(e) =>
                          setPicked((v) =>
                            e.target.checked
                              ? [...v, o.id]
                              : v.filter((id) => id !== o.id),
                          )
                        }
                      />
                      Comanda {i + 1} · {orderLabels[o.status]}
                    </label>
                    <span>
                      {bolivianos(o.sale.total)} · saldo{" "}
                      {bolivianos(
                        ["CANCELLED", "REFUNDED"].includes(o.sale.status)
                          ? 0
                          : balance(o) / 100,
                      )}
                    </span>
                  </div>
                  {o.snapshot.map((l, n) => (
                    <p key={n}>
                      {l.quantity} × {l.name}
                      {l.options.length
                        ? ` · ${l.options.map((x) => x.name).join(", ")}`
                        : ""}
                    </p>
                  ))}
                  {o.notes && <p>Nota: {o.notes}</p>}
                  {o.status === "DRAFT" && (
                    <button
                      disabled={busy}
                      className={`${primary} mt-2`}
                      onClick={() =>
                        post(
                          `${base}/accounts/${account.id}/orders/${o.id}/dispatch`,
                          {},
                        )
                      }
                    >
                      Enviar a cocina
                    </button>
                  )}
                  <Link
                    className="ml-3 inline-block min-h-11 py-2 underline"
                    href={`/sales/${o.saleId}`}
                  >
                    Ver venta
                  </Link>
                </article>
              ))}
            </div>
            <div className="grid gap-4 lg:grid-cols-2">
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  post(`${base}/accounts/${account.id}/move`, {
                    version: account.version,
                    tableId: targetTable,
                  });
                }}
              >
                <fieldset disabled={busy} className="space-y-2">
                  <label>
                    Trasladar a mesa
                    <select
                      className={`${control} block w-full`}
                      required
                      value={targetTable}
                      onChange={(e) => setTargetTable(e.target.value)}
                    >
                      <option value="">Selecciona destino</option>
                      {tables
                        .filter(
                          (t) =>
                            t.branchId === account.branchId &&
                            t.id !== account.tableId,
                        )
                        .map((t) => (
                          <option key={t.id} value={t.id}>
                            {t.name}
                          </option>
                        ))}
                    </select>
                  </label>
                  <button className={control}>Trasladar cuenta</button>
                </fieldset>
              </form>
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  post(`${base}/accounts/${account.id}/waiter`, {
                    version: account.version,
                    waiterId,
                  });
                }}
              >
                <fieldset disabled={busy} className="space-y-2">
                  <label>
                    Asignar mesero
                    <select
                      className={`${control} block w-full`}
                      required
                      value={waiterId}
                      onChange={(e) => setWaiterId(e.target.value)}
                    >
                      <option value="">Selecciona operador</option>
                      {waiters.map((w) => (
                        <option key={w.userId} value={w.userId}>
                          {w.user.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <button className={control}>Cambiar mesero</button>
                </fieldset>
              </form>
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  post(`${base}/accounts/${account.id}/split`, {
                    version: account.version,
                    orderIds: picked,
                    label: splitLabel,
                    requestKey: crypto.randomUUID(),
                  });
                }}
              >
                <fieldset disabled={busy} className="space-y-2">
                  <label>
                    Nombre de cuenta separada
                    <input
                      className={`${control} block w-full`}
                      required
                      maxLength={100}
                      value={splitLabel}
                      onChange={(e) => setSplitLabel(e.target.value)}
                    />
                  </label>
                  <p className="text-sm text-zinc-600">
                    Selecciona comandas completas para separar; sus pagos y
                    precios se conservan.
                  </p>
                  <button
                    className={control}
                    disabled={
                      !picked.length || picked.length >= account.orders.length
                    }
                  >
                    Dividir cuenta
                  </button>
                </fieldset>
              </form>
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  const source = accounts.find((a) => a.id === mergeId);
                  if (source)
                    post(`${base}/accounts/${account.id}/merge`, {
                      version: account.version,
                      sourceId: source.id,
                      sourceVersion: source.version,
                    });
                }}
              >
                <fieldset disabled={busy} className="space-y-2">
                  <label>
                    Unir otra cuenta a esta
                    <select
                      className={`${control} block w-full`}
                      required
                      value={mergeId}
                      onChange={(e) => setMergeId(e.target.value)}
                    >
                      <option value="">Selecciona cuenta</option>
                      {accounts
                        .filter(
                          (a) =>
                            a.id !== account.id &&
                            a.posTerminalId === account.posTerminalId &&
                            a.warehouseId === account.warehouseId,
                        )
                        .map((a) => (
                          <option key={a.id} value={a.id}>
                            {a.table.name} · {a.label}
                          </option>
                        ))}
                    </select>
                  </label>
                  <button className={control}>Unir cuentas</button>
                </fieldset>
              </form>
            </div>
            <form
              className="rounded-xl border border-emerald-300 p-4"
              onSubmit={(e) => {
                e.preventDefault();
                post(
                  `${base}/accounts/${account.id}/orders/${payOrder}/payments`,
                  {
                    method: payMethod,
                    amount: Number(payAmount),
                    idempotencyKey: crypto.randomUUID(),
                  },
                );
              }}
            >
              <h3 className="mb-3 font-semibold">Cobrar consumo (cajero)</h3>
              <fieldset disabled={busy} className="grid gap-3 sm:grid-cols-3">
                <label>
                  Comanda a cobrar
                  <select
                    className={`${control} block w-full`}
                    required
                    value={payOrder}
                    onChange={(e) => {
                      setPayOrder(e.target.value);
                      const o = account.orders.find(
                        (o) => o.id === e.target.value,
                      );
                      setPayAmount(o ? (balance(o) / 100).toFixed(2) : "");
                    }}
                  >
                    <option value="">Selecciona comanda</option>
                    {account.orders
                      .filter((o) =>
                        ["CONFIRMED", "PARTIALLY_PAID"].includes(o.sale.status),
                      )
                      .map((o) => (
                        <option key={o.id} value={o.id}>
                          {o.snapshot.map((l) => l.name).join(", ")} · saldo{" "}
                          {bolivianos(balance(o) / 100)}
                        </option>
                      ))}
                  </select>
                </label>
                <label>
                  Importe del pago
                  <input
                    className={`${control} block w-full`}
                    type="number"
                    min="0.01"
                    step="0.01"
                    required
                    value={payAmount}
                    onChange={(e) => setPayAmount(e.target.value)}
                  />
                </label>
                <label>
                  Método de pago
                  <select
                    className={`${control} block w-full`}
                    value={payMethod}
                    onChange={(e) => setPayMethod(e.target.value)}
                  >
                    {["CASH", "CARD", "TRANSFER", "QR"].map((m, i) => (
                      <option key={m} value={m}>
                        {
                          ["Efectivo", "Tarjeta", "Transferencia", "QR manual"][
                            i
                          ]
                        }
                      </option>
                    ))}
                  </select>
                </label>
                <p className="text-sm sm:col-span-3">
                  Puedes registrar pagos parciales con métodos distintos. El
                  cambio se entrega aparte; QR requiere confirmación manual.
                </p>
                <button className={primary}>Registrar pago</button>
              </fieldset>
            </form>
            <form
              className="rounded-xl border p-4"
              onSubmit={(e) => {
                e.preventDefault();
                post(`${base}/accounts/${account.id}/close`, {
                  version: account.version,
                  tipAmount: Number(tip),
                  tipMethod,
                });
              }}
            >
              <h3 className="mb-3 font-semibold">
                Cerrar cuenta y liberar mesa
              </h3>
              <fieldset disabled={busy} className="grid gap-3 sm:grid-cols-2">
                <label>
                  Propina voluntaria (Bs)
                  <input
                    className={`${control} block w-full`}
                    required
                    type="number"
                    min="0"
                    max="100000"
                    step="0.01"
                    value={tip}
                    onChange={(e) => setTip(e.target.value)}
                  />
                </label>
                <label>
                  Método de propina
                  <select
                    className={`${control} block w-full`}
                    value={tipMethod}
                    onChange={(e) => setTipMethod(e.target.value)}
                  >
                    {["CASH", "CARD", "TRANSFER", "QR"].map((m, i) => (
                      <option key={m} value={m}>
                        {
                          ["Efectivo", "Tarjeta", "Transferencia", "QR manual"][
                            i
                          ]
                        }
                      </option>
                    ))}
                  </select>
                </label>
                <p className="text-sm sm:col-span-2">
                  Todas las comandas deben estar cobradas y entregadas o
                  anuladas. La propina en efectivo entra en caja por separado
                  del consumo.
                </p>
                <button className={primary}>Cerrar cuenta</button>
              </fieldset>
            </form>
          </section>
        )}
      </main>
    </AppShell>
  );
}
