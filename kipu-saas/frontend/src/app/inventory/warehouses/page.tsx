"use client";

import { useEffect, useState } from "react";
import AppShell from "@/components/AppShell";
import { api } from "@/lib/api";
import { ApiError } from "@/lib/auth-context";

interface Branch {
  id: string;
  name: string;
}

interface Warehouse {
  id: string;
  name: string;
  branchId: string;
  active: boolean;
}

export default function WarehousesPage() {
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [form, setForm] = useState({ name: "", branchId: "" });
  const [error, setError] = useState<string | null>(null);

  async function load() {
    const [w, b] = await Promise.all([api<Warehouse[]>("/warehouses"), api<Branch[]>("/branches")]);
    setWarehouses(w);
    setBranches(b);
    if (b.length > 0) setForm((f) => ({ ...f, branchId: f.branchId || b[0].id }));
  }

  useEffect(() => {
    load();
  }, []);

  async function addWarehouse(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      await api("/warehouses", { method: "POST", body: form });
      setForm((f) => ({ ...f, name: "" }));
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "No se pudo crear el almacén");
    }
  }

  function branchName(id: string) {
    return branches.find((b) => b.id === id)?.name ?? "-";
  }

  return (
    <AppShell>
      <div className="p-6 max-w-2xl space-y-6">
        <h1 className="text-lg font-semibold">Almacenes</h1>
        {error && <p className="text-sm text-red-600 bg-red-50 rounded p-2">{error}</p>}
        <form onSubmit={addWarehouse} className="bg-white rounded-lg border border-zinc-200 p-5 flex gap-2 items-end">
          <div className="flex-1">
            <label className="block text-xs text-zinc-500 mb-1">Nombre</label>
            <input
              value={form.name}
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              className="w-full rounded border border-zinc-300 px-3 py-1.5 text-sm"
              required
            />
          </div>
          <div>
            <label className="block text-xs text-zinc-500 mb-1">Sucursal</label>
            <select
              value={form.branchId}
              onChange={(e) => setForm((f) => ({ ...f, branchId: e.target.value }))}
              className="rounded border border-zinc-300 px-3 py-1.5 text-sm"
            >
              {branches.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </select>
          </div>
          <button className="bg-zinc-900 text-white rounded px-3 py-1.5 text-sm">Agregar</button>
        </form>
        <div className="bg-white rounded-lg border border-zinc-200 divide-y divide-zinc-100">
          {warehouses.map((w) => (
            <div key={w.id} className="px-4 py-2 text-sm flex justify-between">
              <span>{w.name}</span>
              <span className="text-zinc-400">{branchName(w.branchId)}</span>
            </div>
          ))}
          {warehouses.length === 0 && <p className="px-4 py-6 text-center text-zinc-400 text-sm">Sin almacenes</p>}
        </div>
      </div>
    </AppShell>
  );
}
