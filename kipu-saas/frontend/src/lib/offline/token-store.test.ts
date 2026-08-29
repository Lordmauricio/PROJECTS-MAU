import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getAccessToken, getRefreshToken, refreshSession, resetRefreshGuard } from "./token-store";

describe("token-store — lee las MISMAS claves que auth-context.tsx/lib/api.ts", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
  });

  it("getAccessToken/getRefreshToken leen kipu_token/kipu_refresh_token de localStorage", () => {
    localStorage.setItem("kipu_token", "access-abc");
    localStorage.setItem("kipu_refresh_token", "refresh-abc");
    expect(getAccessToken()).toBe("access-abc");
    expect(getRefreshToken()).toBe("refresh-abc");
  });

  it("sin sesión guardada, devuelve null (nunca lanza)", () => {
    expect(getAccessToken()).toBeNull();
    expect(getRefreshToken()).toBeNull();
  });
});

describe("refreshSession — renovación de sesión sin pasar por React", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("sin refresh token guardado, no llama a la red", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const result = await refreshSession();
    expect(result).toEqual({ ok: false, reason: "no-refresh-token" });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("éxito: persiste el NUEVO par de tokens (la Fase Offline 1 rota el refresh token en cada uso)", async () => {
    localStorage.setItem("kipu_refresh_token", "refresh-viejo");
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({ accessToken: "access-nuevo", refreshToken: "refresh-nuevo" }),
          { status: 201 },
        ),
      ),
    );

    const result = await refreshSession();
    expect(result).toEqual({ ok: true, accessToken: "access-nuevo" });
    expect(localStorage.getItem("kipu_token")).toBe("access-nuevo");
    expect(localStorage.getItem("kipu_refresh_token")).toBe("refresh-nuevo");
  });

  it("401 (revocado o expirado): señal explícita 'revoked-or-expired', nunca persiste nada", async () => {
    localStorage.setItem("kipu_refresh_token", "refresh-revocado");
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response(JSON.stringify({ message: "inválido" }), { status: 401 })),
    );

    const result = await refreshSession();
    expect(result).toEqual({ ok: false, reason: "revoked-or-expired" });
    expect(localStorage.getItem("kipu_token")).toBeNull();
  });

  it("error de red: 'network-error', distinto de una sesión realmente revocada", async () => {
    localStorage.setItem("kipu_refresh_token", "refresh-cualquiera");
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("sin conexión")));

    const result = await refreshSession();
    expect(result).toEqual({ ok: false, reason: "network-error" });
  });
});

describe("refreshSession — deduplicación contra llamadas concurrentes (Offline 4.1)", () => {
  beforeEach(() => {
    localStorage.clear();
    resetRefreshGuard();
    vi.restoreAllMocks();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("dos llamadas CONCURRENTES comparten la MISMA promesa y disparan un solo POST /auth/refresh", async () => {
    localStorage.setItem("kipu_refresh_token", "refresh-viejo");
    let resolveFetch!: (v: Response) => void;
    const fetchMock = vi.fn().mockImplementation(
      () => new Promise<Response>((resolve) => (resolveFetch = resolve)),
    );
    vi.stubGlobal("fetch", fetchMock);

    const first = refreshSession();
    const second = refreshSession(); // concurrente, ANTES de que la primera resuelva

    resolveFetch(
      new Response(
        JSON.stringify({ accessToken: "access-nuevo", refreshToken: "refresh-nuevo" }),
        { status: 201 },
      ),
    );
    const [firstResult, secondResult] = await Promise.all([first, second]);

    expect(fetchMock).toHaveBeenCalledTimes(1); // nunca 2 — evita que el refresh token rotado deje a una de las dos "huérfana"
    expect(firstResult).toEqual({ ok: true, accessToken: "access-nuevo" });
    expect(secondResult).toEqual({ ok: true, accessToken: "access-nuevo" }); // misma respuesta, no una segunda renovación
  });

  it("una llamada POSTERIOR (ya resuelta la anterior) SÍ dispara un nuevo refresh — el dedupe no queda pegado para siempre", async () => {
    localStorage.setItem("kipu_refresh_token", "refresh-1");
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({ accessToken: "access-a", refreshToken: "refresh-2" }),
        { status: 201 },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    await refreshSession();
    expect(fetchMock).toHaveBeenCalledTimes(1);

    // El token ya rotó (refresh-2 quedó guardado) — una renovación
    // posterior, ya no concurrente con la primera, debe volver a golpear
    // la red con normalidad.
    await refreshSession();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
