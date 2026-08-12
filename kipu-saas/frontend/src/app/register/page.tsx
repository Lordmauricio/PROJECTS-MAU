"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api";
import { useAuth, ApiError } from "@/lib/auth-context";

interface RegisterResponse {
  accessToken: string;
  refreshToken: string;
  user: { id: string; name: string; email: string };
  organization: { id: string; name: string };
}

export default function RegisterPage() {
  const router = useRouter();
  const { setSession } = useAuth();
  const [form, setForm] = useState({
    organizationName: "",
    legalName: "",
    nit: "",
    branchName: "Casa Matriz",
    ownerName: "",
    email: "",
    password: "",
  });
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  function update<K extends keyof typeof form>(key: K, value: string) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const result = await api<RegisterResponse>("/auth/register", { method: "POST", body: form });
      setSession(result);
      router.push("/dashboard");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "No se pudo registrar la empresa");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex flex-1 items-center justify-center min-h-screen py-10">
      <form onSubmit={handleSubmit} className="w-full max-w-lg bg-white rounded-xl shadow p-8 space-y-4">
        <div>
          <h1 className="text-xl font-semibold">Registra tu empresa en KIPU</h1>
          <p className="text-sm text-zinc-500 mt-1">
            Creamos tu empresa, tu primera sucursal, su almacén y punto de venta principales, y tu
            usuario como propietario.
          </p>
        </div>

        {error && <p className="text-sm text-red-600 bg-red-50 rounded p-2">{error}</p>}

        <div className="grid grid-cols-2 gap-3">
          <Field label="Nombre comercial" value={form.organizationName} onChange={(v) => update("organizationName", v)} />
          <Field label="Razón social" value={form.legalName} onChange={(v) => update("legalName", v)} />
          <Field label="NIT" value={form.nit} onChange={(v) => update("nit", v)} />
          <Field label="Nombre de la sucursal" value={form.branchName} onChange={(v) => update("branchName", v)} />
          <Field label="Tu nombre (propietario/a)" value={form.ownerName} onChange={(v) => update("ownerName", v)} />
          <Field label="Email" type="email" value={form.email} onChange={(v) => update("email", v)} />
        </div>
        <Field
          label="Contraseña (mín. 8 caracteres)"
          type="password"
          value={form.password}
          onChange={(v) => update("password", v)}
        />

        <button
          type="submit"
          disabled={loading}
          className="w-full bg-zinc-900 text-white rounded py-2 text-sm font-medium disabled:opacity-50"
        >
          {loading ? "Creando cuenta..." : "Crear cuenta"}
        </button>
      </form>
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
  type = "text",
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  type?: string;
}) {
  return (
    <div>
      <label className="block text-sm font-medium mb-1">{label}</label>
      <input
        type={type}
        required
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full rounded border border-zinc-300 px-3 py-2 text-sm"
      />
    </div>
  );
}
