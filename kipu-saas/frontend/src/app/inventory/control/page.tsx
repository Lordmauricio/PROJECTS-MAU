"use client";
import { useCallback, useState } from "react";
import Link from "next/link";
import LotHistory from '@/components/LotHistory';
import AppShell from "@/components/AppShell";
import { api } from "@/lib/api";
import { useRemoteLoad } from "@/lib/use-remote-load";
import { useRecordedAction } from "@/lib/use-recorded-action";
import { bolivianos, businessTime, control, primary } from "@/lib/restaurant";
interface Product {
  id: string;
  name: string;
  requireLots: boolean;
  unit?: { symbol: string } | null;
}
interface Branch {
  id: string;
  name: string;
  warehouses: { id: string; name: string }[];
}
interface Lot {
  id: string;
  productId: string;
  warehouseId: string;
  code: string;
  expiresOn: string | null;
  blocked: boolean;
  quantity: string;
  product: { name: string };
}
interface Stock {
  productId: string;
  quantity: string;
  availableQuantity: string;
  untrackedQuantity: string;
  unavailableQuantity: string;
}
interface Operation {
  id: string;
  kind: string;
  createdAt: string;
  snapshot: {
    productName: string;
    lotCode?: string;
    quantity: string;
    before?: string;
    after?: string;
    referenceCost?: string;
    reason: string;
  };
}
interface Data {
  stocks: Stock[];
  lots: Lot[];
  operations: Operation[];
  businessDate: string;
}
const labels: Record<string, string> = {
  RECEIPT: "Entrada con lote",
  CLASSIFY: "Clasificar existencia sin lote",
  COUNT: "Conteo físico",
  WASTE: "Merma",
  STAFF: "Consumo del personal",
};
export default function StockControlPage() {
  const [products, setProducts] = useState<Product[]>([]),
    [branches, setBranches] = useState<Branch[]>([]),
    [data, setData] = useState<Data | null>(null),
    [warehouse, setWarehouse] = useState("");
  const [historyLot,setHistoryLot]=useState('');
  const [product, setProduct] = useState(""),
    [kind, setKind] = useState("RECEIPT"),
    [lotId, setLot] = useState(""),
    [lotCode, setCode] = useState(""),
    [expiresOn, setExpiry] = useState(""),
    [quantity, setQuantity] = useState("1"),
    [reason, setReason] = useState("");
  const load = useCallback(
    () =>
      Promise.all([
        api<Data>(
          `/inventory/control${warehouse ? `?warehouseId=${encodeURIComponent(warehouse)}` : ""}`,
        ),
        api<Product[]>("/products"),
        api<Branch[]>("/branches"),
      ]),
    [warehouse],
  );
  const receive = useCallback(([d, p, b]: Awaited<ReturnType<typeof load>>) => {
    setData(d);
    setProducts(p);
    setBranches(b);
    setWarehouse((w) => w || b[0]?.warehouses[0]?.id || "");
  }, []);
  const {
    reload,
    loading,
    error: loadError,
  } = useRemoteLoad(load, receive, "No se pudo cargar stock");
  const action = useRecordedAction(reload);
  const selectedProduct = products.find((p) => p.id === product);
  const stock = data?.stocks.find((s) => s.productId === product);
  const selectedLot = data?.lots.find((l) => l.id === lotId);
  const expired = (l: Lot) =>
    l.blocked ||
    (l.expiresOn !== null &&
      l.expiresOn.slice(0, 10) < (data?.businessDate ?? ""));
  return (
    <AppShell>
      <main className="mx-auto max-w-6xl space-y-5 p-4 sm:p-6">
        <header className="flex flex-wrap justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold">Lotes y control de stock</h1>
            <p className="text-sm text-zinc-600">
              Conteos, mermas y consumo del personal · vencimiento al final del
              día de Bolivia
            </p>
          </div>
          <Link className={control} href="/restaurant/recipes">
            Recetas y rendimientos
          </Link>
        </header>
        {(action.error || loadError) && (
          <p role="alert" className="rounded-xl bg-red-50 p-3 text-red-800">
            {action.error || loadError}
          </p>
        )}
        {action.notice && <p role="status">{action.notice}</p>}
        {action.uncertain && (
          <aside className="rounded-xl bg-amber-50 p-4">
            La respuesta no se confirmó. Mantén esta pestaña abierta.
            <button className={primary} onClick={() => void action.retry()}>
              Reintentar operación
            </button>
          </aside>
        )}
        <div className="flex flex-wrap gap-3">
          <label>
            Almacén
            <select
              disabled={action.busy || loading}
              className={`${control} ml-2 max-w-full`}
              value={warehouse}
              onChange={(e) => {
                setWarehouse(e.target.value);
                setLot("");
              }}
            >
              {branches.flatMap((b) =>
                b.warehouses.map((w) => (
                  <option key={w.id} value={w.id}>
                    {b.name} · {w.name}
                  </option>
                )),
              )}
            </select>
          </label>
          <button className={control} onClick={reload} disabled={action.busy || loading}>
            Actualizar stock
          </button>
        </div>
        {loading && <p role="status">Cargando…</p>}
        <form
          className="rounded-2xl border bg-white p-4"
          onSubmit={(e) => {
            e.preventDefault();
            void action.run("/inventory/control", {
              warehouseId: warehouse,
              productId: product,
              kind,
              quantity: Number(quantity),
              reason,
              requestKey: crypto.randomUUID(),
              ...(["RECEIPT", "CLASSIFY"].includes(kind)
                ? {
                    ...(lotCode ? { lotCode } : {}),
                    ...(expiresOn ? { expiresOn } : {}),
                  }
                : lotId
                  ? { lotId }
                  : {}),
              ...(kind === "COUNT"
                ? {
                    expectedQuantity: Number(
                      selectedLot?.quantity ?? stock?.quantity ?? 0,
                    ),
                  }
                : {}),
            });
          }}
        >
          <h2 className="mb-3 text-lg font-semibold">Registrar operación</h2>
          <fieldset
            disabled={action.busy || loading}
            className="grid gap-3 sm:grid-cols-2"
          >
            <label>
              Producto
              <select
                required
                className={`${control} block w-full`}
                value={product}
                onChange={(e) => {
                  setProduct(e.target.value);
                  setLot("");
                }}
              >
                <option value="">Selecciona producto</option>
                {products.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name} ({p.unit?.symbol || "u"})
                  </option>
                ))}
              </select>
            </label>
            <label>
              Tipo de operación
              <select
                className={`${control} block w-full`}
                value={kind}
                onChange={(e) => {
                  setKind(e.target.value);
                  setLot("");
                }}
              >
                {Object.entries(labels).map(([k, v]) => (
                  <option key={k} value={k}>
                    {v}
                  </option>
                ))}
              </select>
            </label>
            {["RECEIPT", "CLASSIFY"].includes(kind) ? (
              <>
                <label>
                  Código de lote
                  <input
                    className={`${control} block w-full`}
                    required={
                      kind === "CLASSIFY" || !!selectedProduct?.requireLots
                    }
                    maxLength={100}
                    value={lotCode}
                    onChange={(e) => setCode(e.target.value)}
                  />
                </label>
                <label>
                  Fecha de vencimiento
                  <input
                    className={`${control} block w-full`}
                    type="date"
                    value={expiresOn}
                    onChange={(e) => setExpiry(e.target.value)}
                  />
                </label>
              </>
            ) : (
              <label>
                Lote
                <select
                  className={`${control} block w-full`}
                  value={lotId}
                  onChange={(e) => setLot(e.target.value)}
                >
                  <option value="">
                    {kind === "COUNT"
                      ? "Existencia total (solo sin lotes)"
                      : "Selección automática por vencimiento"}
                  </option>
                  {data?.lots
                    .filter(
                      (l) =>
                        l.productId === product && l.warehouseId === warehouse,
                    )
                    .map((l) => (
                      <option key={l.id} value={l.id}>
                        {l.code} · {l.quantity}
                        {expired(l) ? " · No vendible" : ""}
                      </option>
                    ))}
                </select>
              </label>
            )}
            <label>
              {kind === "COUNT" ? "Cantidad contada" : "Cantidad de operación"}
              <input
                className={`${control} block w-full`}
                type="number"
                min={kind === "COUNT" ? "0" : "0.01"}
                max="1000000"
                step="0.01"
                required
                value={quantity}
                onChange={(e) => setQuantity(e.target.value)}
              />
            </label>
            <label>
              Motivo
              <input
                className={`${control} block w-full`}
                maxLength={500}
                required
                value={reason}
                onChange={(e) => setReason(e.target.value)}
              />
            </label>
            <p className="text-sm sm:col-span-2">
              {kind === "CLASSIFY"
                ? "Clasificar no aumenta la existencia: identifica stock ya registrado."
                : kind === "COUNT"
                  ? `Saldo observado: ${selectedLot?.quantity ?? stock?.quantity ?? "0"}. Si cambia, el servidor rechazará el conteo.`
                  : kind === "RECEIPT"
                    ? "Entrada manual: no genera compra ni cuenta por pagar. Para compras, registra el lote en la recepción de la orden."
                    : kind === "STAFF"
                      ? "El consumo del personal usa solo existencia apta."
                      : "La merma puede retirar lotes vencidos; no modifica ingresos de caja."}
            </p>
            <button className={primary}>Registrar stock</button>
          </fieldset>
        </form>
        {selectedProduct && (
          <aside className="space-y-2 rounded-xl border p-4">
            <h2 className="font-semibold">
              {selectedProduct.name} · trazabilidad
            </h2>
            <p>
              Existencia física: {stock?.quantity ?? "0"} · Disponible:{" "}
              {stock?.availableQuantity ?? "0"} · Sin lote:{" "}
              {stock?.untrackedQuantity ?? "0"} · Vencido/bloqueado:{" "}
              {stock?.unavailableQuantity ?? "0"}
            </p>
            <p>
              {selectedProduct.requireLots
                ? "Lote obligatorio en nuevas entradas."
                : "Se permiten entradas sin lote; los lotes conocidos conservan sus vencimientos."}
            </p>
            <button
              className={control}
              disabled={action.busy || loading}
              onClick={() =>
                void action.run(
                  `/inventory/control/products/${product}/tracking`,
                  { required: !selectedProduct.requireLots },
                )
              }
            >
              {selectedProduct.requireLots
                ? "Permitir entradas sin lote"
                : "Exigir lotes"}
            </button>
          </aside>
        )}
        <section
          aria-label="Lotes registrados"
          className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3"
        >
          {data?.lots.map((l) => (
            <article
              key={l.id}
              className={`rounded-xl border p-4 ${expired(l) ? "border-red-300 bg-red-50" : ""}`}
            >
              <h2 className="font-semibold">
                {l.product.name} · {l.code}
              </h2>
              <p>Existencia: {l.quantity}</p>
              <p>
                {l.expiresOn
                  ? `Vence ${l.expiresOn.slice(0, 10)}`
                  : "Sin vencimiento declarado"}
              </p>
              <p>
                {expired(l)
                  ? "No disponible para venta o consumo"
                  : "Apto según fecha registrada"}
              </p>
              <button className="min-h-11 underline" onClick={()=>setHistoryLot(v=>v===l.id?'':l.id)}>{historyLot===l.id?'Cerrar historial':'Ver historial'}</button>{historyLot===l.id&&<LotHistory lotId={l.id}/>}
            </article>
          ))}
        </section>
        <section aria-label="Operaciones registradas" className="space-y-3">
          <h2 className="text-lg font-semibold">Historial de control</h2>
          {data?.operations.map((o) => (
            <article key={o.id} className="rounded-xl border p-3">
              <h3 className="font-semibold">
                {labels[o.kind]} · {o.snapshot.productName}
              </h3>
              <p>
                {o.snapshot.lotCode ?? "Sin lote"} · {o.snapshot.quantity} ·{" "}
                {businessTime(o.createdAt)}
              </p>
              {o.snapshot.before !== undefined && (
                <p>
                  Antes {o.snapshot.before} → después {o.snapshot.after}
                </p>
              )}
              {o.snapshot.referenceCost !== undefined && (
                <p>
                  Costo de referencia: {bolivianos(o.snapshot.referenceCost)}
                </p>
              )}
              <p>{o.snapshot.reason}</p>
            </article>
          ))}
        </section>
      </main>
    </AppShell>
  );
}
