"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import AppShell from "@/components/AppShell";
import { api } from "@/lib/api";
import { ApiError } from "@/lib/auth-context";

interface SaleItem {
  id: string;
  quantity: string;
  unitPrice: string;
  discount: string;
  subtotal: string;
  product?: { id: string; name: string; sku?: string | null };
}

interface Payment {
  id: string;
  method: string;
  amount: string;
  createdAt: string;
}

interface Sale {
  id: string;
  status: string;
  subtotal: string;
  discount: string;
  total: string;
  paidTotal: string;
  balance: string;
  createdAt: string;
  confirmedAt?: string | null;
  customer?: { id: string; name: string } | null;
  items: SaleItem[];
  payments: Payment[];
}

const STATUS_LABELS: Record<string, string> = {
  DRAFT: "Borrador",
  CONFIRMED: "Confirmada (crédito)",
  PARTIALLY_PAID: "Pago parcial",
  PAID: "Pagada",
  CANCELLED: "Cancelada",
  REFUNDED: "Devuelta",
};

function newIdempotencyKey() {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `key-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export default function SaleDetailPage() {
  const params = useParams<{ id: string }>();
  const [sale, setSale] = useState<Sale | null>(null);
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
      setSale(await api<Sale>(`/sales/${params.id}`));
    } catch (err) {
      setLoadError(err instanceof ApiError ? err.message : "No se pudo cargar la venta");
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
      const updated = await api<Sale>(`/sales/${params.id}/payments`, {
        method: "POST",
        body: { method: payMethod, amount: Number(payAmount), idempotencyKey: newIdempotencyKey() },
      });
      setSale(updated);
      setPayAmount("");
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : "No se pudo registrar el pago");
    } finally {
      setBusy(false);
    }
  }

  async function cancelSale() {
    setActionError(null);
    setBusy(true);
    try {
      setSale(await api<Sale>(`/sales/${params.id}/cancel`, { method: "POST" }));
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : "No se pudo cancelar la venta");
    } finally {
      setBusy(false);
    }
  }

  async function returnSale() {
    setActionError(null);
    setBusy(true);
    try {
      setSale(await api<Sale>(`/sales/${params.id}/return`, { method: "POST" }));
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : "No se pudo procesar la devolución");
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

  if (loadError || !sale) {
    return (
      <AppShell>
        <div className="p-6">
          <p className="text-sm text-red-600 bg-red-50 rounded p-2">{loadError ?? "Venta no encontrada"}</p>
        </div>
      </AppShell>
    );
  }

  const canCancel = sale.status === "DRAFT";
  const canPay = sale.status === "CONFIRMED" || sale.status === "PARTIALLY_PAID";
  const canReturn = ["CONFIRMED", "PARTIALLY_PAID", "PAID"].includes(sale.status);

  return (
    <AppShell>
      <div className="p-6 max-w-3xl space-y-6">
        <div className="flex justify-between items-start">
          <div>
            <h1 className="text-lg font-semibold">Venta {sale.id.slice(0, 8)}</h1>
            <p className="text-sm text-zinc-500">{new Date(sale.createdAt).toLocaleString()}</p>
          </div>
          <span className="rounded px-2 py-1 text-xs bg-zinc-100">{STATUS_LABELS[sale.status] ?? sale.status}</span>
        </div>

        {actionError && <p className="text-sm text-red-600 bg-red-50 rounded p-2">{actionError}</p>}

        <div className="bg-white rounded-lg border border-zinc-200 p-4 space-y-2 text-sm">
          <p>
            <span className="text-zinc-500">Cliente: </span>
            {sale.customer?.name ?? "Ocasional"}
          </p>
          <table className="w-full text-sm mt-2">
            <thead className="text-zinc-500 text-left">
              <tr>
                <th className="py-1">Producto</th>
                <th className="py-1">Cant.</th>
                <th className="py-1">P. unit.</th>
                <th className="py-1">Desc.</th>
                <th className="py-1 text-right">Subtotal</th>
              </tr>
            </thead>
            <tbody>
              {sale.items.map((it) => (
                <tr key={it.id} className="border-t border-zinc-100">
                  <td className="py-1">{it.product?.name ?? it.id}</td>
                  <td className="py-1">{Number(it.quantity)}</td>
                  <td className="py-1">Bs. {Number(it.unitPrice).toFixed(2)}</td>
                  <td className="py-1">Bs. {Number(it.discount).toFixed(2)}</td>
                  <td className="py-1 text-right">Bs. {Number(it.subtotal).toFixed(2)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="border-t border-zinc-200 pt-2 space-y-1 text-right">
            <p>Subtotal: Bs. {Number(sale.subtotal).toFixed(2)}</p>
            <p>Descuento: Bs. {Number(sale.discount).toFixed(2)}</p>
            <p className="font-semibold">Total: Bs. {Number(sale.total).toFixed(2)}</p>
            <p>Pagado: Bs. {Number(sale.paidTotal).toFixed(2)}</p>
            <p className={Number(sale.balance) > 0 ? "text-amber-700" : "text-emerald-700"}>
              Saldo: Bs. {Number(sale.balance).toFixed(2)}
            </p>
          </div>
        </div>

        <div className="bg-white rounded-lg border border-zinc-200 p-4 space-y-2">
          <h2 className="font-medium text-sm">Pagos</h2>
          {sale.payments.length === 0 && <p className="text-sm text-zinc-400">Sin pagos registrados</p>}
          {sale.payments.map((p) => (
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
        </div>

        <div className="flex gap-2">
          {canCancel && (
            <button onClick={cancelSale} disabled={busy} className="rounded border border-red-300 text-red-700 px-3 py-1.5 text-sm disabled:opacity-50">
              Cancelar venta
            </button>
          )}
          {canReturn && (
            <button onClick={returnSale} disabled={busy} className="rounded border border-red-300 text-red-700 px-3 py-1.5 text-sm disabled:opacity-50">
              Registrar devolución
            </button>
          )}
        </div>
      </div>
    </AppShell>
  );
}
