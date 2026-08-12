"use client";

import { useEffect, useState } from "react";
import AppShell from "@/components/AppShell";
import { api } from "@/lib/api";
import { ApiError } from "@/lib/auth-context";

interface Organization {
  id: string;
  name: string;
  legalName: string;
  nit: string;
  currency: string;
  timezone: string;
  status: string;
}

interface POSTerminal {
  id: string;
  name: string;
  code: string;
}

interface Warehouse {
  id: string;
  name: string;
}

interface Branch {
  id: string;
  name: string;
  address?: string | null;
  isMainOffice: boolean;
  warehouses: Warehouse[];
  posTerminals: POSTerminal[];
}

export default function SettingsPage() {
  const [organization, setOrganization] = useState<Organization | null>(null);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [newBranch, setNewBranch] = useState({ name: "", address: "" });
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    setLoadError(null);
    try {
      const [org, br] = await Promise.all([
        api<Organization>("/organizations/me"),
        api<Branch[]>("/branches"),
      ]);
      setOrganization(org);
      setBranches(br);
    } catch (err) {
      setLoadError(err instanceof ApiError ? err.message : "No se pudo cargar la configuración de la empresa");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  async function addBranch(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      await api("/branches", { method: "POST", body: newBranch });
      setNewBranch({ name: "", address: "" });
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "No se pudo crear la sucursal");
    }
  }

  async function addPosTerminal(branchId: string, name: string, code: string) {
    setError(null);
    try {
      await api("/pos-terminals", { method: "POST", body: { branchId, name, code } });
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "No se pudo crear el punto de venta");
    }
  }

  return (
    <AppShell>
      <div className="p-6 max-w-3xl space-y-6">
        <h1 className="text-lg font-semibold">Configuración</h1>
        {loadError && <p className="text-sm text-red-600 bg-red-50 rounded p-2">{loadError}</p>}

        {organization && (
          <div className="bg-white rounded-lg border border-zinc-200 p-5 space-y-1 text-sm">
            <h2 className="font-medium mb-2">Datos de la empresa</h2>
            <p>
              <span className="text-zinc-500">Nombre comercial: </span>
              {organization.name}
            </p>
            <p>
              <span className="text-zinc-500">Razón social: </span>
              {organization.legalName}
            </p>
            <p>
              <span className="text-zinc-500">NIT: </span>
              {organization.nit}
            </p>
            <p>
              <span className="text-zinc-500">Moneda: </span>
              {organization.currency} · <span className="text-zinc-500">Zona horaria: </span>
              {organization.timezone}
            </p>
            <p>
              <span className="text-zinc-500">Estado: </span>
              {organization.status}
            </p>
          </div>
        )}

        {error && <p className="text-sm text-red-600 bg-red-50 rounded p-2">{error}</p>}

        <form onSubmit={addBranch} className="bg-white rounded-lg border border-zinc-200 p-5 space-y-3">
          <h2 className="font-medium text-sm">Nueva sucursal</h2>
          <div className="grid grid-cols-2 gap-3">
            <input
              placeholder="Nombre"
              value={newBranch.name}
              onChange={(e) => setNewBranch((f) => ({ ...f, name: e.target.value }))}
              className="rounded border border-zinc-300 px-3 py-1.5 text-sm"
              required
            />
            <input
              placeholder="Dirección"
              value={newBranch.address}
              onChange={(e) => setNewBranch((f) => ({ ...f, address: e.target.value }))}
              className="rounded border border-zinc-300 px-3 py-1.5 text-sm"
            />
          </div>
          <button className="bg-zinc-900 text-white rounded px-3 py-1.5 text-sm">Agregar sucursal</button>
        </form>

        <div className="space-y-4">
          <h2 className="font-medium text-sm">Sucursales, almacenes y puntos de venta</h2>
          {branches.map((b) => (
            <div key={b.id} className="bg-white rounded-lg border border-zinc-200 p-5 space-y-3">
              <div className="flex items-center justify-between">
                <p className="font-medium text-sm">
                  {b.name} {b.isMainOffice && <span className="text-xs text-zinc-400">(principal)</span>}
                </p>
              </div>
              <div className="grid grid-cols-2 gap-4 text-sm">
                <div>
                  <p className="text-xs text-zinc-500 mb-1">Almacenes</p>
                  <ul className="space-y-1">
                    {b.warehouses.map((w) => (
                      <li key={w.id}>{w.name}</li>
                    ))}
                  </ul>
                </div>
                <div>
                  <p className="text-xs text-zinc-500 mb-1">Puntos de venta</p>
                  <ul className="space-y-1 mb-2">
                    {b.posTerminals.map((p) => (
                      <li key={p.id}>
                        {p.name} <span className="text-zinc-400">({p.code})</span>
                      </li>
                    ))}
                  </ul>
                  <AddPosTerminalForm branchId={b.id} onAdd={addPosTerminal} />
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </AppShell>
  );
}

function AddPosTerminalForm({
  branchId,
  onAdd,
}: {
  branchId: string;
  onAdd: (branchId: string, name: string, code: string) => void;
}) {
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (!name || !code) return;
        onAdd(branchId, name, code);
        setName("");
        setCode("");
      }}
      className="flex gap-2"
    >
      <input
        placeholder="Nombre"
        value={name}
        onChange={(e) => setName(e.target.value)}
        className="rounded border border-zinc-300 px-2 py-1 text-xs flex-1"
      />
      <input
        placeholder="Código"
        value={code}
        onChange={(e) => setCode(e.target.value)}
        className="rounded border border-zinc-300 px-2 py-1 text-xs w-20"
      />
      <button className="text-xs bg-zinc-900 text-white rounded px-2 py-1">+</button>
    </form>
  );
}
