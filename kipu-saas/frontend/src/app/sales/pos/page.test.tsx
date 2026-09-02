import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import POSPage from "./page";
import { getLocalDb, resetLocalDbCache } from "@/lib/offline/db";
import { uniqueOrgId } from "@/lib/offline/test-support/unique";
import type { LocalOrgContext, LocalProduct, LocalCustomer } from "@/lib/offline/types";

// ── Mocks controlados de las fronteras externas (instrucción explícita de
// la fase: mockear useAuth() de forma controlada, next/navigation porque
// AppShell lo necesita, y `fetch` — nunca la lógica real de pos-cart.ts/
// pos-submit.ts/sale-sync-state.ts, que se ejercitan tal cual existen. ──
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  usePathname: () => "/sales/pos",
}));

let mockOrg: { id: string; name: string };
const mockUser = { id: "user-1", name: "Ana Cajera", email: "ana@negocio.test" };
vi.mock("@/lib/auth-context", () => ({
  useAuth: () => ({ user: mockUser, organization: mockOrg, loading: false, logout: vi.fn() }),
}));


function jsonResponse(status: number, body: unknown) {
  return new Response(JSON.stringify(body), { status });
}

/** Stub de fetch para todo lo que NO es la venta bajo prueba (poll de notificaciones de AppShell, catálogo si algo lo pidiera). */
function baseFetchStub(url: string): Promise<Response> {
  if (url.includes("/notifications/unread-count")) {
    return Promise.resolve(jsonResponse(200, { count: 0 }));
  }
  return Promise.reject(new Error(`URL inesperada en el stub base: ${url}`));
}

const PRODUCT_A: LocalProduct = {
  id: "prod-coca",
  organizationId: "",
  name: "Coca Cola 2L",
  sku: "COCA",
  barcode: null,
  price: "15.00",
  active: true,
  updatedAt: new Date().toISOString(),
  cachedAt: new Date().toISOString(),
};
const PRODUCT_B: LocalProduct = {
  id: "prod-pan",
  organizationId: "",
  name: "Pan integral",
  sku: "PAN",
  barcode: null,
  price: "8.50",
  active: true,
  updatedAt: new Date().toISOString(),
  cachedAt: new Date().toISOString(),
};
const CUSTOMER_A: LocalCustomer = {
  id: "cust-1",
  organizationId: "",
  name: "Juan Pérez",
  documentType: "CI",
  documentNumber: "123456",
  phone: null,
  email: null,
  active: true,
  updatedAt: new Date().toISOString(),
  cachedAt: new Date().toISOString(),
};

/**
 * Precarga la base local con catálogo + contexto de sucursal YA
 * descargados (simula un dispositivo que ya sincronizó alguna vez) —
 * `navigator.onLine = false` además evita que el efecto de arranque del
 * POS intente una descarga real, así que el render es 100% determinista
 * sin necesitar mockear `runFullInitialSync`/`GET /products` en cada
 * test (esa función ya tiene su propia cobertura en `catalog-sync.test.ts`).
 */
async function seedCatalog(orgId: string) {
  const db = getLocalDb(orgId);
  await db.products.bulkAdd([
    { ...PRODUCT_A, organizationId: orgId },
    { ...PRODUCT_B, organizationId: orgId },
  ]);
  await db.customers.add({ ...CUSTOMER_A, organizationId: orgId });
  const context: LocalOrgContext = {
    organizationId: orgId,
    organizationName: "Mi Negocio",
    businessLegalName: "Mi Negocio SRL",
    businessNit: "123456789",
    businessAddress: null,
    businessPhone: null,
    businessLogoUrl: null,
    branchId: "branch-1",
    branchName: "Sucursal Centro",
    branchAddress: null,
    warehouseId: "wh-1",
    posTerminalId: "pos-1",
    posTerminalName: "Caja 1",
    posTerminalCode: "POS-01",
    userId: mockUser.id,
    userName: mockUser.name,
    roleKey: "OWNER",
    fetchedAt: new Date().toISOString(),
  };
  await db.orgContext.put(context);
  return db;
}

/**
 * El total ("Bs. X.XX") puede coincidir textualmente con el precio de un
 * producto en la lista (ej. un solo ítem al precio de lista) — se escoge
 * el valor específicamente de la fila "Total" (etiqueta + monto en el
 * mismo contenedor), nunca por posición/índice en la lista de matches.
 */
