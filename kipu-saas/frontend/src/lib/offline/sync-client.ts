import { getAccessToken, refreshSession } from "./token-store";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4200";

export type SyncRequestResult =
  | { kind: "success"; status: number; body: unknown }
  // 409: idempotencyKey reusada con datos distintos, o un conflicto de
  // negocio real (ej. stock insuficiente al confirmar) — nunca se
  // reintenta solo, necesita revisión (ver `sync-queue.ts#markConflict`).
  | { kind: "conflict"; status: number; body: unknown }
  // 400: error de validación — reintentar con el MISMO payload nunca lo
  // arregla solo (ej. "Producto no encontrado").
  | { kind: "validation-error"; status: number; body: unknown }
  // Red caída, timeout, 5xx — candidato real a reintento automático.
  | { kind: "transient-error"; message: string }
  // El refresh token está revocado o expiró y no se pudo renovar la
  // sesión — señal concreta de "este dispositivo fue revocado
  // remotamente" (Fase Offline 1) o de que el usuario debe volver a
  // loguearse.
  | { kind: "session-revoked" };

/**
 * Dedicado al Sync Engine — a propósito NO es el mismo `api()` de
 * `lib/api.ts` que usa el resto de la app. Desde Offline 4.1, `lib/api.ts`
 * TAMBIÉN renueva la sesión ante un 401 (mismo `refreshSession` de
 * `token-store.ts`, cero lógica duplicada) — la diferencia que sigue
 * justificando dos clientes separados es la forma de la respuesta: el Sync
 * Engine necesita distinguir `conflict`/`validation-error`/`transient-error`
 * (para decidir si reintenta solo o no, ver `sync-engine.ts`), algo que las
 * llamadas interactivas de `lib/api.ts` no necesitan — ahí un error HTTP
 * que no sea 401 simplemente se convierte en `ApiError` para que la
 * pantalla lo muestre. Ver `docs/architecture.md` sección 20 para el
 * detalle de por qué se mantienen dos clientes con un solo mecanismo de
 * renovación compartido, en vez de fusionarlos en uno.
 */
export async function syncRequest(
  path: string,
  body: unknown,
): Promise<SyncRequestResult> {
  const attempt = async (token: string | null): Promise<Response | null> => {
    try {
      return await fetch(`${API_URL}${path}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify(body),
      });
    } catch {
      return null;
    }
  };

  let res = await attempt(getAccessToken());
  if (!res) {
    return { kind: "transient-error", message: "No se pudo contactar al servidor" };
  }

  if (res.status === 401) {
    const refreshed = await refreshSession();
    if (!refreshed.ok) {
      if (refreshed.reason === "revoked-or-expired") {
        return { kind: "session-revoked" };
      }
      return { kind: "transient-error", message: "No se pudo renovar la sesión" };
    }
    res = await attempt(refreshed.accessToken);
    if (!res) {
      return { kind: "transient-error", message: "No se pudo contactar al servidor" };
    }
    if (res.status === 401) {
      // Renovó el token pero el request real igual dio 401 — no debería
      // pasar en el camino feliz, pero se trata como sesión inválida en
      // vez de reintentar en bucle.
      return { kind: "session-revoked" };
    }
  }

  const jsonBody = await res.json().catch(() => null);

  if (res.status === 200 || res.status === 201) {
    return { kind: "success", status: res.status, body: jsonBody };
  }
  if (res.status === 409) {
    return { kind: "conflict", status: res.status, body: jsonBody };
  }
  if (res.status === 400) {
    return { kind: "validation-error", status: res.status, body: jsonBody };
  }
  return {
    kind: "transient-error",
    message: `El servidor respondió ${res.status}`,
  };
}
