"use client";

import { useEffect, useState } from "react";
import AppShell from "@/components/AppShell";
import { api } from "@/lib/api";
import { ApiError } from "@/lib/auth-context";

interface Product {
  id: string;
  name: string;
  sku?: string | null;
}

interface Warehouse {
  id: string;
  name: string;
}

interface StockRow {
  productId: string;
  warehouseId: string;
  quantity: string;
  product: { id: string; name: string; sku?: string | null };
  warehouse: { id: string; name: string };
}

interface MovementRow {
  id: string;
  type: string;
  quantity: string;
  stockBefore: string;
  stockAfter: string;
  reason?: string | null;
  reference?: string | null;
  createdAt: string;
  product: { name: string };
  warehouse: { name: string };
}

const MOVEMENT_TYPE_LABELS: Record<string, string> = {
  IN: "Entrada",
  OUT: "Salida",
  TRANSFER: "Transferencia",
  ADJUSTMENT: "Ajuste",
  RETURN: "Devolución",
};

function newIdempotencyKey() {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `key-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export default function InventoryMovementsPage() {
  const [products, setProducts] = useState<Product[]>([]);
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [stock, setStock] = useState<StockRow[]>([]);
  const [movements, setMovements] = useState<MovementRow[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);

  // Filtros que se aplican tanto al stock por almacén como al historial de movimientos.
  const [filters, setFilters] = useState({ warehouseId: "", productId: "", type: "", dateFrom: "", dateTo: "" });

  const [moveForm, setMoveForm] = useState({
    productId: "",
    warehouseId: "",
    type: "IN",
    direction: "INCREASE",
    quantity: "",
    reason: "",
  });
  const [moveError, setMoveError] = useState<string | null>(null);
  const [moveOk, setMoveOk] = useState<string | null>(null);

  const [transferForm, setTransferForm] = useState({
    productId: "",
    fromWarehouseId: "",
    toWarehouseId: "",
    quantity: "",
    reason: "",
  });
  const [transferError, setTransferError] = useState<string | null>(null);
  const [transferOk, setTransferOk] = useState<string | null>(null);

  const [kardexRows, setKardexRows] = useState<MovementRow[] | null>(null);
  const [kardexError, setKardexError] = useState<string | null>(null);

  async function loadCatalogs() {
    try {
      const [p, branches] = await Promise.all([
        api<Product[]>("/products"),
        api<{ warehouses: Warehouse[] }[]>("/branches"),
      ]);
      setProducts(p);
      setWarehouses(branches.flatMap((b) => b.warehouses));
    } catch (err) {
      setLoadError(err instanceof ApiError ? err.message : "No se pudo cargar productos/almacenes");
    }
  }

  function buildQuery(params: Record<string, string>) {
    const qs = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) {
      if (value) qs.set(key, value);
    }
    const str = qs.toString();
    return str ? `?${str}` : "";
  }

  async function loadStockAndMovements() {
    setLoadError(null);
    try {
      const [s, m] = await Promise.all([
        api<StockRow[]>(`/inventory${buildQuery({ warehouseId: filters.warehouseId, productId: filters.productId })}`),
        api<MovementRow[]>(
          `/inventory/movements${buildQuery({
            warehouseId: filters.warehouseId,
            productId: filters.productId,
            type: filters.type,
            dateFrom: filters.dateFrom,
            dateTo: filters.dateTo,
          })}`
        ),
      ]);
      setStock(s);
      setMovements(m);
    } catch (err) {
      setLoadError(err instanceof ApiError ? err.message : "No se pudo cargar el inventario");
    }
  }

  useEffect(() => {
    loadCatalogs();
  }, []);

  useEffect(() => {
    loadStockAndMovements();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filters.warehouseId, filters.productId, filters.type, filters.dateFrom, filters.dateTo]);

  async function registerMovement(e: React.FormEvent) {
    e.preventDefault();
    setMoveError(null);
    setMoveOk(null);
    try {
      await api("/inventory/movements", {
        method: "POST",
        body: {
          productId: moveForm.productId,
          warehouseId: moveForm.warehouseId,
          type: moveForm.type,
          direction: moveForm.type === "ADJUSTMENT" ? moveForm.direction : undefined,
          quantity: Number(moveForm.quantity),
          reason: moveForm.reason || undefined,
          idempotencyKey: newIdempotencyKey(),
        },
      });
      setMoveOk("Movimiento registrado correctamente.");
      setMoveForm((f) => ({ ...f, quantity: "", reason: "" }));
      loadStockAndMovements();
    } catch (err) {
      setMoveError(err instanceof ApiError ? err.message : "No se pudo registrar el movimiento");
    }
  }

  async function registerTransfer(e: React.FormEvent) {
    e.preventDefault();
    setTransferError(null);
    setTransferOk(null);
    if (transferForm.fromWarehouseId && transferForm.fromWarehouseId === transferForm.toWarehouseId) {
      setTransferError("El almacén de origen y destino no pueden ser el mismo.");
      return;
    }
    try {
      await api("/inventory/transfers", {
        method: "POST",
        body: {
          productId: transferForm.productId,
          fromWarehouseId: transferForm.fromWarehouseId,
          toWarehouseId: transferForm.toWarehouseId,
          quantity: Number(transferForm.quantity),
          reason: transferForm.reason || undefined,
          idempotencyKey: newIdempotencyKey(),
        },
      });
      setTransferOk("Transferencia realizada correctamente.");
      setTransferForm((f) => ({ ...f, quantity: "", reason: "" }));
      loadStockAndMovements();
    } catch (err) {
      setTransferError(err instanceof ApiError ? err.message : "No se pudo realizar la transferencia");
    }
  }

  async function viewKardex() {
    setKardexError(null);
    setKardexRows(null);
    if (!filters.productId || !filters.warehouseId) {
      setKardexError("Elegí un producto y un almacén en los filtros para ver su kardex.");
      return;
    }
    try {
      const rows = await api<MovementRow[]>(
        `/inventory/kardex${buildQuery({
          productId: filters.productId,
          warehouseId: filters.warehouseId,
          dateFrom: filters.dateFrom,
          dateTo: filters.dateTo,
        })}`
      );
      setKardexRows(rows);
    } catch (err) {
      setKardexError(err instanceof ApiError ? err.message : "No se pudo cargar el kardex");
    }
  }

  function warehouseName(id: string) {
    return warehouses.find((w) => w.id === id)?.name ?? "-";
  }

  return (
    <AppShell>
      <div className="p-6 max-w-6xl space-y-6">
        <div>
          <h1 className="text-lg font-semibold">Inventario avanzado</h1>
          <p className="text-sm text-zinc-500">
            Kardex real por producto y almacén. Entradas/salidas por venta y compra se registran automáticamente
            desde esos módulos; acá se registran entradas/salidas manuales, ajustes con conteo físico y
            transferencias entre almacenes.
          </p>
        </div>
        {loadError && <p className="text-sm text-red-600 bg-red-50 rounded p-2">{loadError}</p>}

        <div className="bg-white rounded-lg border border-zinc-200 p-4 space-y-3">
          <h2 className="font-medium text-sm">Filtros</h2>
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
            <select
              value={filters.productId}
              onChange={(e) => setFilters((f) => ({ ...f, productId: e.target.value }))}
              className="rounded border border-zinc-300 px-3 py-1.5 text-sm"
            >
              <option value="">Todos los productos</option>
              {products.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name} {p.sku ? `(${p.sku})` : ""}
                </option>
              ))}
            </select>
            <select
              value={filters.warehouseId}
              onChange={(e) => setFilters((f) => ({ ...f, warehouseId: e.target.value }))}
              className="rounded border border-zinc-300 px-3 py-1.5 text-sm"
            >
              <option value="">Todos los almacenes</option>
              {warehouses.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.name}
                </option>
              ))}
            </select>
            <select
              value={filters.type}
              onChange={(e) => setFilters((f) => ({ ...f, type: e.target.value }))}
              className="rounded border border-zinc-300 px-3 py-1.5 text-sm"
            >
              <option value="">Todos los tipos</option>
              {Object.entries(MOVEMENT_TYPE_LABELS).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
            <input
              type="date"
              value={filters.dateFrom}
              onChange={(e) => setFilters((f) => ({ ...f, dateFrom: e.target.value }))}
              className="rounded border border-zinc-300 px-3 py-1.5 text-sm"
            />
            <input
              type="date"
              value={filters.dateTo}
              onChange={(e) => setFilters((f) => ({ ...f, dateTo: e.target.value }))}
              className="rounded border border-zinc-300 px-3 py-1.5 text-sm"
            />
          </div>
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={viewKardex}
              className="text-sm rounded border border-zinc-300 px-3 py-1.5 hover:bg-zinc-50"
            >
              Ver kardex de este producto/almacén
            </button>
            <span className="text-xs text-zinc-400">Requiere elegir un producto y un almacén específicos arriba.</span>
          </div>
          {kardexError && <p className="text-sm text-red-600 bg-red-50 rounded p-2">{kardexError}</p>}
        </div>

        {kardexRows && (
          <div className="bg-white rounded-lg border border-zinc-200 overflow-hidden">
            <div className="px-4 py-2 border-b border-zinc-100 flex items-center justify-between">
              <h2 className="font-medium text-sm">
                Kardex — {products.find((p) => p.id === filters.productId)?.name} en {warehouseName(filters.warehouseId)}
              </h2>
              <button className="text-xs text-zinc-400 hover:text-zinc-700" onClick={() => setKardexRows(null)}>
                Cerrar
              </button>
            </div>
            <table className="w-full text-sm">
              <thead className="bg-zinc-50 text-zinc-500 text-left">
                <tr>
                  <th className="px-4 py-2">Fecha</th>
                  <th className="px-4 py-2">Tipo</th>
                  <th className="px-4 py-2">Cantidad</th>
                  <th className="px-4 py-2">Saldo antes</th>
                  <th className="px-4 py-2">Saldo después</th>
                  <th className="px-4 py-2">Motivo</th>
                </tr>
              </thead>
              <tbody>
                {kardexRows.map((m) => (
                  <tr key={m.id} className="border-t border-zinc-100">
                    <td className="px-4 py-2">{new Date(m.createdAt).toLocaleString()}</td>
                    <td className="px-4 py-2">{MOVEMENT_TYPE_LABELS[m.type] ?? m.type}</td>
                    <td className="px-4 py-2">{Number(m.quantity)}</td>
                    <td className="px-4 py-2">{Number(m.stockBefore)}</td>
                    <td className="px-4 py-2">{Number(m.stockAfter)}</td>
                    <td className="px-4 py-2">{m.reason ?? "-"}</td>
                  </tr>
                ))}
                {kardexRows.length === 0 && (
                  <tr>
                    <td colSpan={6} className="px-4 py-6 text-center text-zinc-400">
                      Sin movimientos en el período seleccionado
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}

        <div className="grid md:grid-cols-2 gap-6">
          <form onSubmit={registerMovement} className="bg-white rounded-lg border border-zinc-200 p-5 space-y-3">
            <h2 className="font-medium text-sm">Registrar entrada, salida o ajuste</h2>
            {moveError && <p className="text-sm text-red-600 bg-red-50 rounded p-2">{moveError}</p>}
            {moveOk && <p className="text-sm text-green-700 bg-green-50 rounded p-2">{moveOk}</p>}
            <div className="grid grid-cols-2 gap-3">
              <select
                value={moveForm.productId}
                onChange={(e) => setMoveForm((f) => ({ ...f, productId: e.target.value }))}
                className="rounded border border-zinc-300 px-3 py-1.5 text-sm col-span-2"
                required
              >
                <option value="">Producto...</option>
                {products.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name} {p.sku ? `(${p.sku})` : ""}
                  </option>
                ))}
              </select>
              <select
                value={moveForm.warehouseId}
                onChange={(e) => setMoveForm((f) => ({ ...f, warehouseId: e.target.value }))}
                className="rounded border border-zinc-300 px-3 py-1.5 text-sm"
                required
              >
                <option value="">Almacén...</option>
                {warehouses.map((w) => (
                  <option key={w.id} value={w.id}>
                    {w.name}
                  </option>
                ))}
              </select>
              <select
                value={moveForm.type}
                onChange={(e) => setMoveForm((f) => ({ ...f, type: e.target.value }))}
                className="rounded border border-zinc-300 px-3 py-1.5 text-sm"
              >
                <option value="IN">Entrada manual</option>
                <option value="OUT">Salida manual</option>
                <option value="ADJUSTMENT">Ajuste (conteo físico)</option>
              </select>
              {moveForm.type === "ADJUSTMENT" && (
                <select
                  value={moveForm.direction}
                  onChange={(e) => setMoveForm((f) => ({ ...f, direction: e.target.value }))}
                  className="rounded border border-zinc-300 px-3 py-1.5 text-sm"
                >
                  <option value="INCREASE">Ajuste positivo (sube stock)</option>
                  <option value="DECREASE">Ajuste negativo (baja stock)</option>
                </select>
              )}
              <input
                placeholder="Cantidad"
                type="number"
                min={0.01}
                step="0.01"
                value={moveForm.quantity}
                onChange={(e) => setMoveForm((f) => ({ ...f, quantity: e.target.value }))}
                className="rounded border border-zinc-300 px-3 py-1.5 text-sm"
                required
              />
              <input
                placeholder="Motivo (opcional)"
                value={moveForm.reason}
                onChange={(e) => setMoveForm((f) => ({ ...f, reason: e.target.value }))}
                className="rounded border border-zinc-300 px-3 py-1.5 text-sm col-span-2"
              />
            </div>
            <button className="bg-zinc-900 text-white rounded px-3 py-1.5 text-sm">Registrar</button>
          </form>

          <form onSubmit={registerTransfer} className="bg-white rounded-lg border border-zinc-200 p-5 space-y-3">
            <h2 className="font-medium text-sm">Transferir entre almacenes</h2>
            {transferError && <p className="text-sm text-red-600 bg-red-50 rounded p-2">{transferError}</p>}
            {transferOk && <p className="text-sm text-green-700 bg-green-50 rounded p-2">{transferOk}</p>}
            <div className="grid grid-cols-2 gap-3">
              <select
                value={transferForm.productId}
                onChange={(e) => setTransferForm((f) => ({ ...f, productId: e.target.value }))}
                className="rounded border border-zinc-300 px-3 py-1.5 text-sm col-span-2"
                required
              >
                <option value="">Producto...</option>
                {products.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name} {p.sku ? `(${p.sku})` : ""}
                  </option>
                ))}
              </select>
              <select
                value={transferForm.fromWarehouseId}
                onChange={(e) => setTransferForm((f) => ({ ...f, fromWarehouseId: e.target.value }))}
                className="rounded border border-zinc-300 px-3 py-1.5 text-sm"
                required
              >
                <option value="">Almacén origen...</option>
                {warehouses.map((w) => (
                  <option key={w.id} value={w.id}>
                    {w.name}
                  </option>
                ))}
              </select>
              <select
                value={transferForm.toWarehouseId}
                onChange={(e) => setTransferForm((f) => ({ ...f, toWarehouseId: e.target.value }))}
                className="rounded border border-zinc-300 px-3 py-1.5 text-sm"
                required
              >
                <option value="">Almacén destino...</option>
                {warehouses.map((w) => (
                  <option key={w.id} value={w.id}>
                    {w.name}
                  </option>
                ))}
              </select>
              <input
                placeholder="Cantidad"
                type="number"
                min={0.01}
                step="0.01"
                value={transferForm.quantity}
                onChange={(e) => setTransferForm((f) => ({ ...f, quantity: e.target.value }))}
                className="rounded border border-zinc-300 px-3 py-1.5 text-sm"
                required
              />
              <input
                placeholder="Motivo (opcional)"
                value={transferForm.reason}
                onChange={(e) => setTransferForm((f) => ({ ...f, reason: e.target.value }))}
                className="rounded border border-zinc-300 px-3 py-1.5 text-sm"
              />
            </div>
            <button className="bg-zinc-900 text-white rounded px-3 py-1.5 text-sm">Transferir</button>
          </form>
        </div>

        <div className="bg-white rounded-lg border border-zinc-200 overflow-hidden">
          <h2 className="px-4 py-2 font-medium text-sm border-b border-zinc-100">Stock por almacén</h2>
          <table className="w-full text-sm">
            <thead className="bg-zinc-50 text-zinc-500 text-left">
              <tr>
                <th className="px-4 py-2">Producto</th>
                <th className="px-4 py-2">Almacén</th>
                <th className="px-4 py-2">Cantidad disponible</th>
              </tr>
            </thead>
            <tbody>
              {stock.map((s) => (
                <tr key={`${s.productId}-${s.warehouseId}`} className="border-t border-zinc-100">
                  <td className="px-4 py-2">{s.product.name}</td>
                  <td className="px-4 py-2">{s.warehouse.name}</td>
                  <td className="px-4 py-2">{Number(s.quantity)}</td>
                </tr>
              ))}
              {stock.length === 0 && (
                <tr>
                  <td colSpan={3} className="px-4 py-6 text-center text-zinc-400">
                    Sin stock cargado para este filtro
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        <div className="bg-white rounded-lg border border-zinc-200 overflow-hidden">
          <h2 className="px-4 py-2 font-medium text-sm border-b border-zinc-100">Historial de movimientos</h2>
          <table className="w-full text-sm">
            <thead className="bg-zinc-50 text-zinc-500 text-left">
              <tr>
                <th className="px-4 py-2">Fecha</th>
                <th className="px-4 py-2">Producto</th>
                <th className="px-4 py-2">Almacén</th>
                <th className="px-4 py-2">Tipo</th>
                <th className="px-4 py-2">Cantidad</th>
                <th className="px-4 py-2">Saldo después</th>
                <th className="px-4 py-2">Motivo</th>
              </tr>
            </thead>
            <tbody>
              {movements.map((m) => (
                <tr key={m.id} className="border-t border-zinc-100">
                  <td className="px-4 py-2">{new Date(m.createdAt).toLocaleString()}</td>
                  <td className="px-4 py-2">{m.product.name}</td>
                  <td className="px-4 py-2">{m.warehouse.name}</td>
                  <td className="px-4 py-2">{MOVEMENT_TYPE_LABELS[m.type] ?? m.type}</td>
                  <td className="px-4 py-2">{Number(m.quantity)}</td>
                  <td className="px-4 py-2">{Number(m.stockAfter)}</td>
                  <td className="px-4 py-2">{m.reason ?? "-"}</td>
                </tr>
              ))}
              {movements.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-4 py-6 text-center text-zinc-400">
                    Sin movimientos para este filtro
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
