-- Fase Comercial 5 — Caja y Gastos.
--
-- Nota de despliegue (backfill): `expenses.cashRegisterId` pasa a ser
-- NOT NULL. En este entorno de desarrollo la tabla `expenses` está vacía
-- (era un modelo placeholder desde la Fase 1, sin ningún endpoint que
-- escribiera en ella hasta esta fase), así que el ALTER TABLE es seguro
-- tal cual. Un despliegue real sobre una base con filas existentes en
-- `expenses` necesitaría primero un backfill (crear una CashRegister
-- histórica de respaldo por organización, o decidir explícitamente qué
-- gastos previos quedan huérfanos) antes de aplicar esta migración.
--
-- Índice único parcial (`cash_registers_one_open_per_terminal`): Prisma no
-- expresa índices parciales (`WHERE`) en su DSL, así que se agrega a mano
-- acá — mismo criterio ya usado para el CHECK constraint de `payments` en
-- la Fase Comercial 3. Es la barrera atómica a nivel de Postgres que
-- impide dos cajas OPEN del mismo `posTerminalId` incluso bajo
-- concurrencia real: dos INSERT simultáneos con `status = 'OPEN'` para el
-- mismo terminal violan este índice, sin necesitar ningún lock explícito
-- de aplicación. Ver `CashService.open` / `docs/architecture.md`.

-- AlterTable
ALTER TABLE "cash_movements" ADD COLUMN     "createdById" TEXT,
ADD COLUMN     "idempotencyKey" TEXT,
ADD COLUMN     "reference" TEXT;

-- AlterTable
ALTER TABLE "cash_registers" ADD COLUMN     "closingIdempotencyKey" TEXT,
ADD COLUMN     "closingObservation" TEXT,
ADD COLUMN     "difference" DECIMAL(12,2),
ADD COLUMN     "expectedAmount" DECIMAL(12,2),
ADD COLUMN     "openingIdempotencyKey" TEXT;

-- AlterTable
ALTER TABLE "expenses" ADD COLUMN     "cashRegisterId" TEXT NOT NULL,
ADD COLUMN     "createdById" TEXT,
ADD COLUMN     "idempotencyKey" TEXT,
ADD COLUMN     "observation" TEXT,
ALTER COLUMN "category" DROP NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "cash_movements_idempotencyKey_key" ON "cash_movements"("idempotencyKey");

-- CreateIndex
CREATE UNIQUE INDEX "cash_registers_openingIdempotencyKey_key" ON "cash_registers"("openingIdempotencyKey");

-- CreateIndex
CREATE UNIQUE INDEX "cash_registers_closingIdempotencyKey_key" ON "cash_registers"("closingIdempotencyKey");

-- CreateIndex
CREATE UNIQUE INDEX "expenses_idempotencyKey_key" ON "expenses"("idempotencyKey");

-- CreateIndex
CREATE INDEX "expenses_cashRegisterId_idx" ON "expenses"("cashRegisterId");

-- AddForeignKey
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_cashRegisterId_fkey" FOREIGN KEY ("cashRegisterId") REFERENCES "cash_registers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Índice único parcial: a lo sumo una CashRegister OPEN por posTerminalId.
-- No se puede expresar en schema.prisma (Prisma DSL no soporta WHERE en
-- @@unique), se agrega a mano.
CREATE UNIQUE INDEX "cash_registers_one_open_per_terminal" ON "cash_registers"("posTerminalId") WHERE "status" = 'OPEN';
