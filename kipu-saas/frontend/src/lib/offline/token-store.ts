const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4200";

// Mismas claves de `localStorage` que ya usa `lib/auth-context.tsx`/
// `lib/api.ts` — deliberadamente NO se crea un segundo lugar donde vive la
// sesión. Este módulo solo LEE/ACTUALIZA esas claves para que el Sync
// Engine (que corre sin que haya necesariamente un humano mirando la
// pantalla en ese momento) pueda refrescar su propio access token vencido
// sin depender de React ni de que el usuario interactúe con la UI.
const TOKEN_KEY = "kipu_token";
const REFRESH_TOKEN_KEY = "kipu_refresh_token";
const ORGANIZATION_KEY = "kipu_organization";

export function getAccessToken(): string | null {
  if (typeof window === "undefined") return null;
  return localStorage.getItem(TOKEN_KEY);
}

export function getRefreshToken(): string | null {
  if (typeof window === "undefined") return null;
  return localStorage.getItem(REFRESH_TOKEN_KEY);
}

export function getActiveOrganizationId(): string | null {
  if (typeof window === "undefined") return null;
  const raw = localStorage.getItem(ORGANIZATION_KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as { id?: string };
    return parsed.id ?? null;
  } catch {
    return null;
  }
}

function setTokens(accessToken: string, refreshToken: string): void {
  localStorage.setItem(TOKEN_KEY, accessToken);
  localStorage.setItem(REFRESH_TOKEN_KEY, refreshToken);
}

export type RefreshOutcome =
  | { ok: true; accessToken: string }
  | { ok: false; reason: "no-refresh-token" | "revoked-or-expired" | "network-error" };

/**
 * Llama a `POST /auth/refresh` directamente (sin pasar por
 * `auth-context.tsx`, que es un React Context y no puede invocarse desde
 * fuera de un componente). Reutiliza el MISMO endpoint que ya usa el resto
 * de la app — no se inventa un mecanismo de auth paralelo.
 *
 * Éxito: la Fase Offline 1 rota el refresh token en cada uso, así que acá
 * también hay que persistir el par nuevo — si no, el siguiente intento
 * (de este engine o de la pestaña interactiva) usaría un refresh token ya
 * revocado por la propia rotación.
 *
 * `reason: "revoked-or-expired"` es la señal concreta de la Fase Offline 1:
 * un dispositivo revocado remotamente (`POST /members/:id/revoke-sessions`)
 * deja de poder refrescar exactamente por este camino — cuando vuelve la
 * conexión y el Sync Engine intenta trabajar, este es el punto donde la
 * revocación se descubre.
 */
export async function refreshSession(): Promise<RefreshOutcome> {
  const refreshToken = getRefreshToken();
  if (!refreshToken) return { ok: false, reason: "no-refresh-token" };

  let res: Response;
  try {
    res = await fetch(`${API_URL}/auth/refresh`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ refreshToken }),
    });
  } catch {
    return { ok: false, reason: "network-error" };
  }

  if (res.status === 401) {
    return { ok: false, reason: "revoked-or-expired" };
  }
  if (!res.ok) {
    return { ok: false, reason: "network-error" };
  }

  const data = (await res.json().catch(() => null)) as
    | { accessToken?: string; refreshToken?: string }
    | null;
  if (!data?.accessToken || !data?.refreshToken) {
    return { ok: false, reason: "network-error" };
  }
  setTokens(data.accessToken, data.refreshToken);
  return { ok: true, accessToken: data.accessToken };
}
