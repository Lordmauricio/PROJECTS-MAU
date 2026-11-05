-- AlterTable
ALTER TABLE "restaurant_orders" ADD COLUMN     "accountId" TEXT;

-- CreateTable
CREATE TABLE "dining_tables" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "area" TEXT NOT NULL DEFAULT 'Salón',
    "seats" INTEGER NOT NULL DEFAULT 4,
    "active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "dining_tables_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "dining_accounts" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "tableId" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "posTerminalId" TEXT NOT NULL,
    "warehouseId" TEXT NOT NULL,
    "waiterId" TEXT NOT NULL,
    "waiterName" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "version" INTEGER NOT NULL DEFAULT 0,
    "requestKey" TEXT NOT NULL,
    "requestHash" TEXT NOT NULL,
    "mergedIntoId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "closedAt" TIMESTAMP(3),
    "tipAmount" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "tipMethod" TEXT,
    "closeHash" TEXT,

    CONSTRAINT "dining_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "dining_tables_id_organizationId_key" ON "dining_tables"("id", "organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "dining_tables_organizationId_branchId_name_key" ON "dining_tables"("organizationId", "branchId", "name");

-- CreateIndex
CREATE INDEX "dining_accounts_organizationId_branchId_status_idx" ON "dining_accounts"("organizationId", "branchId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "dining_accounts_id_organizationId_key" ON "dining_accounts"("id", "organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "dining_accounts_organizationId_requestKey_key" ON "dining_accounts"("organizationId", "requestKey");

-- AddForeignKey
ALTER TABLE "restaurant_orders" ADD CONSTRAINT "restaurant_orders_accountId_organizationId_fkey" FOREIGN KEY ("accountId", "organizationId") REFERENCES "dining_accounts"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dining_accounts" ADD CONSTRAINT "dining_accounts_tableId_organizationId_fkey" FOREIGN KEY ("tableId", "organizationId") REFERENCES "dining_tables"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;


ALTER TABLE dining_tables ADD CONSTRAINT dining_tables_seats_check CHECK (seats BETWEEN 1 AND 100);
ALTER TABLE dining_accounts ADD CONSTRAINT dining_accounts_status_check CHECK (status IN ('OPEN','CLOSED','MERGED'));
ALTER TABLE dining_accounts ADD CONSTRAINT dining_accounts_tip_check CHECK ("tipAmount" >= 0 AND ("tipMethod" IS NULL OR "tipMethod" IN ('CASH','CARD','TRANSFER','QR')));
ALTER TABLE dining_tables ENABLE ROW LEVEL SECURITY;
ALTER TABLE dining_tables FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON dining_tables USING ("organizationId" = current_setting('app.current_tenant',true)) WITH CHECK ("organizationId" = current_setting('app.current_tenant',true));
ALTER TABLE dining_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE dining_accounts FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON dining_accounts USING ("organizationId" = current_setting('app.current_tenant',true)) WITH CHECK ("organizationId" = current_setting('app.current_tenant',true));
GRANT SELECT, INSERT, UPDATE, DELETE ON dining_tables, dining_accounts TO app_user;
INSERT INTO permissions (id,key,module,description) VALUES
 ('perm_dining_read','dining.read','restaurant','Ver mesas y cuentas de salón'),
 ('perm_dining_serve','dining.serve','restaurant','Atender mesas y enviar comandas sin cobrar')
ON CONFLICT (key) DO NOTHING;
-- Add only the new permissions to existing standard service roles; preserve custom roles.
INSERT INTO role_permissions (id,"organizationId","roleId","permissionId")
SELECT 'drp_' || md5(r.id || p.id), r."organizationId", r.id, p.id FROM roles r CROSS JOIN permissions p
WHERE (r.key IN ('OWNER','ADMIN','MANAGER','CASHIER','SALES') AND p.key IN ('dining.read','dining.serve')) OR (r.key='AUDITOR' AND p.key='dining.read')
ON CONFLICT DO NOTHING;

INSERT INTO roles (id,"organizationId",key,name,"isSystem","updatedAt")
SELECT 'dwr_' || md5(id), id, 'WAITER', 'Mesero', true, NOW() FROM organizations
ON CONFLICT ("organizationId",key) DO NOTHING;
INSERT INTO role_permissions (id,"organizationId","roleId","permissionId")
SELECT 'dwrp_' || md5(r.id || p.id), r."organizationId", r.id, p.id FROM roles r CROSS JOIN permissions p
WHERE r.key='WAITER' AND p.key IN ('dining.read','dining.serve','products.read','organization.branches.read')
ON CONFLICT DO NOTHING;
