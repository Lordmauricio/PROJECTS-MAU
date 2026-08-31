"use client";

import { useState } from "react";
import Link from "next/link";
import { useAuth, ApiError } from "@/lib/auth-context";

export default function LoginPage() {
  const { login } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [orgOptions, setOrgOptions] = useState<{ id: string; name: string }[] | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const result = await login(email, password);
      if (result.requiresOrganizationSelection && result.organizations) {
        setOrgOptions(result.organizations);
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "No se pudo iniciar sesión");
    } finally {
      setLoading(false);
    }
  }

  async function selectOrganization(organizationId: string) {
    setLoading(true);
    setError(null);
    try {
      // login() ya persiste la sesión y navega a /dashboard cuando la
      // respuesta no vuelve a pedir selección de organización (que es
      // siempre el caso aquí, porque ya pasamos organizationId).
      await login(email, password, organizationId);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "No se pudo iniciar sesión");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex flex-1 items-center justify-center min-h-screen">
      <div className="w-full max-w-sm bg-white rounded-xl shadow p-8 space-y-4">
        <div>
          <h1 className="text-xl font-semibold">KIPU</h1>
          <p className="text-sm text-zinc-500 mt-1">Inicia sesión para continuar</p>
        </div>

        {error && <p className="text-sm text-red-600 bg-red-50 rounded p-2">{error}</p>}

        {orgOptions ? (
          <div className="space-y-2">
            <p className="text-sm text-zinc-600">Tu cuenta pertenece a varias empresas. Elige una:</p>
            {orgOptions.map((org) => (
              <button
                key={org.id}
                onClick={() => selectOrganization(org.id)}
                disabled={loading}
                className="w-full text-left px-3 py-2 rounded border border-zinc-300 hover:border-zinc-500 text-sm"
              >
                {org.name}
              </button>
            ))}
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label htmlFor="login-email" className="block text-sm font-medium mb-1">
                Email
              </label>
              <input
                id="login-email"
                type="email"
                autoComplete="email"
                inputMode="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full rounded border border-zinc-300 px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label htmlFor="login-password" className="block text-sm font-medium mb-1">
                Contraseña
              </label>
              <input
                id="login-password"
                type="password"
                autoComplete="current-password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full rounded border border-zinc-300 px-3 py-2 text-sm"
              />
            </div>
            <button
              type="submit"
              disabled={loading}
              className="w-full bg-zinc-900 text-white rounded py-2 text-sm font-medium disabled:opacity-50"
            >
              {loading ? "Ingresando..." : "Ingresar"}
            </button>
          </form>
        )}

        <p className="text-sm text-center text-zinc-500">
          ¿No tienes una cuenta?{" "}
          <Link href="/register" className="text-zinc-900 font-medium underline">
            Registra tu empresa
          </Link>
        </p>
      </div>
    </div>
  );
}
