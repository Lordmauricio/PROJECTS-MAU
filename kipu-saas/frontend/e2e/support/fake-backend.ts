import type { BrowserContext, Route } from "@playwright/test";

/**
 * Backend simulado para el E2E (Offline 4.14.6).
 *
 * Intercepta el origen real de la API (`NEXT_PUBLIC_API_URL`, por defecto
 * `http://localhost:4200`) para que la prueba no necesite Postgres, Redis ni
 * NestJS. Lo que NO se simula es nada del frontend: el login, la
 * sincronización de catálogo, Dexie, la cola, el Service Worker y la
 * generación del PDF son el código real de producción.
 *
 * Responde con las MISMAS formas que el backend de KIPU (ver
 * `catalog-sync.ts`, `sync-client.ts` y los DTOs de NestJS). Cualquier
 * divergencia haría que la prueba pasara con datos que el código real
 * rechazaría.
 */

export const API_ORIGIN = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4200";

export const ORG_ID = "org-quirquina";
export const USER = { id: "user-1", name: "Mauricio", email: "mau@quirquina.test" };
export const ORGANIZATION = { id: ORG_ID, name: "Quirquiña Fit" };

export const PRODUCTS = [
  {
    id: "prod-ensalada",
    organizationId: ORG_ID,
    name: "Ensalada de quinua",
    sku: "ENS-001",
    barcode: null,
    price: "25.00",
    active: true,
    updatedAt: "2026-08-30T10:00:00.000Z",
  },
  {
    id: "prod-jugo",
    organizationId: ORG_ID,
    name: "Jugo verde 500ml",
    sku: "JUG-002",
    barcode: null,
    price: "15.50",
    active: true,
    updatedAt: "2026-08-30T10:00:00.000Z",
  },
];

export const CUSTOMERS = [
  {
    id: "cust-1",
    organizationId: ORG_ID,
    name: "Cliente de prueba",
    documentType: "CI",
    documentNumber: "1234567",
    phone: null,
    email: null,
    active: true,
    updatedAt: "2026-08-30T10:00:00.000Z",
  },
];

export interface FakeBackend {
  /** Cuando es true, TODA la API falla como si no hubiera red. */
  offline: boolean;
  /** Peticiones recibidas, para auditar duplicados de venta. */
  calls: { method: string; path: string; body: unknown }[];
  postedSales(): { method: string; path: string; body: unknown }[];
}

export async function installFakeBackend(context: BrowserContext): Promise<FakeBackend> {
  const state: FakeBackend = {
    offline: false,
    calls: [],
    postedSales() {
      return state.calls.filter((c) => c.method === "POST" && c.path === "/sales");
    },
  };

  await context.route(`${API_ORIGIN}/**`, async (route: Route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    const method = request.method();

    // `context.setOffline` no siempre alcanza a una ruta interceptada, así que
    // el corte de red se modela también acá: es el interruptor explícito de la
    // prueba y no depende de un detalle de implementación de Playwright.
    if (state.offline) {
      await route.abort("internetdisconnected");
      return;
    }

    let body: unknown = null;
    try {
      body = request.postDataJSON();
    } catch {
      body = request.postData();
    }
    state.calls.push({ method, path, body });

    const json = (status: number, data: unknown) =>
      route.fulfill({
        status,
        contentType: "application/json",
        headers: { "access-control-allow-origin": "*" },
        body: JSON.stringify(data),
      });

    if (method === "OPTIONS") {
      await route.fulfill({
        status: 204,
        headers: {
          "access-control-allow-origin": "*",
          "access-control-allow-methods": "GET,POST,PATCH,PUT,DELETE,OPTIONS",
          "access-control-allow-headers": "content-type,authorization",
        },
      });
      return;
    }

    if (path === "/auth/login") {
      await json(200, {
        accessToken: "access-token-de-prueba",
        refreshToken: "refresh-token-de-prueba",
        user: USER,
        organization: ORGANIZATION,
      });
      return;
    }

    if (path === "/products") {
      await json(200, PRODUCTS);
      return;
    }
    if (path === "/customers") {
      await json(200, CUSTOMERS);
      return;
    }
    if (path === "/branches") {
      await json(200, [
        {
          id: "branch-1",
          name: "Sucursal Central",
          address: "Av. Siempre Viva 123",
          warehouses: [{ id: "wh-1" }],
          posTerminals: [{ id: "pos-1", name: "Caja 1", code: "C1" }],
        },
      ]);
      return;
    }
    if (path === "/organizations/me") {
      await json(200, {
        name: "Quirquiña Fit",
        legalName: "Quirquiña Fit S.R.L.",
        nit: "1234567019",
        address: "Av. Siempre Viva 123",
        phone: "+591 70000000",
        logoUrl: null,
      });
      return;
    }

    // Sincronización de una venta creada offline.
    if (path === "/sales" && method === "POST") {
      await json(201, { id: "server-sale-1" });
      return;
    }
    if (/^\/sales\/[^/]+\/confirm$/.test(path) && method === "POST") {
      await json(201, {
        id: "server-sale-1",
        status: "PAID",
        total: "25.00",
        paidTotal: "25.00",
        balance: "0.00",
      });
      return;
    }

    await json(404, { message: `sin ruta simulada para ${method} ${path}` });
  });

  return state;
}
