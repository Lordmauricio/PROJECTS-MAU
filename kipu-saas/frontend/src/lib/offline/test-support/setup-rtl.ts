// Setup exclusivo de los tests de UI (React Testing Library, Offline 4.2)
// — separado de `setup-fake-indexeddb.ts` a propósito, que sigue siendo el
// único setup para los tests de lógica pura (no todos los tests de este
// proyecto son de UI). Este proyecto no usa `test.globals` de Vitest
// (todos los tests importan explícitamente `describe`/`it`/`expect`/etc.),
// así que el auto-cleanup de RTL (que depende de detectar un `afterEach`
// global) no se activaría solo — se registra acá de forma explícita.
import { afterEach } from "vitest";
import { cleanup } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";

afterEach(() => {
  cleanup();
});
