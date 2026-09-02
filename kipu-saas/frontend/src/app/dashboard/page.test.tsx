import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import DashboardPage from "./page";
import { getLocalDb, resetLocalDbCache } from "@/lib/offline/db";
import { createSaleOffline } from "@/lib/offline/sales-repo";
import { uniqueOrgId } from "@/lib/offline/test-support/unique";

/**
 * Offline 4.15 (rediseño Stitch) — Dashboard.
 *
 * Verifica lo que realmente cambió: se conservan los 13 indicadores reales
 * de `/organizations/me/dashboard` (ninguno se quitó ni se inventó), el
 * gráfico de tendencia usa un endpoint REAL ya existente
 * (`/reports/sales-by-date`, Fase Comercial 7 — no un endpoint nuevo) y
 * degrada con gracia si el usuario no tiene el permiso `reports.read`, y
 * las alertas están atadas a datos reales (`lowStockProducts` del backend,
 * ventas locales en conflicto/error desde Dexie) — nunca a las alertas
 * inventadas de Stitch ("Offline Data Synced", "System Update").
 */

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  usePathname: () => "/dashboard",
}));

let mockOrganization: { id: string; name: string } = { id: "org-dash", name: "Quirquiña Fit" };
const mockUser = { id: "user-1", name: "Mauricio", email: "mau@quirquina.test" };
vi.mock("@/lib/auth-context", () => ({
  useAuth: () => ({ user: mockUser, organization: mockOrganization, loading: false, logout: vi.fn() }),
  ApiError: class ApiError extends Error {
    status: number;
    constructor(status: number, message: string) {
      super(message);
      this.status = status;
    }
  },
}));

const SUMMARY = {
  salesToday: { count: 3, total: "150.00" },
  salesMonth: { count: 40, total: "4200.00" },
  purchasesMonth: { count: 5, total: "900.00" },
  incomeMonth: "3800.00",
  expensesMonth: "600.00",
  invoicesIssued: 12,
  customersServed: 25,
  productsActive: 87,
  lowStockProducts: 0,
  pendingReceivables: { count: 2, total: "300.00" },
  pendingPayables: { count: 1, total: "175.00" },
  stockValue: "9800.00",
  topProducts: [{ productId: "p1", product: { name: "Ensalada de quinua", sku: "ENS-001" }, quantity: "8", total: "325.00" }],
  grossMargin: { available: false, reason: "Costo promedio no implementado todavía" },
};

// Cada monto es deliberadamente distinto de los demás (incluido el de TREND):
// varios indicadores muestran cifras en el mismo formato "Bs. X.XX", y un
// valor repetido entre dos tarjetas reales generaría un falso "duplicado" en
// las aserciones de texto — no un bug de la app.
const TREND = {
  rows: [
    { date: new Date().toISOString().slice(0, 10), total: "220.00", salesCount: 3 },
  ],
};

function jsonResponse(status: number, body: unknown) {
  return Promise.resolve(
    new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } }),
  );
}

/** `AppShell` (siempre presente, envuelve la página) pide esto en su propio efecto — sin este caso, cualquier stub de fetch de esta suite lo rechaza como "URL inesperada". */
function withUnreadCount(url: string): Promise<Response> | undefined {
  if (url.includes("/notifications/unread-count")) return jsonResponse(200, { count: 0 });
  return undefined;
}

function stubFetch(trendStatus: 200 | 403 = 200) {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockImplementation((input: RequestInfo | URL) => {
      const url = String(input);
      const unread = withUnreadCount(url);
      if (unread) return unread;
      if (url.endsWith("/organizations/me/dashboard")) return jsonResponse(200, SUMMARY);
      if (url.includes("/reports/sales-by-date")) {
        return trendStatus === 200 ? jsonResponse(200, TREND) : jsonResponse(403, { message: "Permiso requerido: reports.read" });
      }
      return Promise.reject(new Error(`URL inesperada en el stub: ${url}`));
    }),
  );
}

