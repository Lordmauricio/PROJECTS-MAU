-- Fase Comercial 3 (Compras): estados de recepción de una orden de compra,
-- almacén de destino, historial de recepciones (análogo a `payments` en
-- Ventas), y reutilización de `payments` como ledger genérico (Sale O
-- Payable, nunca ambos ni ninguno).

-- AlterEnum
-- Postgres no permite usar un valor de enum recién agregado en la misma
-- transacción en la que se agrega; cada sentencia de este archivo corre en
-- su propia declaración bajo `prisma migrate`, así que esto aplica limpio.
ALTER TYPE "PurchaseStatus" ADD VALUE 'CONFIRMED';
ALTER TYPE "PurchaseStatus" ADD VALUE 'PARTIALLY_RECEIVED';

-- AlterTable
ALTER TABLE "payments" ADD COLUMN     "payableId" TEXT;

-- AlterTable
ALTER TABLE "purchase_items" ADD COLUMN     "discount" DECIMAL(12,2) NOT NULL DEFAULT 0,
ADD COLUMN     "receivedQuantity" DECIMAL(12,2) NOT NULL DEFAULT 0,
ADD COLUMN     "returnedQuantity" DECIMAL(12,2) NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "purchases" ADD COLUMN     "cancelledAt" TIMESTAMP(3),
ADD COLUMN     "confirmedAt" TIMESTAMP(3),
ADD COLUMN     "discount" DECIMAL(12,2) NOT NULL DEFAULT 0,
ADD COLUMN     "receivedAt" TIMESTAMP(3),
ADD COLUMN     "warehouseId" TEXT;

-- CreateTable
CREATE TABLE "purchase_receipts" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "purchaseId" TEXT NOT NULL,
    "idempotencyKey" TEXT,
    "notes" TEXT,
    "receivedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "purchase_receipts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "purchase_receipt_items" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "purchaseReceiptId" TEXT NOT NULL,
    "purchaseItemId" TEXT NOT NULL,
    "quantity" DECIMAL(12,2) NOT NULL,

    CONSTRAINT "purchase_receipt_items_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "purchase_receipts_idempotencyKey_key" ON "purchase_receipts"("idempotencyKey");

-- CreateIndex
CREATE INDEX "purchase_receipts_organizationId_idx" ON "purchase_receipts"("organizationId");

-- CreateIndex
CREATE INDEX "purchase_receipts_purchaseId_idx" ON "purchase_receipts"("purchaseId");

-- CreateIndex
CREATE INDEX "purchase_receipt_items_organizationId_idx" ON "purchase_receipt_items"("organizationId");

-- CreateIndex
CREATE INDEX "purchase_receipt_items_purchaseReceiptId_idx" ON "purchase_receipt_items"("purchaseReceiptId");

-- CreateIndex
CREATE UNIQUE INDEX "payables_purchaseId_key" ON "payables"("purchaseId");

-- CreateIndex
CREATE INDEX "payments_payableId_idx" ON "payments"("payableId");

-- CreateIndex
CREATE INDEX "purchases_warehouseId_idx" ON "purchases"("warehouseId");

-- AddForeignKey
ALTER TABLE "purchases" ADD CONSTRAINT "purchases_warehouseId_fkey" FOREIGN KEY ("warehouseId") REFERENCES "warehouses"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_receipts" ADD CONSTRAINT "purchase_receipts_purchaseId_fkey" FOREIGN KEY ("purchaseId") REFERENCES "purchases"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_receipt_items" ADD CONSTRAINT "purchase_receipt_items_purchaseReceiptId_fkey" FOREIGN KEY ("purchaseReceiptId") REFERENCES "purchase_receipts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_receipt_items" ADD CONSTRAINT "purchase_receipt_items_purchaseItemId_fkey" FOREIGN KEY ("purchaseItemId") REFERENCES "purchase_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_payableId_fkey" FOREIGN KEY ("payableId") REFERENCES "payables"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- CreateTable
CREATE TABLE "purchase_returns" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "purchaseId" TEXT NOT NULL,
    "idempotencyKey" TEXT,
    "reason" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "purchase_returns_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "purchase_return_items" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "purchaseReturnId" TEXT NOT NULL,
    "purchaseItemId" TEXT NOT NULL,
    "quantity" DECIMAL(12,2) NOT NULL,

    CONSTRAINT "purchase_return_items_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "purchase_returns_idempotencyKey_key" ON "purchase_returns"("idempotencyKey");

-- CreateIndex
CREATE INDEX "purchase_returns_organizationId_idx" ON "purchase_returns"("organizationId");

-- CreateIndex
CREATE INDEX "purchase_returns_purchaseId_idx" ON "purchase_returns"("purchaseId");

-- CreateIndex
CREATE INDEX "purchase_return_items_organizationId_idx" ON "purchase_return_items"("organizationId");

-- CreateIndex
CREATE INDEX "purchase_return_items_purchaseReturnId_idx" ON "purchase_return_items"("purchaseReturnId");

-- AddForeignKey
ALTER TABLE "purchase_returns" ADD CONSTRAINT "purchase_returns_purchaseId_fkey" FOREIGN KEY ("purchaseId") REFERENCES "purchases"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_return_items" ADD CONSTRAINT "purchase_return_items_purchaseReturnId_fkey" FOREIGN KEY ("purchaseReturnId") REFERENCES "purchase_returns"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_return_items" ADD CONSTRAINT "purchase_return_items_purchaseItemId_fkey" FOREIGN KEY ("purchaseItemId") REFERENCES "purchase_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- CheckConstraint: un Payment es o bien un cobro de venta (saleId) o bien
-- un pago a proveedor (payableId), nunca ambos ni ninguno. No expresable
-- en el DSL de Prisma — se agrega a mano, igual que las policies de RLS.
ALTER TABLE "payments" ADD CONSTRAINT "payments_exactly_one_target_check"
  CHECK (
    ("saleId" IS NOT NULL AND "payableId" IS NULL)
    OR
    ("saleId" IS NULL AND "payableId" IS NOT NULL)
  );

-- RLS para las 2 tablas nuevas — mismo patrón que el resto de las tablas
-- tenant-scoped desde la migración init.
ALTER TABLE "purchase_receipts" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "purchase_receipts" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "purchase_receipts"
  USING ("organizationId" = current_setting('app.current_tenant', true))
  WITH CHECK ("organizationId" = current_setting('app.current_tenant', true));

ALTER TABLE "purchase_receipt_items" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "purchase_receipt_items" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "purchase_receipt_items"
  USING ("organizationId" = current_setting('app.current_tenant', true))
  WITH CHECK ("organizationId" = current_setting('app.current_tenant', true));

ALTER TABLE "purchase_returns" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "purchase_returns" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "purchase_returns"
  USING ("organizationId" = current_setting('app.current_tenant', true))
  WITH CHECK ("organizationId" = current_setting('app.current_tenant', true));

ALTER TABLE "purchase_return_items" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "purchase_return_items" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "purchase_return_items"
  USING ("organizationId" = current_setting('app.current_tenant', true))
  WITH CHECK ("organizationId" = current_setting('app.current_tenant', true));