function getTotalText(): string {
  const totalLabel = screen.getByText("Total");
  const totalRow = totalLabel.parentElement!;
  return within(totalRow).getByText(/^Bs\. /).textContent!;
}

function setOffline() {
  Object.defineProperty(window.navigator, "onLine", { value: false, configurable: true });
}
function setOnline() {
  Object.defineProperty(window.navigator, "onLine", { value: true, configurable: true });
}

async function renderPosWithCatalog() {
  const orgId = uniqueOrgId();
  mockOrg = { id: orgId, name: "Mi Negocio" };
  setOffline(); // el catálogo ya está precargado; sin esto el bootstrap intentaría un GET real
  await seedCatalog(orgId);
  render(<POSPage />);
  await screen.findByText("Coca Cola 2L");
  return orgId;
}

beforeEach(() => {
  resetLocalDbCache();
  vi.stubGlobal("fetch", vi.fn().mockImplementation(baseFetchStub));
});
afterEach(() => {
  vi.unstubAllGlobals();
  setOnline();
});

describe("POS — catálogo y carrito (interacción real DOM → handler → estado → UI)", () => {
  it("renderiza el POS y muestra los productos cacheados localmente", async () => {
    await renderPosWithCatalog();
    expect(screen.getByText("Coca Cola 2L")).toBeInTheDocument();
    expect(screen.getByText("Pan integral")).toBeInTheDocument();
  });

  it("click en un producto lo agrega al carrito con cantidad 1 y actualiza el total visible", async () => {
    const user = userEvent.setup();
    await renderPosWithCatalog();

    await user.click(screen.getByRole("button", { name: /Coca Cola 2L/ }));

    expect(screen.getByLabelText("Cantidad de Coca Cola 2L")).toHaveValue(1);
    expect(getTotalText()).toBe("Bs. 15.00");
  });

  it("click en el MISMO producto de nuevo aumenta la cantidad (no duplica la línea)", async () => {
    const user = userEvent.setup();
    await renderPosWithCatalog();

    const productButton = screen.getByRole("button", { name: /Coca Cola 2L/ });
    await user.click(productButton);
    await user.click(productButton);

    expect(screen.getByLabelText("Cantidad de Coca Cola 2L")).toHaveValue(2);
    expect(getTotalText()).toBe("Bs. 30.00");
  });

  it("editar la cantidad a mano recalcula el total (usuario aumenta y disminuye)", async () => {
    const user = userEvent.setup();
    await renderPosWithCatalog();
    await user.click(screen.getByRole("button", { name: /Coca Cola 2L/ }));

    const qtyInput = screen.getByLabelText("Cantidad de Coca Cola 2L");
    fireEventChange(qtyInput, "5");
    expect(getTotalText()).toBe("Bs. 75.00"); // aumentó

    fireEventChange(qtyInput, "2");
    expect(getTotalText()).toBe("Bs. 30.00"); // disminuyó
  });

  it("quitar un producto del carrito lo saca de la lista y el total vuelve a Bs. 0.00", async () => {
    const user = userEvent.setup();
    await renderPosWithCatalog();
    await user.click(screen.getByRole("button", { name: /Coca Cola 2L/ }));
    expect(screen.getByLabelText("Cantidad de Coca Cola 2L")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Quitar" }));

    expect(screen.queryByLabelText("Cantidad de Coca Cola 2L")).not.toBeInTheDocument();
    expect(screen.getByText("Agregá productos desde la lista")).toBeInTheDocument();
    expect(getTotalText()).toBe("Bs. 0.00");
  });

  it("dos productos distintos en el carrito: el total suma ambas líneas", async () => {
    const user = userEvent.setup();
    await renderPosWithCatalog();
    await user.click(screen.getByRole("button", { name: /Coca Cola 2L/ }));
    await user.click(screen.getByRole("button", { name: /Pan integral/ }));

    expect(getTotalText()).toBe("Bs. 23.50"); // 15.00 + 8.50
  });
});

describe("POS — pagos (formulario real, no la función pura)", () => {
  it("agregar una línea de pago la muestra, con método y monto editables", async () => {
    const user = userEvent.setup();
    await renderPosWithCatalog();
    await user.click(screen.getByRole("button", { name: /Coca Cola 2L/ }));

    await user.click(screen.getByRole("button", { name: "+ método" }));

    const methodSelect = screen.getByLabelText("Método de pago");
    expect(methodSelect).toHaveValue("CASH");
    const amountInput = screen.getByLabelText("Monto");
    expect(amountInput).toBeInTheDocument();
  });

  it("cambiar el método de pago se refleja en el select", async () => {
    const user = userEvent.setup();
    await renderPosWithCatalog();
    await user.click(screen.getByRole("button", { name: /Coca Cola 2L/ }));
    await user.click(screen.getByRole("button", { name: "+ método" }));

    await user.selectOptions(screen.getByLabelText("Método de pago"), "CARD");
    expect(screen.getByLabelText("Método de pago")).toHaveValue("CARD");
  });

  it("escribir un monto actualiza 'Pagado: Bs. X de Bs. Y' en tiempo real", async () => {
    const user = userEvent.setup();
    await renderPosWithCatalog();
    await user.click(screen.getByRole("button", { name: /Coca Cola 2L/ })); // total 15.00
    await user.click(screen.getByRole("button", { name: "+ método" }));

    fireEventChange(screen.getByLabelText("Monto"), "10");
    expect(screen.getByText("Pagado: Bs. 10.00 de Bs. 15.00")).toBeInTheDocument();
  });

  it("quitar una línea de pago la elimina del formulario (sin tocar la línea del carrito, que tiene su propio 'Quitar')", async () => {
    const user = userEvent.setup();
    await renderPosWithCatalog();
    await user.click(screen.getByRole("button", { name: /Coca Cola 2L/ }));
    await user.click(screen.getByRole("button", { name: "+ método" }));
    expect(screen.getByLabelText("Método de pago")).toBeInTheDocument();

    // Hay dos botones "Quitar" en pantalla: el de la línea del carrito
    // (primero, en el orden del documento) y el de la línea de pago
    // (segundo) — se quita el de pago, sin afectar el carrito.
    const quitarButtons = screen.getAllByRole("button", { name: "Quitar" });
    expect(quitarButtons).toHaveLength(2);
    await user.click(quitarButtons[1]);

    expect(screen.queryByLabelText("Método de pago")).not.toBeInTheDocument();
    expect(screen.getByLabelText("Cantidad de Coca Cola 2L")).toBeInTheDocument(); // el carrito sigue intacto
  });

  it("botón 'Confirmar venta': deshabilitado con el carrito vacío, habilitado con productos", async () => {
    // Offline 4.15: el carrito vive en un bottom sheet que arranca cerrado
    // (comportamiento nuevo, real, no un detalle de implementación) — la
    // barra "Ver carrito" sigue disponible con el carrito vacío, así que se
    // abre a mano para poder ver el botón "Confirmar venta" deshabilitado
    // antes de agregar nada.
    const user = userEvent.setup();
    await renderPosWithCatalog();

    await user.click(screen.getByRole("button", { name: /Ver carrito/ }));
    expect(screen.getByRole("button", { name: "Confirmar venta" })).toBeDisabled();
    await user.click(screen.getByRole("button", { name: /Coca Cola 2L/ }));
    expect(screen.getByRole("button", { name: "Confirmar venta" })).toBeEnabled();
  });
});

describe("POS — confirmar venta: los cuatro desenlaces reales de pos-submit.ts", () => {
  it("A) SINCRONIZADA: fetch responde 201 en create+confirm → mensaje de éxito con el resumen real del servidor", async () => {
    const user = userEvent.setup();
    await renderPosWithCatalog();
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation((url: string) => {
        if (url.endsWith("/sales")) return Promise.resolve(jsonResponse(201, { id: "server-sale-1" }));
        if (url.includes("/confirm")) {
          return Promise.resolve(
            jsonResponse(201, { id: "server-sale-1", status: "PAID", total: "15.00", paidTotal: "15.00", balance: "0.00" }),
          );
        }
        return baseFetchStub(url);
      }),
    );

    await user.click(screen.getByRole("button", { name: /Coca Cola 2L/ }));
    await user.click(screen.getByRole("button", { name: "Confirmar venta" }));

    await screen.findByText(/Venta confirmada \(PAID\)\. Total Bs\. 15\.00/);
    // El carrito se limpia tras una confirmación exitosa.
    expect(screen.getByText("Agregá productos desde la lista")).toBeInTheDocument();
  });

  it("B) OFFLINE-PENDING: sin red → 'Venta guardada sin conexión', nunca un error crudo", async () => {
    const user = userEvent.setup();
    await renderPosWithCatalog();
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("sin conexión")));

    await user.click(screen.getByRole("button", { name: /Coca Cola 2L/ }));
    await user.click(screen.getByRole("button", { name: "Confirmar venta" }));

    await screen.findByText(
      "Venta guardada sin conexión. Se sincronizará automáticamente cuando vuelva Internet.",
    );
  });

  it("C) CONFLICTO: create OK, confirm 409 → mensaje de conflicto visible, la venta queda en el historial", async () => {
    const user = userEvent.setup();
    const orgId = await renderPosWithCatalog();
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation((url: string) => {
        if (url.endsWith("/sales")) return Promise.resolve(jsonResponse(201, { id: "server-sale-2" }));
        if (url.includes("/confirm")) {
          return Promise.resolve(jsonResponse(409, { message: "Stock insuficiente" }));
        }
        return baseFetchStub(url);
      }),
    );

    await user.click(screen.getByRole("button", { name: /Coca Cola 2L/ }));
    await user.click(screen.getByRole("button", { name: "Confirmar venta" }));

    await screen.findByText("Stock insuficiente");

    // Queda visible en el historial como "Conflicto" — la venta NUNCA se pierde
    // (con una venta en atención, el panel ya se muestra sin necesidad de abrirlo).
    expect(screen.getByText("Conflicto")).toBeInTheDocument();

    const db = getLocalDb(orgId);
    expect(await db.sales.count()).toBe(1);
  });
});

