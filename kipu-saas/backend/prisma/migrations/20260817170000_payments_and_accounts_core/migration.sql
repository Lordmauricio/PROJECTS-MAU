-- Fase Comercial 6 — Pagos y Cuentas (Receivables reales, integración de
-- Caja con Payable, reembolsos de Venta).
--
-- Migración puramente aditiva: `receivables.saleId` es NULLABLE (sin
-- backfill posible ni necesario — las Receivable existentes, si las
-- hubiera, quedan sin venta asociada, que es un estado válido) y
-- `refunds` es una tabla nueva. Ninguna columna NOT NULL nueva, ningún
-- dato existente se modifica ni se elimina.

-- AlterTable
ALTER TABLE "receivables" ADD COLUMN     "saleId" TEXT;

-- CreateTable
CREATE TABLE "refunds" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "saleId" TEXT NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "reason" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "refunds_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "refunds_organizationId_idx" ON "refunds"("organizationId");

-- CreateIndex
CREATE INDEX "refunds_saleId_idx" ON "refunds"("saleId");

-- CreateIndex
CREATE UNIQUE INDEX "receivables_saleId_key" ON "receivables"("saleId");

-- AddForeignKey
ALTER TABLE "receivables" ADD CONSTRAINT "receivables_saleId_fkey" FOREIGN KEY ("saleId") REFERENCES "sales"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_saleId_fkey" FOREIGN KEY ("saleId") REFERENCES "sales"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- RLS para la tabla nueva, mismo patrón que el resto del esquema
-- (`receivables` ya tenía RLS desde la migración inicial — solo gana una
-- columna).
ALTER TABLE "refunds" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "refunds" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "refunds"
  USING ("organizationId" = current_setting('app.current_tenant', true))
  WITH CHECK ("organizationId" = current_setting('app.current_tenant', true));
