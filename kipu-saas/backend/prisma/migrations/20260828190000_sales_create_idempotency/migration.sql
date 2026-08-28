-- Fase Offline 1 — Preparación del backend.
--
-- `sales.idempotencyKey` (nullable, única): protege POST /sales (crear
-- venta) contra reintentos/timeout/doble click, mismo patrón que
-- `payments.idempotencyKey`/`cash_registers.openingIdempotencyKey`/
-- `inventory_movements.idempotencyKey`. Nullable porque el POST /sales
-- actual predata este campo y el caller de hoy (POS web) no lo envía
-- todavía: un valor ausente conserva el comportamiento actual (create
-- simple, sin protección), sin backfill necesario sobre las filas
-- existentes. Ver `SalesService.create`/`runOrResolveCreateConflict` y
-- `docs/security.md` sección "Fase Offline 1".
--
-- Aditiva y segura: no borra ni renombra ninguna columna existente, no
-- requiere backfill (columna nullable, `sales` puede tener filas previas
-- sin este valor), reversible con `ALTER TABLE "sales" DROP COLUMN
-- "idempotencyKey";` si hiciera falta revertirla a mano.

-- AlterTable
ALTER TABLE "sales" ADD COLUMN     "idempotencyKey" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "sales_idempotencyKey_key" ON "sales"("idempotencyKey");
