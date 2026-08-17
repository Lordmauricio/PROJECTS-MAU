# Seguridad — KIPU SAAS

## Aislamiento de tenant (lo más importante)

Ver `docs/architecture.md` sección 3. Row Level Security en PostgreSQL,
reforzado (no reemplazado) por scoping a nivel de aplicación. Verificado con
`npm run verify:tenant-isolation`, que incluye una prueba explícita de que
una consulta **sin ningún WHERE**, ejecutada con el mismo rol de Postgres
que usa la aplicación en runtime (`app_user`, sin `BYPASSRLS`), no devuelve
filas de otro tenant, y que sin contexto de tenant fijado no devuelve nada
(fail-closed, no fail-open).

## Autenticación

- **Hashing de contraseñas**: Argon2id (`argon2` npm package), no
  bcrypt/MD5/SHA. Nunca se compara con `===`; siempre `argon2.verify`.
- **Tokens de acceso**: JWT firmado (HS256), vida corta (15 min por
  defecto). No se persiste en base — es stateless.
- **Refresh tokens**: opacos (no JWT), de alta entropía
  (`crypto.randomBytes(32)`), con **rotación**: cada uso revoca el token
  usado y emite uno nuevo. Solo se guarda su hash SHA-256 en base — un hash
  rápido es apropiado acá porque el secreto es aleatorio de 256 bits, no
  elegido por un humano (no hay ataque de diccionario posible).
- **Verificación de email / reset de password**: mismo patrón de token
  opaco + hash, con expiración (48h / 30min respectivamente) y marca de
  "usado" para que no se pueda reutilizar. El reset de password además
  revoca todos los refresh tokens activos del usuario.
- **Enumeración de usuarios**: `POST /auth/password-reset/request` responde
  igual exista o no el email — no revela qué cuentas existen.
- **Rate limiting**: `@nestjs/throttler` global (120 req/min por IP) más
  límites específicos en `/auth/login` (10/min) y
  `/auth/password-reset/request` (5/min) para dificultar fuerza bruta.
- **MFA**: no implementado en esta fase. El modelo de `User` no tiene
  todavía los campos necesarios (secret TOTP, códigos de recuperación);
  se agrega en una fase posterior sin romper el flujo de auth actual (el
  access token seguiría siendo JWT, solo cambiaría el paso previo a
  emitirlo).

## Autorización

- RBAC granular: cada endpoint sensible declara `@RequirePermissions(...)`
  y `PermissionsGuard` verifica **en vivo** contra `role_permissions`
  (dentro de una transacción con RLS activo, igual que cualquier otra
  query) — revocar un permiso surte efecto inmediato, no espera a que
  expire el access token.
- **`PermissionsGuard` es fail-closed por defecto.** Una ruta protegida por
  este guard debe declarar explícitamente `@RequirePermissions(...)` (exige
  el/los permiso(s) indicados) o `@NoPermissionRequired()` (opt-in
  explícito: "cualquier autenticado, sin permiso específico"). Si no
  declara ninguno de los dos, el guard lanza `ForbiddenException` — no
  existe ningún camino donde olvidar el decorador deje una ruta abierta
  por accidente. Verificado en `npm run verify:tenant-isolation`
  (sección 3): a nivel de guard (sin HTTP ni DB) y a nivel de API HTTP con
  un usuario de rol bajo (SALES) contra endpoints con y sin el permiso
  requerido, más regresión del rol OWNER contra los endpoints ya
  existentes.
- Reglas de negocio adicionales donde aplica: por ejemplo, no se puede
  quitar el rol OWNER al último propietario de una organización
  (`MembersService.changeRole`).
- **Resolución de membresías antes de tener contexto de tenant** (login,
  refresh de token): `organization_users` tiene RLS por `organizationId`,
  pero login/refresh todavía no saben con qué organización va a operar el
  request. `UserPrismaService` fija `app.current_user_id` (análogo a
  `TenantPrismaService` con `app.current_tenant`) y una policy adicional de
  solo lectura (`own_memberships_readable`) permite ver las propias filas
  de membresía por `userId` — nunca datos de negocio de otro tenant. El
  rol y la organización de la membresía elegida se resuelven después, ya
  con `tenantPrisma.run(organizationId, ...)`, para evitar que un `include`
  a través de RLS sin contexto de tenant devuelva relaciones `null` en
  silencio (bug real encontrado y corregido en la auditoría de Fase 1: el
  login para cualquier usuario que no fuera el flujo de registro estaba
  roto).

