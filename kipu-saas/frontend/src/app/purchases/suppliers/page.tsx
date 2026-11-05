"use client";

import { useState, useCallback } from "react";
import { useRemoteLoad } from "@/lib/use-remote-load";
import AppShell from "@/components/AppShell";
import FieldInput from "@/components/FieldInput";
import ResponsiveTable from "@/components/ResponsiveTable";
import { api } from "@/lib/api";
import { useSubmitGuard } from "@/lib/use-submit-guard";
import { ApiError } from "@/lib/auth-context";

interface Supplier {
  id: string;
  name: string;
  nit?: string | null;
  phone?: string | null;
  email?: string | null;
}

export default function SuppliersPage() {
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [form, setForm] = useState({ name: "", nit: "", phone: "", email: "" });
  const [error, setError] = useState<string | null>(null);

  const fetchData = useCallback(() => {
    return api<Supplier[]>("/suppliers");
  }, []);

  const receiveData = useCallback((result: Awaited<ReturnType<typeof fetchData>>) => {
    setSuppliers(result);
  }, []);

  const {
    loading,
    error: loadError,
    reload: load,
  } = useRemoteLoad(fetchData, receiveData, "No se pudo cargar la lista de proveedores");

  async function addSupplierRequest(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      await api("/suppliers", { method: "POST", body: form });
      setForm({ name: "", nit: "", phone: "", email: "" });
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "No se pudo crear el proveedor");
    }
  }

  // Doble click: sin esto, dos clicks seguidos creaban dos registros
  // (ver `useSubmitGuard`).
  const { submitting: addSupplierSubmitting, onSubmit: addSupplier } =
    useSubmitGuard(addSupplierRequest);

  return (
    <AppShell>
      <div className="p-6 max-w-4xl space-y-6">
        <h1 className="text-lg font-semibold">Proveedores</h1>
        {loadError && <p className="text-sm text-red-600 bg-red-50 rounded p-2">{loadError}</p>}

        <form onSubmit={addSupplier} className="bg-white rounded-lg border border-zinc-200 p-5 space-y-3">
          <h2 className="font-medium text-sm">Nuevo proveedor</h2>
          {error && <p className="text-sm text-red-600 bg-red-50 rounded p-2">{error}</p>}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <FieldInput label="Nombre" placeholder="Nombre"
              value={form.name}
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              className="rounded border border-zinc-300 px-3 py-1.5 text-sm"
              required
            />
            <FieldInput label="NIT" placeholder="NIT"
              value={form.nit}
              onChange={(e) => setForm((f) => ({ ...f, nit: e.target.value }))}
              className="rounded border border-zinc-300 px-3 py-1.5 text-sm"
            />
            <FieldInput label="Teléfono" placeholder="Teléfono"
              value={form.phone}
              onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))}
              className="rounded border border-zinc-300 px-3 py-1.5 text-sm"
            />
            <FieldInput label="Email" placeholder="Email"
              type="email"
              value={form.email}
              onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
              className="rounded border border-zinc-300 px-3 py-1.5 text-sm"
            />
          </div>
          <button disabled={addSupplierSubmitting} className="bg-zinc-900 text-white rounded px-3 py-1.5 text-sm">Agregar proveedor</button>
        </form>

        <div className="bg-white rounded-lg border border-zinc-200 overflow-hidden">
          <ResponsiveTable label="Proveedores" className="w-full text-sm">
            <thead className="bg-zinc-50 text-zinc-500 text-left">
              <tr>
                <th className="px-4 py-2">Nombre</th>
                <th className="px-4 py-2">NIT</th>
                <th className="px-4 py-2">Teléfono</th>
                <th className="px-4 py-2">Email</th>
              </tr>
            </thead>
            <tbody>
              {suppliers.map((s) => (
                <tr key={s.id} className="border-t border-zinc-100">
                  <td className="px-4 py-2">{s.name}</td>
                  <td className="px-4 py-2">{s.nit ?? "-"}</td>
                  <td className="px-4 py-2">{s.phone ?? "-"}</td>
                  <td className="px-4 py-2">{s.email ?? "-"}</td>
                </tr>
              ))}
              {!loading && suppliers.length === 0 && (
                <tr>
                  <td colSpan={4} className="px-4 py-6 text-center text-zinc-400">
                    Sin proveedores todavía
                  </td>
                </tr>
              )}
            </tbody>
          </ResponsiveTable>
        </div>
      </div>
    </AppShell>
  );
}
