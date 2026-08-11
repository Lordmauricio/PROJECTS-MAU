"use client";

import { useEffect, useState } from "react";
import AppShell from "@/components/AppShell";
import { api, ApiError } from "@/lib/api";

interface UserRow {
  id: string;
  name: string;
  email: string;
  role: string;
  active: boolean;
}

export default function UsersPage() {
  const [users, setUsers] = useState<UserRow[]>([]);
  const [form, setForm] = useState({ name: "", email: "", password: "", role: "CASHIER" });
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setUsers(await api<UserRow[]>("/users"));
  }

  useEffect(() => {
    load();
  }, []);

  async function addUser(e: React.FormEvent) {
    e.preventDefault();
    try {
      await api("/users", { method: "POST", body: form });
      setForm({ name: "", email: "", password: "", role: "CASHIER" });
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "No se pudo crear el usuario");
    }
  }

  return (
    <AppShell>
      <div className="p-6 max-w-2xl space-y-6">
        <h1 className="text-lg font-semibold">Usuarios</h1>

        <form onSubmit={addUser} className="bg-white rounded-lg border border-zinc-200 p-5 space-y-3">
          <h2 className="font-medium text-sm">Nuevo usuario</h2>
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
              placeholder="Email"
              type="email"
              value={form.email}
              onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
              className="rounded border border-zinc-300 px-3 py-1.5 text-sm"
              required
            />
            <input
              placeholder="Contraseña"
              type="password"
              value={form.password}
              onChange={(e) => setForm((f) => ({ ...f, password: e.target.value }))}
              className="rounded border border-zinc-300 px-3 py-1.5 text-sm"
              required
            />
            <select
              value={form.role}
              onChange={(e) => setForm((f) => ({ ...f, role: e.target.value }))}
              className="rounded border border-zinc-300 px-3 py-1.5 text-sm"
            >
              <option value="ADMIN">Administrador</option>
              <option value="CASHIER">Cajero</option>
              <option value="KITCHEN">Cocina</option>
            </select>
          </div>
          <button className="bg-zinc-900 text-white rounded px-3 py-1.5 text-sm">Crear usuario</button>
        </form>

        <div className="bg-white rounded-lg border border-zinc-200 divide-y divide-zinc-100">
          {users.map((u) => (
            <div key={u.id} className="flex items-center justify-between px-4 py-2 text-sm">
              <div>
                <p className="font-medium">{u.name}</p>
                <p className="text-zinc-500 text-xs">{u.email}</p>
              </div>
              <span className="text-xs bg-zinc-100 rounded-full px-2 py-1">{u.role}</span>
            </div>
          ))}
        </div>
      </div>
    </AppShell>
  );
}
