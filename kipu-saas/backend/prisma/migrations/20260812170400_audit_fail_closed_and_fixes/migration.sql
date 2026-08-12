-- AlterTable
ALTER TABLE "refresh_tokens" ADD COLUMN     "organizationId" TEXT,
ADD COLUMN     "roleId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "products_organizationId_sku_key" ON "products"("organizationId", "sku");

-- CreateIndex
CREATE UNIQUE INDEX "products_organizationId_barcode_key" ON "products"("organizationId", "barcode");

-- CreateIndex
CREATE UNIQUE INDEX "suppliers_organizationId_nit_key" ON "suppliers"("organizationId", "nit");

-- AddForeignKey
ALTER TABLE "tax_configurations" ADD CONSTRAINT "tax_configurations_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE CASCADE ON UPDATE CASCADE;
