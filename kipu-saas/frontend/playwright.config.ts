import { defineConfig, devices } from "@playwright/test";

/**
 * Offline 4.14.6 — configuración de las pruebas E2E reales.
 *
 * Estas pruebas existen porque jsdom NO puede responder la única pregunta que
 * importa en esta fase: ¿arranca KIPU sin Internet? Un Service Worker, la
 * Cache API y una recarga real de página no existen en jsdom. Acá corre
 * Chromium de verdad, contra el build de producción, y se apaga la red con
 * `context.setOffline(true)`.
 *
 * Se ejecutan aparte de Vitest a propósito (`npm run test:e2e`): necesitan un
 * build y un servidor, así que no deben frenar el ciclo rápido de `npm test`.
 */

const PORT = Number(process.env.KIPU_E2E_PORT ?? 3101);

export default defineConfig({
  testDir: "./e2e",
  // El flujo fundamental es una secuencia larga con estado (instalar → offline
  // → vender → reabrir → reconectar); paralelizarla no tendría sentido.
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: 0,
  reporter: [["list"]],
  timeout: 90_000,
  expect: { timeout: 15_000 },

  use: {
    baseURL: `http://localhost:${PORT}`,
    // El Service Worker solo se registra en contexto seguro: HTTPS o
    // localhost. Por eso la baseURL es localhost y no una IP de LAN — es la
    // misma razón por la que probar desde un teléfono necesita el redirigido
    // de puertos de ADB (ver docs/architecture.md).
    serviceWorkers: "allow",
    trace: "retain-on-failure",
  },

  projects: [
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"],
        launchOptions: {
          // Permite apuntar a un Chromium ya instalado en el sistema. Sin la
          // variable se usa el que instala Playwright (`npx playwright install
          // chromium`), que es lo normal en una máquina de desarrollo.
          executablePath: process.env.KIPU_E2E_CHROMIUM || undefined,
        },
      },
    },
  ],

  webServer: {
    // Producción, no `next dev`: el Service Worker no se registra en
    // desarrollo (ver `ServiceWorkerRegistrar`), así que un E2E contra `next
    // dev` probaría algo que no es lo que se despliega.
    command: `npx next build && npx next start -p ${PORT}`,
    url: `http://localhost:${PORT}/login`,
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
  },
});
