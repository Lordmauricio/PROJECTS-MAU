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

# Generá los secretos (NO hay valores por defecto: ninguna contraseña vive
# en el repositorio) y pegalos en .env — APP_USER_PASSWORD, JWT_ACCESS_SECRET
# y JWT_REFRESH_SECRET:
openssl rand -base64 32

# Aplica el esquema + crea el rol app_user (sin BYPASSRLS) y las policies
# de RLS en 32 tablas + organizations (todo en la migración inicial).
npx prisma migrate dev

# Asigna la contraseña de app_user desde APP_USER_PASSWORD. Las migraciones
# crean el rol SIN contraseña a propósito, así que este paso es obligatorio:
# hasta que corra, la app no puede conectarse (fail-closed deliberado).
# Correrlo de nuevo con otro valor es también la forma de ROTAR la clave.
npm run db:provision-roles

# Copiá esa misma contraseña dentro de RUNTIME_DATABASE_URL en .env.

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

### Despliegue en producción

Ver **[docs/deployment.md](docs/deployment.md)**: variables obligatorias,
health checks (`/health` liveness, `/health/ready` readiness), backups con
`pg_dump` y procedimiento de restauración, y endurecimiento aplicado
(CORS, helmet, rate limiting, manejo de errores).

El backend **valida su configuración al arrancar** y se niega a levantar si
falta un secreto, si `CORS_ORIGINS` no está definido en producción o si
`EMAIL_PROVIDER=console` en producción.

### Con Docker

`docker-compose.yml` no contiene ningún secreto: los toma del entorno y
falla de entrada si falta alguno. Creá un `.env` en la raíz del repo
(está en `.gitignore`) con valores generados por vos:

```bash
cat > .env <<EOF
POSTGRES_PASSWORD=$(openssl rand -base64 32)
APP_USER_PASSWORD=$(openssl rand -base64 32)
JWT_ACCESS_SECRET=$(openssl rand -base64 32)
JWT_REFRESH_SECRET=$(openssl rand -base64 32)
EOF

docker compose up --build
```

El `docker-entrypoint.sh` del backend aplica las migraciones y luego asigna
la contraseña de `app_user` con `db:provision-roles` automáticamente.

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
