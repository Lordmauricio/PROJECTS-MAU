"use client";

import { useEffect, useState } from "react";
import AppShell from "@/components/AppShell";
import { api } from "@/lib/api";
import { ApiError } from "@/lib/auth-context";

interface Subscription {
  status: string;
  currentPeriodEnd: string | null;
  plan: {
    name: string;
    priceMonthly: string;
    limits: { maxUsers?: number; maxBranches?: number; maxProducts?: number };
    features: Record<string, boolean>;
  };
}

export default function SubscriptionPage() {
  const [subscription, setSubscription] = useState<Subscription | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    api<Subscription>("/organizations/me/subscription")
      .then(setSubscription)
      .catch((err) =>
        setLoadError(err instanceof ApiError ? err.message : "No se pudo cargar la suscripción"),
      );
  }, []);

  return (
    <AppShell>
      <div className="p-6 max-w-xl space-y-4">
        <h1 className="text-lg font-semibold">Suscripción</h1>
        {loadError && <p className="text-sm text-red-600 bg-red-50 rounded p-2">{loadError}</p>}
        {subscription ? (
          <div className="bg-white rounded-lg border border-zinc-200 p-5 space-y-3 text-sm">
            <div className="flex items-center justify-between">
              <p className="font-medium text-base">Plan {subscription.plan.name}</p>
              <span className="text-xs bg-zinc-100 rounded-full px-2 py-1">{subscription.status}</span>
            </div>
            <p className="text-zinc-500">Bs. {Number(subscription.plan.priceMonthly).toFixed(2)} / mes</p>
            <div>
              <p className="text-xs text-zinc-500 mb-1">Límites del plan</p>
              <ul className="list-disc list-inside text-zinc-700">
                <li>Usuarios: {subscription.plan.limits.maxUsers ?? "-"}</li>
                <li>Sucursales: {subscription.plan.limits.maxBranches ?? "-"}</li>
                <li>Productos: {subscription.plan.limits.maxProducts ?? "-"}</li>
              </ul>
            </div>
            <p className="text-xs text-zinc-400">
              La pasarela de pagos para cambiar de plan es una fase siguiente (ver docs/PROJECT_PLAN.md).
            </p>
          </div>
        ) : !loadError ? (
          <p className="text-sm text-zinc-500">Cargando...</p>
        ) : null}
      </div>
    </AppShell>
  );
}
