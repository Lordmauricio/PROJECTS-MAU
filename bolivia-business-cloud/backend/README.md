# Bolivia Business Cloud — Backend (Fase 1)

Backend NestJS + Prisma + PostgreSQL. Fase 1 del roadmap (ver
`../docs/ROADMAP.md`): backbone multi-tenant, autenticación y RBAC granular.
Todavía no incluye módulos de negocio (ventas, inventario, facturación) —
esos llegan en fases siguientes.

## Requisitos

- Node.js 22+
- PostgreSQL 14+ (se probó contra PostgreSQL 16)

## Arquitectura de tenancy (leer antes de tocar código)

Ver `../docs/ARCHITECTURE.md`. Resumen: base de datos compartida, aislamiento
por `organizationId` + PostgreSQL Row Level Security. La app se conecta con
un rol de base de datos (`app_user`) que **no tiene BYPASSRLS** — las
policies de RLS se aplican siempre, incluso si el código de la aplicación
tuviera un bug. Toda consulta a una tabla tenant-scoped debe pasar por
`TenantPrismaService.run(organizationId, tx => ...)`.

## Setup

```bash
npm install

# Base de datos
createdb bolivia_business_cloud

cp .env.example .env
# Edita DATABASE_URL (rol admin, usado por `prisma migrate`) si tu setup
# de Postgres es distinto al default.

# Aplica el esquema + crea el rol `app_user` (sin BYPASSRLS) y las policies
# de RLS (todo está en la migración inicial).
npx prisma migrate dev

# Actualiza RUNTIME_DATABASE_URL en .env con la password que uses para
# app_user (por defecto en la migración: app_user_dev_password — CAMBIAR en
# cualquier ambiente que no sea tu máquina local).

# Siembra el catálogo global de permisos (una sola vez, no es tenant-scoped).
npx prisma db seed

npm run start:dev   # http://localhost:4100
```

## Verificar el aislamiento de tenant

```bash
npm run verify:tenant-isolation
```

Este comando compila el proyecto y corre `scripts/verify-tenant-isolation.ts`
contra una instancia real de la app: registra dos organizaciones, prueba que
ninguna ve datos de la otra vía la API, y además ejecuta una consulta SQL
cruda **sin ningún WHERE** con el mismo rol de Postgres que usa la app en
runtime, para probar que Row Level Security bloquea la fuga incluso si el
código de aplicación tuviera un bug de filtrado. Por qué no es un test de
Jest: ver el comentario al inicio de ese script (problema conocido de
interoperabilidad entre el compilador WASM de Prisma 7 y `ts-jest`/`tsx`).

## Estructura

```
src/
  prisma/          PrismaService (conexión app_user) y TenantPrismaService
  auth/             registro, login, refresh, verificación de email, reset de password
  organizations/    bootstrap de organización nueva (con roles/permisos por defecto)
  branches/         sucursales
  roles/            roles y su catálogo de permisos por organización
  members/          gestión de miembros de la organización (invitar, cambiar rol, suspender)
  permissions/      catálogo global de permisos + mapeo de roles por defecto
  common/           guards y decoradores compartidos (@RequirePermissions, @CurrentAuth)
scripts/
  verify-tenant-isolation.ts   verificación de RLS (ver arriba)
```

## Notas de seguridad importantes

- `RUNTIME_DATABASE_URL` **debe** apuntar al rol `app_user` (sin BYPASSRLS).
  Si apunta al mismo superusuario que `DATABASE_URL`, el aislamiento de
  tenant deja de existir silenciosamente — Postgres no avisa, simplemente
  ignora las policies para superusuarios/roles con BYPASSRLS.
- El rol `app_superadmin` (con BYPASSRLS) queda creado por la migración para
  el backoffice del SaaS (Fase 8 del roadmap) pero **ningún código lo usa
  todavía**.
- Los permisos se verifican en vivo contra la base de datos en cada request
  (`PermissionsGuard`), no confían en un snapshot embebido en el JWT: revocar
  un permiso a un rol tiene efecto inmediato.
