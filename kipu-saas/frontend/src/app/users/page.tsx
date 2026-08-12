"use client";

import { useEffect, useState } from "react";
import AppShell from "@/components/AppShell";
import { api } from "@/lib/api";
import { ApiError } from "@/lib/auth-context";

interface Role {
  id: string;
  key: string;
  name: string;
}

interface Member {
  id: string;
  status: string;
  user: { id: string; name: string; email: string };
  role: Role;
}

export default function UsersPage() {
  const [members, setMembers] = useState<Member[]>([]);
  const [roles, setRoles] = useState<Role[]>([]);
  const [form, setForm] = useState({ email: "", name: "", roleId: "" });
  const [error, setError] = useState<string | null>(null);

  async function load() {
    const [m, r] = await Promise.all([api<Member[]>("/members"), api<Role[]>("/roles")]);
    setMembers(m);
    setRoles(r);
    if (r.length > 0) setForm((f) => ({ ...f, roleId: f.roleId || r.find((x) => x.key === "CASHIER")?.id || r[0].id }));
  }

  useEffect(() => {
    load();
  }, []);

  async function invite(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      await api("/members/invite", { method: "POST", body: form });
      setForm((f) => ({ ...f, email: "", name: "" }));
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "No se pudo invitar al usuario");
    }
  }

  async function changeRole(membershipId: string, roleId: string) {
    await api(`/members/${membershipId}/role`, { method: "PATCH", body: { roleId } });
    load();
  }

  async function toggleStatus(member: Member) {
    const action = member.status === "SUSPENDED" ? "reactivate" : "suspend";
    await api(`/members/${member.id}/${action}`, { method: "PATCH" });
    load();
  }

  return (
    <AppShell>
      <div className="p-6 max-w-3xl space-y-6">
        <h1 className="text-lg font-semibold">Usuarios y Permisos</h1>

        <form onSubmit={invite} className="bg-white rounded-lg border border-zinc-200 p-5 space-y-3">
          <h2 className="font-medium text-sm">Invitar usuario</h2>
          {error && <p className="text-sm text-red-600 bg-red-50 rounded p-2">{error}</p>}
          <div className="grid grid-cols-3 gap-3">
            <input
              placeholder="Nombre"
              value={form.name}
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              className="rounded border border-zinc-300 px-3 py-1.5 text-sm"
            />
            <input
              placeholder="Email"
              type="email"
              value={form.email}
              onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
              className="rounded border border-zinc-300 px-3 py-1.5 text-sm"
              required
            />
            <select
              value={form.roleId}
              onChange={(e) => setForm((f) => ({ ...f, roleId: e.target.value }))}
              className="rounded border border-zinc-300 px-3 py-1.5 text-sm"
            >
              {roles.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name}
                </option>
              ))}
            </select>
          </div>
          <button className="bg-zinc-900 text-white rounded px-3 py-1.5 text-sm">Invitar</button>
        </form>

        <div className="bg-white rounded-lg border border-zinc-200 divide-y divide-zinc-100">
          {members.map((m) => (
            <div key={m.id} className="flex items-center justify-between px-4 py-3 text-sm">
              <div>
                <p className="font-medium">{m.user.name}</p>
                <p className="text-zinc-500 text-xs">{m.user.email}</p>
              </div>
              <div className="flex items-center gap-3">
                <select
                  value={m.role.id}
                  onChange={(e) => changeRole(m.id, e.target.value)}
                  className="text-xs border border-zinc-300 rounded px-2 py-1"
                >
                  {roles.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.name}
                    </option>
                  ))}
                </select>
                <span
                  className={`text-xs px-2 py-1 rounded-full ${
                    m.status === "SUSPENDED" ? "bg-red-50 text-red-600" : "bg-green-50 text-green-700"
                  }`}
                >
                  {m.status}
                </span>
                <button onClick={() => toggleStatus(m)} className="text-xs underline text-zinc-600">
                  {m.status === "SUSPENDED" ? "Reactivar" : "Suspender"}
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>
    </AppShell>
  );
}
