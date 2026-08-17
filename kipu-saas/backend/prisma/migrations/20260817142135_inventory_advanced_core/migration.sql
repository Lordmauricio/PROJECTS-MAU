-- Fase Comercial 4 (Inventario avanzado / Kardex): snapshot de stock por
-- movimiento (stockBefore/stockAfter, persistido en el momento en vez de
-- recalculado después), idempotencyKey para movimientos registrados
-- directamente (entrada/salida/ajuste manual, cada leg de una
-- transferencia), y transferencias entre almacenes.
--
-- Nota de despliegue: `stockBefore`/`stockAfter` se agregan NOT NULL sin
-- default. Es seguro acá porque este es un entorno de desarrollo que se
-- recrea desde cero en cada fase (ver README de setup); en un despliegue
-- real contra una base con `inventory_movements` ya poblada, esta
-- migración necesitaría un backfill previo (recalcular el saldo corriente
-- replicando el historial una vez) antes de poder aplicarse.

-- AlterTable
ALTER TABLE "inventory_movements" ADD COLUMN     "idempotencyKey" TEXT,
ADD COLUMN     "stockAfter" DECIMAL(12,2) NOT NULL,
ADD COLUMN     "stockBefore" DECIMAL(12,2) NOT NULL;

-- CreateTable
CREATE TABLE "inventory_transfers" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "fromWarehouseId" TEXT NOT NULL,
    "toWarehouseId" TEXT NOT NULL,
    "quantity" DECIMAL(12,2) NOT NULL,
    "reason" TEXT,
    "idempotencyKey" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "inventory_transfers_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "inventory_transfers_idempotencyKey_key" ON "inventory_transfers"("idempotencyKey");

-- CreateIndex
CREATE INDEX "inventory_transfers_organizationId_idx" ON "inventory_transfers"("organizationId");

-- CreateIndex
CREATE INDEX "inventory_transfers_fromWarehouseId_idx" ON "inventory_transfers"("fromWarehouseId");

-- CreateIndex
CREATE INDEX "inventory_transfers_toWarehouseId_idx" ON "inventory_transfers"("toWarehouseId");

-- CreateIndex
CREATE INDEX "inventory_transfers_productId_idx" ON "inventory_transfers"("productId");

-- CreateIndex
CREATE UNIQUE INDEX "inventory_movements_idempotencyKey_key" ON "inventory_movements"("idempotencyKey");

-- CreateIndex
CREATE INDEX "inventory_movements_createdAt_idx" ON "inventory_movements"("createdAt");

-- AddForeignKey
ALTER TABLE "inventory_transfers" ADD CONSTRAINT "inventory_transfers_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_transfers" ADD CONSTRAINT "inventory_transfers_fromWarehouseId_fkey" FOREIGN KEY ("fromWarehouseId") REFERENCES "warehouses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_transfers" ADD CONSTRAINT "inventory_transfers_toWarehouseId_fkey" FOREIGN KEY ("toWarehouseId") REFERENCES "warehouses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- RLS para la tabla nueva — mismo patrón que el resto de las tablas
-- tenant-scoped desde la migración init.
ALTER TABLE "inventory_transfers" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "inventory_transfers" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "inventory_transfers"
  USING ("organizationId" = current_setting('app.current_tenant', true))
  WITH CHECK ("organizationId" = current_setting('app.current_tenant', true));
