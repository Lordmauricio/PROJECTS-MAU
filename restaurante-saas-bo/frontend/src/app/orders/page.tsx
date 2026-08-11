"use client";

import { useEffect, useState } from "react";
import AppShell from "@/components/AppShell";
import { api } from "@/lib/api";
import { Order } from "@/lib/types";

const STATUS_LABEL: Record<Order["status"], string> = {
  OPEN: "Abierto",
  IN_PREPARATION: "En preparacion",
  READY: "Listo",
  DELIVERED: "Entregado",
  PAID: "Pagado",
  CANCELLED: "Cancelado",
};

export default function OrdersPage() {
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);

  async function load() {
    setLoading(true);
    const data = await api<Order[]>("/orders");
    setOrders(data);
    setLoading(false);
  }

  useEffect(() => {
    load();
  }, []);

  async function updateStatus(id: string, status: string) {
    await api(`/orders/${id}/status`, { method: "PATCH", body: { status } });
    load();
  }

  return (
    <AppShell>
      <div className="p-6">
        <h1 className="text-lg font-semibold mb-4">Pedidos</h1>
        {loading ? (
          <p className="text-sm text-zinc-500">Cargando...</p>
        ) : (
          <div className="bg-white rounded-lg border border-zinc-200 overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-zinc-50 text-zinc-500 text-left">
                <tr>
                  <th className="px-4 py-2">Fecha</th>
                  <th className="px-4 py-2">Tipo</th>
                  <th className="px-4 py-2">Items</th>
                  <th className="px-4 py-2">Total</th>
                  <th className="px-4 py-2">Estado</th>
                  <th className="px-4 py-2">Factura</th>
                  <th className="px-4 py-2"></th>
                </tr>
              </thead>
              <tbody>
                {orders.map((o) => (
                  <tr key={o.id} className="border-t border-zinc-100">
                    <td className="px-4 py-2">{new Date(o.createdAt).toLocaleString("es-BO")}</td>
                    <td className="px-4 py-2">{o.type}</td>
                    <td className="px-4 py-2">{o.items.length}</td>
                    <td className="px-4 py-2">Bs. {Number(o.total).toFixed(2)}</td>
                    <td className="px-4 py-2">{STATUS_LABEL[o.status]}</td>
                    <td className="px-4 py-2">
                      {o.invoice ? `#${o.invoice.numeroFactura} (${o.invoice.state})` : "-"}
                    </td>
                    <td className="px-4 py-2">
                      {o.status !== "PAID" && o.status !== "CANCELLED" && (
                        <select
                          defaultValue=""
                          onChange={(e) => e.target.value && updateStatus(o.id, e.target.value)}
                          className="text-xs border border-zinc-300 rounded px-1 py-1"
                        >
                          <option value="" disabled>
                            Cambiar estado
                          </option>
                          <option value="IN_PREPARATION">En preparacion</option>
                          <option value="READY">Listo</option>
                          <option value="DELIVERED">Entregado</option>
                          <option value="CANCELLED">Cancelar</option>
                        </select>
                      )}
                    </td>
                  </tr>
                ))}
                {orders.length === 0 && (
                  <tr>
                    <td colSpan={7} className="px-4 py-6 text-center text-zinc-400">
                      Sin pedidos todavia
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </AppShell>
  );
}
