"use client";

import { useEffect } from "react";
import { useAuth } from "@/lib/auth-context";
import { clearSessionRevoked, triggerSync } from "../auto-sync";
import { connectionStatus } from "../connection-status";
import { countPending } from "../sync-queue";
import { useLocalDb } from "./useLocalDb";

// Respaldo del evento `online` del navegador — no todos los cambios de
// conectividad real disparan ese evento de forma confiable (ej. WiFi
// "conectado" pero sin salida a internet), así que además se reintenta
// periódicamente. 45s es un intervalo razonable para un comercio chico:
// ni tan agresivo como para golpear la API en bucle, ni tan lento como
// para que una venta quede pendiente minutos después de que vuelve la señal.
const FALLBACK_POLL_MS = 45_000;

/**
 * Monta UNA vez (en `AppShell`, no en cada página) el disparo automático
 * del Sync Engine: al iniciar, al reconectar, y periódicamente como
 * respaldo. No devuelve nada — es pura orquestación, la UI lee el
 * resultado a través de `useConnectionStatus()`.
 */
export function useAutoSync(): void {
  const { organization, token } = useAuth();
  const db = useLocalDb();

  useEffect(() => {
    if (!db || !organization) return;

    // Una sesión nueva (login, o un refresh que ya renovó el token) le da
    // al Sync Engine otra oportunidad si la vez anterior había quedado
    // marcada como revocada.
    if (token) clearSessionRevoked(organization.id);

    let cancelled = false;
    const orgId = organization.id;

    async function refreshPendingCount() {
      if (cancelled || !db) return;
      connectionStatus.setPendingCount(await countPending(db));
    }

    async function sync(force: boolean) {
      if (cancelled || !db) return;
      await triggerSync(db, orgId, { force });
    }

    void refreshPendingCount();
    // Al iniciar la app (o volver a abrirla) puede haber operaciones cuyo
    // backoff se calculó suponiendo que se seguía sin conexión — arrancar
    // ignora ese backoff, igual que una reconexión real.
    void sync(true);

    function onOnline() {
      void sync(true);
    }
    window.addEventListener("online", onOnline);
    // El respaldo periódico SÍ respeta el backoff normal (no fuerza) —
    // evita reintentar en bucle algo que ya sabe que tiene que esperar.
    const interval = setInterval(() => void sync(false), FALLBACK_POLL_MS);

    return () => {
      cancelled = true;
      window.removeEventListener("online", onOnline);
      clearInterval(interval);
    };
  }, [db, organization, token]);
}
