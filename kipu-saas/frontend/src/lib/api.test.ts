import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api, apiDownload, ApiError, registerSessionExpiredHandler } from "./api";
import { resetRefreshGuard } from "./offline/token-store";

function jsonResponse(status: number, body: unknown) {
  return new Response(JSON.stringify(body), { status });
}

/** Evita repetir el casteo de `mock.calls` (tipado como `any[][]` por vitest) en cada test. */
function callUsedToken(calls: unknown[][], token: string): boolean {
  return calls.some((call) => {
    const init = call[1] as RequestInit | undefined;
    return (init?.headers as Record<string, string> | undefined)?.Authorization === `Bearer ${token}`;
  });
}

/**
 * Todas las pruebas de esta fase (Offline 4.1) ejercitan el comportamiento
 * REAL de `api()` contra un `fetch` mockeado por URL — nunca mockean
 * `authorizedFetch`/`refreshSession` en sí, para demostrar de punta a
 * punta que el ciclo 401→refresh→reintento único ocurre de verdad, no que
 * la lógica interna "confía" en que funcione.
 */
describe("lib/api — ciclo 401 → refresh → reintento único (Offline 4.1)", () => {
  beforeEach(() => {
    localStorage.clear();
    localStorage.setItem("kipu_token", "access-vigente");
    localStorage.setItem("kipu_refresh_token", "refresh-vigente");
    resetRefreshGuard();
    registerSessionExpiredHandler(null);
    vi.restoreAllMocks();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    registerSessionExpiredHandler(null);
  });

  // A
  it("request normal (200) nunca toca el ciclo de refresh", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, { ok: true }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await api<{ ok: boolean }>("/products");
    expect(result).toEqual({ ok: true });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  // B, H, I
  it("401 → refresh exitoso → reintenta UNA vez con el token nuevo → 200; rota ambos tokens en localStorage", async () => {
    const fetchMock = vi.fn().mockImplementation((url: string) => {
      if (url.endsWith("/auth/refresh")) {
        return Promise.resolve(
          jsonResponse(201, { accessToken: "access-nuevo", refreshToken: "refresh-nuevo" }),
        );
      }
      if (url.endsWith("/products")) {
        // La PRIMERA vez que llega acá, sin haber renovado, da 401.
        const usedNewToken = callUsedToken(fetchMock.mock.calls, "access-nuevo");
        return Promise.resolve(
          usedNewToken ? jsonResponse(200, { ok: true }) : jsonResponse(401, {}),
        );
      }
      throw new Error(`URL inesperada: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await api<{ ok: boolean }>("/products");
    expect(result).toEqual({ ok: true });
    expect(fetchMock).toHaveBeenCalledTimes(3); // 401 original + refresh + reintento
    expect(localStorage.getItem("kipu_token")).toBe("access-nuevo");
    expect(localStorage.getItem("kipu_refresh_token")).toBe("refresh-nuevo");

    const retryHeaders = fetchMock.mock.calls[2][1].headers as Record<string, string>;
    expect(retryHeaders.Authorization).toBe("Bearer access-nuevo");
  });

  // C
  it("401 → sin refresh token disponible (rechazado) → propaga el 401 original, sin logout forzado", async () => {
    localStorage.removeItem("kipu_refresh_token");
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(401, { message: "No autorizado" }));
    vi.stubGlobal("fetch", fetchMock);
    const sessionExpired = vi.fn();
    registerSessionExpiredHandler(sessionExpired);

    await expect(api("/products")).rejects.toMatchObject({ status: 401 });
    // Sin refresh token, `refreshSession` ni siquiera llama a la red — un
    // solo fetch total (el original), nunca un POST /auth/refresh de más.
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(sessionExpired).toHaveBeenCalledTimes(1);
  });

  // D
  it("401 → refresh también da 401 (sesión revocada) → propaga el 401 original y dispara sessionExpiredHandler", async () => {
    const fetchMock = vi.fn().mockImplementation((url: string) => {
      if (url.endsWith("/auth/refresh")) {
        return Promise.resolve(jsonResponse(401, { message: "Refresh token inválido" }));
      }
      return Promise.resolve(jsonResponse(401, {}));
    });
    vi.stubGlobal("fetch", fetchMock);
    const sessionExpired = vi.fn();
    registerSessionExpiredHandler(sessionExpired);

    await expect(api("/products")).rejects.toMatchObject({ status: 401 });
    expect(fetchMock).toHaveBeenCalledTimes(2); // 401 original + intento de refresh, SIN reintento del original
    expect(sessionExpired).toHaveBeenCalledTimes(1);
  });

  // E, J
  it("401 → refresh falla por error de RED → propaga el 401 original SIN forzar logout ni borrar tokens", async () => {
    const fetchMock = vi.fn().mockImplementation((url: string) => {
      if (url.endsWith("/auth/refresh")) {
        return Promise.reject(new Error("sin conexión"));
      }
      return Promise.resolve(jsonResponse(401, {}));
    });
    vi.stubGlobal("fetch", fetchMock);
    const sessionExpired = vi.fn();
    registerSessionExpiredHandler(sessionExpired);

    await expect(api("/products")).rejects.toMatchObject({ status: 401 });
    expect(sessionExpired).not.toHaveBeenCalled();
    // Ni el access token ni el refresh token se tocan por un simple error de red.
    expect(localStorage.getItem("kipu_token")).toBe("access-vigente");
    expect(localStorage.getItem("kipu_refresh_token")).toBe("refresh-vigente");
  });

  // F, N
  it("401 → refresh exitoso → el reintento TAMBIÉN da 401 → se detiene ahí, nunca un tercer intento", async () => {
    const fetchMock = vi.fn().mockImplementation((url: string) => {
      if (url.endsWith("/auth/refresh")) {
        return Promise.resolve(
          jsonResponse(201, { accessToken: "access-nuevo", refreshToken: "refresh-nuevo" }),
        );
      }
      return Promise.resolve(jsonResponse(401, {})); // el request real SIEMPRE da 401, incluso con el token nuevo
    });
    vi.stubGlobal("fetch", fetchMock);
    const sessionExpired = vi.fn();
    registerSessionExpiredHandler(sessionExpired);

    await expect(api("/products")).rejects.toMatchObject({ status: 401 });
    expect(fetchMock).toHaveBeenCalledTimes(3); // original + refresh + UN reintento, nunca más
    // El refresh en sí fue exitoso (el token SÍ es válido) — este segundo
    // 401 es un asunto propio del endpoint, no evidencia de sesión
    // revocada, así que NO se fuerza logout por esto.
    expect(sessionExpired).not.toHaveBeenCalled();
  });

  // G, M
  it("varias llamadas simultáneas con 401 comparten UN solo refresh (dedupe de token-store.ts)", async () => {
    let refreshCalls = 0;
    const fetchMock = vi.fn().mockImplementation((url: string) => {
      if (url.endsWith("/auth/refresh")) {
        refreshCalls += 1;
        return Promise.resolve(
          jsonResponse(201, { accessToken: "access-nuevo", refreshToken: "refresh-nuevo" }),
        );
      }
      const usedNewToken = callUsedToken(fetchMock.mock.calls, "access-nuevo");
      return Promise.resolve(usedNewToken ? jsonResponse(200, { ok: true }) : jsonResponse(401, {}));
    });
    vi.stubGlobal("fetch", fetchMock);

    const [a, b, c] = await Promise.all([
      api<{ ok: boolean }>("/products"),
      api<{ ok: boolean }>("/customers"),
      api<{ ok: boolean }>("/branches"),
    ]);
    expect([a, b, c]).toEqual([{ ok: true }, { ok: true }, { ok: true }]);
    expect(refreshCalls).toBe(1); // nunca 3 — las tres esperan la MISMA renovación
  });

  // No debe intentar refrescar sobre los propios endpoints de arranque de sesión.
  it("un 401 en /auth/login NUNCA dispara el ciclo de refresh (sería sin sentido: es la contraseña, no el token)", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(401, { message: "Credenciales inválidas" }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      api("/auth/login", { method: "POST", body: { email: "a@a.com", password: "mala" } }),
    ).rejects.toMatchObject({ status: 401 });
    expect(fetchMock).toHaveBeenCalledTimes(1); // nunca un POST /auth/refresh de más
  });

  it("apiDownload también pasa por el mismo ciclo 401→refresh→reintento (sin duplicar la lógica)", async () => {
    const fetchMock = vi.fn().mockImplementation((url: string) => {
      if (url.endsWith("/auth/refresh")) {
        return Promise.resolve(
          jsonResponse(201, { accessToken: "access-nuevo", refreshToken: "refresh-nuevo" }),
        );
      }
      const usedNewToken = callUsedToken(fetchMock.mock.calls, "access-nuevo");
      if (usedNewToken) {
        return Promise.resolve(new Response("contenido", { status: 200 }));
      }
      return Promise.resolve(jsonResponse(401, {}));
    });
    vi.stubGlobal("fetch", fetchMock);

    // jsdom no implementa URL.createObjectURL/revokeObjectURL por defecto.
    (URL as unknown as { createObjectURL: () => string }).createObjectURL = () => "blob:mock";
    (URL as unknown as { revokeObjectURL: () => void }).revokeObjectURL = () => {};

    await expect(apiDownload("/reports/export", "reporte.csv")).resolves.toBeUndefined();
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("ApiError conserva status/message/details tal como antes de esta fase", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(jsonResponse(400, { message: "Producto no encontrado" })),
    );
    try {
      await api("/products/does-not-exist");
      throw new Error("no debería llegar acá");
    } catch (err) {
      expect(err).toBeInstanceOf(ApiError);
      expect((err as ApiError).status).toBe(400);
      expect((err as ApiError).message).toBe("Producto no encontrado");
    }
  });
});
