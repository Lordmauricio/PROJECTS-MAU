#!/bin/sh
set -e

echo "Aplicando migraciones (crea también el rol app_user y las policies de RLS si es la primera vez)..."
npx prisma migrate deploy

echo "Sembrando catálogo de permisos y plan gratuito (idempotente)..."
npx tsx prisma/seed.ts

echo "Iniciando KIPU SAAS backend..."
exec node dist/src/main.js