describe("POS — desenlace ERROR e historial (sección 9.D, 10, 11)", () => {
  it("D) ERROR: una operación que agotó sus reintentos automáticos se ve como 'Error' en el historial, con reintento manual", async () => {
    const user = userEvent.setup();
    const orgId = uniqueOrgId();
    mockOrg = { id: orgId, name: "Mi Negocio" };
    setOffline();
    const db = await seedCatalog(orgId);

    // El desenlace "error" (a diferencia de synced/offline-pending/conflict)
    // requiere haber agotado MAX_AUTOMATIC_ATTEMPTS reintentos automáticos
    // (ver sale-sync-state.ts) — algo que UNA sola confirmación de venta
    // nunca alcanza a producir por sí sola (cada click intenta la operación
    // una única vez). Se reproduce el estado real directamente en la base
    // local, mismo criterio que ya usan los tests de Offline 2/3 para
    // simular un lock/backoff vencido sin usar timers falsos.
    const { createSaleOffline, confirmSaleOffline } = await import("@/lib/offline/sales-repo");
    const sale = await createSaleOffline(db, {
      organizationId: orgId,
      posTerminalId: "pos-1",
      warehouseId: "wh-1",
      items: [{ productId: "prod-coca", quantity: "1", unitPrice: "15.00", discount: "0" }],
    });
    await confirmSaleOffline(db, {
      localSaleId: sale.id,
      payments: [{ method: "CASH", amount: "15.00", idempotencyKey: "pago-error-1" }],
    });
    const updated = await db.sales.get(sale.id);
    await db.syncQueue.update(updated!.confirmSyncOperationId!, {
      status: "FAILED",
      attempts: 8,
      error: "Producto descontinuado",
    });

    // El mock de fetch se deja en su versión "exitosa" DESDE ANTES del
    // render, no recién antes del click de reintentar: `AppShell` dispara
    // su propio `useAutoSync()` al montar, que intenta sincronizar la cola
    // de inmediato — la operación `sales.create` (todavía PENDING, sin
    // relación con el estado "error" que se está probando) sincroniza sola
    // en ese primer pase. La operación `sales.confirm`, en cambio, con
    // `attempts >= MAX_AUTOMATIC_ATTEMPTS`, queda explícitamente EXCLUIDA
    // de cualquier reclamo automático (`sync-queue.ts#isDue`) — solo un
    // reintento MANUAL (`retryManually`, disparado por el botón) puede
    // recuperarla. Por eso el estado "Error" se mantiene estable hasta que
    // el usuario realmente clickea "Reintentar".
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation((url: string) => {
        if (url.endsWith("/sales")) return Promise.resolve(jsonResponse(201, { id: "server-sale-retry" }));
        if (url.includes("/confirm")) {
          return Promise.resolve(
            jsonResponse(201, { id: "server-sale-retry", status: "PAID", total: "15.00", paidTotal: "15.00", balance: "0.00" }),
          );
        }
        return baseFetchStub(url);
      }),
    );

    render(<POSPage />);
    await screen.findByText("Coca Cola 2L");

    // Con una venta en atención (error), el panel se muestra solo (mismo
    // comportamiento real de la pantalla: `historyOpen || attentionCount > 0`).
    expect(await screen.findByText("Producto descontinuado")).toBeInTheDocument();
    expect(screen.getByText("Error")).toBeInTheDocument();
    // HALLAZGO (documentado, no corregido — sección 24 del pedido): el
    // panel de historial se muestra automáticamente SOLO mientras hay algo
    // en atención (`historyOpen || attentionCount > 0`, ver page.tsx). Si
    // el usuario nunca lo abrió a mano, en el instante en que el reintento
    // tiene éxito `attentionCount` cae a 0 y el panel se OCULTA de nuevo
    // solo — el usuario podría no llegar a ver el "Sincronizada" que
    // confirma que el reintento funcionó. Para observar la transición real
    // acá se abre el panel a mano primero (`historyOpen = true`), que sí
    // lo mantiene visible después de resolverse el error.
    await user.click(screen.getByRole("button", { name: /Ventas de este dispositivo/ }));
    const retryButton = screen.getByRole("button", { name: "Reintentar" });

    // Sección 11: el botón está conectado de verdad — reintentar y que la
    // API responda bien debe reflejarse en la UI, no solo llamar a una función.
    await user.click(retryButton);

    await waitFor(() => expect(screen.getByText("Sincronizada")).toBeInTheDocument());
    expect(screen.queryByText("Producto descontinuado")).not.toBeInTheDocument();
  });

  it("historial: cerrado por defecto sin ventas en atención; click lo abre y muestra el contenido; click de nuevo lo cierra", async () => {
    const user = userEvent.setup();
    await renderPosWithCatalog();

    const toggle = screen.getByRole("button", { name: /Ventas de este dispositivo/ });
    expect(screen.queryByText("Todavía no se registró ninguna venta desde este dispositivo")).not.toBeInTheDocument();

    await user.click(toggle);
    expect(
      screen.getByText("Todavía no se registró ninguna venta desde este dispositivo"),
    ).toBeInTheDocument();

    await user.click(toggle);
    await waitFor(() =>
      expect(
        screen.queryByText("Todavía no se registró ninguna venta desde este dispositivo"),
      ).not.toBeInTheDocument(),
    );
  });
});

