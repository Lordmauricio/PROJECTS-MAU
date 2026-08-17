"use client";

import { useEffect, useState } from "react";
import AppShell from "@/components/AppShell";
import { api } from "@/lib/api";
import { ApiError } from "@/lib/auth-context";

interface Product {
  id: string;
  name: string;
  sku?: string | null;
}

interface Warehouse {
  id: string;
  name: string;
}

interface StockRow {
  productId: string;
  warehouseId: string;
  quantity: string;
  product: { id: string; name: string; sku?: string | null };
  warehouse: { id: string; name: string };
}

interface MovementRow {
  id: string;
  type: string;
  quantity: string;
  reason?: string | null;
  reference?: string | null;
  createdAt: string;
  product: { name: string };
  warehouse: { name: string };
}

export default function InventoryMovementsPage() {
  const [products, setProducts] = useState<Product[]>([]);
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [stock, setStock] = useState<StockRow[]>([]);
  const [movements, setMovements] = useState<MovementRow[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [form, setForm] = useState({ productId: "", warehouseId: "", type: "IN", direction: "INCREASE", quantity: "", reason: "" });

  async function load() {
    setLoadError(null);
    try {
      const [p, branches, s, m] = await Promise.all([
        api<Product[]>("/products"),
        api<{ warehouses: Warehouse[] }[]>("/branches"),
        api<StockRow[]>("/inventory"),
        api<MovementRow[]>("/inventory/movements"),
      ]);
      setProducts(p);
      setWarehouses(branches.flatMap((b) => b.warehouses));
      setStock(s);
      setMovements(m);
    } catch (err) {
      setLoadError(err instanceof ApiError ? err.message : "No se pudo cargar el inventario");
    }
  }

  useEffect(() => {
    load();
  }, []);

  async function registerMovement(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      await api("/inventory/movements", {
        method: "POST",
        body: {
          productId: form.productId,
          warehouseId: form.warehouseId,
          type: form.type,
          direction: form.type === "ADJUSTMENT" ? form.direction : undefined,
          quantity: Number(form.quantity),
          reason: form.reason || undefined,
        },
      });
      setForm((f) => ({ ...f, quantity: "", reason: "" }));
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "No se pudo registrar el movimiento");
    }
  }

  return (
    <AppShell>
      <div className="p-6 max-w-4xl space-y-6">
        <h1 className="text-lg font-semibold">Movimientos de inventario</h1>
        <p className="text-sm text-zinc-500">
          Entrada manual y ajustes básicos, disponibles ahora para poder cargar stock mientras no existe el módulo de
          Compras. Transferencias entre almacenes y kardex avanzado llegan en una fase siguiente.
        </p>
        {loadError && <p className="text-sm text-red-600 bg-red-50 rounded p-2">{loadError}</p>}

        <form onSubmit={registerMovement} className="bg-white rounded-lg border border-zinc-200 p-5 space-y-3">
          <h2 className="font-medium text-sm">Registrar movimiento</h2>
          {error && <p className="text-sm text-red-600 bg-red-50 rounded p-2">{error}</p>}
          <div className="grid grid-cols-2 gap-3">
            <select
              value={form.productId}
              onChange={(e) => setForm((f) => ({ ...f, productId: e.target.value }))}
              className="rounded border border-zinc-300 px-3 py-1.5 text-sm"
              required
            >
              <option value="">Producto...</option>
              {products.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name} {p.sku ? `(${p.sku})` : ""}
                </option>
              ))}
            </select>
            <select
              value={form.warehouseId}
              onChange={(e) => setForm((f) => ({ ...f, warehouseId: e.target.value }))}
              className="rounded border border-zinc-300 px-3 py-1.5 text-sm"
              required
            >
              <option value="">Almacén...</option>
              {warehouses.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.name}
                </option>
              ))}
            </select>
            <select
              value={form.type}
              onChange={(e) => setForm((f) => ({ ...f, type: e.target.value }))}
              className="rounded border border-zinc-300 px-3 py-1.5 text-sm"
            >
              <option value="IN">Entrada (carga de stock)</option>
              <option value="ADJUSTMENT">Ajuste</option>
            </select>
            {form.type === "ADJUSTMENT" && (
              <select
                value={form.direction}
                onChange={(e) => setForm((f) => ({ ...f, direction: e.target.value }))}
                className="rounded border border-zinc-300 px-3 py-1.5 text-sm"
              >
                <option value="INCREASE">Incrementa stock</option>
                <option value="DECREASE">Reduce stock</option>
              </select>
            )}
            <input
              placeholder="Cantidad"
              type="number"
              min={0.01}
              step="0.01"
              value={form.quantity}
              onChange={(e) => setForm((f) => ({ ...f, quantity: e.target.value }))}
              className="rounded border border-zinc-300 px-3 py-1.5 text-sm"
              required
            />
            <input
              placeholder="Motivo (opcional)"
              value={form.reason}
              onChange={(e) => setForm((f) => ({ ...f, reason: e.target.value }))}
              className="rounded border border-zinc-300 px-3 py-1.5 text-sm"
            />
          </div>
          <button className="bg-zinc-900 text-white rounded px-3 py-1.5 text-sm">Registrar</button>
        </form>

        <div className="bg-white rounded-lg border border-zinc-200 overflow-hidden">
          <h2 className="px-4 py-2 font-medium text-sm border-b border-zinc-100">Stock actual</h2>
          <table className="w-full text-sm">
            <thead className="bg-zinc-50 text-zinc-500 text-left">
              <tr>
                <th className="px-4 py-2">Producto</th>
                <th className="px-4 py-2">Almacén</th>
                <th className="px-4 py-2">Cantidad</th>
              </tr>
            </thead>
            <tbody>
              {stock.map((s) => (
                <tr key={`${s.productId}-${s.warehouseId}`} className="border-t border-zinc-100">
                  <td className="px-4 py-2">{s.product.name}</td>
                  <td className="px-4 py-2">{s.warehouse.name}</td>
                  <td className="px-4 py-2">{Number(s.quantity)}</td>
                </tr>
              ))}
              {stock.length === 0 && (
                <tr>
                  <td colSpan={3} className="px-4 py-6 text-center text-zinc-400">
                    Sin stock cargado todavía
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        <div className="bg-white rounded-lg border border-zinc-200 overflow-hidden">
          <h2 className="px-4 py-2 font-medium text-sm border-b border-zinc-100">Historial de movimientos</h2>
          <table className="w-full text-sm">
            <thead className="bg-zinc-50 text-zinc-500 text-left">
              <tr>
                <th className="px-4 py-2">Fecha</th>
                <th className="px-4 py-2">Producto</th>
                <th className="px-4 py-2">Almacén</th>
                <th className="px-4 py-2">Tipo</th>
                <th className="px-4 py-2">Cantidad</th>
                <th className="px-4 py-2">Motivo</th>
              </tr>
            </thead>
            <tbody>
              {movements.map((m) => (
                <tr key={m.id} className="border-t border-zinc-100">
                  <td className="px-4 py-2">{new Date(m.createdAt).toLocaleString()}</td>
                  <td className="px-4 py-2">{m.product.name}</td>
                  <td className="px-4 py-2">{m.warehouse.name}</td>
                  <td className="px-4 py-2">{m.type}</td>
                  <td className="px-4 py-2">{Number(m.quantity)}</td>
                  <td className="px-4 py-2">{m.reason ?? "-"}</td>
                </tr>
              ))}
              {movements.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-4 py-6 text-center text-zinc-400">
                    Sin movimientos todavía
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
