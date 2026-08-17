"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import AppShell from "@/components/AppShell";
import { api } from "@/lib/api";
import { ApiError } from "@/lib/auth-context";

interface PurchaseItem {
  id: string;
  productId: string;
  quantity: string;
  receivedQuantity: string;
  returnedQuantity: string;
  unitCost: string;
  discount: string;
  subtotal: string;
  product?: { id: string; name: string; sku?: string | null };
}

interface Payable {
  id: string;
  amount: string;
  status: string;
  paidTotal?: string;
  balance?: string;
}

interface Purchase {
  id: string;
  status: string;
  subtotal: string;
  discount: string;
  total: string;
  createdAt: string;
  supplier?: { id: string; name: string } | null;
  items: PurchaseItem[];
  payables: Payable[];
}

const STATUS_LABELS: Record<string, string> = {
  DRAFT: "Borrador",
  CONFIRMED: "Confirmada",
  PARTIALLY_RECEIVED: "Recepción parcial",
  RECEIVED: "Recibida",
  CANCELLED: "Cancelada",
};

function newIdempotencyKey() {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `key-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export default function PurchaseDetailPage() {
  const params = useParams<{ id: string }>();
  const [purchase, setPurchase] = useState<Purchase | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [receiveQty, setReceiveQty] = useState<Record<string, string>>({});
  const [returnQty, setReturnQty] = useState<Record<string, string>>({});
  const [payAmount, setPayAmount] = useState("");
  const [payMethod, setPayMethod] = useState("CASH");

  async function load() {
    setLoading(true);
    setLoadError(null);
    try {
      setPurchase(await api<Purchase>(`/purchases/${params.id}`));
    } catch (err) {
      setLoadError(err instanceof ApiError ? err.message : "No se pudo cargar la compra");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (params.id) load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params.id]);

  async function confirmPurchase() {
    setActionError(null);
    setBusy(true);
    try {
      setPurchase(await api<Purchase>(`/purchases/${params.id}/confirm`, { method: "POST" }));
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : "No se pudo confirmar la orden");
    } finally {
      setBusy(false);
    }
  }

  async function cancelPurchase() {
    setActionError(null);
    setBusy(true);
    try {
      setPurchase(await api<Purchase>(`/purchases/${params.id}/cancel`, { method: "POST" }));
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : "No se pudo cancelar la orden");
    } finally {
      setBusy(false);
    }
  }

  async function submitReceive(e: React.FormEvent) {
    e.preventDefault();
    setActionError(null);
    setBusy(true);
    try {
      const items = Object.entries(receiveQty)
        .filter(([, qty]) => Number(qty) > 0)
        .map(([purchaseItemId, qty]) => ({ purchaseItemId, quantity: Number(qty) }));
      if (items.length === 0) {
        setActionError("Ingresa alguna cantidad a recibir");
        return;
      }
      const updated = await api<Purchase>(`/purchases/${params.id}/receive`, {
        method: "POST",
        body: { items, idempotencyKey: newIdempotencyKey() },
      });
      setPurchase(updated);
      setReceiveQty({});
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : "No se pudo registrar la recepción");
    } finally {
      setBusy(false);
    }
  }

  async function submitReturn(e: React.FormEvent) {
    e.preventDefault();
    setActionError(null);
    setBusy(true);
    try {
      const items = Object.entries(returnQty)
        .filter(([, qty]) => Number(qty) > 0)
        .map(([purchaseItemId, qty]) => ({ purchaseItemId, quantity: Number(qty) }));
      if (items.length === 0) {
        setActionError("Ingresa alguna cantidad a devolver");
        return;
      }
      const updated = await api<Purchase>(`/purchases/${params.id}/return`, {
        method: "POST",
        body: { items, idempotencyKey: newIdempotencyKey() },
      });
      setPurchase(updated);
      setReturnQty({});
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : "No se pudo registrar la devolución");
    } finally {
      setBusy(false);
    }
  }

  async function submitPayment(e: React.FormEvent) {
    e.preventDefault();
    setActionError(null);
    if (!purchase?.payables[0]) return;
    setBusy(true);
    try {
      await api(`/payables/${purchase.payables[0].id}/payments`, {
        method: "POST",
        body: { method: payMethod, amount: Number(payAmount), idempotencyKey: newIdempotencyKey() },
      });
      setPayAmount("");
      load();
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

  if (loadError || !purchase) {
    return (
      <AppShell>
        <div className="p-6">
          <p className="text-sm text-red-600 bg-red-50 rounded p-2">{loadError ?? "Compra no encontrada"}</p>
        </div>
      </AppShell>
    );
  }

  const canEdit = purchase.status === "DRAFT";
  const canConfirm = purchase.status === "DRAFT";
  const canReceive = purchase.status === "CONFIRMED" || purchase.status === "PARTIALLY_RECEIVED";
  const canReturn = purchase.status === "PARTIALLY_RECEIVED" || purchase.status === "RECEIVED";
  const canCancel = purchase.status === "DRAFT" || purchase.status === "CONFIRMED";
  const payable = purchase.payables[0];

  return (
    <AppShell>
      <div className="p-6 max-w-3xl space-y-6">
        <div className="flex justify-between items-start">
          <div>
            <h1 className="text-lg font-semibold">Compra {purchase.id.slice(0, 8)}</h1>
            <p className="text-sm text-zinc-500">
              {purchase.supplier?.name ?? "-"} · {new Date(purchase.createdAt).toLocaleString()}
            </p>
          </div>
          <span className="rounded px-2 py-1 text-xs bg-zinc-100">{STATUS_LABELS[purchase.status] ?? purchase.status}</span>
        </div>

        {actionError && <p className="text-sm text-red-600 bg-red-50 rounded p-2">{actionError}</p>}
        {canEdit && <p className="text-sm text-zinc-500">Esta orden está en borrador — vuelve al listado para editar sus ítems.</p>}

        <div className="bg-white rounded-lg border border-zinc-200 p-4 space-y-2 text-sm">
          <table className="w-full text-sm">
            <thead className="text-zinc-500 text-left">
              <tr>
                <th className="py-1">Producto</th>
                <th className="py-1">Pedido</th>
                <th className="py-1">Recibido</th>
                <th className="py-1">Devuelto</th>
                <th className="py-1">Costo unit.</th>
                <th className="py-1 text-right">Subtotal</th>
              </tr>
            </thead>
            <tbody>
              {purchase.items.map((it) => (
                <tr key={it.id} className="border-t border-zinc-100">
                  <td className="py-1">{it.product?.name ?? it.productId}</td>
                  <td className="py-1">{Number(it.quantity)}</td>
                  <td className="py-1">{Number(it.receivedQuantity)}</td>
                  <td className="py-1">{Number(it.returnedQuantity)}</td>
                  <td className="py-1">Bs. {Number(it.unitCost).toFixed(2)}</td>
                  <td className="py-1 text-right">Bs. {Number(it.subtotal).toFixed(2)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="border-t border-zinc-200 pt-2 text-right space-y-1">
            <p>Subtotal: Bs. {Number(purchase.subtotal).toFixed(2)}</p>
            <p>Descuento: Bs. {Number(purchase.discount).toFixed(2)}</p>
            <p className="font-semibold">Total: Bs. {Number(purchase.total).toFixed(2)}</p>
          </div>
        </div>

        <div className="flex gap-2">
          {canConfirm && (
            <button onClick={confirmPurchase} disabled={busy} className="bg-zinc-900 text-white rounded px-3 py-1.5 text-sm disabled:opacity-50">
              Confirmar orden
            </button>
          )}
          {canCancel && (
            <button onClick={cancelPurchase} disabled={busy} className="rounded border border-red-300 text-red-700 px-3 py-1.5 text-sm disabled:opacity-50">
              Cancelar orden
            </button>
          )}
        </div>

        {canReceive && (
          <form onSubmit={submitReceive} className="bg-white rounded-lg border border-zinc-200 p-4 space-y-2">
            <h2 className="font-medium text-sm">Registrar recepción</h2>
            {purchase.items.map((it) => {
              const pending = Number(it.quantity) - Number(it.receivedQuantity);
              if (pending <= 0) return null;
              return (
                <div key={it.id} className="flex justify-between items-center text-sm">
                  <span>
                    {it.product?.name ?? it.productId} <span className="text-zinc-400">(pendiente: {pending})</span>
                  </span>
                  <input
                    type="number"
                    min={0}
                    max={pending}
                    step="0.01"
                    value={receiveQty[it.id] ?? ""}
                    onChange={(e) => setReceiveQty((prev) => ({ ...prev, [it.id]: e.target.value }))}
                    className="w-24 rounded border border-zinc-300 px-2 py-1"
                  />
                </div>
              );
            })}
            <button disabled={busy} className="bg-zinc-900 text-white rounded px-3 py-1.5 text-sm disabled:opacity-50">
              Registrar recepción
            </button>
          </form>
        )}

        {canReturn && (
          <form onSubmit={submitReturn} className="bg-white rounded-lg border border-zinc-200 p-4 space-y-2">
            <h2 className="font-medium text-sm">Devolución al proveedor</h2>
            {purchase.items.map((it) => {
              const returnable = Number(it.receivedQuantity) - Number(it.returnedQuantity);
              if (returnable <= 0) return null;
              return (
                <div key={it.id} className="flex justify-between items-center text-sm">
                  <span>
                    {it.product?.name ?? it.productId} <span className="text-zinc-400">(disponible para devolver: {returnable})</span>
                  </span>
                  <input
                    type="number"
                    min={0}
                    max={returnable}
                    step="0.01"
                    value={returnQty[it.id] ?? ""}
                    onChange={(e) => setReturnQty((prev) => ({ ...prev, [it.id]: e.target.value }))}
                    className="w-24 rounded border border-zinc-300 px-2 py-1"
                  />
                </div>
              );
            })}
            <button disabled={busy} className="rounded border border-red-300 text-red-700 px-3 py-1.5 text-sm disabled:opacity-50">
              Registrar devolución
            </button>
          </form>
        )}

        {payable && (
          <div className="bg-white rounded-lg border border-zinc-200 p-4 space-y-2">
            <h2 className="font-medium text-sm">Cuenta por pagar</h2>
            <p className="text-sm">
              Monto: Bs. {Number(payable.amount).toFixed(2)} · Pagado: Bs. {Number(payable.paidTotal ?? 0).toFixed(2)} · Saldo:{" "}
              <span className={Number(payable.balance ?? 0) > 0 ? "text-amber-700" : "text-emerald-700"}>
                Bs. {Number(payable.balance ?? 0).toFixed(2)}
              </span>{" "}
              · <span className="text-xs bg-zinc-100 rounded px-2 py-0.5">{payable.status}</span>
            </p>
            {Number(payable.balance ?? 0) > 0 && (
              <form onSubmit={submitPayment} className="flex gap-2 items-center pt-2">
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
        )}
      </div>
    </AppShell>
  );
}
