# Base de datos — KIPU SAAS

Ver el modelo completo y actualizado en `backend/prisma/schema.prisma` — este
documento es un mapa de lectura, no una copia (evita que se desactualice).

## Convención de tenancy

Toda tabla de negocio tiene una columna `organizationId` (texto, `cuid()` a
nivel de aplicación) y una policy de Row Level Security que la compara
contra `current_setting('app.current_tenant')`. Las tablas hijas de una
tabla tenant-scoped (`sale_items`, `purchase_items`, `invoice_items`)
**también** llevan `organizationId` propio, denormalizado desde su padre,
para que la policy de RLS no necesite hacer JOIN. Ver `docs/architecture.md`
sección 3 para el detalle de por qué y cómo se aplica esto en runtime.

Tablas **sin** RLS (catálogos globales, no pertenecen a ninguna empresa):
`users`, `refresh_tokens`, `email_verification_tokens`,
`password_reset_tokens`, `permissions`, `plans`.

## Entidades por dominio

### Identidad / tenancy raíz
- `organizations` — la empresa (tenant). NIT único, razón social, nombre
  comercial, actividad económica, moneda (BOB por defecto), timezone
  (America/La_Paz por defecto), estado.
- `users` — identidad global; un usuario puede pertenecer a varias
  organizaciones vía `organization_users`.
- `organization_users` — membresía: usuario + organización + rol + estado
  (INVITED/ACTIVE/SUSPENDED).
- `refresh_tokens`, `email_verification_tokens`, `password_reset_tokens` —
  tokens de un solo uso para el flujo de auth (ver `docs/security.md`).

### RBAC
- `permissions` — catálogo global (ej. `sales.create`, `invoices.cancel`,
  `products.update`, `reports.read`, `users.manage`, `settings.update`).
- `roles` — por organización; 8 roles del sistema se clonan al crear la
  empresa (OWNER, ADMIN, MANAGER, ACCOUNTANT, CASHIER, INVENTORY, SALES,
  AUDITOR), más espacio para roles custom (`isSystem = false`) a futuro.
- `role_permissions` — qué permisos tiene cada rol.

### Jerarquía operativa
```
Organization
 └─ Branch (sucursal)
     ├─ Warehouse (almacén)
     └─ POSTerminal (punto de venta)
```
- `branches`, `warehouses`, `pos_terminals` — al registrar una empresa se
  crea automáticamente su sucursal principal con un almacén y un punto de
  venta principales (ver `OrganizationsService.bootstrapOrganization`).

### Terceros
- `customers` — nombre, razón social, tipo/número de documento (NIT/CI/CEX/
  PASAPORTE/OTRO/SIN_NOMBRE — este último para "consumidor final"), contacto.
- `suppliers` — datos comerciales, NIT, contacto.

### Catálogo / inventario
- `product_categories`, `product_units` — catálogos propios de cada empresa.
- `products` — código, SKU, código de barras, nombre, marca, costo, precio,
  precio mayorista, stock mínimo, categoría/unidad/proveedor opcionales.
- `inventories` — stock actual por producto y almacén (`@@unique([warehouseId, productId])`).
  Un mismo producto tiene filas independientes por almacén: nunca hay un
  "stock global" agregado en una columna propia (evita que se
  desincronice del detalle real).
- `inventory_movements` — entradas/salidas/transferencias/ajustes/
  devoluciones (`type`: `IN`/`OUT`/`TRANSFER`/`ADJUSTMENT`/`RETURN`), con
  referencia opcional al documento de origen (`reference` guarda el id de
  la venta/compra relacionada, o el id de la `InventoryTransfer` cuando
  `type = TRANSFER`). Módulo de negocio real completo desde la Fase
  Comercial 4 (`InventoryService.applyMovement`, único motor, usado por
  Ventas, Compras y por `POST /inventory/movements`/`POST
  /inventory/transfers`). Desde la Fase Comercial 4 lleva además:
  - `stockBefore`/`stockAfter` (`Decimal(12,2)`, `NOT NULL`): saldo exacto
    antes/después del movimiento, grabado en el momento — permite leer el
    kardex (`GET /inventory/kardex`) como una cuenta corriente sin
    recalcular sumas históricas.
  - `idempotencyKey` (`String?`, `@unique`): protege `POST
    /inventory/movements` contra doble click/retry, mismo patrón que
    `payments.idempotencyKey`.
  - `@@index([createdAt])`, además de los índices por
    organización/almacén/producto ya existentes, para que el filtro por
    rango de fechas del kardex/historial no dependa de un full scan.
