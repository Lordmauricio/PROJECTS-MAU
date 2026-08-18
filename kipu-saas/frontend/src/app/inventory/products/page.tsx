"use client";

import { useEffect, useState } from "react";
import AppShell from "@/components/AppShell";
import { api } from "@/lib/api";
import { useSubmitGuard } from "@/lib/use-submit-guard";
import { ApiError } from "@/lib/auth-context";

interface Category {
  id: string;
  name: string;
}

interface Product {
  id: string;
  name: string;
  price: string;
  cost: string;
  sku?: string | null;
  category?: { id: string; name: string } | null;
  active: boolean;
}

export default function ProductsPage() {
  const [products, setProducts] = useState<Product[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [form, setForm] = useState({ name: "", price: "", sku: "", categoryId: "" });
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    setLoadError(null);
    try {
      const [p, c] = await Promise.all([
        api<Product[]>("/products"),
        api<Category[]>("/product-categories"),
      ]);
      setProducts(p);
      setCategories(c);
    } catch (err) {
      setLoadError(err instanceof ApiError ? err.message : "No se pudo cargar el catálogo de productos");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  async function addProductRequest(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      await api("/products", {
        method: "POST",
        body: {
          name: form.name,
          price: Number(form.price),
          sku: form.sku || undefined,
          categoryId: form.categoryId || undefined,
        },
      });
      setForm({ name: "", price: "", sku: "", categoryId: "" });
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "No se pudo crear el producto");
    }
  }

  async function removeProduct(id: string) {
    setError(null);
    try {
      await api(`/products/${id}`, { method: "DELETE" });
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "No se pudo eliminar el producto");
    }
  }

  async function duplicateProduct(id: string) {
    setError(null);
    try {
      await api(`/products/${id}/duplicate`, { method: "POST" });
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "No se pudo duplicar el producto");
    }
  }

  // Doble click: sin esto, dos clicks seguidos creaban dos registros
  // (ver `useSubmitGuard`).
  const { submitting: addProductSubmitting, onSubmit: addProduct } =
    useSubmitGuard(addProductRequest);

  return (
    <AppShell>
      <div className="p-6 max-w-4xl space-y-6">
        <h1 className="text-lg font-semibold">Productos</h1>
        {loadError && <p className="text-sm text-red-600 bg-red-50 rounded p-2">{loadError}</p>}

        <form onSubmit={addProduct} className="bg-white rounded-lg border border-zinc-200 p-5 space-y-3">
          <h2 className="font-medium text-sm">Nuevo producto</h2>
          {error && <p className="text-sm text-red-600 bg-red-50 rounded p-2">{error}</p>}
          <div className="grid grid-cols-2 gap-3">
            <input
              placeholder="Nombre"
              value={form.name}
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              className="rounded border border-zinc-300 px-3 py-1.5 text-sm"
              required
            />
            <input
              placeholder="Precio (Bs.)"
              type="number"
              step="0.01"
              value={form.price}
              onChange={(e) => setForm((f) => ({ ...f, price: e.target.value }))}
              className="rounded border border-zinc-300 px-3 py-1.5 text-sm"
              required
            />
            <input
              placeholder="SKU (opcional)"
              value={form.sku}
              onChange={(e) => setForm((f) => ({ ...f, sku: e.target.value }))}
              className="rounded border border-zinc-300 px-3 py-1.5 text-sm"
            />
            <select
              value={form.categoryId}
              onChange={(e) => setForm((f) => ({ ...f, categoryId: e.target.value }))}
              className="rounded border border-zinc-300 px-3 py-1.5 text-sm"
            >
              <option value="">Sin categoría</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>
          <button disabled={addProductSubmitting} className="bg-zinc-900 text-white rounded px-3 py-1.5 text-sm">Agregar producto</button>
        </form>

        <div className="bg-white rounded-lg border border-zinc-200 overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-zinc-50 text-zinc-500 text-left">
              <tr>
                <th className="px-4 py-2">Nombre</th>
                <th className="px-4 py-2">Categoría</th>
                <th className="px-4 py-2">SKU</th>
                <th className="px-4 py-2">Precio</th>
                <th className="px-4 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {products.map((p) => (
                <tr key={p.id} className="border-t border-zinc-100">
                  <td className="px-4 py-2">{p.name}</td>
                  <td className="px-4 py-2">{p.category?.name ?? "-"}</td>
                  <td className="px-4 py-2">{p.sku ?? "-"}</td>
                  <td className="px-4 py-2">Bs. {Number(p.price).toFixed(2)}</td>
                  <td className="px-4 py-2 text-right space-x-2">
                    <button onClick={() => duplicateProduct(p.id)} className="text-xs text-zinc-600 underline">
                      Duplicar
                    </button>
                    <button onClick={() => removeProduct(p.id)} className="text-xs text-red-600 underline">
                      Eliminar
                    </button>
                  </td>
                </tr>
              ))}
              {!loading && products.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-4 py-6 text-center text-zinc-400">
                    Sin productos todavía
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
