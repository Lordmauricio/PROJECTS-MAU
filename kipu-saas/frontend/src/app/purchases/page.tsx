"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import AppShell from "@/components/AppShell";
import { api } from "@/lib/api";
import { ApiError } from "@/lib/auth-context";

interface Supplier {
  id: string;
  name: string;
}

interface Product {
  id: string;
  name: string;
  cost: string;
}

interface Branch {
  warehouses: { id: string; name: string }[];
}

interface Purchase {
  id: string;
  status: string;
  total: string;
  createdAt: string;
  supplier?: { id: string; name: string } | null;
  _count?: { items: number };
}

interface PurchaseLine {
  productId: string;
  quantity: number;
  unitCost: number;
  discount: number;
}

const STATUS_LABELS: Record<string, string> = {
  DRAFT: "Borrador",
  CONFIRMED: "Confirmada",
  PARTIALLY_RECEIVED: "Recepción parcial",
  RECEIVED: "Recibida",
  CANCELLED: "Cancelada",
};

const STATUS_COLORS: Record<string, string> = {
  DRAFT: "bg-zinc-100 text-zinc-600",
  CONFIRMED: "bg-amber-50 text-amber-700",
  PARTIALLY_RECEIVED: "bg-amber-50 text-amber-700",
  RECEIVED: "bg-emerald-50 text-emerald-700",
  CANCELLED: "bg-red-50 text-red-700",
};