beforeEach(() => {
  resetLocalDbCache();
  mockOrganization = { id: uniqueOrgId(), name: "Quirquiña Fit" };
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe("Dashboard (Offline 4.15)", () => {
  it("conserva los 13 indicadores reales, sin quitar ni inventar ninguno", async () => {
    stubFetch();
    render(<DashboardPage />);

    await screen.findByText("Bs. 150.00"); // ventas hoy
    expect(screen.getByText("Bs. 4200.00")).toBeInTheDocument(); // ventas del mes
    expect(screen.getByText("Bs. 900.00")).toBeInTheDocument(); // compras del mes
    expect(screen.getByText("Bs. 3800.00")).toBeInTheDocument(); // ingresos caja
    expect(screen.getByText("Bs. 600.00")).toBeInTheDocument(); // egresos caja
    expect(screen.getByText("No disponible")).toBeInTheDocument(); // utilidad comercial
    expect(screen.getByText("Bs. 300.00")).toBeInTheDocument(); // cuentas por cobrar
    expect(screen.getByText("Bs. 175.00")).toBeInTheDocument(); // cuentas por pagar
    expect(screen.getByText("Bs. 9800.00")).toBeInTheDocument(); // valor de inventario
    expect(screen.getByText("12")).toBeInTheDocument(); // facturas emitidas
    expect(screen.getByText("25")).toBeInTheDocument(); // clientes atendidos
    expect(screen.getByText("87")).toBeInTheDocument(); // productos activos
    expect(screen.getByText("Stock bajo")).toBeInTheDocument();
  });

  it("el gráfico de tendencia usa el endpoint REAL /reports/sales-by-date, no datos inventados", async () => {
    const fetchSpy = vi.fn().mockImplementation((input: RequestInfo | URL) => {
      const url = String(input);
      const unread = withUnreadCount(url);
      if (unread) return unread;
      if (url.endsWith("/organizations/me/dashboard")) return jsonResponse(200, SUMMARY);
      if (url.includes("/reports/sales-by-date")) return jsonResponse(200, TREND);
      return Promise.reject(new Error(`URL inesperada: ${url}`));
    });
    vi.stubGlobal("fetch", fetchSpy);

    render(<DashboardPage />);
    await screen.findByText("Ventas de los últimos 7 días");

    await waitFor(() => {
      const calledSalesByDate = fetchSpy.mock.calls.some((c) => String(c[0]).includes("/reports/sales-by-date"));
      expect(calledSalesByDate).toBe(true);
    });
    // El pico mostrado sale del dato real devuelto (Bs. 220.00), no un valor fijo.
    await waitFor(() => expect(screen.getByText("Pico: Bs. 220.00")).toBeInTheDocument());
  });

  it("sin permiso reports.read (403), NO se ve como un error — el resto del panel sigue funcionando", async () => {
    stubFetch(403);
    render(<DashboardPage />);

    await screen.findByText("Bs. 150.00"); // el resumen principal sí cargó
    await waitFor(() =>
      expect(screen.getByText("No tenés permiso para ver la tendencia de ventas.")).toBeInTheDocument(),
    );
    // Nunca un ErrorState genérico tapando todo el panel por esto.
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("alerta de stock bajo SOLO aparece si el dato real (lowStockProducts) es mayor a cero", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation((input: RequestInfo | URL) => {
        const url = String(input);
        const unread = withUnreadCount(url);
        if (unread) return unread;
        if (url.endsWith("/organizations/me/dashboard")) return jsonResponse(200, { ...SUMMARY, lowStockProducts: 3 });
        if (url.includes("/reports/sales-by-date")) return jsonResponse(200, TREND);
        return Promise.reject(new Error("URL inesperada"));
      }),
    );
    render(<DashboardPage />);
    expect(await screen.findByText("3 productos por debajo del mínimo.")).toBeInTheDocument();
    // "Stock bajo" aparece dos veces a propósito: el indicador (StatCard,
    // siempre presente) y el título de la alerta (AlertRow, solo cuando
    // lowStockProducts > 0) — ambas atadas al mismo dato real, no un
    // duplicado accidental.
    expect(screen.getAllByText("Stock bajo")).toHaveLength(2);
  });

  it("sin alertas reales, muestra el mensaje tranquilizador — nunca 'Offline Data Synced'/'System Update' inventados", async () => {
    stubFetch();
    render(<DashboardPage />);
    await screen.findByText("Bs. 150.00");
    await waitFor(() => expect(screen.getByText("Sin alertas pendientes.")).toBeInTheDocument());
    expect(screen.queryByText(/system update/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/offline data synced/i)).not.toBeInTheDocument();
  });

  it("una venta local en conflicto/error dispara la alerta real de 'ventas locales pendientes de revisar'", async () => {
    stubFetch();
    const orgId = mockOrganization!.id;
    const db = getLocalDb(orgId);
    const sale = await createSaleOffline(db, {
      organizationId: orgId,
      posTerminalId: "pt1",
      warehouseId: "wh1",
      customerId: null,
      discount: "0",
      items: [{ productId: "p1", quantity: "1", unitPrice: "10", discount: "0" }],
    });
    // Fuerza el estado a error simulando reintentos agotados (mismo patrón que ya usa page.test.tsx del POS).
    await db.syncQueue
      .where("id")
      .equals(sale.createSyncOperationId)
      .modify({ status: "FAILED", attempts: 999, error: "Error de validación permanente" });

    render(<DashboardPage />);
    await screen.findByText("Bs. 150.00");
    await waitFor(() =>
      expect(screen.getByText("Ventas locales pendientes de revisar")).toBeInTheDocument(),
    );
    expect(screen.getByText(/1 venta de este dispositivo/)).toBeInTheDocument();
  });

  it("mantiene la tabla de productos más vendidos, sin quitarla", async () => {
    stubFetch();
    render(<DashboardPage />);
    await screen.findByText("Productos más vendidos del mes");
    expect(await screen.findByText("Ensalada de quinua")).toBeInTheDocument();
  });

  it("un error al cargar el resumen principal SÍ se muestra como error real", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation((input: RequestInfo | URL) => {
        const url = String(input);
        const unread = withUnreadCount(url);
        if (unread) return unread;
        return jsonResponse(500, { message: "Falla interna" });
      }),
    );
    render(<DashboardPage />);
    expect(await screen.findByRole("alert")).toHaveTextContent("Falla interna");
  });
});
