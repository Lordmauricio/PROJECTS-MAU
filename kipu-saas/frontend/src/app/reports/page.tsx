"use client";

import { useEffect, useMemo, useState } from "react";
import AppShell from "@/components/AppShell";
import { api, apiDownload } from "@/lib/api";
import { ApiError } from "@/lib/auth-context";
import {
  FILTER_LABELS,
  FilterKey,
  PAYMENT_METHOD_OPTIONS,
  REPORTS,
  ReportDefinition,
  getPath,
} from "./report-definitions";

interface Option {
  id: string;
  name: string;
}

interface ReportViewData {
  rows: Record<string, unknown>[];
  summary?: Record<string, unknown>;
  totalRows?: number;
  page?: number;
  pageSize?: number;
}

const SUMMARY_LABELS: Record<string, string> = {
  count: "Cantidad",
  total: "Total",
  subtotal: "Subtotal",
  discount: "Descuento",
  amount: "Monto",
  balance: "Saldo",
  openingAmount: "Apertura",
  currentBalance: "Saldo actual",
  closedDifference: "Diferencia (cerradas)",
  openCount: "Cajas abiertas",
  closedCount: "Cajas cerradas",
  totalQuantity: "Cantidad total",
  totalValue: "Valor total",
  lowStockCount: "Productos con stock bajo",
  categories: "Categorías",
  branches: "Sucursales",
  posTerminals: "Puntos de venta",
  users: "Usuarios",
  methods: "Métodos",
  days: "Días",
  products: "Productos",
  quantity: "Cantidad",
  salesCount: "N.º de ventas",
  in: "Entradas",
  out: "Salidas",
  transfer: "Transferencias",
  adjustment: "Ajustes",
  return: "Devoluciones",
};

function humanizeKey(key: string): string {
  return SUMMARY_LABELS[key] ?? key.replace(/([A-Z])/g, " $1").replace(/^./, (c) => c.toUpperCase());
}

function formatMoney(value: unknown): string {
  return `Bs. ${Number(value ?? 0).toFixed(2)}`;
}

function formatDate(value: unknown): string {
  if (!value) return "-";
  const d = new Date(value as string);
  if (Number.isNaN(d.getTime())) return String(value);
  return d.toLocaleString("es-BO", { dateStyle: "short", timeStyle: "short" });
}

