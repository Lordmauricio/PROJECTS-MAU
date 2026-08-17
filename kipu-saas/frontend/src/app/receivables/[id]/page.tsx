"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import AppShell from "@/components/AppShell";
import { api } from "@/lib/api";
import { ApiError } from "@/lib/auth-context";

interface Payment {
  id: string;
  method: string;
  amount: string;
  createdAt: string;
}

interface Receivable {
  id: string;
  amount: string;
  status: string;
  paidTotal?: string;
  balance?: string;
  dueDate: string;
  customer?: { id: string; name: string } | null;
  sale?: { id: string; total: string; status: string; payments?: Payment[] } | null;
}

const STATUS_LABELS: Record<string, string> = {
  PENDING: "Pendiente",
  PAID: "Pagada",
  OVERDUE: "Vencida",
  CANCELLED: "Anulada",
};

function newIdempotencyKey() {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `key-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export default function ReceivableDetailPage() {
  const params = useParams<{ id: string }>();
  const [receivable, setReceivable] = useState<Receivable | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [payAmount, setPayAmount] = useState("");
  const [payMethod, setPayMethod] = useState("CASH");

  async function load() {
    setLoading(true);
    setLoadError(null);
    try {
      setReceivable(await api<Receivable>(`/receivables/${params.id}`));
    } catch (err) {
      setLoadError(err instanceof ApiError ? err.message : "No se pudo cargar la cuenta por cobrar");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (params.id) load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params.id]);

  async function addPayment(e: React.FormEvent) {
    e.preventDefault();
    setActionError(null);
    setBusy(true);
    try {
      await api(`/receivables/${params.id}/payments`, {
        method: "POST",
        body: { method: payMethod, amount: Number(payAmount), idempotencyKey: newIdempotencyKey() },
      });
      setPayAmount("");
      await load();
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : "No se pudo registrar el pago");
    } finally {
      setBusy(false);
    }
  }

  if (loading) {
    return (
      <AppShell>
        <div className="p-6 text-sm text-zinc-500">Cargando...</div>
      </AppShell>
    );
  }

  if (loadError || !receivable) {
    return (
      <AppShell>
        <div className="p-6">
          <p className="text-sm text-red-600 bg-red-50 rounded p-2">{loadError ?? "Cuenta por cobrar no encontrada"}</p>
        </div>
      </AppShell>
    );
  }

  const canPay = receivable.status === "PENDING" && Number(receivable.balance ?? 0) > 0;

  return (
    <AppShell>
      <div className="p-6 max-w-3xl space-y-6">
        <div className="flex justify-between items-start">
          <div>
            <Link href="/receivables" className="text-sm text-zinc-400 hover:text-zinc-900">← Cuentas por cobrar</Link>
            <h1 className="text-lg font-semibold">{receivable.customer?.name ?? "Cliente"}</h1>
            {receivable.sale && (
              <Link href={`/sales/${receivable.sale.id}`} className="text-xs text-zinc-500 underline">
                Ver venta asociada
              </Link>
            )}
          </div>
          <span className="rounded px-2 py-1 text-xs bg-zinc-100">{STATUS_LABELS[receivable.status] ?? receivable.status}</span>
        </div>

        {actionError && <p className="text-sm text-red-600 bg-red-50 rounded p-2">{actionError}</p>}

        <div className="bg-white rounded-lg border border-zinc-200 p-4 space-y-1 text-sm">
          <p>Monto: Bs. {Number(receivable.amount).toFixed(2)}</p>
          <p>Pagado: Bs. {Number(receivable.paidTotal ?? 0).toFixed(2)}</p>
          <p className={Number(receivable.balance ?? 0) > 0 ? "text-amber-700" : "text-emerald-700"}>
            Saldo: Bs. {Number(receivable.balance ?? 0).toFixed(2)}
          </p>
        </div>

        <div className="bg-white rounded-lg border border-zinc-200 p-4 space-y-2">
          <h2 className="font-medium text-sm">Historial de pagos</h2>
          {(receivable.sale?.payments ?? []).length === 0 && <p className="text-sm text-zinc-400">Sin pagos registrados</p>}
          {(receivable.sale?.payments ?? []).map((p) => (
            <div key={p.id} className="flex justify-between text-sm border-t border-zinc-100 pt-1">
              <span>{p.method}</span>
              <span>{new Date(p.createdAt).toLocaleString()}</span>
              <span>Bs. {Number(p.amount).toFixed(2)}</span>
            </div>
          ))}

          {canPay && (
            <form onSubmit={addPayment} className="flex gap-2 items-center pt-2">
              <select value={payMethod} onChange={(e) => setPayMethod(e.target.value)} className="rounded border border-zinc-300 px-2 py-1 text-sm">
                <option value="CASH">Efectivo</option>
                <option value="CARD">Tarjeta</option>
                <option value="TRANSFER">Transferencia</option>
                <option value="QR">QR</option>
              </select>
              <input
                type="number"
                min={0.01}
                step="0.01"
                required
                placeholder="Monto"
                value={payAmount}
                onChange={(e) => setPayAmount(e.target.value)}
                className="w-28 rounded border border-zinc-300 px-2 py-1 text-sm"
              />
              <button disabled={busy} className="bg-zinc-900 text-white rounded px-3 py-1 text-sm disabled:opacity-50">
                Registrar pago
              </button>
            </form>
          )}
          {payMethod === "CASH" && canPay && (
            <p className="text-xs text-zinc-400">
              Si hay una caja abierta en el punto de venta de la venta original, el cobro en efectivo se refleja ahí automáticamente.
            </p>
          )}
        </div>
      </div>
    </AppShell>
  );
}