export default function PurchasesPage() {
  const [purchases, setPurchases] = useState<Purchase[]>([]);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [warehouseId, setWarehouseId] = useState("");
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [status, setStatus] = useState("");

  const [supplierId, setSupplierId] = useState("");
  const [lines, setLines] = useState<PurchaseLine[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function load() {
    setLoading(true);
    setLoadError(null);
    try {
      const query = status ? `?status=${status}` : "";
      const [p, s, prod, branches] = await Promise.all([
        api<Purchase[]>(`/purchases${query}`),
        api<Supplier[]>("/suppliers"),
        api<Product[]>("/products"),
        api<Branch[]>("/branches"),
      ]);
      setPurchases(p);
      setSuppliers(s);
      setProducts(prod);
      setWarehouseId(branches[0]?.warehouses[0]?.id ?? "");
    } catch (err) {
      setLoadError(err instanceof ApiError ? err.message : "No se pudo cargar las compras");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status]);

  const total = useMemo(
    () => lines.reduce((acc, l) => acc + l.quantity * l.unitCost - l.discount, 0),
    [lines],
  );

  function addLine() {
    if (products.length === 0) return;
    setLines((prev) => [...prev, { productId: products[0].id, quantity: 1, unitCost: Number(products[0].cost) || 0, discount: 0 }]);
  }

  function updateLine(index: number, patch: Partial<PurchaseLine>) {
    setLines((prev) => prev.map((l, i) => (i === index ? { ...l, ...patch } : l)));
  }

  function removeLine(index: number) {
    setLines((prev) => prev.filter((_, i) => i !== index));
  }

  async function createPurchase(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!supplierId || !warehouseId || lines.length === 0) {
      setError("Selecciona proveedor, almacén y al menos un producto");
      return;
    }
    setSubmitting(true);
    try {
      await api("/purchases", {
        method: "POST",
        body: {
          supplierId,
          warehouseId,
          items: lines.map((l) => ({ productId: l.productId, quantity: l.quantity, unitCost: l.unitCost, discount: l.discount })),
        },
      });
      setSupplierId("");
      setLines([]);
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "No se pudo crear la orden de compra");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <AppShell>
      <div className="p-6 max-w-5xl space-y-6">
        <h1 className="text-lg font-semibold">Compras</h1>
        {loadError && <p className="text-sm text-red-600 bg-red-50 rounded p-2">{loadError}</p>}

        <form onSubmit={createPurchase} className="bg-white rounded-lg border border-zinc-200 p-5 space-y-3">
          <h2 className="font-medium text-sm">Nueva orden de compra</h2>
          {error && <p className="text-sm text-red-600 bg-red-50 rounded p-2">{error}</p>}

          <select value={supplierId} onChange={(e) => setSupplierId(e.target.value)} className="rounded border border-zinc-300 px-3 py-1.5 text-sm w-full" required>
            <option value="">Proveedor...</option>
            {suppliers.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>

          {lines.map((line, i) => (
            <div key={i} className="flex gap-2 items-center text-sm">
              <select
                value={line.productId}
                onChange={(e) => updateLine(i, { productId: e.target.value })}
                className="flex-1 rounded border border-zinc-300 px-2 py-1"
              >
                {products.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
              <input
                type="number"
                min={0.01}
                step="0.01"
                value={line.quantity}
                onChange={(e) => updateLine(i, { quantity: Number(e.target.value) })}
                className="w-20 rounded border border-zinc-300 px-2 py-1"
                placeholder="Cant."
              />
              <input
                type="number"
                min={0}
                step="0.01"
                value={line.unitCost}
                onChange={(e) => updateLine(i, { unitCost: Number(e.target.value) })}
                className="w-24 rounded border border-zinc-300 px-2 py-1"
                placeholder="Costo"
              />
              <input
                type="number"
                min={0}
                step="0.01"
                value={line.discount}
                onChange={(e) => updateLine(i, { discount: Number(e.target.value) })}
                className="w-20 rounded border border-zinc-300 px-2 py-1"
                placeholder="Desc."
              />
              <button type="button" onClick={() => removeLine(i)} className="text-red-600 text-xs underline">
                Quitar
              </button>
            </div>
          ))}

          <button type="button" onClick={addLine} className="text-xs text-zinc-600 underline">
            + producto
          </button>

          <div className="flex justify-between items-center border-t border-zinc-200 pt-2">
            <span className="font-semibold text-sm">Total: Bs. {total.toFixed(2)}</span>
            <button disabled={submitting} className="bg-zinc-900 text-white rounded px-3 py-1.5 text-sm disabled:opacity-50">
              {submitting ? "Creando..." : "Crear orden"}
            </button>
          </div>
        </form>

        <select value={status} onChange={(e) => setStatus(e.target.value)} className="rounded border border-zinc-300 px-2 py-1.5 text-sm">
          <option value="">Todos los estados</option>
          {Object.entries(STATUS_LABELS).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>

        <div className="bg-white rounded-lg border border-zinc-200 overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-zinc-50 text-zinc-500 text-left">
              <tr>
                <th className="px-4 py-2">Fecha</th>
                <th className="px-4 py-2">Proveedor</th>
                <th className="px-4 py-2">Ítems</th>
                <th className="px-4 py-2">Total</th>
                <th className="px-4 py-2">Estado</th>
                <th className="px-4 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {purchases.map((p) => (
                <tr key={p.id} className="border-t border-zinc-100">
                  <td className="px-4 py-2">{new Date(p.createdAt).toLocaleString()}</td>
                  <td className="px-4 py-2">{p.supplier?.name ?? "-"}</td>
                  <td className="px-4 py-2">{p._count?.items ?? "-"}</td>
                  <td className="px-4 py-2">Bs. {Number(p.total).toFixed(2)}</td>
                  <td className="px-4 py-2">
                    <span className={`rounded px-2 py-0.5 text-xs ${STATUS_COLORS[p.status] ?? "bg-zinc-100"}`}>
                      {STATUS_LABELS[p.status] ?? p.status}
                    </span>
                  </td>
                  <td className="px-4 py-2 text-right">
                    <Link href={`/purchases/${p.id}`} className="text-xs text-zinc-600 underline">
                      Ver detalle
                    </Link>
                  </td>
                </tr>
              ))}
              {!loading && purchases.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-4 py-6 text-center text-zinc-400">
                    Sin órdenes de compra todavía
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </AppShell>
  );
}
