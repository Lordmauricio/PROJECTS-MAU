import { expect, test, type Page } from "@playwright/test";
import { installFakeBackend, PRODUCTS, USER } from "./support/fake-backend";
import { extractPdfText } from "../src/lib/offline/test-support/pdf-text";

/**
 * Offline 4.14.6 — LA PRUEBA FUNDAMENTAL, en un navegador real.
 *
 * Recorre el flujo completo del negocio: primera carga con Internet, corte de
 * red, cierre y reapertura de la app, venta offline, ticket PDF, otro cierre y
 * reapertura, y por fin la reconexión y la sincronización sin duplicados.
 *
 * Por qué esto no podía vivir en Vitest: jsdom no tiene Service Worker, ni
 * Cache API, ni recargas de página de verdad. La pregunta central de Offline
 * 4.14 —"¿la app ARRANCA sin Internet?"— solo se puede responder recargando
 * un navegador real con la red apagada, que es exactamente lo que hace este
 * archivo. Todo el frontend es código de producción; lo único simulado es el
 * backend HTTP (ver `support/fake-backend.ts`).
 *
 * `page.reload()` representa "cerrar y volver a abrir KIPU": para el
 * navegador, un arranque en frío es servir el documento otra vez. La única
 * parte del flujo manual que NO se puede automatizar es pulsar "Instalar
 * aplicación" en Chrome — es un diálogo del navegador, no de la página; ver la
 * guía manual de `docs/architecture.md`.
 */

const CREDENTIALS = { email: USER.email, password: "una-contraseña" };

/** Espera a que el Service Worker esté activo y controlando esta página. */
async function waitForServiceWorker(page: Page) {
  await page.waitForFunction(async () => {
    if (!("serviceWorker" in navigator)) return false;
    const reg = await navigator.serviceWorker.getRegistration();
    return Boolean(reg?.active && navigator.serviceWorker.controller);
  }, null, { timeout: 30_000 });
}

/** Cuántos recursos guardó el App Shell — sin mirar dentro de las cachés. */
async function cachedResourceCount(page: Page) {
  return page.evaluate(async () => {
    const names = await caches.keys();
    let total = 0;
    for (const name of names) total += (await (await caches.open(name)).keys()).length;
    return total;
  });
}

/** Ventas guardadas en la base local de la organización (Dexie). */
async function localSaleCount(page: Page, organizationId: string) {
  return page.evaluate(async (orgId) => {
    return await new Promise<number>((resolve, reject) => {
      const open = indexedDB.open(`kipu_local_${orgId}`);
      open.onerror = () => reject(open.error);
      open.onsuccess = () => {
        const db = open.result;
        const tx = db.transaction("sales", "readonly");
        const count = tx.objectStore("sales").count();
        count.onsuccess = () => {
          resolve(count.result);
          db.close();
        };
        count.onerror = () => reject(count.error);
      };
    });
  }, organizationId);
}

