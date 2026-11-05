-- AlterTable
ALTER TABLE "products" ADD COLUMN     "requireLots" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "purchase_receipts" ADD COLUMN     "requestHash" TEXT;

-- CreateTable
CREATE TABLE "stock_lots" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "warehouseId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "expiresOn" DATE,
    "blocked" BOOLEAN NOT NULL DEFAULT false,
    "quantity" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "stock_lots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lot_allocations" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "movementId" TEXT NOT NULL,
    "lotId" TEXT,
    "direction" TEXT NOT NULL,
    "quantity" DECIMAL(12,2) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "lot_allocations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stock_operations" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "warehouseId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "requestKey" TEXT NOT NULL,
    "requestHash" TEXT NOT NULL,
    "snapshot" JSONB NOT NULL,
    "actorUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "stock_operations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "recipes" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "revision" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "recipes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "recipe_versions" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "recipeId" TEXT NOT NULL,
    "revision" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "station" TEXT NOT NULL,
    "outputProductId" TEXT NOT NULL,
    "outputName" TEXT NOT NULL,
    "outputUnit" TEXT NOT NULL,
    "yieldQuantity" DECIMAL(12,2) NOT NULL,
    "ingredients" JSONB NOT NULL,
    "theoreticalCost" DECIMAL(12,2) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdById" TEXT NOT NULL,

    CONSTRAINT "recipe_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "recipe_runs" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "versionId" TEXT NOT NULL,
    "warehouseId" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "station" TEXT NOT NULL,
    "outputProductId" TEXT NOT NULL,
    "outputName" TEXT NOT NULL,
    "outputUnit" TEXT NOT NULL,
    "plannedQuantity" DECIMAL(12,2) NOT NULL,
    "expectedInputs" JSONB NOT NULL,
    "actualInputs" JSONB,
    "theoreticalCost" DECIMAL(12,2) NOT NULL,
    "actualCost" DECIMAL(12,2),
    "producedQuantity" DECIMAL(12,2),
    "costPerUnit" DECIMAL(12,4),
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "version" INTEGER NOT NULL DEFAULT 0,
    "requestKey" TEXT NOT NULL,
    "requestHash" TEXT NOT NULL,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "startedAt" TIMESTAMP(3),
    "readyAt" TIMESTAMP(3),
    "cancelReason" TEXT,
    "actionHash" TEXT,

    CONSTRAINT "recipe_runs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "stock_lots_organizationId_warehouseId_productId_idx" ON "stock_lots"("organizationId", "warehouseId", "productId");

