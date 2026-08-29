import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import ConnectionBadge from "./ConnectionBadge";
import { connectionStatus } from "@/lib/offline/connection-status";
import { getLocalDb, resetLocalDbCache } from "@/lib/offline/db";
import { enqueue } from "@/lib/offline/sync-queue";
import { uniqueOrgId } from "@/lib/offline/test-support/unique";

// `useLocalDb()` (usado internamente por `ConnectionBadge` para el conteo
// de pendientes) lee `useAuth().organization` — se mockea acá de forma
// controlada (instrucción explícita de la fase), nunca la lógica real de
// autenticación de Offline 4.1.
let mockOrganization: { id: string; name: string } | null = null;
vi.mock("@/lib/auth-context", () => ({
  useAuth: () => ({ organization: mockOrganization }),
}));

// `connectionStatus` (singleton, ver `connection-status.ts`) solo
// recalcula su estado ante un evento `online`/`offline` REAL del
// navegador — mutar `navigator.onLine` a mano no alcanza, hay que
// disparar el evento correspondiente para que su propio listener lo note
// (igual que ocurriría con una desconexión real).
function setOnline(value: boolean) {
  Object.defineProperty(window.navigator, "onLine", { value, configurable: true, writable: true });
  window.dispatchEvent(new Event(value ? "online" : "offline"));
}

describe("ConnectionBadge — los 5 estados reales, con símbolo + texto accesibles (nunca solo color)", () => {
  beforeEach(() => {
    resetLocalDbCache();
    mockOrganization = null;
    setOnline(true);
    connectionStatus.setSyncing(false);
    connectionStatus.setPendingCount(0);
    connectionStatus.setBlockingError(false);
  });
  afterEach(() => {
    setOnline(true);
    connectionStatus.setSyncing(false);
    connectionStatus.setPendingCount(0);
    connectionStatus.setBlockingError(false);
  });

  it("ONLINE: símbolo ●, texto 'En línea', accesible vía role=status", () => {
    render(<ConnectionBadge />);
    const status = screen.getByRole("status");
    expect(status).toHaveAttribute("aria-live", "polite");
    expect(status).toHaveTextContent("En línea");
    expect(status).toHaveTextContent("●");
  });

  it("OFFLINE: símbolo ▲, texto 'Sin conexión' — gana sobre cualquier otra señal", () => {
    setOnline(false);
    render(<ConnectionBadge />);
    const status = screen.getByRole("status");
    expect(status).toHaveTextContent("Sin conexión");
    expect(status).toHaveTextContent("▲");
  });

  it("SYNCING: símbolo ↻, texto 'Sincronizando…'", () => {
    connectionStatus.setSyncing(true);
    render(<ConnectionBadge />);
    const status = screen.getByRole("status");
    expect(status).toHaveTextContent("Sincronizando…");
    expect(status).toHaveTextContent("↻");
  });

  it("ERROR: símbolo ✕, texto 'Error de sincronización'", () => {
    connectionStatus.setBlockingError(true);
    render(<ConnectionBadge />);
    const status = screen.getByRole("status");
    expect(status).toHaveTextContent("Error de sincronización");
    expect(status).toHaveTextContent("✕");
  });

  it("PENDING: símbolo ●, texto con la cantidad REAL de operaciones en cola (no solo un color de aviso)", async () => {
    const org = uniqueOrgId();
    mockOrganization = { id: org, name: "Negocio de prueba" };
    const db = getLocalDb(org);
    await enqueue(db, {
      organizationId: org,
      operation: "sales.create",
      entity: "Sale",
      entityId: "local-sale-1",
      idempotencyKey: "idem-1",
      path: "/sales",
      payload: {},
    });
    await enqueue(db, {
      organizationId: org,
      operation: "sales.create",
      entity: "Sale",
      entityId: "local-sale-2",
      idempotencyKey: "idem-2",
      path: "/sales",
      payload: {},
    });
    connectionStatus.setPendingCount(2);

    render(<ConnectionBadge />);
    const status = screen.getByRole("status");
    await waitFor(() => expect(status).toHaveTextContent("2 operaciones pendientes"));
    expect(status).toHaveTextContent("●");
  });

  it("modo compacto (AppShell): el símbolo sigue siendo visible, el texto pasa a sr-only pero SIGUE en el DOM (accesible)", () => {
    connectionStatus.setBlockingError(true);
    render(<ConnectionBadge compact />);
    const status = screen.getByRole("status");
    // El texto completo sigue existiendo para lectores de pantalla —
    // "compacto" es una decisión visual, nunca una pérdida de información.
    expect(status).toHaveTextContent("Error de sincronización");
  });
});
