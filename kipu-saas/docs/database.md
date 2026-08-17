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
- `inventory_movements` — entradas/salidas/transferencias/ajustes/
  devoluciones, con referencia opcional al documento de origen (`reference`
  guarda el id de la venta/compra relacionada). `IN`/`OUT`/`RETURN` tienen
  módulo de negocio real desde Fase Comercial 2
  (`InventoryService.applyMovement`, usado por Ventas y por la entrada
  manual `POST /inventory/movements`); `TRANSFER` y el motor de ajustes
  avanzado quedan para la Fase Comercial 4.

### Ventas (módulo de negocio real desde Fase Comercial 2) / Compras / Caja
- `sales` + `sale_items` — venta separada explícitamente de `invoices`
  ("una venta puede generar una factura", no son lo mismo). `status`:
  `DRAFT → CONFIRMED/PARTIALLY_PAID/PAID → REFUNDED`, o `DRAFT →
  CANCELLED`. `warehouseId` (de dónde se descuenta stock al confirmar) y
  `confirmedAt`/`cancelledAt`/`refundedAt` se agregaron en la migración
  `20260817060253_sales_pos_core`.
- `purchases` + `purchase_items` — esquema listo, módulo de negocio es
  Fase Comercial 3.
- `payments` — pagos asociados a una venta
  (efectivo/tarjeta/transferencia/QR — "mixto" se representa como varios
  `Payment`, uno por método, no como un único registro `MIXED`).
  `idempotencyKey` (única, opcional) agregada en la misma migración:
  protege contra doble cobro por doble click/retry — ver
  `docs/architecture.md` sección 7.
- `cash_registers` + `cash_movements` — esquema listo; apertura/cierre/
  arqueo y el enlace de `Payment` a una caja abierta son Fase Comercial 5.
- `expenses`, `receivables`, `payables` — gastos y cuentas por cobrar/pagar,
  esquema listo, Fase Comercial 5/6.

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
- Montos siempre `Decimal` (`@db.Decimal`), nunca `Float`.
