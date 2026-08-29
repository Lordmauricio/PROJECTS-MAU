import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import AppShell from "./AppShell";
import { getLocalDb, resetLocalDbCache } from "@/lib/offline/db";
import { enqueue } from "@/lib/offline/sync-queue";
import { uniqueOrgId } from "@/lib/offline/test-support/unique";

// Mocks controlados de las dos fronteras externas que AppShell no puede
// evitar tocar: next/navigation (router/pathname) y useAuth() — instrucción
// explícita de la fase de no modificar la lógica real de auth de Offline
// 4.1, solo controlar lo que devuelve.
const routerReplace = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: routerReplace }),
  usePathname: () => "/sales/pos",
}));

const mockLogout = vi.fn();
let mockOrganization: { id: string; name: string } | null = null;
vi.mock("@/lib/auth-context", () => ({
  useAuth: () => ({
    user: { id: "user-1", name: "Ana Cajera", email: "ana@negocio.test" },
    organization: mockOrganization,
    loading: false,
    logout: mockLogout,
  }),
}));

describe("AppShell — menú responsive (mobile)", () => {
  beforeEach(() => {
    resetLocalDbCache();
    mockOrganization = { id: uniqueOrgId(), name: "Mi Negocio" };
    mockLogout.mockClear();
    routerReplace.mockClear();
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation((url: string) =>
        url.includes("/notifications/unread-count")
          ? Promise.resolve(new Response(JSON.stringify({ count: 0 }), { status: 200 }))
          : Promise.reject(new Error("sin red (test)")),
      ),
    );
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("estado inicial: el menú off-canvas está cerrado (no hay overlay ni aside móvil en el DOM)", () => {
    render(<AppShell>contenido</AppShell>);
    expect(screen.queryByLabelText("Abrir menú")).toBeInTheDocument();
    // El botón de cerrar sesión existe DOS veces cuando el menú móvil está
    // abierto (sidebar fijo + off-canvas comparten `navContent`) — cerrado,
    // debe existir una sola vez.
    expect(screen.getAllByRole("button", { name: "Cerrar sesión" })).toHaveLength(1);
  });

  it("abrir el menú: click en la hamburguesa muestra la navegación off-canvas", async () => {
    const user = userEvent.setup();
    render(<AppShell>contenido</AppShell>);

    const hamburger = screen.getByLabelText("Abrir menú");
    expect(hamburger).toHaveAttribute("aria-expanded", "false");
    await user.click(hamburger);
    expect(hamburger).toHaveAttribute("aria-expanded", "true");

    // Con el menú abierto, "Cerrar sesión" aparece dos veces (sidebar
    // fijo + off-canvas) — confirma que el panel realmente se montó.
    expect(screen.getAllByRole("button", { name: "Cerrar sesión" })).toHaveLength(2);
  });

  it("navegar: click en un link del menú móvil lo cierra (no deja el overlay pegado tras navegar)", async () => {
    const user = userEvent.setup();
    render(<AppShell>contenido</AppShell>);

    await user.click(screen.getByLabelText("Abrir menú"));
    expect(screen.getAllByRole("button", { name: "Cerrar sesión" })).toHaveLength(2);

    // Hay dos links "POS" (sidebar fijo + off-canvas) — el del panel
    // off-canvas es el que hay que clickear para probar el cierre.
    const posLinks = screen.getAllByRole("link", { name: "POS" });
    await user.click(posLinks[posLinks.length - 1]);

    await waitFor(() =>
      expect(screen.getAllByRole("button", { name: "Cerrar sesión" })).toHaveLength(1),
    );
  });

  it("cerrar con el fondo (backdrop): click fuera del panel también cierra el menú", async () => {
    const user = userEvent.setup();
    const { container } = render(<AppShell>contenido</AppShell>);

    await user.click(screen.getByLabelText("Abrir menú"));
    expect(screen.getAllByRole("button", { name: "Cerrar sesión" })).toHaveLength(2);

    const backdrop = container.querySelector('[aria-hidden="true"].fixed.inset-0');
    expect(backdrop).not.toBeNull();
    await user.click(backdrop as Element);

    await waitFor(() =>
      expect(screen.getAllByRole("button", { name: "Cerrar sesión" })).toHaveLength(1),
    );
  });
});

describe("AppShell — logout con operaciones pendientes (nunca las borra en silencio)", () => {
  beforeEach(() => {
    resetLocalDbCache();
    mockOrganization = { id: uniqueOrgId(), name: "Mi Negocio" };
    mockLogout.mockClear();
    routerReplace.mockClear();
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation((url: string) =>
        url.includes("/notifications/unread-count")
          ? Promise.resolve(new Response(JSON.stringify({ count: 0 }), { status: 200 }))
          : Promise.reject(new Error("sin red (test)")),
      ),
    );
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  async function seedPendingOperation() {
    const db = getLocalDb(mockOrganization!.id);
    await enqueue(db, {
      organizationId: mockOrganization!.id,
      operation: "sales.create",
      entity: "Sale",
      entityId: "local-sale-pendiente",
      idempotencyKey: "idem-pendiente",
      path: "/sales",
      payload: {},
    });
  }

  it("sin operaciones pendientes: logout ocurre directo, sin preguntar nada", async () => {
    const user = userEvent.setup();
    const confirmSpy = vi.spyOn(window, "confirm");
    render(<AppShell>contenido</AppShell>);

    await user.click(screen.getByRole("button", { name: "Cerrar sesión" }));

    await waitFor(() => expect(mockLogout).toHaveBeenCalledTimes(1));
    expect(confirmSpy).not.toHaveBeenCalled();
  });

  it("con pendientes: aparece la advertencia; CANCELAR realmente evita el logout (sigue en la app)", async () => {
    await seedPendingOperation();
    const user = userEvent.setup();
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(false);
    render(<AppShell>contenido</AppShell>);

    await user.click(screen.getByRole("button", { name: "Cerrar sesión" }));

    await waitFor(() => expect(confirmSpy).toHaveBeenCalledTimes(1));
    expect(confirmSpy.mock.calls[0][0]).toContain("1 operación sin sincronizar");
    // Cancelar de verdad evita el logout — no navega, no limpia sesión.
    expect(mockLogout).not.toHaveBeenCalled();

    // La operación pendiente NO se tocó por haber preguntado.
    const db = getLocalDb(mockOrganization!.id);
    expect(await db.syncQueue.count()).toBe(1);
  });

  it("con pendientes: CONFIRMAR sí hace logout (comportamiento aprobado en Offline 2/3)", async () => {
    await seedPendingOperation();
    const user = userEvent.setup();
    vi.spyOn(window, "confirm").mockReturnValue(true);
    render(<AppShell>contenido</AppShell>);

    await user.click(screen.getByRole("button", { name: "Cerrar sesión" }));

    await waitFor(() => expect(mockLogout).toHaveBeenCalledTimes(1));
    // El logout no borra la cola — sigue ahí para la próxima sesión.
    const db = getLocalDb(mockOrganization!.id);
    expect(await db.syncQueue.count()).toBe(1);
  });
});
