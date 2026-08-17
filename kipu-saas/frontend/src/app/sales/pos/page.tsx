"use client";

import { useEffect, useMemo, useState } from "react";
import AppShell from "@/components/AppShell";
import { api } from "@/lib/api";
import { ApiError } from "@/lib/auth-context";

interface Product {
  id: string;
  name: string;
  price: string;
  sku?: string | null;
  active: boolean;
}

interface Customer {
  id: string;
  name: string;
}

interface Branch {
  id: string;
  warehouses: { id: string; name: string }[];
  posTerminals: { id: string; name: string; code: string }[];
}

interface CartLine {
  productId: string;
  name: string;
  quantity: number;
  unitPrice: number;
  discount: number;
}

type PaymentMethod = "CASH" | "CARD" | "TRANSFER" | "QR";

interface PaymentLine {
  method: PaymentMethod;
  amount: string;
  idempotencyKey: string;
}

function newIdempotencyKey() {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `key-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export default function POSPage() {
  const [products, setProducts] = useState<Product[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [branch, setBranch] = useState<Branch | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [search, setSearch] = useState("");
  const [cart, setCart] = useState<CartLine[]>([]);
  const [customerId, setCustomerId] = useState("");
  const [saleDiscount, setSaleDiscount] = useState("0");
  const [payments, setPayments] = useState<PaymentLine[]>([]);

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ id: string; status: string; total: string; balance: string } | null>(null);

  async function load() {
    setLoadError(null);
    try {
      const [p, c, branches] = await Promise.all([
        api<Product[]>("/products"),
        api<Customer[]>("/customers"),
        api<Branch[]>("/branches"),
      ]);
      setProducts(p.filter((x) => x.active));
      setCustomers(c);
      setBranch(branches[0] ?? null);
    } catch (err) {
      setLoadError(err instanceof ApiError ? err.message : "No se pudo cargar el POS");
    }
  }

  useEffect(() => {
    load();
  }, []);

  const filteredProducts = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return products.slice(0, 20);
    return products.filter((p) => p.name.toLowerCase().includes(q) || p.sku?.toLowerCase().includes(q)).slice(0, 20);
  }, [products, search]);

  const subtotal = cart.reduce((acc, line) => acc + line.quantity * line.unitPrice - line.discount, 0);
  const discountNum = Number(saleDiscount) || 0;
  const total = Math.max(0, subtotal - discountNum);
  const paidSoFar = payments.reduce((acc, p) => acc + (Number(p.amount) || 0), 0);

  function addToCart(product: Product) {
    setResult(null);
    setCart((prev) => {
      const existing = prev.find((l) => l.productId === product.id);
      if (existing) {
        return prev.map((l) => (l.productId === product.id ? { ...l, quantity: l.quantity + 1 } : l));
      }
      return [...prev, { productId: product.id, name: product.name, quantity: 1, unitPrice: Number(product.price), discount: 0 }];
    });
  }

  function updateLine(productId: string, patch: Partial<CartLine>) {
    setCart((prev) => prev.map((l) => (l.productId === productId ? { ...l, ...patch } : l)));
  }

  function removeLine(productId: string) {
    setCart((prev) => prev.filter((l) => l.productId !== productId));
  }

  function addPaymentLine() {
    setPayments((prev) => [...prev, { method: "CASH", amount: "", idempotencyKey: newIdempotencyKey() }]);
  }

  function updatePaymentLine(index: number, patch: Partial<PaymentLine>) {
    setPayments((prev) => prev.map((p, i) => (i === index ? { ...p, ...patch } : p)));
  }

  function removePaymentLine(index: number) {
    setPayments((prev) => prev.filter((_, i) => i !== index));
  }

  function resetSale() {
    setCart([]);
    setCustomerId("");
    setSaleDiscount("0");
    setPayments([]);
    setResult(null);
    setError(null);
  }

  async function confirmSale() {
    if (!branch || branch.warehouses.length === 0 || branch.posTerminals.length === 0) {
      setError("No hay almacén o punto de venta configurado todavía (ve a Configuración).");
      return;
    }
    if (cart.length === 0) {
      setError("El carrito está vacío");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const sale = await api<{ id: string }>("/sales", {
        method: "POST",
        body: {
          posTerminalId: branch.posTerminals[0].id,
          warehouseId: branch.warehouses[0].id,
          customerId: customerId || undefined,
          discount: discountNum,
          items: cart.map((l) => ({
            productId: l.productId,
            quantity: l.quantity,
            unitPrice: l.unitPrice,
            discount: l.discount,
          })),
        },
      });

      const validPayments = payments.filter((p) => Number(p.amount) > 0);
      const confirmed = await api<{ id: string; status: string; total: string; balance: string }>(
        `/sales/${sale.id}/confirm`,
        {
          method: "POST",
          body: {
            payments: validPayments.map((p) => ({ method: p.method, amount: Number(p.amount), idempotencyKey: p.idempotencyKey })),
          },
        },
      );

      setResult(confirmed);
      setCart([]);
      setPayments([]);
      setCustomerId("");
      setSaleDiscount("0");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "No se pudo confirmar la venta");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <AppShell>
      <div className="p-6 grid grid-cols-3 gap-6">
        <div className="col-span-2 space-y-4">
          <h1 className="text-lg font-semibold">Punto de venta</h1>
          {loadError && <p className="text-sm text-red-600 bg-red-50 rounded p-2">{loadError}</p>}

          <input
            placeholder="Buscar producto por nombre o SKU..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full rounded border border-zinc-300 px-3 py-2 text-sm"
          />

          <div className="bg-white rounded-lg border border-zinc-200 divide-y divide-zinc-100 max-h-[420px] overflow-y-auto">
            {filteredProducts.map((p) => (
              <button
                key={p.id}
                onClick={() => addToCart(p)}
                className="w-full flex justify-between items-center px-4 py-2 text-sm hover:bg-zinc-50 text-left"
              >
                <span>
                  {p.name} {p.sku && <span className="text-zinc-400">({p.sku})</span>}
                </span>
                <span className="text-zinc-600">Bs. {Number(p.price).toFixed(2)}</span>
              </button>
            ))}
            {filteredProducts.length === 0 && <p className="px-4 py-6 text-center text-zinc-400 text-sm">Sin productos</p>}
          </div>
        </div>

        <div className="space-y-4">
          <div className="bg-white rounded-lg border border-zinc-200 p-4 space-y-3">
            <h2 className="font-medium text-sm">Carrito</h2>
            {error && <p className="text-sm text-red-600 bg-red-50 rounded p-2">{error}</p>}
            {result && (
              <p className="text-sm text-emerald-700 bg-emerald-50 rounded p-2">
                Venta confirmada ({result.status}). Total Bs. {Number(result.total).toFixed(2)}
                {Number(result.balance) > 0 && <> — saldo pendiente Bs. {Number(result.balance).toFixed(2)}</>}
              </p>
            )}

            {cart.length === 0 && <p className="text-sm text-zinc-400">Agrega productos desde la lista</p>}
            {cart.map((line) => (
              <div key={line.productId} className="border-b border-zinc-100 pb-2 text-sm space-y-1">
                <div className="flex justify-between">
                  <span>{line.name}</span>
                  <button onClick={() => removeLine(line.productId)} className="text-red-600 text-xs underline">
                    Quitar
                  </button>
                </div>
                <div className="flex gap-2 items-center text-xs">
                  <label>Cant.</label>
                  <input
                    type="number"
                    min={0.01}
                    step="0.01"
                    value={line.quantity}
                    onChange={(e) => updateLine(line.productId, { quantity: Number(e.target.value) })}
                    className="w-16 rounded border border-zinc-300 px-1 py-0.5"
                  />
                  <label>Precio</label>
                  <input
                    type="number"
                    min={0}
                    step="0.01"
                    value={line.unitPrice}
                    onChange={(e) => updateLine(line.productId, { unitPrice: Number(e.target.value) })}
                    className="w-20 rounded border border-zinc-300 px-1 py-0.5"
                  />
                  <label>Desc.</label>
                  <input
                    type="number"
                    min={0}
                    step="0.01"
                    value={line.discount}
                    onChange={(e) => updateLine(line.productId, { discount: Number(e.target.value) })}
                    className="w-16 rounded border border-zinc-300 px-1 py-0.5"
                  />
                </div>
                <div className="text-right text-zinc-500">
                  Subtotal: Bs. {(line.quantity * line.unitPrice - line.discount).toFixed(2)}
                </div>
              </div>
            ))}

            <select
              value={customerId}
              onChange={(e) => setCustomerId(e.target.value)}
              className="w-full rounded border border-zinc-300 px-2 py-1.5 text-sm"
            >
              <option value="">Cliente ocasional</option>
              {customers.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>

            <div className="flex justify-between items-center text-sm">
              <label>Descuento venta</label>
              <input
                type="number"
                min={0}
                step="0.01"
                value={saleDiscount}
                onChange={(e) => setSaleDiscount(e.target.value)}
                className="w-24 rounded border border-zinc-300 px-2 py-1"
              />
            </div>

            <div className="flex justify-between font-semibold text-sm border-t border-zinc-200 pt-2">
              <span>Total</span>
              <span>Bs. {total.toFixed(2)}</span>
            </div>
          </div>

          <div className="bg-white rounded-lg border border-zinc-200 p-4 space-y-2">
            <div className="flex justify-between items-center">
              <h2 className="font-medium text-sm">Pago (opcional — vacío = venta a crédito)</h2>
              <button onClick={addPaymentLine} className="text-xs text-zinc-600 underline">
                + método
              </button>
            </div>
            {payments.map((p, i) => (
              <div key={i} className="flex gap-2 items-center text-xs">
                <select
                  value={p.method}
                  onChange={(e) => updatePaymentLine(i, { method: e.target.value as PaymentMethod })}
                  className="rounded border border-zinc-300 px-1 py-1"
                >
                  <option value="CASH">Efectivo</option>
                  <option value="CARD">Tarjeta</option>
                  <option value="TRANSFER">Transferencia</option>
                  <option value="QR">QR</option>
                </select>
                <input
                  type="number"
                  min={0}
                  step="0.01"
                  placeholder="Monto"
                  value={p.amount}
                  onChange={(e) => updatePaymentLine(i, { amount: e.target.value })}
                  className="w-24 rounded border border-zinc-300 px-2 py-1"
                />
                <button onClick={() => removePaymentLine(i)} className="text-red-600 underline">
                  Quitar
                </button>
              </div>
            ))}
            {payments.length > 0 && (
              <p className="text-xs text-zinc-500 text-right">
                Pagado: Bs. {paidSoFar.toFixed(2)} de Bs. {total.toFixed(2)}
              </p>
            )}
          </div>

          <div className="flex gap-2">
            <button
              onClick={confirmSale}
              disabled={submitting || cart.length === 0}
              className="flex-1 bg-zinc-900 text-white rounded px-3 py-2 text-sm disabled:opacity-50"
            >
              {submitting ? "Confirmando..." : "Confirmar venta"}
            </button>
            <button onClick={resetSale} className="rounded border border-zinc-300 px-3 py-2 text-sm">
              Limpiar
            </button>
          </div>
        </div>
      </div>
    </AppShell>
  );
}