## Datos sensibles

- Nunca se guardan secretos (JWT secrets, passwords de roles de Postgres)
  en el repositorio — todo vía variables de entorno (`.env`, excluido de
  git; `.env.example` documenta las claves sin valores reales).
- El `.gitignore` de `backend/` excluye además `generated/prisma` (cliente
  generado, puede contener el schema completo embebido) y `dist/`.
- Los refresh tokens y tokens de verificación/reset nunca se loguean en
  texto plano ni se exponen en respuestas de API más allá del momento en
  que se emiten.

## Validación de entrada

- `class-validator` + `ValidationPipe` global con `whitelist: true` y
  `forbidNonWhitelisted: true`: cualquier campo no declarado en el DTO se
  rechaza, no se ignora silenciosamente — reduce superficie de mass
  assignment.
- `@EmptyToUndefined()` (`common/decorators/empty-to-undefined.decorator.ts`)
  normaliza `""` a `undefined` en campos opcionales antes de validar,
  aplicado donde importa por corrección funcional: `Customer.email` /
  `Supplier.email` (`@IsEmail()` rechaza `""`, y los formularios envían
  inputs vacíos como `""`, no `undefined`), y `Supplier.nit` /
  `Product.sku` / `Product.barcode` (tienen `@@unique([organizationId, …])`
  desde la auditoría de Fase 1 — a diferencia de `NULL`, dos filas con
  `""` sí violan un unique constraint en Postgres).
- Prisma parametriza automáticamente toda query generada por su API; todo
  `$queryRaw`/`$executeRaw` del proyecto (fijar `app.current_tenant`, la
  consulta de conteo de stock bajo en el dashboard, y los `SELECT ... FOR
  UPDATE` que bloquean la fila de `Sale`/`Purchase`/`Payable` antes de una
  transición de estado — ver `docs/architecture.md` secciones 7 y 8) usa
  interpolación segura de Prisma (tagged template), nunca concatenación de
  strings — ver `TenantPrismaService`, `OrganizationsService.getDashboardSummary`,
  y los métodos privados `lockSale`/`lockPurchase`/`lockPayable` en
  `sales.service.ts`/`purchases.service.ts`/`payables.service.ts`.

## Transporte y cabeceras

- CORS habilitado explícitamente en `main.ts` (a restringir a los orígenes
  reales del frontend cuando haya un dominio de producción definido).
- HTTPS/CSP/secure headers: responsabilidad de la capa de despliegue
  (reverse proxy / plataforma) en esta fase; no hay terminación TLS propia
  en el backend NestJS. Se documenta como pendiente de configurar en el
  entorno de producción real, no como "hecho" — no se quiere dar una falsa
  sensación de seguridad.

## Auditoría

`audit_logs` registra (vía cola de BullMQ, ver `docs/architecture.md`):
login, creación de empresa, creación/edición de sucursales, almacenes,
puntos de venta, productos, categorías, unidades, clientes, proveedores,
cambios de permisos de rol, invitación/cambio de rol/suspensión de
miembros, y desde las Fases Comerciales 2 y 3: creación/confirmación/pago/
cancelación/devolución de ventas (`sales.*`), lo mismo para compras
(`purchases.*`), recepciones (`purchases.receive`), y pagos sobre cuentas
por pagar (`payables.payment.create`). Cada registro incluye `userId`,
`organizationId`, `action`, `entityType`/`entityId` cuando aplica, IP y
user agent cuando están disponibles — nunca montos de tarjeta ni ningún
otro secreto, solo montos/cantidades de negocio.

## Qué queda pendiente (explícito, no oculto)

- MFA (modelo de datos y guard no implementados todavía).
- CSP / secure headers a nivel de aplicación (hoy depende del entorno de
  despliegue).
- Un mecanismo de gestión de secretos más allá de variables de entorno
  (Vault, AWS Secrets Manager, etc.) — apropiado cuando haya un entorno de
  producción real definido.
- Revisión de dependencias (`npm audit` / Snyk / Dependabot) automatizada
  en CI — no hay CI configurado todavía en esta fase.
