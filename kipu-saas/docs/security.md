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
- Reglas de negocio adicionales donde aplica: por ejemplo, no se puede
  quitar el rol OWNER al último propietario de una organización
  (`MembersService.changeRole`).

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
- Prisma parametriza automáticamente toda query generada por su API;
  los únicos `$queryRaw`/`$executeRaw` del proyecto (fijar
  `app.current_tenant`, y una consulta de conteo de stock bajo en el
  dashboard) usan interpolación segura de Prisma (tagged template), nunca
  concatenación de strings — ver `TenantPrismaService` y
  `OrganizationsService.getDashboardSummary`.

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
miembros. Cada registro incluye `userId`, `organizationId`, `action`,
`entityType`/`entityId` cuando aplica, IP y user agent cuando están
disponibles.

## Qué queda pendiente (explícito, no oculto)

- MFA (modelo de datos y guard no implementados todavía).
- CSP / secure headers a nivel de aplicación (hoy depende del entorno de
  despliegue).
- Un mecanismo de gestión de secretos más allá de variables de entorno
  (Vault, AWS Secrets Manager, etc.) — apropiado cuando haya un entorno de
  producción real definido.
- Revisión de dependencias (`npm audit` / Snyk / Dependabot) automatizada
  en CI — no hay CI configurado todavía en esta fase.
