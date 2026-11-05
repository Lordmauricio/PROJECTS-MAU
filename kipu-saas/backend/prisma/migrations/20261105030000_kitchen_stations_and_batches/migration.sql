-- CreateTable
CREATE TABLE "kitchen_tasks" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "station" TEXT NOT NULL,
    "status" "PreparationStatus" NOT NULL DEFAULT 'QUEUED',
    "version" INTEGER NOT NULL DEFAULT 0,
    "printCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "startedAt" TIMESTAMP(3),
    "readyAt" TIMESTAMP(3),

    CONSTRAINT "kitchen_tasks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "production_batches" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "warehouseId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "station" TEXT NOT NULL,
    "sourceProductId" TEXT NOT NULL,
    "sourceName" TEXT NOT NULL,
    "outputProductId" TEXT NOT NULL,
    "outputName" TEXT NOT NULL,
    "sourceQuantity" DECIMAL(12,2) NOT NULL,
    "plannedQuantity" DECIMAL(12,2) NOT NULL,
    "producedQuantity" DECIMAL(12,2),
    "status" "PreparationStatus" NOT NULL DEFAULT 'DRAFT',
    "requestKey" TEXT NOT NULL,
    "requestHash" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 0,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "startedAt" TIMESTAMP(3),
    "readyAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),
    "cancelReason" TEXT,

    CONSTRAINT "production_batches_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "kitchen_tasks_organizationId_station_status_idx" ON "kitchen_tasks"("organizationId", "station", "status");

-- CreateIndex
CREATE UNIQUE INDEX "kitchen_tasks_orderId_station_key" ON "kitchen_tasks"("orderId", "station");

-- CreateIndex
CREATE INDEX "production_batches_organizationId_branchId_status_idx" ON "production_batches"("organizationId", "branchId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "production_batches_organizationId_requestKey_key" ON "production_batches"("organizationId", "requestKey");

-- CreateIndex
CREATE UNIQUE INDEX "restaurant_orders_id_organizationId_key" ON "restaurant_orders"("id", "organizationId");

-- AddForeignKey
ALTER TABLE "kitchen_tasks" ADD CONSTRAINT "kitchen_tasks_orderId_organizationId_fkey" FOREIGN KEY ("orderId", "organizationId") REFERENCES "restaurant_orders"("id", "organizationId") ON DELETE CASCADE ON UPDATE CASCADE;


INSERT INTO kitchen_tasks (id, "organizationId", "orderId", station, status, version, "createdAt", "startedAt", "readyAt")
SELECT 'kt_' || md5(o.id || ':' || st.station), o."organizationId", o.id, st.station,
 CASE WHEN o.status = 'PREPARING' THEN 'PREPARING'::"PreparationStatus"
      WHEN o.status IN ('READY', 'DELIVERED') THEN 'READY'::"PreparationStatus"
      ELSE 'QUEUED'::"PreparationStatus" END,
 0, COALESCE(o."queuedAt", o."createdAt"), o."preparingAt", o."readyAt"
FROM restaurant_orders o
CROSS JOIN LATERAL (SELECT DISTINCT COALESCE(NULLIF(line->>'station',''), 'Cocina') AS station FROM jsonb_array_elements(o.snapshot) AS line) st
WHERE o.status IN ('QUEUED','PREPARING','READY','DELIVERED');
ALTER TABLE kitchen_tasks ADD CONSTRAINT kitchen_tasks_status_check CHECK (status IN ('QUEUED','PREPARING','READY','CANCELLED'));
ALTER TABLE production_batches ADD CONSTRAINT production_batches_status_check CHECK (status IN ('DRAFT','PREPARING','READY','CANCELLED'));
ALTER TABLE production_batches ADD CONSTRAINT production_batches_quantities_check CHECK ("sourceQuantity" > 0 AND "plannedQuantity" > 0 AND ("producedQuantity" IS NULL OR "producedQuantity" > 0));

ALTER TABLE "kitchen_tasks" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "kitchen_tasks" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "kitchen_tasks" USING ("organizationId" = current_setting('app.current_tenant', true)) WITH CHECK ("organizationId" = current_setting('app.current_tenant', true));
GRANT SELECT, INSERT, UPDATE, DELETE ON "kitchen_tasks" TO app_user;

ALTER TABLE "production_batches" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "production_batches" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "production_batches" USING ("organizationId" = current_setting('app.current_tenant', true)) WITH CHECK ("organizationId" = current_setting('app.current_tenant', true));
GRANT SELECT, INSERT, UPDATE, DELETE ON "production_batches" TO app_user;
