import { defineConfig } from "vitest/config";
import path from "node:path";

// Configuración mínima para testear la capa offline (frontend/src/lib/offline)
// en Node, sin navegador real: `fake-indexeddb` (recomendado por la propia
// documentación de Dexie para tests fuera del navegador) se registra como
// setup global antes de cada archivo de test.
export default defineConfig({
  test: {
    environment: "jsdom",
    setupFiles: ["./src/lib/offline/test-support/setup-fake-indexeddb.ts"],
    include: ["src/**/*.test.ts"],
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
    },
  },
});
