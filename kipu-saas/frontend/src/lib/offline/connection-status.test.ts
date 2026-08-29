import { beforeEach, describe, expect, it } from "vitest";
import { connectionStatus } from "./connection-status";

describe("Connection status — única fuente de verdad del estado de conexión/sync", () => {
  beforeEach(() => {
    connectionStatus.setSyncing(false);
    connectionStatus.setPendingCount(0);
    connectionStatus.setBlockingError(false);
  });

  it("por defecto, sin pendientes ni errores, el estado es ONLINE", () => {
    expect(connectionStatus.getState()).toBe("ONLINE");
  });

  it("mientras el Sync Engine procesa, el estado es SYNCING (gana sobre PENDING)", () => {
    connectionStatus.setPendingCount(3);
    connectionStatus.setSyncing(true);
    expect(connectionStatus.getState()).toBe("SYNCING");
  });

  it("hay operaciones en cola pero el engine no está corriendo ahora → PENDING", () => {
    connectionStatus.setPendingCount(2);
    expect(connectionStatus.getState()).toBe("PENDING");
  });

  it("un error que necesita atención humana (CONFLICT) → ERROR", () => {
    connectionStatus.setBlockingError(true);
    expect(connectionStatus.getState()).toBe("ERROR");
  });

  it("notifica a los suscriptores solo cuando el estado realmente cambia", () => {
    const seen: string[] = [];
    const unsubscribe = connectionStatus.onChange((s) => seen.push(s));

    connectionStatus.setPendingCount(1); // ONLINE -> PENDING
    connectionStatus.setPendingCount(1); // sigue PENDING, no debería notificar de nuevo
    connectionStatus.setPendingCount(5); // sigue PENDING (mismo estado derivado)
    connectionStatus.setSyncing(true); // PENDING -> SYNCING

    unsubscribe();
    connectionStatus.setSyncing(false); // ya no debería verse

    expect(seen).toEqual(["PENDING", "SYNCING"]);
  });
});