describe("POS — prueba fundamental de UI (sección 22): render → agregar producto → pagar → confirmar → resultado visible", () => {
  it("ONLINE: flujo completo termina con el mensaje de venta confirmada", async () => {
    const user = userEvent.setup();
    await renderPosWithCatalog();
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation((url: string) => {
        if (url.endsWith("/sales")) return Promise.resolve(jsonResponse(201, { id: "server-fundamental-1" }));
        if (url.includes("/confirm")) {
          return Promise.resolve(
            jsonResponse(201, { id: "server-fundamental-1", status: "PAID", total: "15.00", paidTotal: "15.00", balance: "0.00" }),
          );
        }
        return baseFetchStub(url);
      }),
    );

    await user.click(screen.getByRole("button", { name: /Coca Cola 2L/ }));
    await user.click(screen.getByRole("button", { name: "+ método" }));
    fireEventChange(screen.getByLabelText("Monto"), "15");
    await user.click(screen.getByRole("button", { name: "Confirmar venta" }));

    await screen.findByText(/Venta confirmada \(PAID\)/);
  });

  it("OFFLINE-PENDING: mismo flujo, sin red, termina con el mensaje de venta guardada localmente", async () => {
    const user = userEvent.setup();
    await renderPosWithCatalog();
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("sin conexión")));

    await user.click(screen.getByRole("button", { name: /Coca Cola 2L/ }));
    await user.click(screen.getByRole("button", { name: "Confirmar venta" }));

    await screen.findByText(/Venta guardada sin conexión/);
  });

  it("CONFLICT: mismo flujo, el servidor rechaza con 409, termina con el mensaje de conflicto", async () => {
    const user = userEvent.setup();
    await renderPosWithCatalog();
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation((url: string) => {
        if (url.endsWith("/sales")) return Promise.resolve(jsonResponse(201, { id: "server-fundamental-3" }));
        if (url.includes("/confirm")) return Promise.resolve(jsonResponse(409, { message: "idempotencyKey ya usada" }));
        return baseFetchStub(url);
      }),
    );

    await user.click(screen.getByRole("button", { name: /Coca Cola 2L/ }));
    await user.click(screen.getByRole("button", { name: "Confirmar venta" }));

    await screen.findByText("idempotencyKey ya usada");
  });

  it("ERROR: variante representada en el historial (agotados los reintentos), reintentar la recupera", async () => {
    const orgId = uniqueOrgId();
    mockOrg = { id: orgId, name: "Mi Negocio" };
    setOffline();
    const db = await seedCatalog(orgId);
    const { createSaleOffline, confirmSaleOffline } = await import("@/lib/offline/sales-repo");
    const sale = await createSaleOffline(db, {
      organizationId: orgId,
      posTerminalId: "pos-1",
      warehouseId: "wh-1",
      items: [{ productId: "prod-pan", quantity: "1", unitPrice: "8.50", discount: "0" }],
    });
    await confirmSaleOffline(db, {
      localSaleId: sale.id,
      payments: [{ method: "CASH", amount: "8.50", idempotencyKey: "pago-error-2" }],
    });
    const updated = await db.sales.get(sale.id);
    await db.syncQueue.update(updated!.confirmSyncOperationId!, {
      status: "FAILED",
      attempts: 8,
      error: "Error de validación permanente",
    });

    render(<POSPage />);
    expect(await screen.findByText("Error de validación permanente")).toBeInTheDocument();
    expect(screen.getByText("Error")).toBeInTheDocument();
  });
});

