"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import AppShell from "@/components/AppShell";
import { api } from "@/lib/api";
import { useSubmitGuard } from "@/lib/use-submit-guard";
import { ApiError } from "@/lib/auth-context";

interface CashMovement {
  id: string;
  type: string;
  amount: string;
  reason?: string | null;
  reference?: string | null;
  createdAt: string;
}

interface Expense {
  id: string;
  amount: string;
  category?: string | null;
  description?: string | null;
  observation?: string | null;
  createdAt: string;
}

interface CashRegister {
  id: string;
  posTerminalId: string;
  status: string;
  openingAmount: string;
  closingAmount?: string | null;
  expectedAmount?: string | null;
  difference?: string | null;
  closingObservation?: string | null;
  openedAt: string;
  closedAt?: string | null;
  posTerminal?: { id: string; name: string };
  movements: CashMovement[];
  expenses: Expense[];
}

const MOVEMENT_TYPE_LABELS: Record<string, string> = {
  CASH_IN: "Ingreso manual",
  CASH_OUT: "Egreso manual",
  SALE_PAYMENT: "Cobro de venta",
  EXPENSE: "Gasto",
};

const INCREASE_TYPES = new Set(["CASH_IN", "SALE_PAYMENT"]);

function newIdempotencyKey() {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `key-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export default function CashRegisterDetailPage() {
  const params = useParams<{ id: string }>();
  const [register, setRegister] = useState<CashRegister | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [movForm, setMovForm] = useState({ type: "CASH_IN", amount: "", reason: "" });
  const [movError, setMovError] = useState<string | null>(null);

  const [expenseForm, setExpenseForm] = useState({ amount: "", category: "", description: "", observation: "" });
  const [expenseError, setExpenseError] = useState<string | null>(null);

  const [closeForm, setCloseForm] = useState({ countedAmount: "", observation: "" });
  const [closeError, setCloseError] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    setLoadError(null);
    try {
      const r = await api<CashRegister>(`/cash-registers/${params.id}`);
      setRegister(r);
    } catch (err) {
      setLoadError(err instanceof ApiError ? err.message : "No se pudo cargar la caja");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params.id]);

  const currentBalance = register
    ? register.movements.reduce(
        (acc, m) => (INCREASE_TYPES.has(m.type) ? acc + Number(m.amount) : acc - Number(m.amount)),
        Number(register.openingAmount)
      )
    : 0;

  async function registerMovementRequest(e: React.FormEvent) {
    e.preventDefault();
    setMovError(null);
    try {
      await api(`/cash-registers/${params.id}/movements`, {
        method: "POST",
        body: {
          type: movForm.type,
          amount: Number(movForm.amount),
          reason: movForm.reason || undefined,
          idempotencyKey: newIdempotencyKey(),
        },
      });
      setMovForm((f) => ({ ...f, amount: "", reason: "" }));
      load();
    } catch (err) {
      setMovError(err instanceof ApiError ? err.message : "No se pudo registrar el movimiento");
    }
  }

  async function registerExpenseRequest(e: React.FormEvent) {
    e.preventDefault();
    setExpenseError(null);
    try {
      await api("/expenses", {
        method: "POST",
        body: {
          cashRegisterId: params.id,
          amount: Number(expenseForm.amount),
          category: expenseForm.category || undefined,
          description: expenseForm.description || undefined,
          observation: expenseForm.observation || undefined,
          idempotencyKey: newIdempotencyKey(),
        },
      });
      setExpenseForm({ amount: "", category: "", description: "", observation: "" });
      load();
    } catch (err) {
      setExpenseError(err instanceof ApiError ? err.message : "No se pudo registrar el gasto");
    }
  }

  async function closeRegisterRequest(e: React.FormEvent) {
    e.preventDefault();
    setCloseError(null);
    try {
      await api(`/cash-registers/${params.id}/close`, {
        method: "POST",
        body: {
          countedAmount: Number(closeForm.countedAmount),
          observation: closeForm.observation || undefined,
          idempotencyKey: newIdempotencyKey(),
        },
      });
      load();
    } catch (err) {
      setCloseError(err instanceof ApiError ? err.message : "No se pudo cerrar la caja");
    }
  }

  // Los hooks van ANTES de los early returns de abajo: llamarlos después
  // rompería las reglas de hooks (el orden cambiaría entre renders).
  // Doble click: sin esto, dos clicks seguidos creaban dos registros
  // (ver `useSubmitGuard`).
  const { submitting: registerMovementSubmitting, onSubmit: registerMovement } =
    useSubmitGuard(registerMovementRequest);

  // Doble click: sin esto, dos clicks seguidos creaban dos registros
  // (ver `useSubmitGuard`).
  const { submitting: registerExpenseSubmitting, onSubmit: registerExpense } =
    useSubmitGuard(registerExpenseRequest);

  // Doble click: sin esto, dos clicks seguidos creaban dos registros
  // (ver `useSubmitGuard`).
  const { submitting: closeRegisterSubmitting, onSubmit: closeRegister } =
    useSubmitGuard(closeRegisterRequest);

  if (loading) return <AppShell><div className="p-6 text-sm text-zinc-500">Cargando...</div></AppShell>;
  if (loadError) return <AppShell><div className="p-6 text-sm text-red-600 bg-red-50 rounded m-6 p-2">{loadError}</div></AppShell>;
  if (!register) return <AppShell><div className="p-6 text-sm text-zinc-500">Caja no encontrada</div></AppShell>;

  const isOpen = register.status === "OPEN";


  return (
    <AppShell>
      <div className="p-6 max-w-4xl space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <Link href="/cash" className="text-sm text-zinc-400 hover:text-zinc-900">← Caja y Bancos</Link>
            <h1 className="text-lg font-semibold">{register.posTerminal?.name ?? "Caja"}</h1>
          </div>
          <span className={`text-xs font-medium px-2 py-1 rounded ${isOpen ? "bg-green-100 text-green-800" : "bg-zinc-100 text-zinc-600"}`}>
            {isOpen ? "Abierta" : "Cerrada"}
          </span>
        </div>

        <div className="bg-white rounded-lg border border-zinc-200 p-5 grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
          <div>
            <div className="text-zinc-400 text-xs">Saldo inicial</div>
            <div className="font-medium">{Number(register.openingAmount)}</div>
          </div>
          <div>
            <div className="text-zinc-400 text-xs">Saldo actual</div>
            <div className="font-medium">{currentBalance.toFixed(2)}</div>
          </div>
          {!isOpen && (
            <>
              <div>
                <div className="text-zinc-400 text-xs">Efectivo contado</div>
                <div className="font-medium">{Number(register.closingAmount)}</div>
              </div>
              <div>
                <div className="text-zinc-400 text-xs">Diferencia</div>
                <div className={`font-medium ${Number(register.difference) < 0 ? "text-red-600" : Number(register.difference) > 0 ? "text-green-700" : ""}`}>
                  {Number(register.difference)}
                </div>
              </div>
            </>
          )}
        </div>
        {!isOpen && register.closingObservation && (
          <p className="text-sm text-zinc-500">Observación del cierre: {register.closingObservation}</p>
        )}

        {isOpen && (
          <div className="grid md:grid-cols-2 gap-6">
            <form onSubmit={registerMovement} className="bg-white rounded-lg border border-zinc-200 p-5 space-y-3">
              <h2 className="font-medium text-sm">Registrar ingreso o egreso</h2>
              {movError && <p className="text-sm text-red-600 bg-red-50 rounded p-2">{movError}</p>}
              <div className="grid grid-cols-2 gap-3">
                <select
                  value={movForm.type}
                  onChange={(e) => setMovForm((f) => ({ ...f, type: e.target.value }))}
                  className="rounded border border-zinc-300 px-3 py-1.5 text-sm"
                >
                  <option value="CASH_IN">Ingreso</option>
                  <option value="CASH_OUT">Egreso</option>
                </select>
                <input
                  placeholder="Monto"
                  type="number"
                  min={0.01}
                  step="0.01"
                  value={movForm.amount}
                  onChange={(e) => setMovForm((f) => ({ ...f, amount: e.target.value }))}
                  className="rounded border border-zinc-300 px-3 py-1.5 text-sm"
                  required
                />
                <input
                  placeholder="Motivo (opcional)"
                  value={movForm.reason}
                  onChange={(e) => setMovForm((f) => ({ ...f, reason: e.target.value }))}
                  className="rounded border border-zinc-300 px-3 py-1.5 text-sm col-span-2"
                />
              </div>
              <button disabled={registerMovementSubmitting} className="bg-zinc-900 text-white rounded px-3 py-1.5 text-sm">Registrar</button>
            </form>

            <form onSubmit={registerExpense} className="bg-white rounded-lg border border-zinc-200 p-5 space-y-3">
              <h2 className="font-medium text-sm">Registrar gasto</h2>
              {expenseError && <p className="text-sm text-red-600 bg-red-50 rounded p-2">{expenseError}</p>}
              <div className="grid grid-cols-2 gap-3">
                <input
                  placeholder="Monto"
                  type="number"
                  min={0.01}
                  step="0.01"
                  value={expenseForm.amount}
                  onChange={(e) => setExpenseForm((f) => ({ ...f, amount: e.target.value }))}
                  className="rounded border border-zinc-300 px-3 py-1.5 text-sm"
                  required
                />
                <input
                  placeholder="Categoría (opcional)"
                  value={expenseForm.category}
                  onChange={(e) => setExpenseForm((f) => ({ ...f, category: e.target.value }))}
                  className="rounded border border-zinc-300 px-3 py-1.5 text-sm"
                />
                <input
                  placeholder="Descripción (opcional)"
                  value={expenseForm.description}
                  onChange={(e) => setExpenseForm((f) => ({ ...f, description: e.target.value }))}
                  className="rounded border border-zinc-300 px-3 py-1.5 text-sm col-span-2"
                />
                <input
                  placeholder="Observación (opcional)"
                  value={expenseForm.observation}
                  onChange={(e) => setExpenseForm((f) => ({ ...f, observation: e.target.value }))}
                  className="rounded border border-zinc-300 px-3 py-1.5 text-sm col-span-2"
                />
              </div>
              <button disabled={registerExpenseSubmitting} className="bg-zinc-900 text-white rounded px-3 py-1.5 text-sm">Registrar gasto</button>
            </form>
          </div>
        )}

        {isOpen && (
          <form onSubmit={closeRegister} className="bg-white rounded-lg border border-zinc-200 p-5 space-y-3">
            <h2 className="font-medium text-sm">Cerrar caja (arqueo)</h2>
            {closeError && <p className="text-sm text-red-600 bg-red-50 rounded p-2">{closeError}</p>}
            <div className="grid grid-cols-2 gap-3">
              <input
                placeholder="Efectivo contado"
                type="number"
                min={0}
                step="0.01"
                value={closeForm.countedAmount}
                onChange={(e) => setCloseForm((f) => ({ ...f, countedAmount: e.target.value }))}
                className="rounded border border-zinc-300 px-3 py-1.5 text-sm"
                required
              />
              <input
                placeholder="Observación (opcional)"
                value={closeForm.observation}
                onChange={(e) => setCloseForm((f) => ({ ...f, observation: e.target.value }))}
                className="rounded border border-zinc-300 px-3 py-1.5 text-sm"
              />
            </div>
            <button disabled={closeRegisterSubmitting} className="bg-red-600 text-white rounded px-3 py-1.5 text-sm">Cerrar caja</button>
          </form>
        )}

        <div className="bg-white rounded-lg border border-zinc-200 overflow-hidden">
          <h2 className="px-4 py-2 font-medium text-sm border-b border-zinc-100">Movimientos</h2>
          <table className="w-full text-sm">
            <thead className="bg-zinc-50 text-zinc-500 text-left">
              <tr>
                <th className="px-4 py-2">Fecha</th>
                <th className="px-4 py-2">Tipo</th>
                <th className="px-4 py-2">Monto</th>
                <th className="px-4 py-2">Motivo</th>
              </tr>
            </thead>
            <tbody>
              {register.movements.map((m) => (
                <tr key={m.id} className="border-t border-zinc-100">
                  <td className="px-4 py-2">{new Date(m.createdAt).toLocaleString()}</td>
                  <td className="px-4 py-2">{MOVEMENT_TYPE_LABELS[m.type] ?? m.type}</td>
                  <td className={`px-4 py-2 ${INCREASE_TYPES.has(m.type) ? "text-green-700" : "text-red-600"}`}>
                    {INCREASE_TYPES.has(m.type) ? "+" : "-"}
                    {Number(m.amount)}
                  </td>
                  <td className="px-4 py-2">{m.reason ?? "-"}</td>
                </tr>
              ))}
              {register.movements.length === 0 && (
                <tr>
                  <td colSpan={4} className="px-4 py-6 text-center text-zinc-400">
                    Sin movimientos todavía
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        <div className="bg-white rounded-lg border border-zinc-200 overflow-hidden">
          <h2 className="px-4 py-2 font-medium text-sm border-b border-zinc-100">Gastos</h2>
          <table className="w-full text-sm">
            <thead className="bg-zinc-50 text-zinc-500 text-left">
              <tr>
                <th className="px-4 py-2">Fecha</th>
                <th className="px-4 py-2">Categoría</th>
                <th className="px-4 py-2">Descripción</th>
                <th className="px-4 py-2">Monto</th>
              </tr>
            </thead>
            <tbody>
              {register.expenses.map((ex) => (
                <tr key={ex.id} className="border-t border-zinc-100">
                  <td className="px-4 py-2">{new Date(ex.createdAt).toLocaleString()}</td>
                  <td className="px-4 py-2">{ex.category ?? "-"}</td>
                  <td className="px-4 py-2">{ex.description ?? "-"}</td>
                  <td className="px-4 py-2">{Number(ex.amount)}</td>
                </tr>
              ))}
              {register.expenses.length === 0 && (
                <tr>
                  <td colSpan={4} className="px-4 py-6 text-center text-zinc-400">
                    Sin gastos todavía
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
