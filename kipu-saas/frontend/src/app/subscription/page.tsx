"use client";

import { useEffect, useState } from "react";
import AppShell from "@/components/AppShell";
import { api } from "@/lib/api";
import { ApiError } from "@/lib/auth-context";

interface PlanLimits {
  maxUsers: number | null;
  maxBranches: number | null;
  maxProducts: number | null;
}

interface PlanFeatures {
  pos: boolean;
  inventory: boolean;
  invoicing: boolean;
}

interface Plan {
  key: string;
  name: string;
  priceMonthly: string;
  limits: PlanLimits;
  features: PlanFeatures;
}

interface UsageEntry {
  used: number;
  limit: number | null;
}

interface SubscriptionSummary {
  status: "TRIALING" | "ACTIVE" | "PAST_DUE" | "CANCELLED";
  currentPeriodEnd: string | null;
  plan: Plan;
  usage: {
    users: UsageEntry;
    branches: UsageEntry;
    products: UsageEntry;
  };
}

const STATUS_LABELS: Record<string, string> = {
  TRIALING: "Prueba / Gratis",
  ACTIVE: "Activa",
  PAST_DUE: "Vencida",
  CANCELLED: "Cancelada",
};

const STATUS_COLORS: Record<string, string> = {
  TRIALING: "bg-blue-50 text-blue-700",
  ACTIVE: "bg-emerald-50 text-emerald-700",
  PAST_DUE: "bg-amber-50 text-amber-700",
  CANCELLED: "bg-red-50 text-red-700",
};

const USAGE_LABELS: Record<keyof SubscriptionSummary["usage"], string> = {
  users: "Usuarios",
  branches: "Sucursales",
  products: "Productos",
};

function formatDate(iso: string | null): string {
  if (!iso) return "-";
  return new Date(iso).toLocaleDateString("es-BO", { dateStyle: "medium" });
}

function UsageBar({ label, entry }: { label: string; entry: UsageEntry }) {
  const unlimited = entry.limit === null;
  const pct = unlimited ? 0 : Math.min(100, Math.round((entry.used / Math.max(entry.limit!, 1)) * 100));
  const atLimit = !unlimited && entry.used >= entry.limit!;
  return (
    <div>
      <div className="flex items-center justify-between text-sm mb-1">
        <span className="text-zinc-600">{label}</span>
        <span className={atLimit ? "text-red-600 font-medium" : "text-zinc-500"}>
          {entry.used} / {unlimited ? "Ilimitado" : entry.limit}
        </span>
      </div>
      {!unlimited && (
        <div className="h-2 rounded-full bg-zinc-100 overflow-hidden">
          <div
            className={`h-full rounded-full ${atLimit ? "bg-red-500" : pct > 80 ? "bg-amber-500" : "bg-blue-600"}`}
            style={{ width: `${pct}%` }}
          />
        </div>
      )}
    </div>
  );
}

