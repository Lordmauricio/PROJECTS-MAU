"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import AppShell from "@/components/AppShell";
import { api } from "@/lib/api";
import { ApiError } from "@/lib/auth-context";

interface Sale {
  id: string;
  status: string;
  total: string;
  createdAt: string;
  customer?: { id: string; name: string } | null;
  _count?: { items: number; payments: number };
}

const STATUS_LABELS: Record<string, string> = {
  DRAFT: "Borrador",
  CONFIRMED: "Confirmada (crédito)",
  PARTIALLY_PAID: "Pago parcial",
  PAID: "Pagada",
  CANCELLED: "Cancelada",
  REFUNDED: "Devuelta",
};

const STATUS_COLORS: Record<string, string> = {
  DRAFT: "bg-zinc-100 text-zinc-600",
  CONFIRMED: "bg-amber-50 text-amber-700",
  PARTIALLY_PAID: "bg-amber-50 text-amber-700",
  PAID: "bg-emerald-50 text-emerald-700",
  CANCELLED: "bg-red-50 text-red-700",
  REFUNDED: "bg-red-50 text-red-700",
};

export default function SalesPage() {
  const [sales, setSales] = useState<Sale[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [status, setStatus] = useState("");

  async function load() {
    setLoading(true);
    setLoadError(null);
    try {
      const query = status ? `?status=${status}` : "";
      setSales(await api<Sale[]>(`/sales${query}`));
    } catch (err) {
      setLoadError(err instanceof ApiError ? err.message : "No se pudo cargar el listado de ventas");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status]);

  return (
    <AppShell>
      <div className="p-6 max-w-5xl space-y-6">
        <div className="flex justify-between items-center">
          <h1 className="text-lg font-semibold">Ventas</h1>
          <Link href="/sales/pos" className="bg-zinc-900 text-white rounded px-3 py-1.5 text-sm">
            Nueva venta (POS)
          </Link>
        </div>

        {loadError && <p className="text-sm text-red-600 bg-red-50 rounded p-2">{loadError}</p>}

        <select
          value={status}
          onChange={(e) => setStatus(e.target.value)}
          className="rounded border border-zinc-300 px-2 py-1.5 text-sm"
        >
          <option value="">Todos los estados</option>
          {Object.entries(STATUS_LABELS).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>

        <div className="bg-white rounded-lg border border-zinc-200 overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-zinc-50 text-zinc-500 text-left">
              <tr>
                <th className="px-4 py-2">Fecha</th>
                <th className="px-4 py-2">Cliente</th>
                <th className="px-4 py-2">Ítems</th>
                <th className="px-4 py-2">Total</th>
                <th className="px-4 py-2">Estado</th>
                <th className="px-4 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {sales.map((s) => (
                <tr key={s.id} className="border-t border-zinc-100">
                  <td className="px-4 py-2">{new Date(s.createdAt).toLocaleString()}</td>
                  <td className="px-4 py-2">{s.customer?.name ?? "Ocasional"}</td>
                  <td className="px-4 py-2">{s._count?.items ?? "-"}</td>
                  <td className="px-4 py-2">Bs. {Number(s.total).toFixed(2)}</td>
                  <td className="px-4 py-2">
                    <span className={`rounded px-2 py-0.5 text-xs ${STATUS_COLORS[s.status] ?? "bg-zinc-100"}`}>
                      {STATUS_LABELS[s.status] ?? s.status}
                    </span>
                  </td>
                  <td className="px-4 py-2 text-right">
                    <Link href={`/sales/${s.id}`} className="text-xs text-zinc-600 underline">
                      Ver detalle
                    </Link>
                  </td>
                </tr>
              ))}
              {!loading && sales.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-4 py-6 text-center text-zinc-400">
                    Sin ventas todavía
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
