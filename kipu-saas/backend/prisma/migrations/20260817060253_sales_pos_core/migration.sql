-- Fase Comercial 2 (Ventas/POS): estados de pago de una venta, almacén de
-- origen del descuento de stock, y trazabilidad temporal de las
-- transiciones. `sales`, `sale_items`, `payments`, `inventories` e
-- `inventory_movements` ya tenían RLS habilitado desde la migración init
-- (son parte de las 32 tablas tenant-scoped originales) — nada que agregar
-- ahí, solo columnas nuevas.

-- AlterEnum
-- Postgres no permite usar un valor de enum recién agregado en la misma
-- transacción en la que se agrega (antes de PG 12 ni siquiera se podía
-- agregar dentro de una transacción). `prisma migrate` corre cada
-- sentencia de este archivo en su propia declaración, así que esto aplica
-- limpio; documentado igual por si se corre a mano.
ALTER TYPE "SaleStatus" ADD VALUE 'PARTIALLY_PAID';
ALTER TYPE "SaleStatus" ADD VALUE 'PAID';
ALTER TYPE "SaleStatus" ADD VALUE 'REFUNDED';

-- AlterTable
ALTER TABLE "payments" ADD COLUMN     "createdById" TEXT,
ADD COLUMN     "idempotencyKey" TEXT;

-- AlterTable
ALTER TABLE "sales" ADD COLUMN     "cancelledAt" TIMESTAMP(3),
ADD COLUMN     "confirmedAt" TIMESTAMP(3),
ADD COLUMN     "refundedAt" TIMESTAMP(3),
ADD COLUMN     "warehouseId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "payments_idempotencyKey_key" ON "payments"("idempotencyKey");

-- CreateIndex
CREATE INDEX "sales_warehouseId_idx" ON "sales"("warehouseId");

-- AddForeignKey
ALTER TABLE "sales" ADD CONSTRAINT "sales_warehouseId_fkey" FOREIGN KEY ("warehouseId") REFERENCES "warehouses"("id") ON DELETE SET NULL ON UPDATE CASCADE;
