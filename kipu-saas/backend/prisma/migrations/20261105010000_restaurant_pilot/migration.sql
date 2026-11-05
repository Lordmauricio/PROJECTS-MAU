-- CreateEnum
CREATE TYPE "OrderService" AS ENUM ('DINE_IN', 'TAKEAWAY');

-- CreateEnum
CREATE TYPE "PreparationStatus" AS ENUM ('DRAFT', 'QUEUED', 'PREPARING', 'READY', 'DELIVERED', 'CANCELLED');

-- AlterTable
ALTER TABLE "sale_items" ADD COLUMN     "productName" TEXT,
ADD COLUMN     "stockComponents" JSONB;

-- CreateTable
CREATE TABLE "menu_entries" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "station" TEXT NOT NULL DEFAULT 'Cocina',
    "price" DECIMAL(12,2) NOT NULL,
    "components" JSONB NOT NULL,
    "options" JSONB NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "menu_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "restaurant_orders" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "saleId" TEXT NOT NULL,
    "requestKey" TEXT NOT NULL,
    "requestHash" TEXT NOT NULL,
    "service" "OrderService" NOT NULL,
    "status" "PreparationStatus" NOT NULL DEFAULT 'DRAFT',
    "customerName" TEXT,
    "notes" TEXT,
    "snapshot" JSONB NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "queuedAt" TIMESTAMP(3),
    "preparingAt" TIMESTAMP(3),
    "readyAt" TIMESTAMP(3),
    "deliveredAt" TIMESTAMP(3),
    "printCount" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "restaurant_orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "restaurant_order_events" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "actorUserId" TEXT NOT NULL,
    "detail" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "restaurant_order_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "menu_entries_organizationId_idx" ON "menu_entries"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "restaurant_orders_saleId_key" ON "restaurant_orders"("saleId");

-- CreateIndex
CREATE INDEX "restaurant_orders_organizationId_branchId_status_idx" ON "restaurant_orders"("organizationId", "branchId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "restaurant_orders_organizationId_requestKey_key" ON "restaurant_orders"("organizationId", "requestKey");

-- CreateIndex
CREATE INDEX "restaurant_order_events_organizationId_orderId_idx" ON "restaurant_order_events"("organizationId", "orderId");

-- AddForeignKey
ALTER TABLE "restaurant_orders" ADD CONSTRAINT "restaurant_orders_saleId_fkey" FOREIGN KEY ("saleId") REFERENCES "sales"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "restaurant_order_events" ADD CONSTRAINT "restaurant_order_events_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "restaurant_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;


ALTER TABLE "menu_entries" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "menu_entries" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "menu_entries"
 USING ("organizationId" = current_setting('app.current_tenant', true))
 WITH CHECK ("organizationId" = current_setting('app.current_tenant', true));
GRANT SELECT, INSERT, UPDATE, DELETE ON "menu_entries" TO app_user;

ALTER TABLE "restaurant_orders" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "restaurant_orders" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "restaurant_orders"
 USING ("organizationId" = current_setting('app.current_tenant', true))
 WITH CHECK ("organizationId" = current_setting('app.current_tenant', true));
GRANT SELECT, INSERT, UPDATE, DELETE ON "restaurant_orders" TO app_user;

ALTER TABLE "restaurant_order_events" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "restaurant_order_events" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "restaurant_order_events"
 USING ("organizationId" = current_setting('app.current_tenant', true))
 WITH CHECK ("organizationId" = current_setting('app.current_tenant', true));
GRANT SELECT, INSERT, UPDATE, DELETE ON "restaurant_order_events" TO app_user;

ALTER TABLE menu_entries ADD CONSTRAINT menu_entries_price_nonnegative CHECK (price >= 0);