- `inventory_transfers` — **nueva en la Fase Comercial 4**. Ledger de
  transferencias entre almacenes de una misma organización (mismo patrón
  que `payments`/`purchase_receipts`): `productId`, `fromWarehouseId`,
  `toWarehouseId`, `quantity`, `reason` opcional, `idempotencyKey` única,
  `createdById`. Cada fila corresponde a exactamente una transferencia, que
  a su vez generó dos `inventory_movements` (`type = TRANSFER`, uno
  `DECREASE` en origen y uno `INCREASE` en destino) ligados por
  `reference = inventory_transfers.id`. RLS igual que el resto del
  esquema. Migración `20260817142135_inventory_advanced_core`.

### Ventas y Compras (módulo de negocio real desde Fase Comercial 2 y 3) / Caja
- `sales` + `sale_items` — venta separada explícitamente de `invoices`
  ("una venta puede generar una factura", no son lo mismo). `status`:
  `DRAFT → CONFIRMED/PARTIALLY_PAID/PAID → REFUNDED`, o `DRAFT →
  CANCELLED`. `warehouseId` (de dónde se descuenta stock al confirmar) y
  `confirmedAt`/`cancelledAt`/`refundedAt` se agregaron en la migración
  `20260817060253_sales_pos_core`.
- `purchases` + `purchase_items` — orden de compra, separada explícitamente
  de `invoices`, igual que `sales`. `status`: `DRAFT → CONFIRMED →
  PARTIALLY_RECEIVED/RECEIVED`, o `DRAFT/CONFIRMED → CANCELLED` (nunca se
  cancela con recepciones — para eso existe la devolución). `warehouseId`,
  `discount`, `confirmedAt`/`cancelledAt`/`receivedAt` y, en
  `purchase_items`, `receivedQuantity`/`returnedQuantity`/`discount`, se
  agregaron en la migración `20260817121351_purchases_core`.
- `purchase_receipts` + `purchase_receipt_items` — ledger de recepciones
  (una fila por cada recepción, total o parcial), mismo patrón que
  `payments` para Ventas: `idempotencyKey` única propia, nunca se muta
  `receivedQuantity` sin dejar rastro de cuándo/cómo. Nuevas en la misma
  migración, con RLS igual que el resto.
- `purchase_returns` + `purchase_return_items` — ledger de devoluciones al
  proveedor, mismo patrón que `purchase_receipts` (`idempotencyKey` propia,
  trazabilidad propia). Nuevas en la misma migración.
- `payments` — ledger genérico de dinero: `saleId` (cobro a un cliente,
  Ventas) O `payableId` (pago a un proveedor, Compras) — un CHECK
  constraint SQL (`payments_exactly_one_target_check`, agregado a mano)
  exige exactamente uno de los dos, nunca ambos ni ninguno. "Mixto" se
  representa como varios `Payment`, uno por método, no un único registro
  `MIXED`. `idempotencyKey` (única, opcional): protege contra doble
  cobro/pago por doble click/retry — ver `docs/architecture.md` sección 7.
  `payableId` se agregó en `20260817121351_purchases_core`.
- `cash_registers` — caja por punto de venta, módulo de negocio real desde
  la Fase Comercial 5 (antes placeholder desde Fase 1). `status`:
  `OPEN`/`CLOSED`. `openingAmount` (saldo inicial) y, al cerrar,
  `closingAmount` (efectivo CONTADO por el usuario en el arqueo),
  `expectedAmount` (saldo que el sistema esperaba: `openingAmount` +
  ingresos − egresos) y `difference` (`closingAmount` − `expectedAmount`;
  positivo = sobrante, negativo = faltante) — los tres quedan `null`
  mientras la caja sigue `OPEN`. `openingIdempotencyKey`/
  `closingIdempotencyKey` (ambas `@unique`, nullable): protegen la
  apertura y el cierre contra doble click/retry por separado, mismo
  patrón que `payments.idempotencyKey`. `openedById`/`closedById`:
  usuario responsable de cada operación. No existe una columna de saldo
  actual mutable — el saldo se calcula siempre bajo demanda desde
  `openingAmount` + los `cash_movements` de esa caja (ver
  `docs/architecture.md` sección 10), nunca se incrementa/decrementa
  directamente (evita que quede desincronizado del detalle real).
  Migración `20260817160000_cash_expenses_core`.
  - Índice único parcial `cash_registers_one_open_per_terminal` (`ON
    "posTerminalId" WHERE status = 'OPEN'`, agregado a mano — Prisma no
    expresa `WHERE` en `@@unique`): garantiza a nivel de Postgres que
    nunca haya dos cajas `OPEN` para el mismo `posTerminalId`, incluso
    bajo dos `INSERT` concurrentes.
