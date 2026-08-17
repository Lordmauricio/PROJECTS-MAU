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
- `cash_registers` + `cash_movements` — esquema listo; apertura/cierre/
  arqueo y el enlace de `Payment` a una caja abierta son Fase Comercial 5.
- `expenses`, `receivables` — gastos y cuentas por cobrar, esquema listo,
  Fase Comercial 5/6.
- `payables` — cuenta por pagar a un proveedor, módulo de negocio real
  desde Fase Comercial 3. `purchaseId` es `@unique` (a lo sumo una Payable
  por compra) cuando no es null — NULLs no colisionan entre sí en
  Postgres, así que esto no bloquea un futuro Payable sin compra asociada.
  `amount` crece con cada recepción (nunca antes de que llegue mercadería
  real) y se reduce con las devoluciones — ver
  `docs/architecture.md` sección 8 para la fórmula de prorrateo exacta.
  `status`: `PENDING`/`PAID` en uso real hoy; `OVERDUE`/`CANCELLED`
  existen en el enum pero ningún código los asigna todavía (`OVERDUE`
  necesitaría un job por fecha, fuera de alcance de esta fase).

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
- `plans` — catálogo global de planes (gratis, básico, pro...), con
  `limits`/`features` en JSON para no hardcodear reglas de negocio en código.
- `subscriptions` — 1:1 por organización; se crea automáticamente en plan
  "Gratis" al registrar la empresa.
- `subscription_events` — historial de cambios de suscripción.

### Notificaciones / archivos
- `notifications`, `files` — tablas listas; sin API todavía.

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
- Montos siempre `Decimal` (`@db.Decimal`), nunca `Float`.
