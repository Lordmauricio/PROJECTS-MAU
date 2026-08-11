"use client";

import { useEffect, useMemo, useState } from "react";
import AppShell from "@/components/AppShell";
import { api, ApiError } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { Category, Invoice, Order, Product } from "@/lib/types";

interface CartLine {
  productId: string;
  name: string;
  price: number;
  quantity: number;
}

type Step = "building" | "paying" | "done";

export default function PosPage() {
  const { user } = useAuth();
  const [categories, setCategories] = useState<Category[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [activeCategory, setActiveCategory] = useState<string | "all">("all");
  const [cart, setCart] = useState<CartLine[]>([]);
  const [orderType, setOrderType] = useState<"DINE_IN" | "TAKEAWAY" | "DELIVERY">("TAKEAWAY");
  const [tableNumber, setTableNumber] = useState("");
  const [step, setStep] = useState<Step>("building");
  const [order, setOrder] = useState<Order | null>(null);
  const [invoice, setInvoice] = useState<Invoice | null>(null);
  const [method, setMethod] = useState<"CASH" | "CARD" | "QR_SIMPLE">("CASH");
  const [receivedAmount, setReceivedAmount] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api<Category[]>("/menu/categories").then(setCategories).catch(() => {});
    api<Product[]>("/menu/products").then(setProducts).catch(() => {});
  }, []);

  const visibleProducts = useMemo(
    () => products.filter((p) => activeCategory === "all" || p.categoryId === activeCategory),
    [products, activeCategory]
  );

  const total = cart.reduce((acc, l) => acc + l.price * l.quantity, 0);
  const change = method === "CASH" && receivedAmount ? Number(receivedAmount) - total : 0;

  function addToCart(product: Product) {
    setCart((prev) => {
      const existing = prev.find((l) => l.productId === product.id);
      if (existing) {
        return prev.map((l) => (l.productId === product.id ? { ...l, quantity: l.quantity + 1 } : l));
      }
      return [...prev, { productId: product.id, name: product.name, price: Number(product.price), quantity: 1 }];
    });
  }

  function changeQty(productId: string, delta: number) {
    setCart((prev) =>
      prev
        .map((l) => (l.productId === productId ? { ...l, quantity: l.quantity + delta } : l))
        .filter((l) => l.quantity > 0)
    );
  }

  function resetSale() {
    setCart([]);
    setOrder(null);
    setInvoice(null);
    setStep("building");
    setReceivedAmount("");
    setTableNumber("");
    setError(null);
  }

  async function handleCreateOrderAndPay() {
    if (!user?.branchId) {
      setError("Tu usuario no tiene una sucursal asignada.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const createdOrder = await api<Order>("/orders", {
        method: "POST",
        body: {
          branchId: user.branchId,
          type: orderType,
          tableNumber: orderType === "DINE_IN" ? tableNumber : undefined,
          items: cart.map((l) => ({ productId: l.productId, quantity: l.quantity })),
        },
      });

      await api(`/orders/${createdOrder.id}/payments`, {
        method: "POST",
        body: {
          method,
          amount: total,
          receivedAmount: method === "CASH" ? Number(receivedAmount || total) : undefined,
        },
      });

      const refreshed = await api<Order>(`/orders/${createdOrder.id}`);
      setOrder(refreshed);
      setStep("done");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "No se pudo procesar el pago");
    } finally {
      setBusy(false);
    }
  }

  async function handleIssueInvoice() {
    if (!order) return;
    setBusy(true);
    setError(null);
    try {
      const inv = await api<Invoice>(`/invoicing/orders/${order.id}/issue`, { method: "POST" });
      setInvoice(inv);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "No se pudo emitir la factura");
    } finally {
      setBusy(false);
    }
  }

  return (
    <AppShell>
      <div className="flex h-full">
        {/* Catalogo */}
        <section className="flex-1 p-6 overflow-y-auto">
          <h1 className="text-lg font-semibold mb-4">Punto de Venta</h1>
          <div className="flex gap-2 mb-4 flex-wrap">
            <button
              onClick={() => setActiveCategory("all")}
              className={`px-3 py-1.5 rounded-full text-sm ${
                activeCategory === "all" ? "bg-zinc-900 text-white" : "bg-white border border-zinc-300"
              }`}
            >
              Todos
            </button>
            {categories.map((c) => (
              <button
                key={c.id}
                onClick={() => setActiveCategory(c.id)}
                className={`px-3 py-1.5 rounded-full text-sm ${
                  activeCategory === c.id ? "bg-zinc-900 text-white" : "bg-white border border-zinc-300"
                }`}
              >
                {c.name}
              </button>
            ))}
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
            {visibleProducts.map((p) => (
              <button
                key={p.id}
                onClick={() => addToCart(p)}
                disabled={step !== "building"}
                className="bg-white border border-zinc-200 rounded-lg p-3 text-left hover:border-zinc-400 disabled:opacity-50"
              >
                <p className="font-medium text-sm">{p.name}</p>
                <p className="text-zinc-500 text-sm mt-1">Bs. {Number(p.price).toFixed(2)}</p>
              </button>
            ))}
          </div>
        </section>

        {/* Carrito / cobro / factura */}
        <aside className="w-96 shrink-0 bg-white border-l border-zinc-200 p-6 flex flex-col">
          {step === "building" && (
            <>
              <h2 className="font-semibold mb-3">Pedido actual</h2>
              <div className="flex gap-2 mb-3">
                {(["DINE_IN", "TAKEAWAY", "DELIVERY"] as const).map((t) => (
                  <button
                    key={t}
                    onClick={() => setOrderType(t)}
                    className={`px-2 py-1 text-xs rounded ${
                      orderType === t ? "bg-zinc-900 text-white" : "bg-zinc-100"
                    }`}
                  >
                    {t === "DINE_IN" ? "En mesa" : t === "TAKEAWAY" ? "Para llevar" : "Delivery"}
                  </button>
                ))}
              </div>
              {orderType === "DINE_IN" && (
                <input
                  placeholder="N° de mesa"
                  value={tableNumber}
                  onChange={(e) => setTableNumber(e.target.value)}
                  className="mb-3 w-full rounded border border-zinc-300 px-2 py-1 text-sm"
                />
              )}
              <div className="flex-1 overflow-y-auto space-y-2">
                {cart.length === 0 && <p className="text-sm text-zinc-400">Toca un producto para agregarlo</p>}
                {cart.map((l) => (
                  <div key={l.productId} className="flex items-center justify-between text-sm">
                    <div>
                      <p className="font-medium">{l.name}</p>
                      <p className="text-zinc-500">Bs. {l.price.toFixed(2)}</p>
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => changeQty(l.productId, -1)}
                        className="w-6 h-6 rounded bg-zinc-100"
                      >
                        -
                      </button>
                      <span>{l.quantity}</span>
                      <button
                        onClick={() => changeQty(l.productId, 1)}
                        className="w-6 h-6 rounded bg-zinc-100"
                      >
                        +
                      </button>
                    </div>
                  </div>
                ))}
              </div>
              <div className="border-t border-zinc-200 mt-4 pt-4">
                <div className="flex justify-between font-semibold mb-3">
                  <span>Total</span>
                  <span>Bs. {total.toFixed(2)}</span>
                </div>
                {error && <p className="text-xs text-red-600 mb-2">{error}</p>}
                <button
                  disabled={cart.length === 0}
                  onClick={() => setStep("paying")}
                  className="w-full bg-zinc-900 text-white rounded py-2 text-sm font-medium disabled:opacity-40"
                >
                  Cobrar
                </button>
              </div>
            </>
          )}

          {step === "paying" && (
            <>
              <h2 className="font-semibold mb-3">Cobrar Bs. {total.toFixed(2)}</h2>
              <div className="flex gap-2 mb-3">
                {(["CASH", "CARD", "QR_SIMPLE"] as const).map((m) => (
                  <button
                    key={m}
                    onClick={() => setMethod(m)}
                    className={`px-2 py-1 text-xs rounded ${method === m ? "bg-zinc-900 text-white" : "bg-zinc-100"}`}
                  >
                    {m === "CASH" ? "Efectivo" : m === "CARD" ? "Tarjeta" : "QR"}
                  </button>
                ))}
              </div>
              {method === "CASH" && (
                <div className="mb-3">
                  <label className="block text-xs font-medium mb-1">Monto recibido</label>
                  <input
                    type="number"
                    min={total}
                    value={receivedAmount}
                    onChange={(e) => setReceivedAmount(e.target.value)}
                    className="w-full rounded border border-zinc-300 px-2 py-1 text-sm"
                  />
                  {receivedAmount && (
                    <p className="text-xs text-zinc-500 mt-1">
                      Cambio: Bs. {change >= 0 ? change.toFixed(2) : "0.00"}
                    </p>
                  )}
                </div>
              )}
              {error && <p className="text-xs text-red-600 mb-2">{error}</p>}
              <div className="flex gap-2 mt-auto">
                <button
                  onClick={() => setStep("building")}
                  className="flex-1 border border-zinc-300 rounded py-2 text-sm"
                >
                  Volver
                </button>
                <button
                  disabled={busy || (method === "CASH" && Number(receivedAmount || 0) < total)}
                  onClick={handleCreateOrderAndPay}
                  className="flex-1 bg-zinc-900 text-white rounded py-2 text-sm font-medium disabled:opacity-40"
                >
                  {busy ? "Procesando..." : "Confirmar pago"}
                </button>
              </div>
            </>
          )}

          {step === "done" && order && (
            <>
              <h2 className="font-semibold mb-3">Pago registrado</h2>
              <p className="text-sm text-zinc-600 mb-4">
                Pedido pagado por Bs. {Number(order.total).toFixed(2)}.
              </p>

              {!invoice && (
                <button
                  disabled={busy}
                  onClick={handleIssueInvoice}
                  className="w-full bg-zinc-900 text-white rounded py-2 text-sm font-medium disabled:opacity-40 mb-3"
                >
                  {busy ? "Emitiendo..." : "Emitir factura electronica"}
                </button>
              )}
              {error && <p className="text-xs text-red-600 mb-2">{error}</p>}

              {invoice && (
                <div className="border border-zinc-200 rounded-lg p-3 text-sm space-y-2">
                  <p className="font-medium">Factura N° {invoice.numeroFactura}</p>
                  <p className="text-xs text-zinc-500 break-all">CUF: {invoice.cuf}</p>
                  <p className="text-xs text-zinc-500">
                    Ambiente: {invoice.environment === "TEST" ? "Piloto/Pruebas" : "Produccion"}
                  </p>
                  {invoice.qrImagePng && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={invoice.qrImagePng} alt="QR factura" className="w-40 h-40 mx-auto" />
                  )}
                </div>
              )}

              <button onClick={resetSale} className="w-full border border-zinc-300 rounded py-2 text-sm mt-4">
                Nueva venta
              </button>
            </>
          )}
        </aside>
      </div>
    </AppShell>
  );
}