- `cash_movements` — historial de movimientos de una caja (`type`:
  `CASH_IN`/`CASH_OUT`/`SALE_PAYMENT`/`EXPENSE` desde Fase Comercial 5, más
  `PAYABLE_PAYMENT`/`SALE_REFUND` desde Fase Comercial 6 — `String` libre
  en el schema pero validado por DTO en el endpoint manual, que solo
  acepta `CASH_IN`/`CASH_OUT`: los otros cuatro tipos los genera el
  sistema, nunca se aceptan como input directo). `amount` siempre
  positivo — el signo (suma o resta al saldo) lo decide `type`, nunca el
  valor, mismo criterio que `InventoryMovement.quantity`. `reference`
  (nullable): id de la `Sale` (`SALE_PAYMENT`), del `Expense` (`EXPENSE`),
  de la `Payable` (`PAYABLE_PAYMENT`) o del `Refund` (`SALE_REFUND`) que
  originó el movimiento, cuando no fue manual — mismo patrón que
  `InventoryMovement.reference`. `idempotencyKey` (`@unique`, nullable):
  obligatoria para movimientos manuales (`CASH_IN`/`CASH_OUT`) y gastos;
  los `SALE_PAYMENT`/`PAYABLE_PAYMENT` heredan la del `Payment` que los
  originó; `SALE_REFUND` usa una key derivada (`sale-refund-<saleId>`,
  ver `docs/architecture.md` sección 11) ya que `returnSale()` no recibe
  una del cliente. Módulo de negocio real desde la Fase Comercial 5,
  ampliado en la Fase Comercial 6.
- `expenses` — gasto asociado a una caja abierta, módulo de negocio real
  desde la Fase Comercial 5 (antes placeholder desde Fase 1, sin ningún
  endpoint). `cashRegisterId` (nuevo, `NOT NULL`): un gasto siempre
  pertenece a una caja — no puede existir "suelto". `category` pasó de
  requerida a opcional (`String?`) porque no todo negocio pequeño
  categoriza cada gasto. `idempotencyKey` (`@unique`, nullable):
  protege contra doble click — el `Expense` y su `CashMovement` (tipo
  `EXPENSE`) se crean atómicamente en la misma transacción, así que
  basta con la `idempotencyKey` del `Expense`.
- `receivables` — cuenta por cobrar a un cliente, módulo de negocio real
  desde la Fase Comercial 6 (antes placeholder desde Fase 1). `saleId`
  (nuevo, `String?` `@unique`): a lo sumo una Receivable por venta — se
  crea automáticamente al confirmar una venta a crédito
  (`SalesService.createOrSyncReceivable`, dentro de la misma transacción
  de `confirm`). A propósito NO tiene su propia relación de `payments` —
  sus pagos son los mismos `Payment.saleId` de la venta asociada; el
  saldo se calcula siempre on-demand sumando `sale.payments`, nunca
  almacenado ni duplicado (ver `docs/architecture.md` sección 11 para la
  justificación completa de esta decisión). `status` SÍ se escribe
  (`PENDING`/`PAID`/`CANCELLED`), pero se deriva enteramente de eventos de
  `Sale` — nunca es una fuente de verdad independiente.
- `refunds` — reembolso de una venta devuelta, tabla **nueva** desde la
  Fase Comercial 6. `saleId` (`String`, no único — nada impide
  conceptualmente más de un reembolso por venta a futuro, aunque hoy
  `SalesService.returnSale` crea a lo sumo uno por ser una devolución
  total de una sola vez). `amount`: siempre el `paidTotal` real de la
  venta al momento de devolverse, nunca una cifra manual. Sin
  `idempotencyKey` propia — `returnSale()` es idempotente por lock +
  chequeo de estado (mismo patrón que `Sale.cancel`), así que esta fila
  se crea a lo sumo una vez por venta sin necesitar ese mecanismo. RLS
  agregada a mano en la migración `20260817170000_payments_and_accounts_core`
  (tabla nueva, mismo patrón que el resto del esquema).
