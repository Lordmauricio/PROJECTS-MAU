"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import AppShell from "@/components/AppShell";
import { api, ApiError } from "@/lib/api";
import { useLocalDb } from "@/lib/offline/react/useLocalDb";
import { listLocalSalesWithState } from "@/lib/offline/sale-sync-state";
import { Button, Card, CardBody, CardHeader, EmptyState, ErrorState, Icon, LoadingState, type IconName } from "@/components/ui";

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

/** Espejo mínimo de `GET /reports/sales-by-date` (`ReportsService#salesByDateReport`) — el mismo reporte que ya existe en Fase Comercial 7, reutilizado acá para el gráfico. Cero endpoints nuevos. */
interface SalesByDateReport {
  rows: Array<{ date: string; total: string; salesCount: number }>;
}

const WEEKDAY_ES = ["dom", "lun", "mar", "mié", "jue", "vie", "sáb"];

function isoDateDaysAgo(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString().slice(0, 10);
}

interface TrendPoint {
  date: string;
  label: string;
  value: number;
}

interface TrendChart {
  points: TrendPoint[];
  max: number;
  linePath: string;
  areaPath: string;
}

/**
 * Arma los últimos 7 días calendario SIEMPRE (aunque el backend no haya
 * devuelto fila para un día — un día sin ventas es 0, no un hueco): nunca se
 * inventa un valor, y el eje X nunca queda con menos de 7 puntos por una
 * ventana vacía.
 */
function buildTrendChart(report: SalesByDateReport | null): TrendChart | null {
  if (!report) return null;
  const byDate = new Map(report.rows.map((r) => [r.date, Number(r.total)]));
  const points: TrendPoint[] = [];
  for (let i = 6; i >= 0; i--) {
    const date = isoDateDaysAgo(i);
    const weekday = new Date(`${date}T00:00:00`).getDay();
    points.push({ date, label: WEEKDAY_ES[weekday], value: byDate.get(date) ?? 0 });
  }
  const max = Math.max(1, ...points.map((p) => p.value));
  const W = 100;
  const H = 100;
  const stepX = W / (points.length - 1);
  const coords = points.map((p, i) => ({ x: i * stepX, y: H - (p.value / max) * H }));
  const linePath = coords.map((c, i) => `${i === 0 ? "M" : "L"}${c.x.toFixed(2)},${c.y.toFixed(2)}`).join(" ");
  const areaPath = `${linePath} L${W},${H} L0,${H} Z`;
  return { points, max, linePath, areaPath };
}

