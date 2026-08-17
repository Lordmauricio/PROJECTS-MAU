"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import AppShell from "@/components/AppShell";
import { api } from "@/lib/api";
import { ApiError } from "@/lib/auth-context";

interface PosTerminal {
  id: string;
  name: string;
  code: string;
  branchId: string;
  active: boolean;
}

interface CashRegister {
  id: string;
  posTerminalId: string;
  status: string;
  openingAmount: string;
  closingAmount?: string | null;
  difference?: string | null;
  openedAt: string;
  closedAt?: string | null;
  posTerminal?: { id: string; name: string };
}

function newIdempotencyKey() {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `key-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export default function CashPage() {
  const [terminals, setTerminals] = useState<PosTerminal[]>([]);
  const [openRegisters, setOpenRegisters] = useState<CashRegister[]>([]);
  const [history, setHistory] = useState<CashRegister[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [form, setForm] = useState({ posTerminalId: "", openingAmount: "" });
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);

  async function load() {
    setLoadError(null);
    try {
      const [t, open, closed] = await Promise.all([
        api<PosTerminal[]>("/pos-terminals"),
        api<CashRegister[]>("/cash-registers?status=OPEN"),
        api<CashRegister[]>("/cash-registers?status=CLOSED"),
      ]);
      setTerminals(t);
      setOpenRegisters(open);
      setHistory(closed);
      if (t.length > 0) setForm((f) => ({ ...f, posTerminalId: f.posTerminalId || t[0].id }));
    } catch (err) {
      setLoadError(err instanceof ApiError ? err.message : "No se pudo cargar el estado de caja");
    }
  }

  useEffect(() => {
    load();
  }, []);

  const terminalsWithoutOpenRegister = terminals.filter(
    (t) => !openRegisters.some((r) => r.posTerminalId === t.id)
  );

  function terminalName(id: string) {
    return terminals.find((t) => t.id === id)?.name ?? openRegisters.find((r) => r.posTerminalId === id)?.posTerminal?.name ?? "-";
  }

  async function openRegister(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setOk(null);
    try {
      await api("/cash-registers", {
        method: "POST",
        body: {
          posTerminalId: form.posTerminalId,
          openingAmount: form.openingAmount ? Number(form.openingAmount) : 0,
          idempotencyKey: newIdempotencyKey(),
        },
      });
      setOk("Caja abierta correctamente.");
      setForm((f) => ({ ...f, openingAmount: "" }));
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "No se pudo abrir la caja");
    }
  }

  return (
    <AppShell>
      <div className="p-6 max-w-4xl space-y-6">
        <h1 className="text-lg font-semibold">Caja y Bancos</h1>
        {loadError && <p className="text-sm text-red-600 bg-red-50 rounded p-2">{loadError}</p>}

        <div className="bg-white rounded-lg border border-zinc-200 overflow-hidden">
          <h2 className="px-4 py-2 font-medium text-sm border-b border-zinc-100">Cajas abiertas</h2>
          <div className="divide-y divide-zinc-100">
            {openRegisters.map((r) => (
              <Link
                key={r.id}
                href={`/cash/${r.id}`}
                className="px-4 py-3 flex items-center justify-between text-sm hover:bg-zinc-50"
              >
                <div>
                  <span className="font-medium">{terminalName(r.posTerminalId)}</span>
                  <span className="text-zinc-400 ml-2">saldo inicial {Number(r.openingAmount)}</span>
                </div>
                <span className="text-zinc-400">abierta {new Date(r.openedAt).toLocaleString()}</span>
              </Link>
            ))}
            {openRegisters.length === 0 && (
              <p className="px-4 py-6 text-center text-zinc-400 text-sm">Ninguna caja abierta actualmente</p>
            )}
          </div>
        </div>

        <form onSubmit={openRegister} className="bg-white rounded-lg border border-zinc-200 p-5 space-y-3">
          <h2 className="font-medium text-sm">Abrir caja</h2>
          {error && <p className="text-sm text-red-600 bg-red-50 rounded p-2">{error}</p>}
          {ok && <p className="text-sm text-green-700 bg-green-50 rounded p-2">{ok}</p>}
          {terminalsWithoutOpenRegister.length === 0 && terminals.length > 0 && (
            <p className="text-sm text-zinc-500">Todos los puntos de venta ya tienen una caja abierta.</p>
          )}
          <div className="grid grid-cols-2 gap-3">
            <select
              value={form.posTerminalId}
              onChange={(e) => setForm((f) => ({ ...f, posTerminalId: e.target.value }))}
              className="rounded border border-zinc-300 px-3 py-1.5 text-sm"
              required
            >
              <option value="">Punto de venta...</option>
              {terminalsWithoutOpenRegister.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
            <input
              placeholder="Saldo inicial"
              type="number"
              min={0}
              step="0.01"
              value={form.openingAmount}
              onChange={(e) => setForm((f) => ({ ...f, openingAmount: e.target.value }))}
              className="rounded border border-zinc-300 px-3 py-1.5 text-sm"
            />
          </div>
          <button
            className="bg-zinc-900 text-white rounded px-3 py-1.5 text-sm disabled:opacity-40"
            disabled={terminalsWithoutOpenRegister.length === 0}
          >
            Abrir caja
          </button>
        </form>

        <div className="bg-white rounded-lg border border-zinc-200 overflow-hidden">
          <h2 className="px-4 py-2 font-medium text-sm border-b border-zinc-100">Historial de cajas cerradas</h2>
          <table className="w-full text-sm">
            <thead className="bg-zinc-50 text-zinc-500 text-left">
              <tr>
                <th className="px-4 py-2">Punto de venta</th>
                <th className="px-4 py-2">Abierta</th>
                <th className="px-4 py-2">Cerrada</th>
                <th className="px-4 py-2">Efectivo contado</th>
                <th className="px-4 py-2">Diferencia</th>
                <th className="px-4 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {history.map((r) => (
                <tr key={r.id} className="border-t border-zinc-100">
                  <td className="px-4 py-2">{terminalName(r.posTerminalId)}</td>
                  <td className="px-4 py-2">{new Date(r.openedAt).toLocaleString()}</td>
                  <td className="px-4 py-2">{r.closedAt ? new Date(r.closedAt).toLocaleString() : "-"}</td>
                  <td className="px-4 py-2">{r.closingAmount != null ? Number(r.closingAmount) : "-"}</td>
                  <td className={`px-4 py-2 ${Number(r.difference) < 0 ? "text-red-600" : Number(r.difference) > 0 ? "text-green-700" : ""}`}>
                    {r.difference != null ? Number(r.difference) : "-"}
                  </td>
                  <td className="px-4 py-2">
                    <Link href={`/cash/${r.id}`} className="text-zinc-500 hover:text-zinc-900 underline">
                      Ver detalle
                    </Link>
                  </td>
                </tr>
              ))}
              {history.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-4 py-6 text-center text-zinc-400">
                    Sin cajas cerradas todavía
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </AppShell>
  );
}