- `payables` — cuenta por pagar a un proveedor, módulo de negocio real
  desde Fase Comercial 3, con integración de Caja agregada en la Fase
  Comercial 6 (ver `cash_movements` arriba, `type: PAYABLE_PAYMENT`).
  `purchaseId` es `@unique` (a lo sumo una Payable por compra) cuando no
  es null — NULLs no colisionan entre sí en Postgres, así que esto no
  bloquea un futuro Payable sin compra asociada. `amount` crece con cada
  recepción (nunca antes de que llegue mercadería real) y se reduce con
  las devoluciones — ver `docs/architecture.md` sección 8 para la
  fórmula de prorrateo exacta. `status`: `PENDING`/`PAID` en uso real
  hoy; `OVERDUE`/`CANCELLED` existen en el enum pero ningún código los
  asigna todavía (`OVERDUE` necesitaría un job por fecha, fuera de
  alcance de esta fase).

### Recibos comerciales NO fiscales (Fase Comercial 8 — implementado)
- `receipt_sequences` — un contador atómico por organización
  (`organizationId` `@unique`), `series` (fija, hoy siempre `"REC"`) +
  `lastNumber`. El siguiente número se obtiene con un único
  `INSERT ... ON CONFLICT DO UPDATE ... RETURNING` — nunca
  `MAX(number) + 1` — ver `docs/architecture.md` sección 14.
- `commercial_receipts` — `saleId` `@unique` (1:1 estricto con `sales`:
  una venta nunca puede tener dos recibos), `series`+`number` (también
  `@@unique([organizationId, series, number])`, nunca dos recibos con el
  mismo número en la misma organización), y `snapshot` (`Json` → `jsonb`
  en Postgres) con el contenido completo e INMUTABLE del recibo — emisor,
  operación, cliente, ítems, pagos. Ninguna columna de `commercial_receipts`
  cambia después de creada la fila; no hay ningún `update()` sobre esta
  tabla en todo `ReceiptsService`. Completamente separado de `invoices`
  (abajo): no comparte tabla, FK, ni lógica con la futura facturación
  fiscal.

### Facturación / fiscal (esquema listo, sin integración SIN)
- `invoices` + `invoice_items` + `invoice_events` — el estado (`VALID`/
  `CANCELLED`/`ERROR`) y el evento son genéricos a propósito: los campos
  específicos del SIN (CUF, CUFD, CUIS, XML, QR) se agregan recién cuando
  se cierre la investigación normativa (ver `docs/sin/` en una fase
  posterior) para no inventar estructura fiscal sin verificarla.
- `tax_configurations` — placeholder por sucursal (NIT, ambiente,
  códigos de sucursal/punto de venta/sistema, CUIS) listo para completarse
  cuando haya credenciales reales del SIN.

### Suscripción del tenant al SaaS (no es facturación del tenant a sus clientes)
- `plans` — catálogo global de planes: `free`/`basic`/`pro`/`enterprise`
  (los 4 sembrados desde `prisma/seed.ts`, fuente única en
  `backend/src/subscriptions/plans.catalog.ts` — Fase Comercial 10).
  `limits` (`{ maxUsers, maxBranches, maxProducts }`, `null` = ilimitado)
  y `features` (`{ pos, inventory, invoicing }`, puramente descriptivo,
  no enforced) en JSON para no hardcodear reglas de negocio en código.
  Sin RLS (tabla global, mismo criterio que `permissions`).
- `subscriptions` — 1:1 por organización; se crea automáticamente en plan
  "Gratis" al registrar la empresa. API real de ciclo de vida desde Fase
  Comercial 10 (`SubscriptionsModule`): `GET`/`change-plan`/`cancel`/
  `renew` en `/organizations/me/subscription*`. `status` transiciona
  perezosamente `ACTIVE` → `PAST_DUE` cuando `currentPeriodEnd` vence (sin
  cron dedicado, se resuelve al leer). Enforcement real de
  `maxUsers`/`maxBranches`/`maxProducts` vía `SELECT ... FOR UPDATE`
  sobre esta tabla — ver `docs/architecture.md` sección 16.
- `subscription_events` — historial de cambios de suscripción
  (`plan_changed`/`cancelled`/`expired`/`renewed`), escrito por
  `SubscriptionsService` en la misma transacción que cada cambio.

### Notificaciones / email / archivos
- `notifications` — API real desde Fase Comercial 9 (`NotificationsModule`):
  listar paginado, marcar leída/todas, contador de no leídas. `userId`
  sigue siendo nullable en el esquema (Fase 1) pero la implementación real
  nunca crea una fila con `userId = null` — ver `docs/architecture.md`
  sección 15. `readAt` (Fase 9) registra cuándo se marcó como leída.
