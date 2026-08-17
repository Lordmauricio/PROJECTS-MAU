-- Fase Comercial 8 — Recibos comerciales NO FISCALES.
--
-- Migración puramente aditiva: dos tablas nuevas (`receipt_sequences`,
-- `commercial_receipts`), ninguna columna nueva en tablas existentes,
-- ningún dato existente se modifica ni se elimina. `commercial_receipts`
-- tiene `saleId` UNIQUE (relación 1:1 estricta con `sales`, una venta
-- nunca puede tener dos recibos) y `(organizationId, series, number)`
-- UNIQUE (nunca dos recibos con el mismo número dentro de la misma
-- organización). `snapshot` es JSONB — inmutable una vez creado el recibo,
-- nunca se vuelve a escribir (ver `ReceiptsService`/
-- `docs/architecture.md` sección 14).

-- CreateTable
CREATE TABLE "receipt_sequences" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "series" TEXT NOT NULL DEFAULT 'REC',
    "lastNumber" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "receipt_sequences_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "commercial_receipts" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "saleId" TEXT NOT NULL,
    "series" TEXT NOT NULL,
    "number" INTEGER NOT NULL,
    "snapshot" JSONB NOT NULL,
    "issuedById" TEXT,
    "issuedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "commercial_receipts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "receipt_sequences_organizationId_key" ON "receipt_sequences"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "commercial_receipts_saleId_key" ON "commercial_receipts"("saleId");

-- CreateIndex
CREATE INDEX "commercial_receipts_organizationId_idx" ON "commercial_receipts"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "commercial_receipts_organizationId_series_number_key" ON "commercial_receipts"("organizationId", "series", "number");

-- AddForeignKey
ALTER TABLE "commercial_receipts" ADD CONSTRAINT "commercial_receipts_saleId_fkey" FOREIGN KEY ("saleId") REFERENCES "sales"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- RLS para ambas tablas nuevas, mismo patrón que el resto del esquema.
ALTER TABLE "receipt_sequences" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "receipt_sequences" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "receipt_sequences"
  USING ("organizationId" = current_setting('app.current_tenant', true))
  WITH CHECK ("organizationId" = current_setting('app.current_tenant', true));

ALTER TABLE "commercial_receipts" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "commercial_receipts" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "commercial_receipts"
  USING ("organizationId" = current_setting('app.current_tenant', true))
  WITH CHECK ("organizationId" = current_setting('app.current_tenant', true));
