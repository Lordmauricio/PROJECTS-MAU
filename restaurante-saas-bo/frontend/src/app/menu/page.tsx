"use client";

import { useEffect, useState } from "react";
import AppShell from "@/components/AppShell";
import { api, ApiError } from "@/lib/api";
import { Category, Product } from "@/lib/types";

export default function MenuPage() {
  const [categories, setCategories] = useState<Category[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [newCategory, setNewCategory] = useState("");
  const [newProduct, setNewProduct] = useState({ name: "", price: "", categoryId: "" });
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setCategories(await api<Category[]>("/menu/categories"));
    setProducts(await api<Product[]>("/menu/products"));
  }

  useEffect(() => {
    load();
  }, []);

  async function addCategory(e: React.FormEvent) {
    e.preventDefault();
    if (!newCategory.trim()) return;
    try {
      await api("/menu/categories", { method: "POST", body: { name: newCategory } });
      setNewCategory("");
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Error al crear categoria");
    }
  }

  async function addProduct(e: React.FormEvent) {
    e.preventDefault();
    if (!newProduct.name.trim() || !newProduct.price) return;
    try {
      await api("/menu/products", {
        method: "POST",
        body: {
          name: newProduct.name,
          price: Number(newProduct.price),
          categoryId: newProduct.categoryId || undefined,
        },
      });
      setNewProduct({ name: "", price: "", categoryId: "" });
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Error al crear producto");
    }
  }

  async function deleteProduct(id: string) {
    await api(`/menu/products/${id}`, { method: "DELETE" });
    load();
  }

  return (
    <AppShell>
      <div className="p-6 max-w-4xl space-y-8">
        <h1 className="text-lg font-semibold">Menu</h1>
        {error && <p className="text-sm text-red-600 bg-red-50 rounded p-2">{error}</p>}

        <section>
          <h2 className="font-medium mb-2">Categorias</h2>
          <form onSubmit={addCategory} className="flex gap-2 mb-3">
            <input
              value={newCategory}
              onChange={(e) => setNewCategory(e.target.value)}
              placeholder="Nueva categoria"
              className="rounded border border-zinc-300 px-3 py-1.5 text-sm flex-1 max-w-xs"
            />
            <button className="bg-zinc-900 text-white rounded px-3 py-1.5 text-sm">Agregar</button>
          </form>
          <div className="flex gap-2 flex-wrap">
            {categories.map((c) => (
              <span key={c.id} className="bg-white border border-zinc-200 rounded-full px-3 py-1 text-sm">
                {c.name}
              </span>
            ))}
          </div>
        </section>

        <section>
          <h2 className="font-medium mb-2">Productos</h2>
          <form onSubmit={addProduct} className="flex gap-2 mb-4 flex-wrap items-end">
            <div>
              <label className="block text-xs text-zinc-500 mb-1">Nombre</label>
              <input
                value={newProduct.name}
                onChange={(e) => setNewProduct((p) => ({ ...p, name: e.target.value }))}
                className="rounded border border-zinc-300 px-3 py-1.5 text-sm"
              />
            </div>
            <div>
              <label className="block text-xs text-zinc-500 mb-1">Precio (Bs.)</label>
              <input
                type="number"
                step="0.01"
                value={newProduct.price}
                onChange={(e) => setNewProduct((p) => ({ ...p, price: e.target.value }))}
                className="rounded border border-zinc-300 px-3 py-1.5 text-sm w-28"
              />
            </div>
            <div>
              <label className="block text-xs text-zinc-500 mb-1">Categoria</label>
              <select
                value={newProduct.categoryId}
                onChange={(e) => setNewProduct((p) => ({ ...p, categoryId: e.target.value }))}
                className="rounded border border-zinc-300 px-3 py-1.5 text-sm"
              >
                <option value="">Sin categoria</option>
                {categories.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </div>
            <button className="bg-zinc-900 text-white rounded px-3 py-1.5 text-sm">Agregar producto</button>
          </form>

          <div className="bg-white rounded-lg border border-zinc-200 divide-y divide-zinc-100">
            {products.map((p) => (
              <div key={p.id} className="flex items-center justify-between px-4 py-2 text-sm">
                <span>{p.name}</span>
                <div className="flex items-center gap-3">
                  <span className="text-zinc-500">Bs. {Number(p.price).toFixed(2)}</span>
                  <button onClick={() => deleteProduct(p.id)} className="text-red-600 text-xs">
                    Eliminar
                  </button>
                </div>
              </div>
            ))}
            {products.length === 0 && <p className="px-4 py-6 text-center text-zinc-400">Sin productos</p>}
          </div>
        </section>
      </div>
    </AppShell>
  );
}