- `email_logs` (Fase Comercial 9) — ledger append-only de envíos de email
  (`to`, `template`, `status` `QUEUED`/`SENT`/`FAILED`, `provider`,
  `attempts`, `error`, `idempotencyKey` único opcional,
  `relatedEntityType`/`relatedEntityId`). Lo escribe únicamente
  `EmailProcessor` (worker de BullMQ), nunca `MailService` directamente —
  ver `docs/architecture.md` sección 15.
- `files` — tabla lista; sin API todavía.

### Auditoría
- `audit_logs` — acción, tipo/id de entidad, metadata JSON, IP, user agent.
  Se escribe de forma asíncrona vía una cola de BullMQ (`AuditService.log()`
  encola, `AuditProcessor` escribe) — ver `docs/architecture.md` sección 2.

## Índices y constraints relevantes

- Todo índice compuesto tenant-scoped lleva `organizationId` como primera
  columna (ej. `@@index([organizationId])` en cada tabla, más índices
  adicionales por FK donde el volumen lo amerita).
- `organizations.nit` es único globalmente.
- `organization_users` tiene `@@unique([organizationId, userId])` — un
  usuario no puede tener dos membresías en la misma empresa.
- `roles` tiene `@@unique([organizationId, key])`.
- `pos_terminals` tiene `@@unique([branchId, code])`.
- `inventories` tiene `@@unique([warehouseId, productId])`.
- `payables` tiene `@@unique([purchaseId])` (a lo sumo una Payable por compra).
- `payments` tiene `@@unique([idempotencyKey])` y el CHECK
  `payments_exactly_one_target_check` (exactamente uno de `saleId`/`payableId`).
- `purchase_receipts` y `purchase_returns` tienen `@@unique([idempotencyKey])` cada una.
- `inventory_movements` y `inventory_transfers` tienen cada una
  `@@unique([idempotencyKey])` (columna nullable — `IN`/`OUT`/`RETURN`
  disparados por Ventas/Compras no la usan, solo los movimientos/
  transferencias registrados directamente vía `POST
  /inventory/movements`/`POST /inventory/transfers`).
- `cash_registers` tiene `@@unique([openingIdempotencyKey])` y
  `@@unique([closingIdempotencyKey])` por separado (apertura y cierre son
  operaciones distintas, cada una con su propia protección de doble
  click/retry), más el índice único **parcial**
  `cash_registers_one_open_per_terminal` (`ON "posTerminalId" WHERE
  status = 'OPEN'`, agregado a mano — a lo sumo una caja OPEN por
  terminal, garantizado por Postgres, no por un chequeo de aplicación).
- `cash_movements` y `expenses` tienen cada una `@@unique([idempotencyKey])`.
- `receivables` tiene `@@unique([saleId])` (a lo sumo una Receivable por
  venta, columna nullable — mismo criterio que `payables.purchaseId`).
- `refunds` no tiene ningún `@unique` propio — no lo necesita, ver la
  justificación de idempotencia en `docs/architecture.md` sección 11.
- Montos siempre `Decimal` (`@db.Decimal`), nunca `Float`.
- `receipt_sequences` tiene `@@unique([organizationId])` (una secuencia
  por empresa). `commercial_receipts` tiene `@@unique([saleId])` (1:1 con
  la venta) Y `@@unique([organizationId, series, number])` (nunca dos
  recibos con el mismo número) — dos constraints únicos independientes
  protegiendo dos invariantes distintas a la vez.

## Fase Comercial 8 — Recibos comerciales: migración aditiva

Una migración nueva, `20260817191458_commercial_receipts`: dos tablas
nuevas (`receipt_sequences`, `commercial_receipts`), ninguna columna
nueva en tablas existentes, ningún dato existente modificado ni
eliminado. RLS `ENABLE`+`FORCE`+policy `tenant_isolation` en ambas tablas
nuevas, mismo patrón que el resto del esquema. `prisma migrate status`
pasa de 8 a 9 migraciones tras esta fase.

## Fase Comercial 7 — Reportes: sin cambios de esquema

El módulo de Reportes (`docs/architecture.md` sección 13) es de solo
lectura sobre las entidades ya documentadas arriba — no agrega tablas,
columnas, índices ni constraints nuevos, y no requirió ninguna migración
(`prisma migrate status` sigue reportando las mismas 8 migraciones desde
la Fase Comercial 6). Los índices ya existentes en `sales`/`purchases`/
`payments`/`cash_movements`/`inventories`/`inventory_movements`
(`organizationId`, y las FK relevantes) ya cubren los filtros que usan
sus reportes correspondientes.
