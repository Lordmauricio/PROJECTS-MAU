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
  `sales.service.ts`/`purchases.service.ts`/`payables.service.ts`, más
  `lockPayableByPurchase` en `purchases.service.ts` (agregado en la
  auditoría post-Fase 6, ver sección "Auditoría post-Fase 6" más abajo).

## Credenciales de la base de datos

Ninguna contraseña vive en el repositorio — ni en las migraciones, ni en
`docker-compose.yml`, ni en `.env.example`:

- **Migraciones**: crean los roles `app_user` y `app_superadmin` sin
  contraseña. Están versionadas, así que cualquier credencial escrita ahí
  sería pública e idéntica en todos los despliegues. Hasta la auditoría
  final pre-producción sí la tenían (`app_user_dev_password` /
  `app_superadmin_dev_password`); la migración
  `20260817230000_db_roles_no_hardcoded_passwords` remedia también las bases
  que ya habían aplicado esa versión, quitándoles la contraseña filtrada.
- **Asignación y rotación**: `npm run db:provision-roles`
  (`scripts/provision-db-roles.ts`) lee `APP_USER_PASSWORD` del entorno y se
  la asigna al rol. Correrlo de nuevo con otro valor es la forma de rotar.
  El script rechaza contraseñas de menos de 16 caracteres y los valores de
  ejemplo conocidos, y nunca imprime el secreto (ni siquiera en el stack de
  error, que se recorta al mensaje para no exponer la cadena de conexión).
- **Fail-closed**: mientras no se provisione, `app_user` existe con sus
  GRANTs y sujeto a las policies, pero no puede autenticarse bajo
  `scram-sha-256`/`md5`. La aplicación falla al conectar en vez de arrancar
  con una credencial conocida.
- **`app_superadmin` queda `NOLOGIN`**: es el único rol con `BYPASSRLS`
  (ve y escribe datos de cualquier tenant) y ningún módulo lo usa todavía,
  así que ni siquiera puede conectarse salvo que alguien defina
  explícitamente `APP_SUPERADMIN_PASSWORD` al provisionar.
- **`PrismaService` verifica en el arranque** que `RUNTIME_DATABASE_URL` no
  apunte a un rol con `BYPASSRLS`, para que un error de configuración no
  desactive el aislamiento en silencio.

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
por pagar (`payables.payment.create`). Desde la Fase Comercial 4:
`inventory.movement.create` (entrada/salida manual y ajuste) e
`inventory.transfer.create` (transferencia entre almacenes). Desde la Fase
Comercial 5: `cash.open`, `cash.close`, `cash.movement.create`,
`expenses.create`. Desde la Fase Comercial 6: `receivables.create`
(al confirmarse una venta a crédito), `receivables.payment.create`
(además del `sales.payment.create` ya existente, para que una Receivable
tenga su propio rastro de auditoría), `sales.refund.create`. Desde la Fase
Comercial 7: `reports.export` (cada exportación CSV/Excel, con el formato,
la cantidad de filas exportadas y los filtros usados — para saber quién
sacó qué datos de la empresa, cuándo). Desde la Fase Comercial 8:
`receipts.issue` (emisión de un recibo comercial, con `saleId`/`series`/
`number`) y `receipts.pdf.download` (cada descarga de PDF, con el
formato — A4 o ticket 80mm). Cada registro incluye `userId`,
`organizationId`, `action`, `entityType`/`entityId` cuando aplica, IP y
user agent cuando están disponibles — nunca montos de tarjeta ni ningún
otro secreto, solo montos/cantidades de negocio.

## Fase Comercial 4 — Inventario avanzado: notas de seguridad específicas

- **RLS en la tabla nueva**: `inventory_transfers` tiene `ENABLE`/`FORCE
  ROW LEVEL SECURITY` + policy `tenant_isolation`, mismo patrón que el
  resto del esquema — agregado a mano en la migración
  `20260817142135_inventory_advanced_core` (Prisma no genera RLS por sí
  solo). Probado con SQL crudo bajo el mismo rol de Postgres que usa la
  aplicación (`app_user`, sin `BYPASSRLS`): con contexto de un tenant real
  se ven solo sus propias filas de `inventories`/`inventory_movements`/
  `inventory_transfers`; con contexto de un tenant inexistente, cero filas
  (fail-closed) — ver `inventory.security.spec.ts`.
