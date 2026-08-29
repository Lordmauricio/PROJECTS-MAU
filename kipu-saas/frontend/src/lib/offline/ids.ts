// Tres conceptos distintos, generados con el mismo mecanismo (UUID v4) pero
// NUNCA intercambiados entre sí — mezclarlos es exactamente el tipo de bug
// que puede terminar acoplando el almacenamiento local al contrato de la API
// del servidor, o confundiendo "la fila de la cola" con "la operación de
// negocio que representa":
//
// - localId       → identifica una fila LOCAL (un Sale/Customer/etc. creado
//                    offline, antes de que el servidor le asigne su propio
//                    id vía `cuid()`). Puramente de bookkeeping del cliente.
// - idempotencyKey → el valor que viaja al servidor en el body del request
//                    (`Sale.idempotencyKey`, `Payment.idempotencyKey`, etc.
//                    — infraestructura de Fase Offline 1/fases comerciales
//                    anteriores). Tiene significado contractual del lado del
//                    servidor (columna `@unique`) y debe reenviarse IDÉNTICO
//                    en cada reintento de la MISMA operación.
// - syncOperationId → identifica una fila de `sync_queue`: el "trabajo en
//                    cola" en sí, no la entidad de negocio ni la garantía de
//                    idempotencia. Una misma entidad (ej. una venta) puede
//                    tener varias operaciones de sync a lo largo de su vida
//                    (crear, luego confirmar) — cada una con su propio
//                    syncOperationId Y su propia idempotencyKey.
//
// Mismo generador que ya usan `sales/pos/page.tsx`/`cash/page.tsx`
// (`crypto.randomUUID()` con fallback) — centralizado acá para no
// duplicarlo una tercera vez.
function uuid(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `id-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export function newLocalId(): string {
  return uuid();
}

export function newIdempotencyKey(): string {
  return uuid();
}

export function newSyncOperationId(): string {
  return uuid();
}