-- CreateIndex
CREATE UNIQUE INDEX "stock_lots_id_organizationId_key" ON "stock_lots"("id", "organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "stock_lots_warehouseId_productId_code_key" ON "stock_lots"("warehouseId", "productId", "code");

-- CreateIndex
CREATE INDEX "lot_allocations_organizationId_movementId_idx" ON "lot_allocations"("organizationId", "movementId");

-- CreateIndex
CREATE INDEX "stock_operations_organizationId_warehouseId_createdAt_idx" ON "stock_operations"("organizationId", "warehouseId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "stock_operations_organizationId_requestKey_key" ON "stock_operations"("organizationId", "requestKey");

-- CreateIndex
CREATE INDEX "recipes_organizationId_idx" ON "recipes"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "recipes_id_organizationId_key" ON "recipes"("id", "organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "recipe_versions_id_organizationId_key" ON "recipe_versions"("id", "organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "recipe_versions_recipeId_revision_key" ON "recipe_versions"("recipeId", "revision");

-- CreateIndex
CREATE INDEX "recipe_runs_organizationId_branchId_status_idx" ON "recipe_runs"("organizationId", "branchId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "recipe_runs_organizationId_requestKey_key" ON "recipe_runs"("organizationId", "requestKey");

-- CreateIndex
CREATE UNIQUE INDEX "warehouses_id_organizationId_key" ON "warehouses"("id", "organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "products_id_organizationId_key" ON "products"("id", "organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "inventory_movements_id_organizationId_key" ON "inventory_movements"("id", "organizationId");

-- AddForeignKey
ALTER TABLE "stock_lots" ADD CONSTRAINT "stock_lots_warehouseId_organizationId_fkey" FOREIGN KEY ("warehouseId", "organizationId") REFERENCES "warehouses"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_lots" ADD CONSTRAINT "stock_lots_productId_organizationId_fkey" FOREIGN KEY ("productId", "organizationId") REFERENCES "products"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lot_allocations" ADD CONSTRAINT "lot_allocations_movementId_organizationId_fkey" FOREIGN KEY ("movementId", "organizationId") REFERENCES "inventory_movements"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lot_allocations" ADD CONSTRAINT "lot_allocations_lotId_organizationId_fkey" FOREIGN KEY ("lotId", "organizationId") REFERENCES "stock_lots"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recipe_versions" ADD CONSTRAINT "recipe_versions_recipeId_organizationId_fkey" FOREIGN KEY ("recipeId", "organizationId") REFERENCES "recipes"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recipe_versions" ADD CONSTRAINT "recipe_versions_outputProductId_organizationId_fkey" FOREIGN KEY ("outputProductId", "organizationId") REFERENCES "products"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recipe_runs" ADD CONSTRAINT "recipe_runs_versionId_organizationId_fkey" FOREIGN KEY ("versionId", "organizationId") REFERENCES "recipe_versions"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;


ALTER TABLE stock_lots ENABLE ROW LEVEL SECURITY;
ALTER TABLE stock_lots FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON stock_lots USING ("organizationId" = current_setting('app.current_tenant',true)) WITH CHECK ("organizationId" = current_setting('app.current_tenant',true));
GRANT SELECT, INSERT, UPDATE, DELETE ON stock_lots TO app_user;

ALTER TABLE lot_allocations ENABLE ROW LEVEL SECURITY;
ALTER TABLE lot_allocations FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON lot_allocations USING ("organizationId" = current_setting('app.current_tenant',true)) WITH CHECK ("organizationId" = current_setting('app.current_tenant',true));
GRANT SELECT, INSERT, UPDATE, DELETE ON lot_allocations TO app_user;

ALTER TABLE stock_operations ENABLE ROW LEVEL SECURITY;
ALTER TABLE stock_operations FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON stock_operations USING ("organizationId" = current_setting('app.current_tenant',true)) WITH CHECK ("organizationId" = current_setting('app.current_tenant',true));
GRANT SELECT, INSERT, UPDATE, DELETE ON stock_operations TO app_user;

ALTER TABLE recipes ENABLE ROW LEVEL SECURITY;
ALTER TABLE recipes FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON recipes USING ("organizationId" = current_setting('app.current_tenant',true)) WITH CHECK ("organizationId" = current_setting('app.current_tenant',true));
GRANT SELECT, INSERT, UPDATE, DELETE ON recipes TO app_user;

ALTER TABLE recipe_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE recipe_versions FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON recipe_versions USING ("organizationId" = current_setting('app.current_tenant',true)) WITH CHECK ("organizationId" = current_setting('app.current_tenant',true));
GRANT SELECT, INSERT, UPDATE, DELETE ON recipe_versions TO app_user;

ALTER TABLE recipe_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE recipe_runs FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON recipe_runs USING ("organizationId" = current_setting('app.current_tenant',true)) WITH CHECK ("organizationId" = current_setting('app.current_tenant',true));
GRANT SELECT, INSERT, UPDATE, DELETE ON recipe_runs TO app_user;

ALTER TABLE stock_lots ADD CONSTRAINT stock_lots_quantity_check CHECK (quantity >= 0);
ALTER TABLE lot_allocations ADD CONSTRAINT lot_allocations_quantity_check CHECK (quantity > 0 AND direction IN ('INCREASE','DECREASE'));
ALTER TABLE recipe_runs ADD CONSTRAINT recipe_runs_status_check CHECK (status IN ('DRAFT','PREPARING','READY','CANCELLED'));
ALTER TABLE recipe_runs ADD CONSTRAINT recipe_runs_quantity_check CHECK ("plannedQuantity" > 0 AND ("producedQuantity" IS NULL OR "producedQuantity" > 0));
ALTER TABLE recipe_versions ADD CONSTRAINT recipe_versions_quantity_check CHECK ("yieldQuantity" > 0 AND revision > 0);
ALTER TABLE stock_operations ADD CONSTRAINT stock_operations_kind_check CHECK (kind IN ('RECEIPT','CLASSIFY','COUNT','WASTE','STAFF'));
