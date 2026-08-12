"use client";

import { useEffect, useState } from "react";
import AppShell from "@/components/AppShell";
import { api } from "@/lib/api";

interface DashboardSummary {
  salesToday: { count: number; total: string | number };
  salesMonth: { count: number; total: string | number };
  invoicesIssued: number;
  customersServed: number;
  productsActive: number;
  lowStockProducts: number;
  pendingReceivables: { count: number; total: string | number };
}

export default function DashboardPage() {
  const [summary, setSummary] = useState<DashboardSummary | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api<DashboardSummary>("/organizations/me/dashboard")
      .then(setSummary)
      .finally(() => setLoading(false));
  }, []);

  return (
    <AppShell>
      <div className="p-6 space-y-6">
        <div>
          <h1 className="text-lg font-semibold">Inicio</h1>
          <p className="text-sm text-zinc-500 mt-1">
            Resumen de tu empresa. Estos números vienen directo de la base de datos — si están en
            cero es porque todavía no hay actividad registrada, no porque falten datos de ejemplo.
          </p>
        </div>

        {loading || !summary ? (
          <p className="text-sm text-zinc-500">Cargando...</p>
        ) : (
          <>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <StatCard label="Ventas hoy" value={`Bs. ${Number(summary.salesToday.total).toFixed(2)}`} sub={`${summary.salesToday.count} ventas`} />
              <StatCard label="Ventas del mes" value={`Bs. ${Number(summary.salesMonth.total).toFixed(2)}`} sub={`${summary.salesMonth.count} ventas`} />
              <StatCard label="Facturas emitidas" value={String(summary.invoicesIssued)} />
              <StatCard label="Clientes atendidos" value={String(summary.customersServed)} />
              <StatCard label="Productos activos" value={String(summary.productsActive)} />
              <StatCard label="Stock bajo" value={String(summary.lowStockProducts)} highlight={summary.lowStockProducts > 0} />
              <StatCard
                label="Cuentas por cobrar pendientes"
                value={`Bs. ${Number(summary.pendingReceivables.total).toFixed(2)}`}
                sub={`${summary.pendingReceivables.count} pendientes`}
              />
            </div>

            <div className="bg-white border border-zinc-200 rounded-lg p-5">
              <p className="text-sm text-zinc-600">
                Los gráficos de ventas (últimos 7 días, por método de pago, productos más
                vendidos, ingresos vs. gastos) y las alertas de facturas rechazadas / errores SIN
                se activan cuando el módulo de ventas y facturación entre en una fase siguiente —
                ver <code className="text-xs bg-zinc-100 px-1 py-0.5 rounded">docs/PROJECT_PLAN.md</code>.
              </p>
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
