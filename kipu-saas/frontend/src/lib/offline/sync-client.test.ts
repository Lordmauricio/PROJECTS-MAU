import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { syncRequest } from "./sync-client";

function jsonResponse(status: number, body: unknown) {
  return new Response(JSON.stringify(body), { status });
}

describe("sync-client — clasificación de respuestas", () => {
  beforeEach(() => {
    localStorage.clear();
    localStorage.setItem("kipu_token", "access-vigente");
    localStorage.setItem("kipu_refresh_token", "refresh-vigente");
    vi.restoreAllMocks();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("2xx → success", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(201, { id: "sale-1" })));
    const result = await syncRequest("/sales", { foo: "bar" });
    expect(result).toEqual({ kind: "success", status: 201, body: { id: "sale-1" } });
  });

  it("409 → conflict (nunca se reintenta solo)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(jsonResponse(409, { message: "idempotencyKey ya usada" })),
    );
    const result = await syncRequest("/sales", {});
    expect(result.kind).toBe("conflict");
  });

  it("400 → validation-error (permanente, no transitorio)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(jsonResponse(400, { message: "Producto no encontrado" })),
    );
    const result = await syncRequest("/sales", {});
    expect(result.kind).toBe("validation-error");
  });

  it("500 → transient-error (candidato real a reintento)", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(500, {})));
    const result = await syncRequest("/sales", {});
    expect(result.kind).toBe("transient-error");
  });

  it("fetch lanza (sin red) → transient-error, nunca una excepción sin capturar", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network down")));
    const result = await syncRequest("/sales", {});
    expect(result.kind).toBe("transient-error");
  });

  it("401 con refresh exitoso: reintenta AUTOMÁTICAMENTE con el token nuevo y devuelve success", async () => {
    const fetchMock = vi.fn();
    // 1) request original → 401
    fetchMock.mockResolvedValueOnce(jsonResponse(401, {}));
    // 2) POST /auth/refresh → éxito
    fetchMock.mockResolvedValueOnce(
      jsonResponse(201, { accessToken: "access-renovado", refreshToken: "refresh-renovado" }),
    );
    // 3) reintento del request original, ahora con el token renovado → éxito
    fetchMock.mockResolvedValueOnce(jsonResponse(201, { id: "sale-2" }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await syncRequest("/sales", { foo: "bar" });
    expect(result).toEqual({ kind: "success", status: 201, body: { id: "sale-2" } });

    // El tercer fetch (el reintento) debe llevar el header con el token NUEVO.
    const thirdCallHeaders = fetchMock.mock.calls[2][1].headers as Record<string, string>;
    expect(thirdCallHeaders.Authorization).toBe("Bearer access-renovado");
  });

  it("401 y el refresh también falla con 401 (sesión revocada): session-revoked", async () => {
    const fetchMock = vi.fn();
    fetchMock.mockResolvedValueOnce(jsonResponse(401, {})); // request original
    fetchMock.mockResolvedValueOnce(jsonResponse(401, { message: "Refresh token inválido o expirado" })); // /auth/refresh
    vi.stubGlobal("fetch", fetchMock);

    const result = await syncRequest("/sales", {});
    expect(result).toEqual({ kind: "session-revoked" });
  });

  it("401 y el refresh falla por red: transient-error, no se confunde con revocación real", async () => {
    const fetchMock = vi.fn();
    fetchMock.mockResolvedValueOnce(jsonResponse(401, {}));
    fetchMock.mockRejectedValueOnce(new Error("sin red"));
    vi.stubGlobal("fetch", fetchMock);

    const result = await syncRequest("/sales", {});
    expect(result.kind).toBe("transient-error");
  });
});
