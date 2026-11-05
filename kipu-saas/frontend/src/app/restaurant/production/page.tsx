"use client";
import { useCallback, useRef, useState } from "react";
import Link from "next/link";
import AppShell from "@/components/AppShell";
import { api, ApiError } from "@/lib/api";
import { useRemoteLoad } from "@/lib/use-remote-load";
import { useSubmitGuard } from "@/lib/use-submit-guard";
import {
  businessTime,
  control,
  primary,
  type ProductionBatch,
} from "@/lib/restaurant";

interface Branch {
  id: string;
  name: string;
  warehouses: { id: string; name: string }[];
}
interface Product {
  id: string;
  name: string;
}
const labels: Record<string, string> = {
  DRAFT: "Planificada",
  PREPARING: "En preparación",
  READY: "Completada",
  CANCELLED: "Cancelada",
};
const blank = {
  name: "",
  station: "Parrilla",
  warehouseId: "",
  sourceProductId: "",
  outputProductId: "",
  sourceQuantity: "1",
  plannedQuantity: "1",
};
interface BatchRequest {
  name: string;
  station: string;
  warehouseId: string;
  sourceProductId: string;
  outputProductId: string;
  sourceQuantity: number;
  plannedQuantity: number;
  requestKey: string;
}

export default function ProductionPage() {
  const [batches, setBatches] = useState<ProductionBatch[]>([]);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [branchId, setBranchId] = useState("");
  const [filter, setFilter] = useState("");
  const [form, setForm] = useState(blank);
  const [lotCodes, setLotCodes] = useState<Record<string,string>>({});
  const [expiry, setExpiry] = useState<Record<string,string>>({});
  const [actuals, setActuals] = useState<Record<string, string>>({});
  const [reasons, setReasons] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [uncertain, setUncertain] = useState(false);
  const attempt = useRef<BatchRequest | null>(null);
  const fetchData = useCallback(
    () =>
      Promise.all([
        api<ProductionBatch[]>(
          `/restaurant/batches${branchId ? `?branchId=${encodeURIComponent(branchId)}` : ""}`,
        ),
        api<Branch[]>("/branches"),
        api<Product[]>("/products"),
      ]),
    [branchId],
  );
  const receive = useCallback(
    ([b, branches, products]: Awaited<ReturnType<typeof fetchData>>) => {
      setBatches(b);
      setBranches(branches);
      setProducts(products);
      setForm((f) => ({
        ...f,
        warehouseId: f.warehouseId || branches[0]?.warehouses[0]?.id || "",
      }));
    },
    [],
  );
  const {
    loading,
    error: loadError,
    reload,
  } = useRemoteLoad(fetchData, receive, "No se pudo cargar producción");
  const create = useSubmitGuard(async (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);
    setNotice(null);
    const body = attempt.current ?? {
      ...form,
      sourceQuantity: Number(form.sourceQuantity),
      plannedQuantity: Number(form.plannedQuantity),
      requestKey: crypto.randomUUID(),
    };
    attempt.current = body;
    try {
      await api("/restaurant/batches", { method: "POST", body });
      attempt.current = null;
      setUncertain(false);
      setForm((f) => ({ ...f, name: "" }));
      setNotice("Tanda planificada. El stock crudo se consumirá al iniciar.");
      await reload();
    } catch (err) {
      if (err instanceof ApiError && [400, 403, 404].includes(err.status)) {
        attempt.current = null;
        setUncertain(false);
      } else setUncertain(true);
      setError(
        err instanceof ApiError
          ? err.message
          : "No se recibió confirmación. Reintenta para recuperar la misma tanda.",
      );
    }
  });
  const action = useSubmitGuard(
    async (batch: ProductionBatch, status: string) => {
      setError(null);
      setNotice(null);
      if (status === "CANCELLED" && !reasons[batch.id]?.trim()) {
        setError("Escribe el motivo antes de cancelar la tanda.");
        return;
      }
      try {
        await api(`/restaurant/batches/${batch.id}/status`, {
          method: "POST",
          body: {
            status,
            version: batch.version,
            ...(status === "READY"
              ? {
                  ...(lotCodes[batch.id]?{lotCode:lotCodes[batch.id],...(expiry[batch.id]?{expiresOn:expiry[batch.id]}:{})}:{}),
                  producedQuantity: Number(
                    actuals[batch.id] ?? batch.plannedQuantity,
                  ),
                }
              : {}),
            ...(status === "CANCELLED" ? { reason: reasons[batch.id] } : {}),
          },
        });
        setNotice(
          status === "READY"
            ? "Producción registrada en el almacén."
            : status === "PREPARING"
              ? "Tanda iniciada; producto crudo consumido."
              : "Tanda cancelada. No se repone automáticamente producto consumido.",
        );
        await reload();
      } catch (err) {
        setError(
          err instanceof ApiError
            ? err.message
            : "No se recibió confirmación. Actualiza y revisa el estado antes de reintentar.",
        );
        await reload();
      }
    },
  );
  const busy = create.submitting || action.submitting;
  return (
    <AppShell>
      <div className="mx-auto max-w-6xl space-y-6 p-4 md:p-8">
        <header className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-widest text-emerald-800">
              KIPU · Producción
            </p>
            <h1 className="mt-2 text-3xl font-semibold">
              Producción por tandas
            </h1>
            <p className="mt-2 text-sm text-zinc-600">
              Del producto crudo al preparado, con cantidades registradas una
              sola vez.
            </p>
          </div>
          <Link className={control} href="/restaurant/kitchen">
            Ver cocina →
          </Link>
        </header>
        {(error || loadError) && (
          <div role="alert" className="rounded-xl bg-red-50 p-4 text-red-900">
            {error || loadError}
            <button className={`${control} ml-2`} onClick={() => void reload()}>
              Actualizar
            </button>
          </div>
        )}
        {notice && (
          <p
            role="status"
            className="rounded-xl bg-emerald-50 p-4 text-emerald-950"
          >
            {notice}
          </p>
        )}
        <form
          onSubmit={create.onSubmit}
          className="space-y-4 rounded-2xl border border-zinc-200 bg-white p-5"
        >
          <h2 className="text-lg font-semibold">Planificar tanda</h2>
          <p className="text-sm text-zinc-600">
            Usa productos distintos para crudo y preparado. Configura las
            porciones del menú para consumir el producto preparado, por ejemplo
            0.25 de pollo por cuarto.
          </p>
          <fieldset
            disabled={busy || uncertain}
            className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3"
          >
            <label className="text-sm">
              Nombre de la tanda
              <input
                required
                maxLength={100}
                className={`${control} mt-1 w-full`}
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
              />
            </label>
            <label className="text-sm">
              Estación
              <input
                required
                maxLength={60}
                className={`${control} mt-1 w-full`}
                value={form.station}
                onChange={(e) => setForm({ ...form, station: e.target.value })}
              />
            </label>
            <label className="text-sm">
              Almacén
              <select
                required
                className={`${control} mt-1 w-full`}
                value={form.warehouseId}
                onChange={(e) =>
                  setForm({ ...form, warehouseId: e.target.value })
                }
              >
                <option value="">Selecciona almacén</option>
                {branches.flatMap((b) =>
                  b.warehouses.map((w) => (
                    <option key={w.id} value={w.id}>
                      {b.name} · {w.name}
                    </option>
                  )),
                )}
              </select>
            </label>
            <label className="text-sm">
              Producto crudo
              <select
                required
                className={`${control} mt-1 w-full`}
                value={form.sourceProductId}
                onChange={(e) =>
                  setForm({ ...form, sourceProductId: e.target.value })
                }
              >
                <option value="">Selecciona producto</option>
                {products.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-sm">
              Cantidad cruda a consumir
              <input
                required
                type="number"
                min="0.01"
                max="10000"
                step="0.01"
                className={`${control} mt-1 w-full`}
                value={form.sourceQuantity}
                onChange={(e) =>
                  setForm({ ...form, sourceQuantity: e.target.value })
                }
              />
            </label>
            <label className="text-sm">
              Producto preparado
              <select
                required
                className={`${control} mt-1 w-full`}
                value={form.outputProductId}
                onChange={(e) =>
                  setForm({ ...form, outputProductId: e.target.value })
                }
              >
                <option value="">Selecciona producto</option>
                {products
                  .filter((p) => p.id !== form.sourceProductId)
                  .map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
              </select>
            </label>
            <label className="text-sm">
              Producción prevista
              <input
                required
                type="number"
                min="0.01"
                max="10000"
                step="0.01"
                className={`${control} mt-1 w-full`}
                value={form.plannedQuantity}
                onChange={(e) =>
                  setForm({ ...form, plannedQuantity: e.target.value })
                }
              />
            </label>
          </fieldset>
          <button disabled={busy || !products.length} className={primary}>
            {create.submitting
              ? "Guardando…"
              : uncertain
                ? "Recuperar la misma tanda"
                : "Planificar tanda"}
          </button>
        </form>
        <div className="flex flex-wrap gap-3">
          <label className="text-sm">
            Sucursal
            <select
              className={`${control} ml-2`}
              value={branchId}
              onChange={(e) => setBranchId(e.target.value)}
            >
              <option value="">Todas</option>
              {branches.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </select>
          </label>
          <label className="text-sm">
            Estado
            <select
              className={`${control} ml-2`}
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
            >
              <option value="">Todos</option>
              {Object.entries(labels).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <button className={control} onClick={() => void reload()}>
            Actualizar tandas
          </button>
        </div>
        {loading && !batches.length && <p role="status">Cargando tandas…</p>}
        <div className="grid items-start gap-4 md:grid-cols-2">
          {batches
            .filter((b) => !filter || b.status === filter)
            .map((batch) => (
              <article
                key={batch.id}
                aria-label={`Tanda ${batch.name}`}
                className="space-y-3 rounded-2xl border border-zinc-200 bg-white p-5"
              >
                <header className="flex flex-wrap justify-between gap-2">
                  <h2 className="text-lg font-semibold">{batch.name}</h2>
                  <span className="rounded-full bg-zinc-100 px-3 py-1 text-xs">
                    {labels[batch.status]}
                  </span>
                </header>
                <p className="text-xs text-zinc-500">
                  {batch.station} · {businessTime(batch.createdAt)}
                </p>
                <p className="text-sm">
                  Crudo: {batch.sourceQuantity} × {batch.sourceName}
                </p>
                <p className="text-sm">
                  Previsto: {batch.plannedQuantity} × {batch.outputName}
                </p>
                {batch.producedQuantity && (
                  <p className="font-medium text-emerald-900">
                    Producción registrada: {batch.producedQuantity} ×{" "}
                    {batch.outputName}
                  </p>
                )}
                {batch.cancelReason && (
                  <p className="rounded-xl bg-amber-50 p-3 text-sm">
                    Motivo: {batch.cancelReason}
                  </p>
                )}
                {batch.status === "DRAFT" && (
                  <button
                    disabled={busy || loading}
                    className={primary}
                    onClick={() => action.onSubmit(batch, "PREPARING")}
                  >
                    Iniciar tanda
                  </button>
                )}
                {batch.status === "PREPARING" && (
                  <div className="space-y-2">
                    <label className="block text-sm">
                      Cantidad preparada real
                      <input
                        disabled={busy}
                        type="number"
                        min="0.01"
                        max="10000"
                        step="0.01"
                        className={`${control} mt-1 w-full`}
                        value={actuals[batch.id] ?? batch.plannedQuantity}
                        onChange={(e) =>
                          setActuals({ ...actuals, [batch.id]: e.target.value })
                        }
                      />
                    </label>
                    <label className="block text-sm">Lote preparado<input className={`${control} block w-full`} value={lotCodes[batch.id]??''} onChange={e=>setLotCodes(v=>({...v,[batch.id]:e.target.value}))}/></label>
                    <label className="block text-sm">Vencimiento preparado<input type="date" className={`${control} block w-full`} value={expiry[batch.id]??''} onChange={e=>setExpiry(v=>({...v,[batch.id]:e.target.value}))}/></label>
                    <button
                      disabled={busy || loading}
                      className={primary}
                      onClick={() => action.onSubmit(batch, "READY")}
                    >
                      Registrar producción
                    </button>
                  </div>
                )}
                {["DRAFT", "PREPARING"].includes(batch.status) && (
                  <details className="border-t border-zinc-100 pt-3">
                    <summary className="min-h-11 cursor-pointer text-sm text-red-800">
                      Cancelar tanda
                    </summary>
                    <label className="block text-sm">
                      Motivo de cancelación
                      <input
                        disabled={busy}
                        maxLength={500}
                        className={`${control} mt-1 w-full`}
                        value={reasons[batch.id] ?? ""}
                        onChange={(e) =>
                          setReasons({ ...reasons, [batch.id]: e.target.value })
                        }
                      />
                    </label>
                    {batch.status === "PREPARING" && (
                      <p className="mt-2 text-xs text-amber-900">
                        El producto crudo ya se consumió. Cancelar no lo
                        devuelve al almacén.
                      </p>
                    )}
                    <button
                      disabled={busy || loading}
                      className={`${control} mt-2 text-red-800`}
                      onClick={() => action.onSubmit(batch, "CANCELLED")}
                    >
                      Confirmar cancelación
                    </button>
                  </details>
                )}
              </article>
            ))}
        </div>
        {!loading && !batches.some((b) => !filter || b.status === filter) && (
          <p className="rounded-2xl border border-dashed border-zinc-300 p-8 text-center text-zinc-600">
            No hay tandas en este estado.
          </p>
        )}
        <p className="text-xs text-zinc-500">
          Las existencias preparadas disponibles se consultan en caja; esta
          lista muestra producción registrada, no saldo individual por tanda. No
          agrega costos, lotes ni vencimientos automáticamente.
        </p>
      </div>
    </AppShell>
  );
}