export default function SubscriptionPage() {
  const [subscription, setSubscription] = useState<SubscriptionSummary | null>(null);
  const [plans, setPlans] = useState<Plan[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionMessage, setActionMessage] = useState<string | null>(null);
  const [busyPlan, setBusyPlan] = useState<string | null>(null);
  const [busyAction, setBusyAction] = useState<"cancel" | "renew" | null>(null);

  async function load() {
    setLoadError(null);
    try {
      const [sub, planList] = await Promise.all([
        api<SubscriptionSummary>("/organizations/me/subscription"),
        api<Plan[]>("/organizations/me/subscription/plans"),
      ]);
      setSubscription(sub);
      setPlans(planList);
    } catch (err) {
      setLoadError(err instanceof ApiError ? err.message : "No se pudo cargar la suscripción");
    }
  }

  useEffect(() => {
    load();
  }, []);

  async function changePlan(planKey: string) {
    setActionError(null);
    setActionMessage(null);
    setBusyPlan(planKey);
    try {
      await api("/organizations/me/subscription/change-plan", { method: "POST", body: { planKey } });
      setActionMessage("Plan actualizado.");
      await load();
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : "No se pudo cambiar de plan");
    } finally {
      setBusyPlan(null);
    }
  }

  async function cancel() {
    setActionError(null);
    setActionMessage(null);
    setBusyAction("cancel");
    try {
      await api("/organizations/me/subscription/cancel", { method: "POST" });
      setActionMessage("Suscripción cancelada.");
      await load();
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : "No se pudo cancelar la suscripción");
    } finally {
      setBusyAction(null);
    }
  }

  async function renew() {
    setActionError(null);
    setActionMessage(null);
    setBusyAction("renew");
    try {
      await api("/organizations/me/subscription/renew", { method: "POST" });
      setActionMessage("Suscripción renovada.");
      await load();
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : "No se pudo renovar la suscripción");
    } finally {
      setBusyAction(null);
    }
  }

  return (
    <AppShell>
      <div className="p-6 max-w-3xl space-y-6">
        <div>
          <h1 className="text-lg font-semibold">Suscripción</h1>
          <p className="text-sm text-zinc-500">Plan, uso actual y límites de tu empresa.</p>
        </div>

        {loadError && <p className="text-sm text-red-600 bg-red-50 rounded p-2">{loadError}</p>}
        {actionError && <p className="text-sm text-red-600 bg-red-50 rounded p-2">{actionError}</p>}
        {actionMessage && <p className="text-sm text-emerald-700 bg-emerald-50 rounded p-2">{actionMessage}</p>}

        {subscription && (
          <div className="bg-white rounded-lg border border-zinc-200 p-5 space-y-4 text-sm">
            <div className="flex items-center justify-between">
              <p className="font-medium text-base">Plan {subscription.plan.name}</p>
              <span className={`text-xs rounded-full px-2 py-1 ${STATUS_COLORS[subscription.status]}`}>
                {STATUS_LABELS[subscription.status]}
              </span>
            </div>
            <p className="text-zinc-500">Bs. {Number(subscription.plan.priceMonthly).toFixed(2)} / mes</p>
            {subscription.currentPeriodEnd && (
              <p className="text-xs text-zinc-500">
                {subscription.status === "PAST_DUE" ? "Venció el" : "Se renueva el"} {formatDate(subscription.currentPeriodEnd)}
              </p>
            )}
            {subscription.status === "PAST_DUE" && (
              <p className="text-xs text-amber-700 bg-amber-50 rounded p-2">
                Tu suscripción está vencida. Renovala para mantener tu plan activo — mientras tanto podés seguir usando KIPU normalmente.
              </p>
            )}
            {subscription.status === "CANCELLED" && (
              <p className="text-xs text-red-700 bg-red-50 rounded p-2">
                Tu suscripción está cancelada: no vas a poder agregar usuarios, sucursales ni productos nuevos hasta que renueves.
              </p>
            )}

            <div className="space-y-3 pt-2 border-t border-zinc-100">
              <p className="text-xs text-zinc-500 font-medium uppercase tracking-wide">Uso del plan</p>
              <UsageBar label={USAGE_LABELS.users} entry={subscription.usage.users} />
              <UsageBar label={USAGE_LABELS.branches} entry={subscription.usage.branches} />
              <UsageBar label={USAGE_LABELS.products} entry={subscription.usage.products} />
            </div>

            {subscription.plan.priceMonthly !== "0.00" && subscription.status !== "CANCELLED" && (
              <div className="pt-2 border-t border-zinc-100 flex gap-2">
                <button
                  onClick={renew}
                  disabled={busyAction !== null}
                  className="text-xs rounded border border-zinc-300 px-3 py-1.5 hover:bg-zinc-100 disabled:opacity-50"
                >
                  {busyAction === "renew" ? "Renovando..." : "Renovar ahora"}
                </button>
                <button
                  onClick={cancel}
                  disabled={busyAction !== null}
                  className="text-xs rounded border border-red-200 text-red-700 px-3 py-1.5 hover:bg-red-50 disabled:opacity-50"
                >
                  {busyAction === "cancel" ? "Cancelando..." : "Cancelar suscripción"}
                </button>
              </div>
            )}
            {subscription.status === "CANCELLED" && (
              <div className="pt-2 border-t border-zinc-100">
                <button
                  onClick={renew}
                  disabled={busyAction !== null}
                  className="text-xs rounded bg-zinc-900 text-white px-3 py-1.5 hover:bg-zinc-800 disabled:opacity-50"
                >
                  {busyAction === "renew" ? "Reactivando..." : "Reactivar (renovar)"}
                </button>
              </div>
            )}
          </div>
        )}

        <div>
          <p className="text-sm font-medium mb-3">Planes disponibles</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {plans.map((plan) => {
              const isCurrent = subscription?.plan.key === plan.key;
              return (
                <div
                  key={plan.key}
                  className={`rounded-lg border p-4 space-y-2 text-sm ${
                    isCurrent ? "border-blue-400 bg-blue-50/40" : "border-zinc-200 bg-white"
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <p className="font-medium">{plan.name}</p>
                    {isCurrent && <span className="text-xs text-blue-700">Plan actual</span>}
                  </div>
                  <p className="text-zinc-500">Bs. {Number(plan.priceMonthly).toFixed(2)} / mes</p>
                  <ul className="text-xs text-zinc-600 space-y-0.5">
                    <li>Usuarios: {plan.limits.maxUsers ?? "Ilimitado"}</li>
                    <li>Sucursales: {plan.limits.maxBranches ?? "Ilimitado"}</li>
                    <li>Productos: {plan.limits.maxProducts ?? "Ilimitado"}</li>
                  </ul>
                  {!isCurrent && (
                    <button
                      onClick={() => changePlan(plan.key)}
                      disabled={busyPlan !== null}
                      className="w-full text-xs rounded bg-zinc-900 text-white px-3 py-1.5 hover:bg-zinc-800 disabled:opacity-50 mt-2"
                    >
                      {busyPlan === plan.key ? "Cambiando..." : "Cambiar a este plan"}
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        <p className="text-xs text-zinc-400">
          El cambio de plan y la renovación no procesan un cobro real todavía (no hay pasarela de pagos conectada) — ver
          docs/PROJECT_PLAN.md.
        </p>
      </div>
    </AppShell>
  );
}