describe("POS — ticket PDF térmico offline (Offline 4.6B)", () => {
  beforeEach(() => {
    // jsdom no implementa URL.createObjectURL/revokeObjectURL por defecto
    // (mismo criterio que `lib/api.test.ts`).
    (URL as unknown as { createObjectURL: () => string }).createObjectURL = () => "blob:mock-ticket";
    (URL as unknown as { revokeObjectURL: () => void }).revokeObjectURL = () => {};
  });

  it("después de una venta ONLINE confirmada, aparecen 'Ver / Imprimir ticket' y 'Descargar ticket', y abren el PDF sin red", async () => {
    const user = userEvent.setup();
    const openSpy = vi.spyOn(window, "open").mockReturnValue(null);
    await renderPosWithCatalog();
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation((url: string) => {
        if (url.endsWith("/sales")) return Promise.resolve(jsonResponse(201, { id: "server-ticket-1" }));
        if (url.includes("/confirm")) {
          return Promise.resolve(
            jsonResponse(201, { id: "server-ticket-1", status: "PAID", total: "15.00", paidTotal: "15.00", balance: "0.00" }),
          );
        }
        return baseFetchStub(url);
      }),
    );

    await user.click(screen.getByRole("button", { name: /Coca Cola 2L/ }));
    await user.click(screen.getByRole("button", { name: "Confirmar venta" }));
    await screen.findByText(/Venta confirmada \(PAID\)/);

    const viewButton = await screen.findByRole("button", { name: "Ver / Imprimir ticket" });
    await user.click(viewButton);

    await waitFor(() => expect(openSpy).toHaveBeenCalledWith("blob:mock-ticket", "_blank"));
  });

  it("después de una venta OFFLINE-PENDING, las acciones de ticket funcionan igual — sin depender del servidor", async () => {
    const user = userEvent.setup();
    const openSpy = vi.spyOn(window, "open").mockReturnValue(null);
    await renderPosWithCatalog();
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("sin conexión")));

    await user.click(screen.getByRole("button", { name: /Coca Cola 2L/ }));
    await user.click(screen.getByRole("button", { name: "Confirmar venta" }));
    await screen.findByText(/Venta guardada sin conexión/);

    const viewButton = await screen.findByRole("button", { name: "Ver / Imprimir ticket" });
    await user.click(viewButton);
    await waitFor(() => expect(openSpy).toHaveBeenCalledWith("blob:mock-ticket", "_blank"));
  });

  it("'Descargar ticket' genera el PDF y dispara la descarga vía un <a download> temporal, sin lanzar", async () => {
    const user = userEvent.setup();
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    await renderPosWithCatalog();
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("sin conexión")));

    await user.click(screen.getByRole("button", { name: /Coca Cola 2L/ }));
    await user.click(screen.getByRole("button", { name: "Confirmar venta" }));
    await screen.findByText(/Venta guardada sin conexión/);

    await user.click(await screen.findByRole("button", { name: "Descargar ticket" }));
    await waitFor(() => expect(clickSpy).toHaveBeenCalled());
  });

  it("historial: 'Ver ticket' funciona para CUALQUIER venta local (acá, una en estado Error) — nunca bloquea la impresión por el estado de sincronización", async () => {
    const user = userEvent.setup();
    const openSpy = vi.spyOn(window, "open").mockReturnValue(null);
    const orgId = uniqueOrgId();
    mockOrg = { id: orgId, name: "Mi Negocio" };
    setOffline();
    const db = await seedCatalog(orgId);
    const { createSaleOffline, confirmSaleOffline } = await import("@/lib/offline/sales-repo");
    const sale = await createSaleOffline(db, {
      organizationId: orgId,
      posTerminalId: "pos-1",
      warehouseId: "wh-1",
      items: [{ productId: "prod-pan", quantity: "1", unitPrice: "8.50", discount: "0" }],
    });
    await confirmSaleOffline(db, {
      localSaleId: sale.id,
      payments: [{ method: "CASH", amount: "8.50", idempotencyKey: "pago-ticket-error" }],
    });
    const updated = await db.sales.get(sale.id);
    await db.syncQueue.update(updated!.confirmSyncOperationId!, {
      status: "FAILED",
      attempts: 8,
      error: "Error de validación permanente",
    });

    render(<POSPage />);
    await screen.findByText("Error de validación permanente");

    await user.click(screen.getByRole("button", { name: "Ver ticket" }));
    await waitFor(() => expect(openSpy).toHaveBeenCalledWith("blob:mock-ticket", "_blank"));
  });

  it("si la generación del ticket falla, muestra un mensaje comprensible — nunca el error técnico crudo", async () => {
    const user = userEvent.setup();
    await renderPosWithCatalog();
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation((url: string) => {
        if (url.endsWith("/sales")) return Promise.resolve(jsonResponse(201, { id: "server-ticket-err" }));
        if (url.includes("/confirm")) {
          return Promise.resolve(
            jsonResponse(201, { id: "server-ticket-err", status: "PAID", total: "15.00", paidTotal: "15.00", balance: "0.00" }),
          );
        }
        return baseFetchStub(url);
      }),
    );
    await user.click(screen.getByRole("button", { name: /Coca Cola 2L/ }));
    await user.click(screen.getByRole("button", { name: "Confirmar venta" }));
    await screen.findByText(/Venta confirmada \(PAID\)/);

    // Simula una condición de carrera real (la venta desaparece de la base
    // entre listarla y que el usuario clickee) en vez de inventar un error
    // artificial — `buildTicketFromLocalSale` ya valida esto y lanza un
    // error claro (cubierto en `build-ticket.test.ts`); acá se confirma que
    // la UI lo traduce a un mensaje comprensible, nunca el `Error` crudo.
    const db = getLocalDb(mockOrg.id);
    await db.sales.clear();

    await user.click(await screen.findByRole("button", { name: "Ver / Imprimir ticket" }));

    await screen.findByText("No se pudo generar el ticket. Podés reintentar en un momento.");
    expect(screen.queryByText(/Venta local no encontrada/)).not.toBeInTheDocument();
  });
});

/** Helper local: cambiar un `<input>` controlado sin pelear con las reglas de `userEvent` para `type="number"`. */
function fireEventChange(element: HTMLElement, value: string) {
  const input = element as HTMLInputElement;
  const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
    window.HTMLInputElement.prototype,
    "value",
  )!.set!;
  nativeInputValueSetter.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
}