- **Sin permisos nuevos**: se reutilizan `inventory.manage`/
  `inventory.read`, ya existentes desde Fase 0. La descripción de
  `inventory.manage` en el catálogo ("Registrar entradas, salidas, ajustes
  y transferencias de inventario") ya anticipaba el alcance completo de
  esta fase, así que no había justificación para crear permisos separados
  por operación (leer/mover/ajustar/transferir) — se habría violado la
  instrucción de no crear permisos salvo que sean necesarios.
- **No se filtra existencia entre tenants**: un intento de registrar un
  movimiento o transferencia contra un almacén/producto de OTRA
  organización responde `400` ("Almacén no encontrado"/"Producto no
  encontrado"), nunca `404` con detalle ni `500` — el mensaje es el mismo
  que si el recurso simplemente no existiera, porque desde la perspectiva
  del tenant que hace el request, no existe.
- **Corrección de idempotencia con implicación de seguridad**: la primera
  versión de `registerManualMovement`/`transfer` devolvía en silencio
  cualquier registro que encontrara al reusar una `idempotencyKey`, sin
  verificar que perteneciera a la misma operación. Aunque
  `idempotencyKey` no es un identificador secreto ni cruza el límite de
  tenant (RLS ya impide que el registro encontrado sea de otro tenant), sí
  era un defecto de integridad: un cliente podía recibir como "su"
  resultado el de una operación ajena dentro del mismo tenant si
  reutilizaba una key por error. Corregido — ver `docs/architecture.md`
  sección 9 para el detalle técnico y `docs/PROJECT_PLAN.md` para el
  seguimiento.

## Fase Comercial 5 — Caja y Gastos: notas de seguridad específicas

- **RLS ya existía**: `cash_registers`/`cash_movements`/`expenses` tenían
  `ENABLE`/`FORCE ROW LEVEL SECURITY` + policy `tenant_isolation` desde la
  migración inicial (eran placeholders de esquema desde la Fase 1, sin
  endpoints hasta ahora) — no hizo falta agregar RLS nueva en esta fase,
  solo columnas. Probado con SQL crudo bajo `app_user` (sin `BYPASSRLS`):
  con contexto de un tenant real se ven solo sus propias filas; con
  contexto de un tenant inexistente, cero filas (fail-closed) — ver
  `cash.security.spec.ts`.
- **Permisos nuevos, solo los necesarios**: se agregaron `cash.read` y
  `expenses.read` (antes solo existían las variantes `.manage`, sin
  ninguna forma de dar acceso de solo lectura — el mismo motivo que llevó
  a agregar `payables.read` en la Fase Comercial 3). No se crearon
  permisos por operación (abrir/cerrar/mover por separado): `cash.manage`
  ya cubría las tres desde su descripción original en el catálogo.
- **No se filtra existencia entre tenants**: abrir una caja reusando el
  `posTerminalId` de OTRA organización responde `400` ("Punto de venta no
  encontrado"), igual que el resto del sistema; operar sobre una caja
  (`GET`/`close`/`movements`) de otro tenant responde `404`, nunca
  filtra si el id existe para otro tenant.
- **Índice único parcial como control de integridad, no solo de
  concurrencia**: el índice `cash_registers_one_open_per_terminal` (`ON
  "posTerminalId" WHERE status = 'OPEN'`) no es únicamente una
  optimización de rendimiento bajo carrera — es la única barrera real
  contra que dos aperturas concurrentes (posible incluso desde el mismo
  usuario con dos pestañas, o dos cajeros distintos) dejen dos cajas
  abiertas simultáneas para el mismo punto de venta, lo cual rompería la
  premisa de todo el módulo (un arqueo solo tiene sentido contra UNA
  caja). Ver `docs/architecture.md` sección 10.
- **Nunca saldo negativo, decisión de seguridad financiera explícita**:
  ver `docs/architecture.md` sección 10 y `docs/PROJECT_PLAN.md`. Egresos
  y gastos que superarían el saldo disponible se rechazan con `400`,
  calculado bajo lock para que sea correcto incluso bajo dos intentos
  concurrentes.

## Fase Comercial 6 — Pagos y Cuentas: notas de seguridad específicas

- **RLS ya existía para `receivables`** (placeholder desde Fase 1); la
  tabla nueva `refunds` la agrega igual que el resto del esquema, con
  policy `tenant_isolation` agregada a mano en la migración
  `20260817170000_payments_and_accounts_core`. Probado con SQL crudo
  (contexto de tenant inexistente → cero filas) — ver
  `receivables.security.spec.ts`.
- **Reusar `SalesService.addPayment` para Receivables no reabre ninguna
  superficie**: `ReceivablesService.addPayment` no bypasea ningún control
  — llama al mismo método que ya valida tenant (vía
  `TenantPrismaService`/RLS), sobrepago, lock, e idempotencia. No hay un
  segundo camino de escritura sobre `payments` que pudiera quedar
  desprotegido.
- **Un tenant no puede afectar la caja de otro indicando su
  `posTerminalId`** en un pago de Payable o en una devolución de venta:
  la búsqueda de la `CashRegister` OPEN correspondiente
  (`CashService.registerPayablePaymentMovement`/
  `registerSaleRefundMovement`) siempre corre dentro del mismo `tx` con
  el `organizationId` del que hace el request — el `posTerminalId` de
  otro tenant simplemente no encuentra ninguna fila (RLS + filtro
  explícito), así que el pago/reembolso se aplica igual pero SIN generar
  ningún movimiento de caja ajeno. Probado explícitamente en
  `payables.security.spec.ts` y `sales.security.spec.ts` con dos tenants
  reales y una caja real de por medio (no solo con un id inventado).
- **Permisos nuevos, solo el necesario**: `receivables.read` (mismo
  motivo que `payables.read`/`cash.read`/`expenses.read` en fases
  anteriores — sin él, AUDITOR no tenía visibilidad de Receivables). No
  se crearon permisos para reembolsos: reusan `sales.delete`, ya que un
  reembolso es parte integral de `returnSale`.
- **Asimetría de bloqueo entre Payables y reembolsos, documentada como
  decisión, no como inconsistencia**: un pago a proveedor que excede el
  saldo de la caja elegida se rechaza (`400`, nada se aplica); un
  reembolso que excedería ese saldo NUNCA bloquea la devolución en sí,
  solo omite el movimiento de caja. Ver `docs/architecture.md` sección 11
  para la justificación completa — no es una laguna, es la misma
  distinción "discrecional vs. corrección obligatoria" que ya regía el
  resto del sistema.

## Auditoría post-Fase 6

Auditoría de integración de solo-lectura sobre las Fases Comerciales 2-6
(sin nuevas features), buscando específicamente saldo negativo, sobrepago,
doble efecto, fuga entre tenants, bypass de permisos y estados
inconsistentes en los 5 flujos comerciales completos.

- **Bug de concurrencia real encontrado y corregido**: `PurchasesService
  .returnToSupplier()`/`growOrCreatePayable()` leían `Payable.amount`/
  `status` sin bloquear esa fila, confiando en el lock de `Purchase`
  (`lockPurchase`). Como `PayablesService.addPayment()` bloquea `Payable`
  directamente sin tocar `Purchase`, una devolución al proveedor y un
  pago sobre la misma cuenta por pagar, ejecutados concurrentemente,
  podían dejar el `balance` calculado en negativo — un sobrepago real,
  no solo teórico (reproducido de forma determinística antes del fix).
  Corregido con `lockPayableByPurchase` (`SELECT ... FOR UPDATE` explícito
  sobre `payables`) en ambos puntos. Ver `docs/architecture.md` sección
  12 para el detalle técnico completo y `purchases.concurrency.spec.ts`
  para el test de regresión.
- **Sin hallazgos de tenant/RBAC/idempotencia**: se releyeron
  `sales.service.ts`, `purchases.service.ts` y `payables.service.ts`
  línea por línea contra el código real (no solo contra los tests ya
  escritos por el mismo autor en las mismas fases). Todo lock ocurre
  antes de la lectura que determina el efecto salvo el caso arriba;
  todo endpoint de las Fases 2-6 declara `@RequirePermissions` o
  `@NoPermissionRequired`; todo dinero usa `Prisma.Decimal`; el único
  query sin `organizationId` explícito en su `WHERE`
  (`PurchasesService.paidAmountFor`, filtra solo por `payableId`) es
  seguro porque corre dentro de `TenantPrismaService.run`, con RLS
  `FORCE` activo en `payments` desde la migración inicial — el filtro
  por tenant lo aplica Postgres, no la query de Prisma.

## Fase Comercial 7 — Reportes: notas de seguridad específicas

- **`reports.read` ya existía en el catálogo desde Fase 1** (placeholder
  sin endpoints reales hasta ahora) — no se creó ningún permiso nuevo.
  Asignado a OWNER/ADMIN (todos los permisos), MANAGER, ACCOUNTANT y
  AUDITOR (rol de solo lectura); SALES/CASHIER/INVENTORY no lo tienen —
  probado explícitamente con un usuario SALES real recibiendo 403 en los
  17 endpoints de reporte y en el export, y con ACCOUNTANT/AUDITOR
  recibiendo 200 (`reports.security.spec.ts`).
- **Ningún filtro puede escapar el tenant**, incluidos los que resuelven
  sucursal → almacén/POS (`resolveBranchScope`): un `branchId`/
  `warehouseId`/`posTerminalId`/`productId`/`categoryId`/`userId` de OTRO
  tenant, pasado explícitamente por un atacante que conoce ese id (por
  ejemplo, filtrado de otra fuente), nunca filtra datos ajenos — la
  resolución de alcance ya está scoped por `organizationId` antes de
  usarse, así que un id ajeno simplemente resuelve a una lista vacía y el
  reporte da cero filas. Probado con dos tenants reales y los ids
  reales del primero, incluyendo el caso de export (`reports.security.spec.ts`,
  `export: el tenant B exportando ventas nunca incluye filas de A`).
- **`userNamesMap` (nombres de usuario para "ventas por usuario") lee la
  tabla global `users`**, la única sin RLS del sistema — pero nunca la
  usa para BUSCAR por tenant: los `userId` que le llegan ya vinieron de
  una consulta de `Sale`/`Purchase` previamente filtrada por
  `organizationId`, así que solo se usan para poner un nombre a un id que
  ya se sabe que pertenece a este tenant, nunca para descubrir usuarios
  de otra organización.
- **Auditoría**: cada export queda registrado (`reports.export`, con
  `format`, cantidad de filas y filtros usados) — ver la nota
  "Auditoría" general más abajo, extendida en esta fase.

## Fase Comercial 8 — Recibos comerciales: notas de seguridad específicas

- **Permisos nuevos, mínimos**: `receipts.manage` (emitir) y
  `receipts.read` (ver/descargar). OWNER/ADMIN los tienen (todos los
  permisos); MANAGER, CASHIER y SALES los tienen explícitamente (son
  quienes emiten recibos en la operación real); ACCOUNTANT e INVENTORY
  NO — probado con un usuario INVENTORY real recibiendo 403 en emitir,
  consultar por id, consultar por venta, y descargar PDF, y con CASHIER
  recibiendo 200 en las cuatro (`receipts.security.spec.ts`).
- **Aislamiento de tenant probado en las cuatro superficies de fuga
  posibles**: consultar un recibo ajeno por ID (404), descargar su PDF
  (404), consultarlo por el `saleId` de la venta ajena (sin resultado,
  nunca el recibo del otro tenant), y emitir un recibo para una venta
  ajena adivinando su id (404 — RLS hace que `tx.sale.findFirst` con
  `organizationId` propio simplemente no la encuentre). Ninguna de las
  cuatro devuelve alguna vez datos de otro tenant, solo "no encontrado".
- **La numeración nunca se filtra ni se comparte entre tenants**: cada
  organización tiene su propia fila en `receipt_sequences`
  (`organizationId` `@unique`, protegida por RLS). Probado explícitamente:
  el tenant B emite su primer recibo con número 1 aunque el tenant A ya
  tenga varios — no hay ninguna secuencia global compartida que un tenant
  pudiera agotar, inflar, o cuya numeración pudiera inferir la actividad
  de otro.
- **RLS crudo** (sin pasar por Nest, mismo patrón que
  `receivables.security.spec.ts`) confirmado en `commercial_receipts` Y
  en `receipt_sequences` por separado: con contexto de un tenant
  inexistente, ninguna de las dos tablas devuelve fila alguna
  (fail-closed); con contexto real, una consulta sin `WHERE` solo trae
  filas de ese tenant.
- **`snapshot` (JSONB) nunca contiene secretos**: son los mismos datos
  comerciales que ya son visibles vía `GET /sales/:id` (montos, nombres,
  NIT/CI del cliente) — nada de contraseñas, tokens, ni datos de tarjeta
  (el sistema no procesa ni almacena datos de tarjeta en ningún punto,
  ver "Datos sensibles" arriba).
- **Auditoría**: `receipts.issue` (con `saleId`, `series`, `number`) y
  `receipts.pdf.download` (con `format`) — para poder responder "quién
  emitió/descargó qué recibo, cuándo" ante cualquier duda operativa.

## Fase Comercial 9 — Notificaciones y email real: notas de seguridad específicas

- **Sin permiso de catálogo nuevo para notificaciones**: es un recurso
  personal (`@NoPermissionRequired()`, mismo criterio que
  `GET /organizations/me`), no un módulo de negocio con RBAC por rol. La
  pertenencia la valida `NotificationsService` en la aplicación —
  `markRead` compara `notification.userId` contra el `sub` del token y
  devuelve 403 si no coincide, incluso cuando la notificación es de la
  MISMA organización (RLS por sí sola no alcanza para aislar por usuario
  dentro de un mismo tenant). Probado explícitamente: un CASHIER no puede
  marcar como leída la notificación del OWNER, ni la ve en su propio
  listado (`notifications.security.spec.ts`).
- **Aislamiento de tenant en `notifications` y `email_logs`**: RLS
  fail-closed confirmado con RLS crudo (contexto de tenant inexistente →
  cero filas) y vía API (el tenant B nunca ve ni puede marcar como leída
  una notificación del tenant A).
- **`email_logs` nunca expone contenido sensible ajeno**: guarda
  destinatario (`to`), template usado, estado y error truncado (1000
  caracteres) — nunca el cuerpo HTML completo ni datos de tarjeta (el
  sistema no procesa datos de tarjeta en ningún punto). RLS por
  `organizationId` igual que el resto del esquema.
- **`Notification.userId` nunca `null` en la práctica**: decisión de
  diseño documentada en `docs/architecture.md` sección 15 — evita que una
  notificación "compartida" filtre su estado `read` entre usuarios
  distintos de la misma organización.
- **Secretos de email SOLO por variable de entorno**: `EMAIL_PROVIDER`,
  `EMAIL_SMTP_HOST`, `EMAIL_SMTP_PORT`, `EMAIL_SMTP_USER`,
  `EMAIL_SMTP_PASSWORD`, `EMAIL_FROM`, `FRONTEND_URL` — ninguno
  hardcodeado en el código, `.env.example` los documenta sin valores
  reales (`EMAIL_SMTP_USER`/`EMAIL_SMTP_PASSWORD` vacíos por defecto).
  `SmtpEmailSender` lee todo vía `ConfigService`.
- **RBAC del endpoint de envío de recibo por email**:
  `POST /receipts/:id/email` exige `receipts.manage` (mismo permiso que
  emitir el recibo) — probado que un usuario INVENTORY (sin
  `receipts.manage`) recibe 403, y que el tenant B no puede pedir el envío
  del recibo del tenant A (404).
- **Idempotencia también es una propiedad de seguridad acá**: sin la
  key única en `EmailLog.idempotencyKey`, un cliente reintentando "enviar
  recibo por email" podría inundar al destinatario con copias — probado
  que dos requests consecutivos al mismo recibo resultan en una sola fila
  `SENT`, nunca dos envíos.

## Fase Comercial 10 — Planes, límites y suscripciones: notas de seguridad específicas

- **El cliente nunca controla su plan ni sus límites**: `ChangePlanDto`
  solo acepta `planKey` (validado contra las 4 claves reales del
  catálogo, `@IsIn`, 400 si no coincide) — ningún campo de límites ni de
  precio viaja nunca en el body de ningún request. Los límites se leen
  SIEMPRE del lado del servidor, desde `Plan.limits` de la suscripción
  vigente de la organización del JWT autenticado. No existe ningún
  endpoint ni parámetro que permita a un usuario fijar su propio límite.
- **`subscription.manage` (permiso nuevo)**: solo `OWNER`/`ADMIN` (vía
  `ALL_PERMISSION_KEYS`) pueden cambiar de plan, cancelar o renovar —
  probado explícitamente con los 6 roles restantes (`MANAGER`,
  `ACCOUNTANT`, `CASHIER`, `INVENTORY`, `SALES`, `AUDITOR`) recibiendo
  403 en los tres endpoints sin importar qué `planKey` manden. Ver la
  suscripción (`GET`) es `@NoPermissionRequired()` — cualquier
  autenticado puede ver el plan/uso de SU PROPIA empresa, mismo criterio
  que `GET /organizations/me`.
- **Enforcement en el backend, nunca solo en el frontend**: los tres
  límites (`maxUsers`/`maxBranches`/`maxProducts`) se verifican dentro de
  la MISMA transacción de Postgres que crea el recurso
  (`MembersService.invite`, `BranchesService.create`,
  `ProductsService.create`/`duplicate`) — un cliente que se salte la UI y
  pegue directo a la API HTTP encuentra exactamente el mismo bloqueo.
- **Concurrencia real probada, no solo asumida**: `assertWithinLimit`
  bloquea la fila de `subscriptions` con `SELECT ... FOR UPDATE` antes de
  contar el uso — mismo patrón que los locks de Ventas/Compras/Pagos.
  Probado con 10 creaciones de producto y 8 invitaciones de usuario
  verdaderamente concurrentes (`Promise.all`) contra límites chicos: el
  conteo final nunca superó el límite configurado.
- **Aislamiento de tenant**: `subscriptions`/`subscription_events` tienen
  RLS desde Fase 1 (sin cambios de esquema en esta fase). Probado que
  cambiar/cancelar el plan del tenant A no afecta al tenant B, y RLS
  crudo confirma fail-closed con contexto de tenant inexistente.
- **`app_superadmin` sigue sin superficie de aplicación**: se revisó
  explícitamente para esta fase; no se construyó ningún endpoint que lo
  use — la gestión del catálogo de planes sigue siendo vía
  `prisma/seed.ts`, nunca expuesta como API pública.
- **Sin datos de pago**: no se implementó pasarela real, no se cobra
  nada, no se almacenan tarjetas ni ningún dato sensible de pago en esta
  fase (ver `docs/architecture.md` sección 16 para la arquitectura de
  billing futura, desacoplada de cualquier proveedor concreto).

## Qué queda pendiente (explícito, no oculto)

- MFA (modelo de datos y guard no implementados todavía).
- CSP / secure headers a nivel de aplicación (hoy depende del entorno de
  despliegue).
- Un mecanismo de gestión de secretos más allá de variables de entorno
  (Vault, AWS Secrets Manager, etc.) — apropiado cuando haya un entorno de
  producción real definido.
- Revisión de dependencias (`npm audit` / Snyk / Dependabot) automatizada
  en CI — no hay CI configurado todavía en esta fase.