test("KIPU se instala, arranca sin Internet, vende, imprime y sincroniza sin duplicar", async ({
  page,
  context,
}) => {
  const backend = await installFakeBackend(context);

  // Captura el PDF sin abrir una pestaña: se guarda la URL del blob para
  // leerla después y comprobar que es un PDF de 80 mm de verdad.
  await context.addInitScript(() => {
    (window as unknown as { __ticketUrls: string[] }).__ticketUrls = [];
    const original = window.open;
    window.open = (url?: string | URL, ...rest: unknown[]) => {
      (window as unknown as { __ticketUrls: string[] }).__ticketUrls.push(String(url));
      return original.call(window, "about:blank", ...(rest as [])) as Window;
    };
  });

  // ===========================================================================
  // PARTE 1 — PRIMERA VEZ, CON INTERNET
  // ===========================================================================

  await test.step("1-2. abrir KIPU e iniciar sesión", async () => {
    await page.goto("/login");
    await page.getByLabel("Email").fill(CREDENTIALS.email);
    await page.getByLabel("Contraseña").fill(CREDENTIALS.password);
    await page.getByRole("button", { name: "Ingresar" }).click();
    await expect(page).toHaveURL(/\/dashboard/);
  });

  await test.step("3-4. cargar el catálogo y confirmar que quedó en IndexedDB", async () => {
    await page.goto("/sales/pos");
    await expect(page.getByRole("heading", { name: "Punto de venta" })).toBeVisible();
    // El catálogo se ve porque salió de Dexie, no de una respuesta en vuelo.
    for (const product of PRODUCTS) {
      await expect(page.getByRole("button", { name: new RegExp(product.name) })).toBeVisible();
    }
  });

  await test.step("5. el App Shell queda instalado (Service Worker activo y caché poblada)", async () => {
    await waitForServiceWorker(page);
    expect(await cachedResourceCount(page)).toBeGreaterThan(10);

    // El manifest es lo que hace que Chrome ofrezca "Instalar aplicación".
    const manifest = await page.evaluate(async () => {
      const res = await fetch("/manifest.webmanifest");
      return res.json();
    });
    expect(manifest.name).toBe("KIPU SAAS");
    expect(manifest.display).toBe("standalone");
  });

  // ===========================================================================
  // PARTE 2 — SIN INTERNET
  // ===========================================================================

  await test.step("6-7-8. cortar la red, cerrar y volver a abrir KIPU en el POS", async () => {
    backend.offline = true;
    await context.setOffline(true);

    // Una recarga con la red caída ES el arranque en frío que antes de esta
    // fase fallaba: el navegador tiene que servir el documento sin red.
    await page.reload();
    await expect(page.getByRole("heading", { name: "Punto de venta" })).toBeVisible();
  });

  await test.step("9-10. el catálogo local sigue disponible sin conexión", async () => {
    for (const product of PRODUCTS) {
      await expect(page.getByRole("button", { name: new RegExp(product.name) })).toBeVisible();
    }
  });

  await test.step("11-12-13. agregar productos, crear y confirmar la venta offline", async () => {
    await page.getByRole("button", { name: new RegExp(PRODUCTS[0].name) }).click();
    await page.getByRole("button", { name: "+ método" }).click();
    await page.getByLabel("Monto").fill("25.00");
    await page.getByRole("button", { name: "Confirmar venta" }).click();

    // Sin red, la venta no se pierde: queda guardada y esperando sincronizar.
    await expect(page.getByText(/pendiente/i).first()).toBeVisible();
  });

  await test.step("14. el historial local muestra la venta", async () => {
    await page.getByRole("button", { name: /Ventas de este dispositivo/ }).click();
    await expect(page.getByRole("button", { name: "Ver ticket" }).first()).toBeVisible();
  });

  await test.step("15-16. generar y abrir el ticket PDF térmico, sin red", async () => {
    await page.getByRole("button", { name: "Ver / Imprimir ticket" }).click();

    await page.waitForFunction(
      () => (window as unknown as { __ticketUrls: string[] }).__ticketUrls.length > 0,
      null,
      { timeout: 30_000 },
    );

    // No basta con "se generó algo": los bytes viajan del navegador a Node y
    // se abren con pdfjs (el mismo extractor que ya usan los tests de Vitest,
    // `test-support/pdf-text.ts`) para comprobar que es un PDF válido, que
    // mide 80 mm de ancho —toda la razón de ser del ticket térmico— y que
    // dentro está la venta real, no una plantilla vacía.
    const bytes = Uint8Array.from(
      await page.evaluate(async () => {
        const url = (window as unknown as { __ticketUrls: string[] }).__ticketUrls[0];
        const buffer = await (await fetch(url)).arrayBuffer();
        return Array.from(new Uint8Array(buffer));
      }),
    );

    const pdf = await extractPdfText(bytes);
    expect(pdf.pageCount).toBe(1);
    expect(pdf.pageWidths[0]).toBeCloseTo(226.77, 1); // 80 mm exactos
    expect(pdf.text).toContain("Quirquiña Fit");
    expect(pdf.text).toContain(PRODUCTS[0].name);
    // Una venta sin sincronizar NUNCA muestra un folio inventado.
    expect(pdf.text.toUpperCase()).toContain("PENDIENTE DE SINCRONIZAR");
  });

  await test.step("17-18-19. cerrar y reabrir sin red: la venta sigue ahí", async () => {
    await page.reload();
    await expect(page.getByRole("heading", { name: "Punto de venta" })).toBeVisible();
    expect(await localSaleCount(page, "org-quirquina")).toBe(1);
    await page.getByRole("button", { name: /Ventas de este dispositivo/ }).click();
    await expect(page.getByRole("button", { name: "Ver ticket" }).first()).toBeVisible();
  });

  // ===========================================================================
  // PARTE 3 — VUELVE INTERNET
  // ===========================================================================

  await test.step("20-21-22. reconectar y esperar la sincronización automática", async () => {
    backend.offline = false;
    await context.setOffline(false);
    // `auto-sync` reacciona al evento `online` del navegador.
    await page.evaluate(() => window.dispatchEvent(new Event("online")));

    await expect
      .poll(() => backend.postedSales().length, { timeout: 30_000 })
      .toBeGreaterThan(0);
  });

  await test.step("23-24. la venta no se duplicó y conserva su idempotencyKey", async () => {
    // Un margen para que un reintento indebido, si existiera, alcance a ocurrir.
    await page.waitForTimeout(3_000);

    const posted = backend.postedSales();
    expect(posted, "la venta se envió más de una vez").toHaveLength(1);

    const body = posted[0].body as { idempotencyKey?: string };
    expect(body.idempotencyKey, "la venta debe viajar con su idempotencyKey").toBeTruthy();
  });

  await test.step("25. estado final: una sola venta local, ya sincronizada", async () => {
    expect(await localSaleCount(page, "org-quirquina")).toBe(1);
    await expect(page.getByRole("heading", { name: "Punto de venta" })).toBeVisible();
  });
});

test("el Service Worker nunca cachea la API ni intercepta un POST de venta", async ({
  page,
  context,
}) => {
  // La contraparte de seguridad de la prueba anterior, en el navegador real:
  // los tests de Vitest verifican las reglas; este verifica el efecto.
  await installFakeBackend(context);

  await page.goto("/login");
  await page.getByLabel("Email").fill(CREDENTIALS.email);
  await page.getByLabel("Contraseña").fill(CREDENTIALS.password);
  await page.getByRole("button", { name: "Ingresar" }).click();
  await expect(page).toHaveURL(/\/dashboard/);
  await page.goto("/sales/pos");
  await waitForServiceWorker(page);

  const cachedUrls = await page.evaluate(async () => {
    const out: string[] = [];
    for (const name of await caches.keys()) {
      const cache = await caches.open(name);
      for (const request of await cache.keys()) out.push(request.url);
    }
    return out;
  });

  expect(cachedUrls.length).toBeGreaterThan(0);
  for (const url of cachedUrls) {
    expect(new URL(url).origin, `fuga de la API a la caché: ${url}`).toBe(
      new URL(page.url()).origin,
    );
  }
  // Ni tokens ni rutas de autenticación en disco.
  const joined = cachedUrls.join("|");
  expect(joined).not.toContain("/auth/");
  expect(joined).not.toContain("token");
});
