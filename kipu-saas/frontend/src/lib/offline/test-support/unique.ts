// `fake-indexeddb` (igual que el IndexedDB real) persiste los datos durante
// todo el proceso, incluso después de `resetLocalDbCache()` (que solo
// limpia la memoización del lado de Dexie, a propósito — ver `db.ts`, es
// justamente lo que permite testear "persistencia entre reinicios"). Para
// que un test no vea filas que dejó otro test anterior, cada test usa su
// PROPIO organizationId único — mismo criterio que ya usa
// `backend/src/test-support/integration-app.ts#uniqueSuffix()` contra el
// Postgres real compartido entre archivos de test.
let counter = 0;

export function uniqueOrgId(label = "org"): string {
  counter += 1;
  return `${label}-${Date.now()}-${counter}`;
}
