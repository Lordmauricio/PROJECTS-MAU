"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import AppShell from "@/components/AppShell";
import { api } from "@/lib/api";
import { ApiError } from "@/lib/auth-context";

interface DashboardSummary {
  salesToday: { count: number; total: string | number };
  salesMonth: { count: number; total: string | number };
  purchasesMonth: { count: number; total: string | number };
  incomeMonth: string | number;
  expensesMonth: string | number;
  invoicesIssued: number;
  customersServed: number;
  productsActive: number;
  lowStockProducts: number;
  pendingReceivables: { count: number; total: string | number };
  pendingPayables: { count: number; total: string | number };
  stockValue: string | number;
  topProducts: Array<{
    productId: string;
    product: { name: string; sku?: string | null } | null;
    quantity: string;
    total: string;
  }>;
  grossMargin: { available: boolean; reason: string };
}

export default function DashboardPage() {
  const [summary, setSummary] = useState<DashboardSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    api<DashboardSummary>("/organizations/me/dashboard")
      .then(setSummary)
      .catch((err) =>
        setLoadError(err instanceof ApiError ? err.message : "No se pudo cargar el resumen de la empresa"),
      )
      .finally(() => setLoading(false));
  }, []);

  return (
    <AppShell>
      <div className="p-6 space-y-6">
        <div>
          <h1 className="text-lg font-semibold">Inicio</h1>
          <p className="text-sm text-zinc-500 mt-1">
            Resumen de tu empresa. Estos números vienen directo de la base de datos — si están en
            cero es porque todavía no hay actividad registrada, no porque falten datos de ejemplo. Son
            indicadores comerciales, no registros fiscales.
          </p>
        </div>

        {loadError ? (
          <p className="text-sm text-red-600 bg-red-50 rounded p-2">{loadError}</p>
        ) : loading || !summary ? (
          <p className="text-sm text-zinc-500">Cargando...</p>
        ) : (
          <>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <StatCard label="Ventas hoy" value={`Bs. ${Number(summary.salesToday.total).toFixed(2)}`} sub={`${summary.salesToday.count} ventas`} />
              <StatCard label="Ventas del mes" value={`Bs. ${Number(summary.salesMonth.total).toFixed(2)}`} sub={`${summary.salesMonth.count} ventas`} />
              <StatCard label="Compras del mes" value={`Bs. ${Number(summary.purchasesMonth.total).toFixed(2)}`} sub={`${summary.purchasesMonth.count} compras`} />
              <StatCard label="Ingresos del mes (caja)" value={`Bs. ${Number(summary.incomeMonth).toFixed(2)}`} />
              <StatCard label="Egresos del mes (caja)" value={`Bs. ${Number(summary.expensesMonth).toFixed(2)}`} />
              <StatCard
                label="Utilidad comercial"
                value="No disponible"
                sub={summary.grossMargin.reason}
              />
              <StatCard
                label="Cuentas por cobrar pendientes"
                value={`Bs. ${Number(summary.pendingReceivables.total).toFixed(2)}`}
                sub={`${summary.pendingReceivables.count} pendientes`}
              />
              <StatCard
                label="Cuentas por pagar pendientes"
                value={`Bs. ${Number(summary.pendingPayables.total).toFixed(2)}`}
                sub={`${summary.pendingPayables.count} pendientes`}
              />
              <StatCard label="Valor de inventario (al costo actual)" value={`Bs. ${Number(summary.stockValue).toFixed(2)}`} />
              <StatCard label="Facturas emitidas" value={String(summary.invoicesIssued)} />
              <StatCard label="Clientes atendidos" value={String(summary.customersServed)} />
              <StatCard label="Productos activos" value={String(summary.productsActive)} />
              <StatCard label="Stock bajo" value={String(summary.lowStockProducts)} highlight={summary.lowStockProducts > 0} />
            </div>

            <div className="bg-white border border-zinc-200 rounded-lg p-5">
              <div className="flex items-center justify-between mb-3">
                <p className="text-sm font-semibold">Productos más vendidos del mes</p>
                <Link href="/reports" className="text-xs text-zinc-600 underline">
                  Ver todos los reportes
                </Link>
              </div>
              {summary.topProducts.length === 0 ? (
                <p className="text-sm text-zinc-400">Sin ventas todavía este mes</p>
              ) : (
                <table className="w-full text-sm">
                  <thead className="text-zinc-500 text-left">
                    <tr>
                      <th className="py-1">Producto</th>
                      <th className="py-1">Cantidad</th>
                      <th className="py-1">Total vendido</th>
                    </tr>
                  </thead>
                  <tbody>
                    {summary.topProducts.map((p) => (
                      <tr key={p.productId} className="border-t border-zinc-100">
                        <td className="py-1.5">{p.product?.name ?? p.productId}</td>
                        <td className="py-1.5">{Number(p.quantity)}</td>
                        <td className="py-1.5">Bs. {Number(p.total).toFixed(2)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </>
        )}
      </div>
    </AppShell>
  );
}

function StatCard({ label, value, sub, highlight }: { label: string; value: string; sub?: string; highlight?: boolean }) {
  return (
    <div className={`bg-white border rounded-lg p-4 ${highlight ? "border-amber-400" : "border-zinc-200"}`}>
      <p className="text-xs text-zinc-500">{label}</p>
      <p className="text-2xl font-semibold mt-1">{value}</p>
      {sub && <p className="text-xs text-zinc-400 mt-1">{sub}</p>}
    </div>
  );
}
