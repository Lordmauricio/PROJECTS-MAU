"use client";

import { useEffect, useState } from "react";
import AppShell from "@/components/AppShell";
import { api, ApiError } from "@/lib/api";
import { Branch } from "@/lib/types";

export default function FiscalConfigPage() {
  const [branches, setBranches] = useState<Branch[]>([]);
  const [saving, setSaving] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  async function load() {
    setBranches(await api<Branch[]>("/branches"));
  }

  useEffect(() => {
    load();
  }, []);

  async function save(branchId: string, form: HTMLFormElement) {
    setSaving(branchId);
    setError(null);
    setMessage(null);
    const data = new FormData(form);
    try {
      await api(`/branches/${branchId}/fiscal-config`, {
        method: "PATCH",
        body: {
          environment: data.get("environment"),
          codigoSucursal: Number(data.get("codigoSucursal")),
          codigoPuntoVenta: Number(data.get("codigoPuntoVenta")),
          codigoSistema: data.get("codigoSistema") || undefined,
          cuis: data.get("cuis") || undefined,
        },
      });
      setMessage("Configuracion actualizada");
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "No se pudo guardar");
    } finally {
      setSaving(null);
    }
  }

  return (
    <AppShell>
      <div className="p-6 max-w-2xl space-y-6">
        <div>
          <h1 className="text-lg font-semibold">Configuracion fiscal (SIN)</h1>
          <p className="text-sm text-zinc-500 mt-1">
            Estos son los datos que el SIN asigna cuando registras tu sistema como facturador
            electronico (Oficina Virtual &gt; Facturacion &gt; Registro de Sucursales/Puntos de
            Venta). Mientras esten vacios, el sistema emite facturas en ambiente simulado sin
            validez fiscal.
          </p>
        </div>

        {message && <p className="text-sm text-green-700 bg-green-50 rounded p-2">{message}</p>}
        {error && <p className="text-sm text-red-600 bg-red-50 rounded p-2">{error}</p>}

        {branches.map((branch) => (
          <form
            key={branch.id}
            onSubmit={(e) => {
              e.preventDefault();
              save(branch.id, e.currentTarget);
            }}
            className="bg-white rounded-lg border border-zinc-200 p-5 space-y-3"
          >
            <h2 className="font-medium">{branch.name}</h2>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs text-zinc-500 mb-1">Ambiente</label>
                <select
                  name="environment"
                  defaultValue={branch.fiscalConfig?.environment ?? "TEST"}
                  className="w-full rounded border border-zinc-300 px-2 py-1.5 text-sm"
                >
                  <option value="TEST">Piloto / Pruebas</option>
                  <option value="PRODUCTION">Produccion</option>
                </select>
              </div>
              <div>
                <label className="block text-xs text-zinc-500 mb-1">Codigo de sistema (SIN)</label>
                <input
                  name="codigoSistema"
                  defaultValue={branch.fiscalConfig?.codigoSistema ?? ""}
                  className="w-full rounded border border-zinc-300 px-2 py-1.5 text-sm"
                />
              </div>
              <div>
                <label className="block text-xs text-zinc-500 mb-1">Codigo sucursal</label>
                <input
                  type="number"
                  name="codigoSucursal"
                  defaultValue={branch.fiscalConfig?.codigoSucursal ?? 0}
                  className="w-full rounded border border-zinc-300 px-2 py-1.5 text-sm"
                />
              </div>
              <div>
                <label className="block text-xs text-zinc-500 mb-1">Codigo punto de venta</label>
                <input
                  type="number"
                  name="codigoPuntoVenta"
                  defaultValue={branch.fiscalConfig?.codigoPuntoVenta ?? 0}
                  className="w-full rounded border border-zinc-300 px-2 py-1.5 text-sm"
                />
              </div>
              <div className="col-span-2">
                <label className="block text-xs text-zinc-500 mb-1">CUIS (si ya fue solicitado al SIN)</label>
                <input
                  name="cuis"
                  defaultValue={branch.fiscalConfig?.cuis ?? ""}
                  className="w-full rounded border border-zinc-300 px-2 py-1.5 text-sm"
                />
              </div>
            </div>
            <button
              disabled={saving === branch.id}
              className="bg-zinc-900 text-white rounded px-3 py-1.5 text-sm disabled:opacity-50"
            >
              {saving === branch.id ? "Guardando..." : "Guardar"}
            </button>
          </form>
        ))}
      </div>
    </AppShell>
  );
}
