import { defineConfig } from "vitest/config";
import path from "node:path";

// Configuración de tests: `fake-indexeddb` (recomendado por la propia
// documentación de Dexie para tests fuera del navegador) para la capa
// offline, y React Testing Library (Offline 4.2) para los tests de UI real
// — ambos setups se registran antes de cada archivo de test, sin necesidad
// de que cada test los importe. `include` cubre tanto `.test.ts` (lógica
// pura) como `.test.tsx` (componentes).
export default defineConfig({
  test: {
    environment: "jsdom",
    setupFiles: [
      "./src/lib/offline/test-support/setup-fake-indexeddb.ts",
      "./src/lib/offline/test-support/setup-rtl.ts",
    ],
    include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
    },
  },
});
