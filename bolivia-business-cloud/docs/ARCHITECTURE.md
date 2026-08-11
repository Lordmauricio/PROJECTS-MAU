# Arquitectura — Bolivia Business Cloud

## 1. Multi-tenancy: estrategia elegida

**Base de datos compartida (pooled), aislamiento por `tenant_id` (=
`organization_id`) en cada tabla, reforzado con Row Level Security (RLS) de
PostgreSQL como segunda barrera.**

### Alternativas consideradas

| Estrategia | Por qué NO |
|---|---|
| Database-per-tenant | Con "cientos o miles de empresas" (spec), significa cientos/miles de bases de datos: migraciones, backups, pooling de conexiones y monitoreo se vuelven un problema operativo antes que un problema de producto. Válido solo como plan "Enterprise" aislado a futuro, no como default. |
| Schema-per-tenant | Mismo problema de migraciones a escala (aplicar una migración a 1000 schemas), y Prisma/la mayoría de ORMs no tienen soporte de primera clase para esto. Complejidad sin beneficio claro para el tamaño de negocio objetivo (PyMEs). |
| Solo `tenant_id` a nivel de aplicación, sin RLS | Un solo `WHERE` olvidado en un query nuevo filtra datos entre empresas. Dado que esto maneja facturación fiscal, el costo de ese bug es inaceptable. |

### Diseño elegido en detalle

- Toda tabla que pertenece a una empresa tiene `organization_id uuid NOT
  NULL REFERENCES organizations(id)`.
- **RLS activado** en esas tablas con una policy que compara
  `organization_id` contra un parámetro de sesión Postgres:
  `current_setting('app.current_tenant')::uuid`.
- Cada request autenticado abre su unidad de trabajo con:
  ```sql
  SET LOCAL app.current_tenant = '<organization_id del usuario>';
  ```
  dentro de una transacción (`prisma.$transaction` con `SET LOCAL` como
  primera sentencia raw), de forma que **incluso si el código de aplicación
  se olvida un `where: { organizationId }`, la base de datos igual filtra**.
- El **backoffice del dueño del SaaS** (sección 30 del spec) es el único rol
  que opera con un `BYPASSRLS` role de Postgres o con policies adicionales
  explícitas de "superadmin", nunca reusando la sesión normal de tenant.
- `organizations` es la tabla raíz (no tiene `organization_id`, se es a sí
  misma la raíz de aislamiento).

### Por qué esto sí escala a "cientos o miles de empresas"

- Una sola base de datos (o un clúster con réplicas de lectura) sirve a todos
  los tenants: una migración se aplica una vez.
- Los índices llevan `organization_id` como primera columna compuesta
  (`@@index([organizationId, ...])`) para que cada query de un tenant golpee
  un rango angosto del índice, no toda la tabla.
- Si en el futuro un tenant específico (plan Enterprise) necesita
  aislamiento físico real, el mismo modelo de datos permite "mudarlo" a una
  base de datos dedicada sin cambiar el dominio: es un problema de
  infraestructura/routing de conexión, no de esquema.

## 2. Stack tecnológico

| Capa | Elección | Por qué |
|---|---|---|
| Frontend | Next.js (App Router) + TypeScript + Tailwind CSS | Ya validado en este entorno (Next 16 instalado y funcionando). SSR/SSG donde convenga (landing, portal de cliente), client components para POS/dashboards interactivos. |
| Backend | Node.js + TypeScript + **NestJS** | El spec pide separación estricta de módulos (Auth, Organizations, Billing, SIN Integration, etc.) con interfaces desacopladas (`SinProvider`, `PaymentProvider`) e inyección de dependencias real. Nest da eso de fábrica (módulos, providers, guards, interceptors, pipes de validación) sin reinventarlo a mano como en el MVP anterior (Express plano), que no escala a 20+ módulos con disciplina. |
| Base de datos | PostgreSQL | RLS nativo, JSON, extensiones fiscales/numéricas (`numeric` para montos, nunca `float`), robusto para reportes. |
| ORM | **Prisma** | Migraciones versionadas legibles, tipado end-to-end, y soporte suficiente para el patrón `SET LOCAL` + `$transaction` que necesita RLS. Se evalúa Drizzle si en el futuro se necesita más control fino de SQL en reportes pesados; ambos pueden convivir (Prisma para CRUD transaccional, SQL crudo/Drizzle solo para reportes analíticos). |
| Cache | Redis | Sesiones, rate limiting, cache de catálogos SIN, cache de CUFD vigente por punto de venta. |
| Colas | Redis + BullMQ | Sincronización de catálogos, envío de facturas con reintentos/backoff, generación de PDF, notificaciones, jobs de conciliación. |
| Storage | S3-compatible (MinIO en dev, S3/Backblaze en prod) | XML/PDF de facturas, logos, certificados cifrados, exports. |
| Auth | Sesiones/JWT propios sobre Nest + Passport, hashing con Argon2id | MFA preparado (tabla `mfa_secrets`, no implementada en fase 1), rate limiting con Redis, verificación de email. |
| Infra | Docker Compose (dev), CI con GitHub Actions, migraciones en pipeline, health checks `/health` | Reproducible, sin asumir un proveedor cloud específico todavía. |

## 3. Módulos (monolito modular)

Un solo backend Nest, con **límites de módulo estrictos** (cada módulo expone
solo su `*.service` público vía su propio `Module`, nunca se importan
repositorios de otro módulo directamente):

```
src/
  auth/
  organizations/
  users/            (incluye roles y permisos)
  branches/
  pos-terminals/
  customers/
  suppliers/
  catalog/          (products, categories, units)
  inventory/
  sales/            (incluye POS)
  purchases/
  cash/
  expenses/
  receivables/
  payables/
  billing/          (dominio de Invoice — NO sabe nada de SOAP/SIN)
  fiscal/
    sin/            (SinProvider, SinBoliviaProvider, XML builder, firma, CUIS/CUFD/CUF)
  reports/
  notifications/
  audit/
  subscriptions/    (planes del SaaS, feature flags)
  files/
  settings/
  admin/            (backoffice del dueño del SaaS — sección 30)
```

`billing/` (el dominio de facturación de la empresa-cliente) depende de una
interfaz `FiscalProvider` que `fiscal/sin/` implementa. Esto es lo que
permite que mañana exista un `FiscalProviderArgentina` o que cambie el
proveedor SIN sin tocar `billing/`.

## 4. Consistencia financiera

- Todo monto es `Decimal` (Prisma `Decimal` → Postgres `numeric(18,2)`),
  nunca `float`/`number` de JS para dinero.
- Todo movimiento de caja, inventario o factura genera un registro de
  auditoría inmutable (`audit_logs` + tablas de eventos específicas como
  `invoice_events`) — nunca se actualiza en sitio un monto histórico, se
  agregan eventos de corrección.
- Idempotencia: toda operación que dispara efectos externos irreversibles
  (emitir factura, cobrar) exige una `idempotency_key` provista por el
  cliente (POS) o generada determinísticamente a partir de la venta, y
  queda una constraint `UNIQUE` en base de datos para impedir duplicados
  aunque el mismo request llegue dos veces por un retry de red.

## 5. Qué no se decide todavía

- Proveedor de pagos para las suscripciones del SaaS (sección 32): no se
  investigó en esta pasada; queda como interfaz `PaymentProvider` sin
  implementación concreta.
- Mecanismo exacto de contingencia offline (sección 25): depende de la
  investigación pendiente en `docs/sin/README.md`.
