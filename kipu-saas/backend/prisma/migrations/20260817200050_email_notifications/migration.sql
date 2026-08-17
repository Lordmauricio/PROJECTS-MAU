-- Fase Comercial 9 — Notificaciones y email real.
--
-- Migración puramente aditiva: `notifications` solo gana una columna
-- nullable (`readAt`), y `email_logs` es una tabla nueva. Ningún dato
-- existente se modifica ni se elimina. `email_logs.idempotencyKey` es
-- UNIQUE (nullable) — mismo patrón que `payments.idempotencyKey` desde
-- Fase Comercial 2: reenviar el recibo de la misma venta con la misma key
-- nunca dispara un segundo correo (ver `MailService.sendReceiptEmail`).

-- CreateEnum
CREATE TYPE "EmailStatus" AS ENUM ('QUEUED', 'SENT', 'FAILED');

-- AlterTable
ALTER TABLE "notifications" ADD COLUMN     "readAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "email_logs" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "to" TEXT NOT NULL,
    "template" TEXT NOT NULL,
    "status" "EmailStatus" NOT NULL DEFAULT 'QUEUED',
    "provider" TEXT,
    "error" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "idempotencyKey" TEXT,
    "relatedEntityType" TEXT,
    "relatedEntityId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sentAt" TIMESTAMP(3),

    CONSTRAINT "email_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "email_logs_idempotencyKey_key" ON "email_logs"("idempotencyKey");

-- CreateIndex
CREATE INDEX "email_logs_organizationId_idx" ON "email_logs"("organizationId");

-- AddForeignKey
ALTER TABLE "email_logs" ADD CONSTRAINT "email_logs_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- RLS para la tabla nueva, mismo patrón que el resto del esquema.
-- `notifications` ya tenía RLS desde la migración inicial (Fase 1) — solo
-- gana una columna, no necesita policy nueva.
ALTER TABLE "email_logs" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "email_logs" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "email_logs"
  USING ("organizationId" = current_setting('app.current_tenant', true))
  WITH CHECK ("organizationId" = current_setting('app.current_tenant', true));