export default function ReportsPage() {
  const [reportKey, setReportKey] = useState<string>("sales");
  const definition = useMemo<ReportDefinition>(
    () => REPORTS.find((r) => r.key === reportKey) ?? REPORTS[0],
    [reportKey],
  );

  const [filters, setFilters] = useState<Record<string, string>>({});
  const [page, setPage] = useState(1);
  const [pageSize] = useState(20);

  const [branches, setBranches] = useState<Option[]>([]);
  const [warehouses, setWarehouses] = useState<Option[]>([]);
  const [posTerminals, setPosTerminals] = useState<Option[]>([]);
  const [products, setProducts] = useState<Option[]>([]);
  const [categories, setCategories] = useState<Option[]>([]);
  const [users, setUsers] = useState<Option[]>([]);

  const [data, setData] = useState<ReportViewData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [exporting, setExporting] = useState<"csv" | "xlsx" | null>(null);

  // Referencia para los selects de filtro — se carga una sola vez.
  useEffect(() => {
    Promise.all([
      api<Array<{ id: string; name: string; warehouses: Option[]; posTerminals: Option[] }>>("/branches"),
      api<Option[]>("/warehouses"),
      api<Option[]>("/pos-terminals"),
      api<Array<{ id: string; name: string }>>("/products"),
      api<Array<{ id: string; name: string }>>("/product-categories"),
      api<Array<{ userId: string; user: { id: string; name: string } }>>("/members"),
    ])
      .then(([b, w, p, prod, cat, mem]) => {
        setBranches(b.map((x) => ({ id: x.id, name: x.name })));
        setWarehouses(w);
        setPosTerminals(p);
        setProducts(prod);
        setCategories(cat);
        setUsers(mem.map((m) => ({ id: m.userId, name: m.user.name })));
      })
      .catch(() => {
        // Los selects de filtro son un plus, no bloqueante: si fallan, los
        // reportes igual se pueden ver sin esos filtros.
      });
  }, []);

  function buildQuery(extra?: { page?: number; pageSize?: number }) {
    const params = new URLSearchParams();
    for (const key of definition.filters) {
      const value = filters[key];
      if (value) params.set(key, value);
    }
    if (definition.hasLimit && filters.limit) params.set("limit", filters.limit);
    if (definition.paginated) {
      params.set("page", String(extra?.page ?? page));
      params.set("pageSize", String(extra?.pageSize ?? pageSize));
    }
    return params.toString();
  }

  async function load(targetPage = page) {
    setLoading(true);
    setError(null);
    try {
      const qs = buildQuery({ page: targetPage });
      const result = await api<ReportViewData>(`/reports/${definition.key}${qs ? `?${qs}` : ""}`);
      setData(result);
      setPage(targetPage);
    } catch (err) {
      setData(null);
      setError(err instanceof ApiError ? err.message : "No se pudo cargar el reporte");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    setFilters({});
    setPage(1);
    load(1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reportKey]);

  async function handleExport(format: "csv" | "xlsx") {
    setExporting(format);
    try {
      const qs = buildQuery();
      const params = new URLSearchParams(qs);
      params.set("format", format);
      await apiDownload(
        `/reports/${definition.key}/export?${params.toString()}`,
        `${definition.key}-${new Date().toISOString().slice(0, 10)}.${format}`,
      );
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "No se pudo exportar el reporte");
    } finally {
      setExporting(null);
    }
  }

  const groups = useMemo(() => {
    const byGroup = new Map<string, ReportDefinition[]>();
    for (const r of REPORTS) {
      if (!byGroup.has(r.group)) byGroup.set(r.group, []);
      byGroup.get(r.group)!.push(r);
    }
    return byGroup;
  }, []);

  const summaryEntries = data?.summary
    ? Object.entries(data.summary).filter(([, v]) => !Array.isArray(v))
    : [];
  const byType = (data?.summary?.byType as Array<{ type: string; total: string; count: number }>) ?? [];

  return (
    <AppShell>
      <div className="p-6 space-y-6 max-w-7xl">
        <div>
          <h1 className="text-lg font-semibold">Reportes</h1>
          <p className="text-sm text-zinc-500 mt-1">
            Reportes comerciales, generados a partir de los datos reales de Ventas, Compras, Caja e
            Inventario. Estos NO son documentos fiscales ni sustituyen la facturación exigida por el
            SIN.
          </p>
        </div>

        <div className="flex gap-6">
          <aside className="w-56 shrink-0">
            {[...groups.entries()].map(([group, items]) => (
              <div key={group} className="mb-4">
                <p className="text-[11px] font-semibold uppercase tracking-wide text-zinc-500 mb-1">
                  {group}
                </p>
                {items.map((r) => (
                  <button
                    key={r.key}
                    onClick={() => setReportKey(r.key)}
                    className={`block w-full text-left px-2 py-1.5 rounded text-sm ${
                      r.key === reportKey ? "bg-zinc-900 text-white" : "text-zinc-700 hover:bg-zinc-100"
                    }`}
                  >
                    {r.label}
                  </button>
                ))}
              </div>
            ))}
          </aside>

          <div className="flex-1 min-w-0 space-y-4">
            {/* Filtros */}
            <div className="bg-white border border-zinc-200 rounded-lg p-4">
              <div className="flex flex-wrap gap-3 items-end">
                {definition.filters.map((key) => (
                  <FilterField
                    key={key}
                    filterKey={key}
                    definition={definition}
                    value={filters[key] ?? ""}
                    onChange={(v) => setFilters((f) => ({ ...f, [key]: v }))}
                    branches={branches}
                    warehouses={warehouses}
                    posTerminals={posTerminals}
                    products={products}
                    categories={categories}
                    users={users}
                  />
                ))}
                {definition.hasLimit && (
                  <div className="flex flex-col gap-1">
                    <label className="text-xs text-zinc-500">Límite</label>
                    <input
                      type="number"
                      min={1}
                      placeholder="10"
                      value={filters.limit ?? ""}
                      onChange={(e) => setFilters((f) => ({ ...f, limit: e.target.value }))}
                      className="rounded border border-zinc-300 px-2 py-1.5 text-sm w-24"
                    />
                  </div>
                )}
                <button
                  onClick={() => load(1)}
                  className="px-3 py-1.5 text-sm rounded bg-zinc-900 text-white hover:bg-zinc-800"
                >
                  Aplicar filtros
                </button>
                <div className="flex-1" />
                <button
                  onClick={() => handleExport("csv")}
                  disabled={exporting !== null || loading}
                  className="px-3 py-1.5 text-sm rounded border border-zinc-300 hover:bg-zinc-50 disabled:opacity-50"
                >
                  {exporting === "csv" ? "Exportando..." : "Exportar CSV"}
                </button>
                <button
                  onClick={() => handleExport("xlsx")}
                  disabled={exporting !== null || loading}
                  className="px-3 py-1.5 text-sm rounded border border-zinc-300 hover:bg-zinc-50 disabled:opacity-50"
                >
                  {exporting === "xlsx" ? "Exportando..." : "Exportar Excel"}
                </button>
              </div>
            </div>

            {error && <p className="text-sm text-red-600 bg-red-50 rounded p-2">{error}</p>}

            {/* Resumen */}
            {!loading && !error && summaryEntries.length > 0 && (
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                {summaryEntries.map(([key, value]) => (
                  <div key={key} className="bg-white border border-zinc-200 rounded-lg p-3">
                    <p className="text-xs text-zinc-500">{humanizeKey(key)}</p>
                    <p className="text-lg font-semibold mt-0.5">
                      {typeof value === "string"
                        ? formatMoney(value)
                        : typeof value === "boolean"
                          ? value
                            ? "Sí"
                            : "No"
                          : String(value)}
                    </p>
                  </div>
                ))}
              </div>
            )}

            {byType.length > 0 && (
              <div className="bg-white border border-zinc-200 rounded-lg p-4">
                <p className="text-xs font-semibold text-zinc-500 mb-2">Desglose por tipo</p>
                <div className="flex flex-wrap gap-4">
                  {byType.map((t) => (
                    <div key={t.type} className="text-sm">
                      <span className="text-zinc-500">{t.type}: </span>
                      <span className="font-medium">{formatMoney(t.total)}</span>
                      <span className="text-zinc-400"> ({t.count})</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Tabla */}
            <div className="bg-white rounded-lg border border-zinc-200 overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-zinc-50 text-zinc-500 text-left">
                  <tr>
                    {definition.columns.map((c) => (
                      <th key={c.key} className="px-4 py-2 whitespace-nowrap">
                        {c.label}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {loading && (
                    <tr>
                      <td colSpan={definition.columns.length} className="px-4 py-6 text-center text-zinc-400">
                        Cargando...
                      </td>
                    </tr>
                  )}
                  {!loading &&
                    data?.rows.map((row, i) => (
                      <tr key={i} className="border-t border-zinc-100">
                        {definition.columns.map((c) => {
                          const value = getPath(row, c.key);
                          return (
                            <td key={c.key} className="px-4 py-2 whitespace-nowrap">
                              {value === null || value === undefined || value === ""
                                ? "-"
                                : c.money
                                  ? formatMoney(value)
                                  : c.date
                                    ? formatDate(value)
                                    : c.boolean
                                      ? (value ? "Sí" : "No")
                                      : String(value)}
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  {!loading && (!data || data.rows.length === 0) && !error && (
                    <tr>
                      <td colSpan={definition.columns.length} className="px-4 py-6 text-center text-zinc-400">
                        Sin datos para los filtros seleccionados
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            {/* Paginación */}
            {definition.paginated && data && (data.totalRows ?? 0) > 0 && (
              <div className="flex items-center justify-between text-sm text-zinc-500">
                <span>
                  {data.rows.length} de {data.totalRows} filas — página {data.page ?? page}
                </span>
                <div className="flex gap-2">
                  <button
                    onClick={() => load(page - 1)}
                    disabled={page <= 1 || loading}
                    className="px-2 py-1 rounded border border-zinc-300 disabled:opacity-40"
                  >
                    Anterior
                  </button>
                  <button
                    onClick={() => load(page + 1)}
                    disabled={loading || page * pageSize >= (data.totalRows ?? 0)}
                    className="px-2 py-1 rounded border border-zinc-300 disabled:opacity-40"
                  >
                    Siguiente
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </AppShell>
  );
}

function FilterField({
  filterKey,
  value,
  onChange,
  definition,
  branches,
  warehouses,
  posTerminals,
  products,
  categories,
  users,
}: {
  filterKey: FilterKey;
  value: string;
  onChange: (v: string) => void;
  definition: ReportDefinition;
  branches: Option[];
  warehouses: Option[];
  posTerminals: Option[];
  products: Option[];
  categories: Option[];
  users: Option[];
}) {
  const label = FILTER_LABELS[filterKey];
  const base = "rounded border border-zinc-300 px-2 py-1.5 text-sm";

  if (filterKey === "dateFrom" || filterKey === "dateTo") {
    return (
      <div className="flex flex-col gap-1">
        <label className="text-xs text-zinc-500">{label}</label>
        <input type="date" value={value} onChange={(e) => onChange(e.target.value)} className={base} />
      </div>
    );
  }

  const selectOptions: Record<string, Option[]> = {
    branchId: branches,
    warehouseId: warehouses,
    posTerminalId: posTerminals,
    productId: products,
    categoryId: categories,
    userId: users,
  };

  if (filterKey === "paymentMethod") {
    return (
      <div className="flex flex-col gap-1">
        <label className="text-xs text-zinc-500">{label}</label>
        <select value={value} onChange={(e) => onChange(e.target.value)} className={base}>
          <option value="">Todos</option>
          {PAYMENT_METHOD_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      </div>
    );
  }

  if (filterKey === "status") {
    return (
      <div className="flex flex-col gap-1">
        <label className="text-xs text-zinc-500">{label}</label>
        <select value={value} onChange={(e) => onChange(e.target.value)} className={base}>
          <option value="">Todos</option>
          {(definition.statusOptions ?? []).map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      </div>
    );
  }

  const options = selectOptions[filterKey] ?? [];
  return (
    <div className="flex flex-col gap-1">
      <label className="text-xs text-zinc-500">{label}</label>
      <select value={value} onChange={(e) => onChange(e.target.value)} className={base}>
        <option value="">Todos</option>
        {options.map((o) => (
          <option key={o.id} value={o.id}>
            {o.name}
          </option>
        ))}
      </select>
    </div>
  );
}
