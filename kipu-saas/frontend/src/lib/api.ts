import { refreshSession } from "./offline/token-store";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4200";

// Endpoints de arranque/renovación de sesión: un 401 acá significa
// "credenciales inválidas" o "refresh token inválido", nunca "mi sesión ya
// vencida necesita renovarse" — intentar el ciclo de refresh SOBRE ellos
// mismos no tiene sentido (ej. refrescar la sesión por un login con
// contraseña incorrecta) y podría producir un bucle.
const AUTH_BOOTSTRAP_PATHS = new Set(["/auth/login", "/auth/register", "/auth/refresh"]);

export class ApiError extends Error {
  constructor(public status: number, message: string, public details?: unknown) {
    super(message);
  }
}

function getToken(): string | null {
  if (typeof window === "undefined") return null;
  return localStorage.getItem("kipu_token");
}

let sessionExpiredHandler: (() => void) | null = null;

/**
 * `auth-context.tsx` registra acá su `logout()` real al montar
 * `AuthProvider` (vía un ref, para no perder identidad entre renders) — es
 * el único puente entre este módulo (no es un componente React, no puede
 * usar hooks ni Context) y el estado de sesión real. Deliberadamente al
 * revés de lo que sería un import circular: `lib/api.ts` nunca importa
 * `auth-context.tsx`, es `auth-context.tsx` quien ya importa de acá.
 */
export function registerSessionExpiredHandler(handler: (() => void) | null): void {
  sessionExpiredHandler = handler;
}

function withAuthHeader(init: RequestInit, token: string | null): RequestInit {
  return {
    ...init,
    headers: {
      ...(init.headers as Record<string, string> | undefined),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
  };
}

function extractMessage(data: unknown, fallback: string): string {
  const raw =
    (data as { message?: unknown; error?: unknown } | undefined)?.message ??
    (data as { message?: unknown; error?: unknown } | undefined)?.error ??
    fallback;
  return Array.isArray(raw) ? raw.join(", ") : (raw as string);
}

/**
 * Ejecuta UN fetch autenticado con el mismo ciclo 401→refresh→reintento
 * único que ya usa el Sync Engine (`sync-client.ts`): reutiliza
 * `refreshSession` de `lib/offline/token-store.ts`, nunca duplica esa
 * lógica. El segundo intento (ya con el token renovado, si lo hubo) NUNCA
 * se vuelve a interceptar — si también da 401, se propaga tal cual, sin
 * loop posible.
 *
 * Un error de RED al intentar renovar (`reason: "network-error"`) nunca se
 * trata como sesión revocada: no dispara `sessionExpiredHandler`, no borra
 * tokens — el 401 original simplemente se propaga como cualquier otro
 * error transitorio, para que el usuario pueda reintentar la acción cuando
 * vuelva la conexión.
 */
async function authorizedFetch(
  path: string,
  init: RequestInit,
  explicitToken?: string,
): Promise<Response> {
  const token = explicitToken ?? getToken();
  const res = await fetch(`${API_URL}${path}`, withAuthHeader(init, token));

  const shouldAttemptRefresh =
    res.status === 401 && !AUTH_BOOTSTRAP_PATHS.has(path) && explicitToken === undefined;
  if (!shouldAttemptRefresh) return res;

  const refreshed = await refreshSession();
  if (!refreshed.ok) {
    if (refreshed.reason !== "network-error") {
      sessionExpiredHandler?.();
    }
    return res;
  }

  return fetch(`${API_URL}${path}`, withAuthHeader(init, refreshed.accessToken));
}

export async function api<T = unknown>(
  path: string,
  options: { method?: string; body?: unknown; token?: string } = {}
): Promise<T> {
  const res = await authorizedFetch(
    path,
    {
      method: options.method ?? "GET",
      headers: { "Content-Type": "application/json" },
      body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
    },
    options.token,
  );

  if (res.status === 204) return undefined as T;

  const data = await res.json().catch(() => undefined);
  if (!res.ok) {
    throw new ApiError(res.status, extractMessage(data, "Error de red"), data);
  }
  return data as T;
}

/** Descarga un archivo (export CSV/Excel) autenticado y dispara el guardado en el navegador. */
export async function apiDownload(path: string, filename: string, token?: string): Promise<void> {
  const res = await authorizedFetch(path, {}, token);
  if (!res.ok) {
    const data = await res.json().catch(() => undefined);
    throw new ApiError(res.status, extractMessage(data, "No se pudo exportar"), data);
  }
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

/** Trae un archivo autenticado (ej. un PDF) como blob URL para verlo/imprimirlo en una pestaña nueva — el caller es responsable de revocar la URL cuando ya no la necesite. */
export async function apiBlobUrl(path: string, token?: string): Promise<string> {
  const res = await authorizedFetch(path, {}, token);
  if (!res.ok) {
    const data = await res.json().catch(() => undefined);
    throw new ApiError(res.status, extractMessage(data, "No se pudo generar el documento"), data);
  }
  const blob = await res.blob();
  return URL.createObjectURL(blob);
}
