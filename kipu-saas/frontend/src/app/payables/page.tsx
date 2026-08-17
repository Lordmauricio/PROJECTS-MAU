"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import AppShell from "@/components/AppShell";
import { api } from "@/lib/api";
import { ApiError } from "@/lib/auth-context";

interface Payable {
  id: string;
  amount: string;
  status: string;
  paidTotal?: string;
  balance?: string;
  supplier?: { id: string; name: string } | null;
  purchase?: { id: string } | null;
}

const STATUS_LABELS: Record<string, string> = {
  PENDING: "Pendiente",
  PAID: "Pagada",
  OVERDUE: "Vencida",
  CANCELLED: "Anulada",
};

const STATUS_COLORS: Record<string, string> = {
  PENDING: "bg-amber-50 text-amber-700",
  PAID: "bg-emerald-50 text-emerald-700",
  OVERDUE: "bg-red-50 text-red-700",
  CANCELLED: "bg-zinc-100 text-zinc-500",
};

export default function PayablesPage() {
  const [payables, setPayables] = useState<Payable[]>([]);
  const [status, setStatus] = useState("");
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    setLoadError(null);
    try {
      const query = status ? `?status=${status}` : "";
      setPayables(await api<Payable[]>(`/payables${query}`));
    } catch (err) {
      setLoadError(err instanceof ApiError ? err.message : "No se pudo cargar las cuentas por pagar");
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
      <div className="p-6 max-w-4xl space-y-6">
        <h1 className="text-lg font-semibold">Cuentas por pagar</h1>
        <p className="text-sm text-zinc-500">
          Se generan automáticamente al recibir mercadería de una compra. Los pagos se registran desde el detalle de la compra asociada.
        </p>
        {loadError && <p className="text-sm text-red-600 bg-red-50 rounded p-2">{loadError}</p>}

        <select value={status} onChange={(e) => setStatus(e.target.value)} className="rounded border border-zinc-300 px-2 py-1.5 text-sm">
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
                <th className="px-4 py-2">Proveedor</th>
                <th className="px-4 py-2">Monto</th>
                <th className="px-4 py-2">Pagado</th>
                <th className="px-4 py-2">Saldo</th>
                <th className="px-4 py-2">Estado</th>
                <th className="px-4 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {payables.map((p) => (
                <tr key={p.id} className="border-t border-zinc-100">
                  <td className="px-4 py-2">{p.supplier?.name ?? "-"}</td>
                  <td className="px-4 py-2">Bs. {Number(p.amount).toFixed(2)}</td>
                  <td className="px-4 py-2">Bs. {Number(p.paidTotal ?? 0).toFixed(2)}</td>
                  <td className="px-4 py-2">
                    <span className={Number(p.balance ?? 0) > 0 ? "text-amber-700" : "text-emerald-700"}>
                      Bs. {Number(p.balance ?? 0).toFixed(2)}
                    </span>
                  </td>
                  <td className="px-4 py-2">
                    <span className={`rounded px-2 py-0.5 text-xs ${STATUS_COLORS[p.status] ?? "bg-zinc-100"}`}>
                      {STATUS_LABELS[p.status] ?? p.status}
                    </span>
                  </td>
                  <td className="px-4 py-2 text-right">
                    {p.purchase && (
                      <Link href={`/purchases/${p.purchase.id}`} className="text-xs text-zinc-600 underline">
                        Ver compra / pagar
                      </Link>
                    )}
                  </td>
                </tr>
              ))}
              {!loading && payables.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-4 py-6 text-center text-zinc-400">
                    Sin cuentas por pagar todavía
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
