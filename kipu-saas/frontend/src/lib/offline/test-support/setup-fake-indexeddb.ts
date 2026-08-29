// Registra un IndexedDB real (en memoria, vía `fake-indexeddb`) en el
// entorno de Node de Vitest — Dexie no distingue esto de un navegador real,
// así que los tests ejercitan el mismo motor de transacciones/índices que
// corre en producción. Recomendado explícitamente por la documentación de
// Dexie para testear fuera del navegador.
import "fake-indexeddb/auto";
