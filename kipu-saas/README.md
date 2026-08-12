# KIPU SAAS

Plataforma SaaS multiempresa de gestión (ventas, inventario, compras, caja,
facturación, clientes, proveedores) para negocios en Bolivia, empezando por
Cochabamba. Este repo cubre **Fase 0 (investigación/arquitectura) y Fase 1
(Foundation)** — ver `docs/PROJECT_PLAN.md` para el detalle y qué sigue.

No es un prototipo: multi-tenancy real con aislamiento verificado a nivel
de base de datos (Row Level Security), autenticación completa, RBAC
granular, y una interfaz con datos reales (nunca inventados) para todo lo
que ya está construido.

## Empezar por acá

1. `docs/architecture.md` — arquitectura, stack y por qué (multi-tenancy,
   NestJS, Prisma 7, Redis/BullMQ).
2. `docs/database.md` — mapa del modelo de datos completo.
3. `docs/security.md` — prácticas de seguridad aplicadas y pendientes.
4. `docs/PROJECT_PLAN.md` — estado por fase y qué sigue.

## Setup local

Requisitos: Node.js 22+, PostgreSQL 16+, Redis 7+ (o `docker compose up postgres redis`).

### Backend

```bash
cd backend
npm install

createdb kipu_saas
cp .env.example .env   # ajusta DATABASE_URL si tu setup de Postgres difiere

# Aplica el esquema + crea el rol app_user (sin BYPASSRLS) y las policies
# de RLS en 32 tablas + organizations (todo en la migración inicial).
npx prisma migrate dev

# Actualiza RUNTIME_DATABASE_URL en .env con la password que uses para
# app_user (por defecto en la migración: app_user_dev_password — CAMBIAR
# en cualquier ambiente que no sea tu máquina local).

# Siembra el catálogo global de permisos y el plan "Gratis".
npx prisma db seed

npm run start:dev   # http://localhost:4200
```

### Frontend

```bash
cd frontend
npm install
cp .env.local.example .env.local
npm run dev          # http://localhost:3000
```

### Con Docker

```bash
docker compose up --build
```

> Nota: el build de las imágenes Docker no se pudo probar en el entorno de
> desarrollo de esta sesión (sin daemon de Docker disponible ahí). La
> sintaxis de `docker-compose.yml` se validó con `docker compose config` y
> los `Dockerfile` se revisaron a mano, pero **conviene correr
> `docker compose build` una vez en un entorno con Docker real** antes de
> depender de esto para producción.

## Verificar el aislamiento de tenant

```bash
cd backend
npm run verify:tenant-isolation
```

Registra dos empresas de prueba y comprueba, vía API HTTP y vía SQL crudo
**sin ningún WHERE** contra el mismo rol de Postgres que usa la app en
runtime, que ninguna ve datos de la otra — incluyendo los eventos de
auditoría que se procesan de forma asíncrona por una cola de BullMQ.

## Estructura

```
kipu-saas/
  docker-compose.yml
  docs/
  backend/    NestJS + Prisma 7 + PostgreSQL + Redis/BullMQ
  frontend/   Next.js + Tailwind
```