export default function DashboardPage() {
  const db = useLocalDb();

  const [summary, setSummary] = useState<DashboardSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [trend, setTrend] = useState<SalesByDateReport | null>(null);
  const [trendUnavailable, setTrendUnavailable] = useState<string | null>(null);

  const [attentionCount, setAttentionCount] = useState(0);

  useEffect(() => {
    api<DashboardSummary>("/organizations/me/dashboard")
      .then(setSummary)
      .catch((err) =>
        setLoadError(err instanceof ApiError ? err.message : "No se pudo cargar el resumen de la empresa"),
      )
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    api<SalesByDateReport>(`/reports/sales-by-date?dateFrom=${isoDateDaysAgo(6)}`)
      .then(setTrend)
      .catch((err) => {
        // Un usuario sin el permiso `reports.read` (ej. un cajero) no debe
        // ver esto como un error de carga — simplemente no tiene acceso a
        // esa vista; el resto del panel sigue funcionando con sus propios
        // datos, que vienen de un endpoint distinto.
        setTrendUnavailable(
          err instanceof ApiError && err.status === 403
            ? "No tenés permiso para ver la tendencia de ventas."
            : "No se pudo cargar la tendencia de ventas.",
        );
      });
  }, []);

  useEffect(() => {
    if (!db) return;
    let cancelled = false;
    listLocalSalesWithState(db).then((sales) => {
      if (cancelled) return;
      const n = sales.filter((s) => s.state.kind === "conflict" || s.state.kind === "error").length;
      setAttentionCount(n);
    });
    return () => {
      cancelled = true;
    };
  }, [db]);

  const chart = useMemo(() => buildTrendChart(trend), [trend]);

  return (
    <AppShell>
      <div className="space-y-6 p-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-lg font-semibold text-text">Inicio</h1>
            <p className="mt-1 max-w-2xl text-sm text-text-muted">
              Resumen de tu empresa. Estos números vienen directo de la base de datos — si están en
              cero es porque todavía no hay actividad registrada, no porque falten datos de ejemplo. Son
              indicadores comerciales, no registros fiscales.
            </p>
          </div>
          <Link href="/sales/pos">
            <Button icon="plus">Nueva venta</Button>
          </Link>
        </div>

        {loadError ? (
          <ErrorState message={loadError} />
        ) : loading || !summary ? (
          <LoadingState label="Cargando resumen…" />
        ) : (
          <>
            <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
              <StatCard label="Ventas hoy" value={`Bs. ${Number(summary.salesToday.total).toFixed(2)}`} sub={`${summary.salesToday.count} ventas`} />
              <StatCard label="Ventas del mes" value={`Bs. ${Number(summary.salesMonth.total).toFixed(2)}`} sub={`${summary.salesMonth.count} ventas`} />
              <StatCard label="Compras del mes" value={`Bs. ${Number(summary.purchasesMonth.total).toFixed(2)}`} sub={`${summary.purchasesMonth.count} compras`} />
              <StatCard label="Ingresos del mes (caja)" value={`Bs. ${Number(summary.incomeMonth).toFixed(2)}`} />
              <StatCard label="Egresos del mes (caja)" value={`Bs. ${Number(summary.expensesMonth).toFixed(2)}`} />
              <StatCard label="Utilidad comercial" value="No disponible" sub={summary.grossMargin.reason} />
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

            <div className="grid gap-6 lg:grid-cols-[2fr_1fr]">
              <Card>
                <CardHeader>
                  <h2 className="text-sm font-semibold text-text">Ventas de los últimos 7 días</h2>
                  {chart && <span className="text-xs text-text-muted">Pico: Bs. {chart.max.toFixed(2)}</span>}
                </CardHeader>
                <CardBody>
                  {trendUnavailable ? (
                    <p className="text-sm text-text-muted">{trendUnavailable}</p>
                  ) : !chart ? (
                    <LoadingState label="Cargando tendencia…" />
                  ) : (
                    <TrendChartView chart={chart} />
                  )}
                </CardBody>
              </Card>

              <Card>
                <CardHeader>
                  <h2 className="text-sm font-semibold text-text">Alertas</h2>
                </CardHeader>
                <CardBody className="space-y-2">
                  {summary.lowStockProducts > 0 && (
                    <AlertRow
                      tone="warning"
                      icon="alert-triangle"
                      title="Stock bajo"
                      description={`${summary.lowStockProducts} producto${summary.lowStockProducts === 1 ? "" : "s"} por debajo del mínimo.`}
                      href="/inventory/products"
                    />
                  )}
                  {attentionCount > 0 && (
                    <AlertRow
                      tone="danger"
                      icon="sync"
                      title="Ventas locales pendientes de revisar"
                      description={`${attentionCount} venta${attentionCount === 1 ? "" : "s"} de este dispositivo con conflicto o error de sincronización.`}
                      href="/sales/pos"
                    />
                  )}
                  {summary.lowStockProducts === 0 && attentionCount === 0 && (
                    <p className="text-sm text-text-muted">Sin alertas pendientes.</p>
                  )}
                </CardBody>
              </Card>
            </div>

            <Card>
              <CardHeader>
                <h2 className="text-sm font-semibold text-text">Productos más vendidos del mes</h2>
                <Link href="/reports" className="text-xs text-text-muted underline">
                  Ver todos los reportes
                </Link>
              </CardHeader>
              <CardBody>
                {summary.topProducts.length === 0 ? (
                  <EmptyState icon="box" title="Sin ventas todavía este mes" />
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead className="text-left text-text-muted">
                        <tr>
                          <th className="py-1 font-medium">Producto</th>
                          <th className="py-1 font-medium">Cantidad</th>
                          <th className="py-1 font-medium">Total vendido</th>
                        </tr>
                      </thead>
                      <tbody>
                        {summary.topProducts.map((p) => (
                          <tr key={p.productId} className="border-t border-border">
                            <td className="py-1.5 text-text">{p.product?.name ?? p.productId}</td>
                            <td className="py-1.5 text-text">{Number(p.quantity)}</td>
                            <td className="py-1.5 text-text">Bs. {Number(p.total).toFixed(2)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </CardBody>
            </Card>
          </>
        )}
      </div>
    </AppShell>
  );
}

function StatCard({ label, value, sub, highlight }: { label: string; value: string; sub?: string; highlight?: boolean }) {
  return (
    <Card className={highlight ? "border-warning" : undefined}>
      <CardBody>
        <p className="text-xs text-text-muted">{label}</p>
        <p className="mt-1 text-2xl font-semibold text-text">{value}</p>
        {sub && <p className="mt-1 text-xs text-text-muted">{sub}</p>}
      </CardBody>
    </Card>
  );
}

/** Gráfico de tendencia — SVG a mano, sin librería (la misma decisión que ya tomó Stitch, solo que acá con datos reales de `GET /reports/sales-by-date`). */
function TrendChartView({ chart }: { chart: TrendChart }) {
  return (
    <div>
      <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="h-40 w-full" aria-hidden="true">
        <path d={chart.areaPath} fill="var(--kipu-primary-soft)" stroke="none" />
        <path
          d={chart.linePath}
          fill="none"
          stroke="var(--kipu-primary)"
          strokeWidth={2}
          strokeLinejoin="round"
          strokeLinecap="round"
          vectorEffect="non-scaling-stroke"
        />
      </svg>
      <div className="mt-2 flex justify-between text-xs text-text-muted">
        {chart.points.map((p) => (
          <span key={p.date}>{p.label}</span>
        ))}
      </div>
      {/* El SVG es decorativo (aria-hidden): esta tabla oculta visualmente es la alternativa textual real para un lector de pantalla. */}
      <table className="sr-only">
        <caption>Ventas por día, últimos 7 días</caption>
        <tbody>
          {chart.points.map((p) => (
            <tr key={p.date}>
              <th scope="row">{p.date}</th>
              <td>Bs. {p.value.toFixed(2)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function AlertRow({
  tone,
  icon,
  title,
  description,
  href,
}: {
  tone: "warning" | "danger";
  icon: IconName;
  title: string;
  description: string;
  href: string;
}) {
  const toneClasses = tone === "warning" ? "bg-warning-soft text-amber-800" : "bg-danger-soft text-red-800";
  return (
    <Link href={href} className={`flex items-start gap-2 rounded-lg px-3 py-2.5 text-sm transition-opacity hover:opacity-90 ${toneClasses}`}>
      <Icon name={icon} size={18} className="mt-0.5 shrink-0" />
      <span>
        <span className="block font-medium">{title}</span>
        <span className="block">{description}</span>
      </span>
    </Link>
  );
}
