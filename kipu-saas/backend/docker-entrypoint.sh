#!/bin/sh
set -e

echo "Aplicando migraciones (crea también los roles app_user/app_superadmin y las policies de RLS si es la primera vez)..."
npx prisma migrate deploy

# Las migraciones crean `app_user` SIN contraseña a propósito: una migración
# versionada nunca debe contener una credencial. Este paso se la asigna a
# partir de APP_USER_PASSWORD, y es idempotente (correrlo de nuevo con otro
# valor es justamente la forma de rotarla).
echo "Asignando contraseñas de los roles Postgres desde variables de entorno..."
npx tsx scripts/provision-db-roles.ts

echo "Sembrando catálogo de permisos y plan gratuito (idempotente)..."
npx tsx prisma/seed.ts

echo "Iniciando KIPU SAAS backend..."
exec node dist/src/main.js
