"use client";

import { useEffect, useState } from "react";
import AppShell from "@/components/AppShell";
import { api } from "@/lib/api";
import { ApiError } from "@/lib/auth-context";

interface Category {
  id: string;
  name: string;
  sortOrder: number;
}

export default function CategoriesPage() {
  const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    setLoadError(null);
    try {
      setCategories(await api<Category[]>("/product-categories"));
    } catch (err) {
      setLoadError(err instanceof ApiError ? err.message : "No se pudo cargar las categorías");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  async function addCategory(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!name.trim()) return;
    try {
      await api("/product-categories", { method: "POST", body: { name } });
      setName("");
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "No se pudo crear la categoría");
    }
  }

  return (
    <AppShell>
      <div className="p-6 max-w-2xl space-y-6">
        <h1 className="text-lg font-semibold">Categorías de producto</h1>
        {loadError && <p className="text-sm text-red-600 bg-red-50 rounded p-2">{loadError}</p>}
        {error && <p className="text-sm text-red-600 bg-red-50 rounded p-2">{error}</p>}
        <form onSubmit={addCategory} className="flex gap-2">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Nueva categoría"
            className="rounded border border-zinc-300 px-3 py-1.5 text-sm flex-1"
          />
          <button className="bg-zinc-900 text-white rounded px-3 py-1.5 text-sm">Agregar</button>
        </form>
        <div className="bg-white rounded-lg border border-zinc-200 divide-y divide-zinc-100">
          {categories.map((c) => (
            <div key={c.id} className="px-4 py-2 text-sm">
              {c.name}
            </div>
          ))}
          {categories.length === 0 && <p className="px-4 py-6 text-center text-zinc-400 text-sm">Sin categorías</p>}
        </div>
      </div>
    </AppShell>
  );
}
