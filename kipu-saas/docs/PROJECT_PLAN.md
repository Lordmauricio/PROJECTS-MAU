# Plan de proyecto — KIPU SAAS

## Estado de este documento

Este plan corresponde a la **Parte 1** del prompt maestro (Fase 0 —
investigación/arquitectura — y Fase 1 — Foundation). El usuario indicó que
enviaría una Parte 2 (probablemente Facturación/Fiscal/SIN, Reportes,
Notificaciones, Suscripciones/Pagos) que todavía no llegó al momento de
escribir esto. Cuando llegue, se planifica como fase(s) nueva(s) sin
reabrir lo ya construido y verificado acá.

Este es el **tercer** intento de SaaS de esta sesión (después de
`restaurante-saas-bo` y `bolivia-business-cloud`, ambos eliminados a
pedido explícito del usuario para arrancar KIPU SAAS desde cero). El
patrón de multi-tenancy con RLS ya se había probado y verificado en el
intento anterior, así que acá se reaplica directamente en vez de
re-investigarlo — ver `docs/architecture.md`.

## Fase 0 — Investigación + Arquitectura ✅

- [x] Inspección del entorno (Node 22, PostgreSQL 16, Redis disponibles).
- [x] Decisión de arquitectura (modular monolith) y stack, documentada en
      `docs/architecture.md`.
- [x] Diseño de base de datos completo (todas las entidades del dominio),
      documentado en `docs/database.md`.
- [x] Diseño de seguridad, documentado en `docs/security.md`.

## Fase 1 — Foundation ✅

Entregable: un usuario puede registrar su empresa (con su sucursal, almacén
y punto de venta principales creados automáticamente), invitar usuarios,
asignarles roles con permisos granulares, gestionar clientes, proveedores y
catálogo de productos — y el aislamiento entre empresas está probado
automáticamente, no solo asumido.

- [x] Proyecto NestJS + Prisma 7 (`backend/`) y Next.js + Tailwind
      (`frontend/`).
- [x] PostgreSQL con Row Level Security activo desde la primera migración
      (rol `app_user` sin `BYPASSRLS` + policies en 32 tablas
      tenant-scoped + `organizations`).
- [x] Redis + BullMQ configurados y usados de verdad (cola de auditoría),
      no solo declarados.
- [x] Docker: `Dockerfile` en `backend/` y `frontend/`,
      `docker-compose.yml` con Postgres + Redis + backend + frontend.
      (Nota: el build de las imágenes Docker no se pudo ejecutar en este
      entorno de desarrollo por no tener el daemon de Docker disponible;
      `docker compose config` valida la sintaxis correctamente y los
      Dockerfiles se revisaron a mano. **Pendiente**: correr
      `docker compose build` en un entorno con Docker real antes de
      confiar en el despliegue containerizado.)
- [x] Autenticación completa: registro (bootstrap atómico de organización),
      login (con selección de organización si el usuario pertenece a
      varias), refresh con rotación, logout, recuperación de contraseña,
      verificación de email (envío real de correo es Fase 9 —
      Notificaciones), rate limiting.
- [x] Multi-tenancy verificada automáticamente
      (`npm run verify:tenant-isolation`, dentro de `backend/`).
- [x] Roles y permisos granulares: OWNER, ADMIN, MANAGER, ACCOUNTANT,
      CASHIER, INVENTORY, SALES, AUDITOR con catálogo de 29 permisos.
- [x] Empresas, sucursales, almacenes y puntos de venta (CRUD real).
- [x] Clientes y proveedores (CRUD real, con vista de compras/facturas/
      pagos/cuenta corriente lista para poblarse cuando existan).
- [x] Productos, categorías y unidades (CRUD real, con crear/editar/
      eliminar/duplicar; import/export CSV y edición masiva quedan para
      una fase siguiente).
- [x] Auditoría (`audit_logs`, vía cola de BullMQ) registrando login,
      creación de empresa, y creación/edición de las entidades de
      Foundation.
- [x] Frontend: sidebar exacto de la sección 8 del prompt, dashboard con
      datos reales (nunca inventados — si no hay actividad, el número es
      0 honesto), pantallas CRUD reales para las entidades de Foundation,
      y placeholders explícitos ("disponible en una fase siguiente") para
      las secciones cuyo módulo de negocio todavía no existe — nunca
      botones que aparenten funcionar sin hacerlo.

## Auditoría final de Fase 1 (post-construcción) ✅

Antes de autorizar el push, se corrió una auditoría completa de seguridad,
multi-tenancy, RBAC, Prisma/Postgres, Redis/BullMQ, auditoría y frontend, y
se corrigió lo encontrado. Resumen — detalle completo en el informe
entregado al usuario en el chat y en `docs/security.md`:

- **`PermissionsGuard` pasó a ser fail-closed por defecto** (antes: una
  ruta protegida sin `@RequirePermissions` quedaba accesible a cualquier
  autenticado). Nuevo decorador `@NoPermissionRequired()` como opt-in
  explícito. Los 5 endpoints GET que dependían del fail-open
  (`branches`, `warehouses`, `pos-terminals`, `members`, `roles`) ahora
  declaran permisos reales (`organization.branches.read`, `users.read`,
  `organization.roles.read`, nuevos en el catálogo).
- **Bug crítico encontrado y corregido**: el login (para cualquier usuario
  que no fuera el flujo de registro) estaba roto por una interacción con
  RLS en `organization_users` — ver `docs/security.md` sección
  Autorización. Sin este fix, nadie podía volver a iniciar sesión después
  de que expirara su sesión inicial.
- Throttle en `POST /auth/register`, `AuthService.refresh()` preserva la
  organización activa de la sesión (antes elegía una arbitrariamente),
  `AuditProcessor` loguea jobs de auditoría que agotan reintentos,
  `PrismaService` verifica en el arranque que el rol conectado no tenga
  `BYPASSRLS`, relación `TaxConfiguration` ↔ `Branch` completada,
  constraints de unicidad por empresa en `Supplier.nit` /
  `Product.sku`/`barcode` (con normalización de `""` a `undefined` en los
  DTOs para no romper filas sin esos campos opcionales).
- Frontend: manejo de errores visible (no más "Cargando..." infinito) en
  todas las páginas de listado y en los manejadores de mutación, limpieza
  de un doble-redirect en el login, validación runtime de la respuesta de
  login en vez de un cast inseguro.
- Verificado con `npm run verify:tenant-isolation` (21 checks, incluyendo
  6 escenarios de fail-closed), builds limpios de backend y frontend, y un
  recorrido en navegador con Playwright (registro → dashboard → CRUD →
  logout → login de nuevo → simulación de API caída).

## Fase Comercial 2 — Ventas / POS ✅

Entregable: un cajero puede vender productos reales por el POS, cobrar en
efectivo/tarjeta/transferencia/QR (completo, parcial o a crédito), y el
inventario se descuenta atómicamente sin permitir sobreventa bajo
concurrencia. Ver `docs/architecture.md` (sección "Fase Comercial 2") y
`docs/database.md` para el detalle técnico completo.

- [x] Máquina de estados de `Sale`: `DRAFT → CONFIRMED/PARTIALLY_PAID/PAID
      → REFUNDED`, `DRAFT → CANCELLED`. Nunca se borra una venta para
      representar una devolución.
- [x] Núcleo mínimo de Inventario (`InventoryService.applyMovement`):
      entrada manual (`IN`)/ajuste (`ADJUSTMENT`) y los movimientos `OUT`/
      `RETURN` que dispara Ventas. El motor avanzado (transferencias,
      kardex completo) queda para la Fase Comercial 4, tal como autorizó
      el usuario — esto es solo lo necesario para que Ventas tenga stock
      real que descontar, dado que Compras (Fase 3) todavía no existe.
- [x] Confirmar una venta descuenta stock de forma atómica y todo-o-nada
      (si un solo ítem no tiene stock suficiente, ningún ítem se
      descuenta) y sin overselling bajo concurrencia real — verificado con
      dos confirmaciones simultáneas por la última unidad
      (`sales.concurrency.spec.ts`).
- [x] Pagos completos, parciales, mixtos (múltiples métodos por venta) y
      venta a crédito. Nunca se acepta un pago que exceda el saldo
      pendiente. Toda la aritmética usa `Prisma.Decimal` (`common/money.ts`),
      nunca `number` de JS, con redondeo half-up a 2 decimales.
- [x] Idempotencia real: `Payment.idempotencyKey` (única) protege contra
      doble click/retry — probado tanto en el caso serializado por el lock
      de la venta como en la carrera cross-venta real (dos requests
      concurrentes, dos ventas distintas, misma key).
- [x] Multi-tenant: `TenantPrismaService` + RLS en todo, más `SELECT ...
      FOR UPDATE` sobre la fila de la venta para las transiciones de
      estado. Probado con HTTP real (tenant B nunca ve ni puede operar una
      venta de tenant A — 404, no 403, para no filtrar existencia) y RBAC
      (rol `SALES` sin `sales.delete` no puede cancelar/devolver).
- [x] Auditoría en `sales.create`, `sales.confirm`, `sales.payment.create`,
      `sales.cancel`, `sales.return`.
- [x] Frontend real: `/sales` (listado con filtro por estado), `/sales/[id]`
      (detalle, registrar pagos, cancelar, devolver) y `/sales/pos` (carrito
      real: búsqueda de producto, cantidades, descuentos por ítem y por
      venta, cliente, métodos de pago mixtos, confirmación con errores
      visibles).
- [x] **`Sale` NO es `Invoice`.** El modelo `Invoice`/`TaxConfiguration`
      sigue existiendo solo como placeholder genérico desde Fase 1 (ver
      Fase Comercial 7 — Facturación/Fiscal/SIN más abajo) — Ventas/POS de
      esta fase no lo toca ni depende de él. Una `Sale` podrá generar en el futuro un documento
      fiscal a través de un Fiscal Engine independiente, pero esa
      integración NO se implementó acá y no está en el alcance de esta
      fase.
- [x] Corregido antes de empezar (PASO 0 de esta fase): `npm ci` ahora deja
      el backend compilable de una (agregado `"postinstall": "prisma
      generate"` a `backend/package.json` — antes había que correr `npx
      prisma generate` a mano tras cada clon/instalación limpia).
- [x] Suite de tests de integración real contra Postgres/Redis reales
      (no mocks): `backend/src/sales/*.spec.ts` +
      `backend/src/common/money.spec.ts` (26 tests). Ver
      `backend/src/test-support/integration-app.ts` para la infraestructura
      compartida y el porqué de las decisiones de Jest (`moduleNameMapper`,
      `--experimental-vm-modules`, `supertest` en vez de `fetch`).

## Fase Comercial 3 — Compras ✅

Entregable: un usuario puede crear una orden de compra a un proveedor,
confirmarla, recibir la mercadería (completa o en varias entregas
parciales) con descuento/entrada de inventario atómico y sin duplicarse
bajo concurrencia, ver la cuenta por pagar que se genera automáticamente,
pagarla (parcial o completa, sin poder sobrepagar), y devolver mercadería
al proveedor sin borrar ni reescribir la compra original. Ver
`docs/architecture.md` sección 8 para el detalle técnico completo.

- [x] Máquina de estados de `Purchase`: `DRAFT → CONFIRMED →
      PARTIALLY_RECEIVED → RECEIVED`, o `DRAFT/CONFIRMED → CANCELLED`
      (nunca se cancela una orden con recepciones — para eso existe la
      devolución). Edición completa de ítems solo mientras está en DRAFT.
- [x] Recepción (`PurchaseReceipt`/`PurchaseReceiptItem`, análogo de
      `Payment` para Ventas): cada recepción es un evento propio con su
      propia `idempotencyKey`, nunca un campo mutable sin rastro. Usa el
      MISMO `InventoryService.applyMovement` de la Fase Comercial 2 (tipo
      `IN`) — no se creó un segundo motor de stock. Valida que nunca se
      reciba más de lo pedido por ítem.
- [x] `Payable` se genera/crece automáticamente con cada recepción (nunca
      antes de que llegue mercadería real), prorrateando el descuento a
      nivel de ítem y de orden — al recibirse todo, la Payable coincide
      exactamente con `Purchase.total`. Pagos parciales/completos vía el
      mismo modelo `Payment` que usa Ventas (`Payment.payableId`, con un
      CHECK constraint en SQL que exige exactamente uno de `saleId`/
      `payableId`). Nunca se acepta un pago que exceda el saldo pendiente.
- [x] Devolución al proveedor (`PurchaseReturn`/`PurchaseReturnItem`, mismo
      patrón que la recepción): salida de inventario (`OUT`, mismo motor),
      nunca devuelve más de lo recibido y no devuelto todavía, reduce la
      Payable proporcionalmente. Dependencia de Caja documentada y
      **rechazada explícitamente en vez de resuelta a medias**: si la
      devolución dejaría la Payable por debajo de lo ya pagado (el
      proveedor terminaría debiéndonos), la operación se rechaza con un
      mensaje claro — no existe todavía ningún concepto de crédito a favor
      frente a un proveedor.
- [x] Idempotencia y concurrencia con el mismo patrón que Ventas: lock
      (`SELECT ... FOR UPDATE`) sobre la fila de `Purchase` para las
      transiciones de estado, y resolución del conflicto de
      `idempotencyKey` FUERA de la transacción que lo generó (ver
      `runOrResolveReceiptConflict`/`runOrResolveReturnConflict` en
      `purchases.service.ts`). Probado con recepciones concurrentes reales
      que juntas excederían lo pedido: el lock serializa y solo una gana.
- [x] Multi-tenant: `TenantPrismaService` + RLS en las 4 tablas nuevas
      (`purchase_receipts`, `purchase_receipt_items`, `purchase_returns`,
      `purchase_return_items`), mismo patrón que el resto del esquema.
- [x] Permisos: se reutilizan `purchases.manage`/`purchases.read` (ya
      existían en el catálogo desde Fase 0). Se agregó `payables.read`
      (antes solo existía `payables.manage`) para que el listado/detalle
      de cuentas por pagar tenga su propio permiso de solo lectura — sin
      eso, el rol AUDITOR (que recibe automáticamente todo permiso
      `.read`) no habría tenido ninguna visibilidad sobre cuentas por
      pagar. `payables.manage` queda reservado para registrar pagos.
- [x] Frontend real: `/purchases` (listado + creación) y `/purchases/[id]`
      (detalle, confirmar, recibir —incluida recepción parcial—, devolver,
      cancelar, y pagar la cuenta por pagar asociada). `/inventory/movements`
      ahora también explica que las entradas/salidas de Compras/Ventas son
      automáticas.
- [x] Regresión de Ventas verificada: los 26 tests de Fase Comercial 2
      siguen pasando sin cambios, y un recorrido en navegador real vendió
      por el POS un producto cuyo stock había llegado exclusivamente por
      una recepción de compra (integración cruzada real, no solo mockeada).
- [x] Suite de tests de integración real (33 tests nuevos:
      `purchases.integration/concurrency/security.spec.ts`), sumando 49 en
      total con los de Ventas.

## Fase Comercial 4 — Inventario avanzado ✅

Entregable: kardex real por producto y almacén (historial cronológico con
saldo antes/después de cada movimiento), entrada/salida manual, ajustes
positivos/negativos con motivo, transferencias atómicas entre almacenes de
la misma organización, y visibilidad clara de stock por almacén (nunca
confundido con un stock global). Ver `docs/architecture.md` sección 9 para
el detalle técnico completo.

- [x] `InventoryService.applyMovement` extendido (no reemplazado): ahora
      recibe `type` y `direction` por separado, para poder distinguir
      `ADJUSTMENT`/`TRANSFER` de los `IN`/`OUT`/`RETURN` que ya disparaban
      Ventas y Compras desde la Fase Comercial 2. `InventoryModule` sigue
      siendo el único motor de stock — Ventas y Compras solo se
      actualizaron mecánicamente (4 call sites) para pasar `direction`
      explícito, sin cambiar su comportamiento.
- [x] Kardex real (`GET /inventory/kardex`): `stockBefore`/`stockAfter` se
      graban en cada `InventoryMovement` en el momento del movimiento
      (antes se calculaban y se descartaban), así que el historial se lee
      directamente como una cuenta corriente, sin recalcular sumas cada
      vez. `GET /inventory/movements` sigue existiendo como historial
      filtrable (almacén/producto/tipo/período, paginado) para vistas más
      amplias que un solo producto+almacén.
- [x] Entradas y salidas manuales (`IN`/`OUT`) y ajustes con signo
      explícito (`ADJUSTMENT` + `direction: INCREASE`/`DECREASE` —
      rechazado con 400 si falta la dirección, nunca hay un signo
      implícito). Todos exigen `idempotencyKey` (antes solo `IN`/
      `ADJUSTMENT` existían y sin ese requisito).
- [x] Transferencias entre almacenes (`POST /inventory/transfers`,
      `InventoryTransfer` como entidad de ledger propia, mismo patrón que
      `Payment`/`PurchaseReceipt`): atómicas (una `DECREASE` en origen y
      una `INCREASE` en destino dentro de la MISMA transacción — si la
      salida falla por stock insuficiente, la entrada nunca se aplica),
      validan que ambos almacenes pertenezcan a la misma organización, y
      nunca permiten origen = destino.
- [x] Nunca se permite stock negativo: `OUT`, ajuste negativo y la pierna
      de salida de una transferencia comparten la misma guarda atómica
      (`UPDATE ... WHERE quantity >= cantidad`) que ya usaban Ventas/
      Compras desde la Fase Comercial 2 — rechazo con 409, stock sin
      alterar.
- [x] Idempotencia y concurrencia con el mismo patrón que Ventas/Compras:
      colisión de `idempotencyKey` resuelta fuera de la transacción que la
      generó. **Problema real encontrado y corregido durante la
      implementación**: la primera versión no verificaba que una
      `idempotencyKey` reusada perteneciera a la MISMA operación —
      devolvía en silencio cualquier movimiento/transferencia que
      encontrara con esa key, con 201, en vez de rechazar con 409 cuando
      los datos no coincidían. Corregido agregando la misma verificación
      que ya usaba Compras (`existingReceipt.purchaseId !== purchaseId`) —
      ver `docs/architecture.md` sección 9 para el detalle. Probado con
      transferencias concurrentes reales sobre el mismo stock (dos
      transferencias que juntas excederían lo disponible → exactamente una
      gana, la otra 409) y con reintento/doble click (misma key, mismo
      resultado, nunca duplicado).
- [x] Multi-tenant: RLS en la tabla nueva (`inventory_transfers`) con el
      mismo patrón que el resto del esquema, más las columnas nuevas de
      `inventory_movements` (`stockBefore`/`stockAfter`/`idempotencyKey`).
      Probado con HTTP real (tenant B nunca ve stock/kardex/movimientos de
      tenant A, ni puede registrar movimientos/transferencias contra sus
      almacenes o productos — 400, sin filtrar existencia) y con SQL crudo
      (contexto de tenant inexistente → cero filas en `inventories`/
      `inventory_movements`/`inventory_transfers`, fail-closed real).
- [x] Permisos: se reutilizan `inventory.manage`/`inventory.read` (ya
      existían en el catálogo desde Fase 0, con una descripción que ya
      anticipaba ajustes/transferencias) — no se crearon permisos nuevos,
      siguiendo la instrucción de no crear permisos salvo que sean
      necesarios. Probado que un rol con `inventory.read` pero sin
      `inventory.manage` (AUDITOR) puede consultar stock/kardex pero no
      registrar movimientos ni transferencias (403).
- [x] Frontend real: `/inventory/movements` pasó de un formulario mínimo
      (solo entrada/ajuste) a la pantalla completa: filtros (producto,
      almacén, tipo, rango de fechas), registrar entrada/salida/ajuste,
      registrar transferencia entre almacenes, ver kardex de un
      producto+almacén específico con saldo corriente, tabla de stock por
      almacén, historial general filtrable, y errores visibles en cada
      formulario (nunca un fallo silencioso).
- [x] Auditoría: `inventory.movement.create` e `inventory.transfer.create`
      registrados para cada movimiento manual/ajuste y cada transferencia.
- [x] Regresión verificada: los 49 tests de Ventas + Compras de las Fases
      Comerciales 2 y 3 siguen pasando sin cambios, y un recorrido en
      navegador real confirmó que Ventas sigue descontando stock
      correctamente después de los cambios de esta fase (mismo motor de
      inventario).
- [x] Suite de tests de integración real (26 tests nuevos:
      `inventory.integration/concurrency/security.spec.ts`), sumando 75 en
      total.
- [x] **Inventario avanzado NO es facturación electrónica.** Kardex,
      transferencias y ajustes no generan XML, no calculan CUF/CUFD, no
      firman nada — cero relación con el SIN.

**Pendiente detectado (no bloqueante para esta fase, no corregido por estar
fuera de su alcance)**: la regla de lint `react-hooks/set-state-in-effect`
(de `eslint-config-next`) marca como error el patrón `useEffect(() => {
load(); }, [...])` usado en TODAS las páginas del frontend desde Foundation
(14 ocurrencias en 8+ archivos, incluyendo páginas no tocadas en esta
fase). No es una regresión de Fase Comercial 4 — ya estaba presente antes
de empezarla. Corregirlo implicaría refactorizar el patrón de carga de
datos en todo el frontend, fuera del alcance de esta fase; queda
documentado acá para una fase de limpieza técnica futura.

## Fase Comercial 5 — Caja y Gastos ✅

Entregable: apertura/cierre/arqueo de caja real por punto de venta (a lo
sumo una caja OPEN por terminal, garantizado a nivel de Postgres),
ingresos/egresos manuales, gastos asociados a una caja abierta, y los
cobros en efectivo de Ventas ahora alimentan automáticamente el
movimiento de caja correspondiente cuando hay una caja abierta para ese
punto de venta. Ver `docs/architecture.md` sección 10 para el detalle
técnico completo.

- [x] `CashRegister`/`CashMovement`/`Expense` — modelos placeholder desde
      la Fase 1 — pasaron a tener módulo de negocio real
      (`backend/src/cash/`). Se ampliaron con las columnas que el modelo
      original no tenía: `openingIdempotencyKey`/`closingIdempotencyKey`
      en `CashRegister`, `idempotencyKey`/`createdById`/`reference` en
      `CashMovement`, `cashRegisterId`/`createdById`/`idempotencyKey`/
      `observation` en `Expense` (y `category` pasó a opcional). Migración
      `20260817160000_cash_expenses_core`.
- [x] Apertura (`POST /cash-registers`): a lo sumo una caja `OPEN` por
      `posTerminalId`, garantizado por un índice único parcial de
      Postgres (`WHERE status = 'OPEN'`, Prisma no lo expresa en su DSL,
      agregado a mano en la migración — mismo criterio que el `CHECK`
      constraint de `payments` en la Fase Comercial 3) — nunca un chequeo
      "leer-luego-escribir" en la aplicación, que tendría una carrera real
      bajo concurrencia.
- [x] Cierre + arqueo en un solo paso (`POST /cash-registers/:id/close`):
      calcula `expectedAmount` (saldo inicial + ingresos − egresos) bajo
      lock (`SELECT ... FOR UPDATE`, mismo patrón que
      `lockSale`/`lockPurchase`/`lockPayable`), compara contra
      `countedAmount` (efectivo contado por el usuario) para obtener
      `difference` (positivo = sobrante, negativo = faltante), y deja la
      caja `CLOSED` — ya no admite nuevos movimientos ni gastos (`409`).
- [x] Ingresos/egresos manuales (`POST /cash-registers/:id/movements`,
      `type: CASH_IN`/`CASH_OUT`) y gastos (`POST /expenses`, crea el
      `Expense` y su `CashMovement` tipo `EXPENSE` atómicamente, en la
      misma transacción).
- [x] **Decisión explícita documentada antes de implementarla** (pedida
      por el prompt): ni un egreso manual ni un gasto pueden superar el
      saldo disponible de la caja — se rechazan con `400`. No se permite
      saldo negativo, mismo principio que "nunca stock negativo" en
      Inventario y "nunca pagar más del saldo pendiente" en Ventas/Compras.
- [x] Integración con Ventas: un pago con `method: CASH` genera
      automáticamente un `CashMovement` (`type: SALE_PAYMENT`) en la caja
      `OPEN` del punto de venta de la venta, atómico con el `Payment`
      (misma transacción). Métodos no efectivo (CARD/TRANSFER/QR) nunca
      generan movimiento de caja — no mueven efectivo físico. Si no hay
      caja abierta para ese terminal, el pago se aplica igual, sin
      movimiento de caja — Ventas nunca quedó bloqueada por no tener Caja
      abierta (los 27 tests de Ventas de Fases 2-4, que nunca abren una
      caja, siguen pasando sin cambios).
- [x] Idempotencia y concurrencia con el mismo rigor que Ventas/Compras/
      Inventario: apertura, cierre, movimientos y gastos exigen
      `idempotencyKey`; colisión de unicidad resuelta fuera de la
      transacción que la generó; y — aplicando directamente desde el
      inicio la corrección que Inventario necesitó agregar después (Fase
      Comercial 4) — reusar una `idempotencyKey` con datos distintos
      siempre responde `409`, nunca aplica en silencio el registro
      ajeno. Probado con aperturas concurrentes (una gana, la otra `409`),
      cierres concurrentes (exactamente uno completa), egresos/gastos
      concurrentes que juntos excederían el saldo (uno gana), y doble
      click/retry en cada operación (efecto único).
- [x] Multi-tenant: RLS ya existía en las 3 tablas desde la migración
      inicial (eran placeholders desde Fase 1); probado con HTTP real
      (tenant B nunca ve/opera una caja de tenant A, ni puede abrir una
      caja reusando un `posTerminalId` de A) y con SQL crudo (contexto de
      tenant inexistente → cero filas, fail-closed real).
- [x] Permisos: se agregaron `cash.read` y `expenses.read` (antes solo
      existían `cash.manage`/`expenses.manage` — sin un permiso de solo
      lectura, AUDITOR no podía ver nada de Caja/Gastos, mismo motivo por
      el que se agregó `payables.read` en la Fase Comercial 3). No se
      crearon permisos por operación (abrir/cerrar/mover por separado):
      `cash.manage` ya cubre las tres, evitando proliferación de permisos
      no pedida.
- [x] Frontend real: `/cash` (cajas abiertas, formulario de apertura,
      historial de cajas cerradas) y `/cash/[id]` (detalle: saldo actual
      calculado en vivo, registrar ingreso/egreso, registrar gasto, cerrar
      con arqueo, historial de movimientos y gastos de esa caja —
      formularios de acción se ocultan automáticamente cuando la caja está
      `CLOSED`).
- [x] Auditoría: `cash.open`, `cash.close`, `cash.movement.create`,
      `expenses.create`.
- [x] Regresión verificada: los 75 tests de Ventas+Compras+Inventario de
      las Fases Comerciales 2-4 siguen pasando sin cambios (102 tests en
      total con los 27 nuevos de Caja), y un recorrido en navegador real
      confirmó el flujo completo: abrir caja → ingreso manual → gasto →
      vender con pago en efectivo (el POS de Ventas, sin cambios visibles
      para el usuario) → el movimiento `Cobro de venta` aparece solo en el
      detalle de caja → cerrar con arqueo exacto (diferencia 0) →
      Inventario sigue reflejando el stock correcto tras la venta.

**Pendiente explícito (NO resuelto en esta fase — el prompt de Fase
Comercial 5 no lo pidió, a diferencia de lo que este documento anticipaba
en una nota anterior)**: los pagos de `Payable` (egresos a proveedores,
Compras) todavía no se enlazan a Caja, y la devolución de una venta
(`Sale.return`) todavía no genera ningún reembolso de caja. Ambos quedan
para una fase futura si se autoriza explícitamente. Tampoco se resolvió
la dependencia documentada en la Fase Comercial 3 (qué pasa cuando una
devolución a un proveedor dejaría la `Payable` por debajo de lo ya
pagado, es decir, el proveedor terminaría debiéndonos) — sigue
rechazándose explícitamente, sin cambios.

## Fase Comercial 6 — Pagos y Cuentas ✅

Entregable: cierra el núcleo de pagos y cuentas del SaaS comercial —
Receivables reales (antes solo esquema), la integración de Caja con los
pagos a proveedores (Payables) que faltaba desde la Fase Comercial 5, y
la devolución de venta ahora genera un reembolso real y trazable,
integrado con Caja cuando corresponde. Ver `docs/architecture.md`
sección 11 para el detalle técnico completo.

- [x] `Receivable` — módulo de negocio real (`backend/src/receivables/`),
      antes placeholder de esquema desde la Fase 1. Se crea automáticamente
      al confirmar una venta a crédito (con cliente, con saldo pendiente)
      dentro de la MISMA transacción de `SalesService.confirm` — mismo
      momento en que Compras genera la `Payable` al recibir mercadería.
      `@@unique([saleId])` + chequeo previo garantizan que nunca se
      duplique para la misma venta.
- [x] **Decisión de diseño central**: una Receivable NO tiene su propio
      ledger de pagos — pagarla delega íntegramente en
      `SalesService.addPayment` (el mismo `Payment.saleId` de siempre), así
      que reusa automáticamente TODA su idempotencia, su lock, su rechazo de
      sobrepago, y su integración con Caja de las Fases Comerciales 2 y 5,
      sin duplicar ni un ápice de esa lógica.
- [x] Payables ↔ Caja: `PayablesService.addPayment` ahora acepta un
      `posTerminalId` opcional; un pago en efectivo con caja abierta genera
      su `CashMovement` (`type: PAYABLE_PAYMENT`) atómicamente. A diferencia
      de Ventas, un pago a proveedor que supera el saldo de la caja elegida
      SÍ se rechaza (`400`, transacción completa revertida) — decisión
      explícita documentada antes de implementarla (ver architecture.md).
- [x] Devolución de venta → Reembolso: `SalesService.returnSale` ahora
      calcula lo efectivamente pagado, crea un `Refund` (modelo nuevo,
      ledger análogo a `PurchaseReturn`) cuando corresponde (nunca si la
      venta no tenía pagos), y genera un `CashMovement`
      (`type: SALE_REFUND`) por la porción pagada en efectivo — que a
      diferencia de Payables, SE OMITE (no bloquea la devolución) si la
      caja elegida no tiene saldo suficiente, decisión explícita distinta y
      documentada. La Receivable asociada (si existía) pasa a `CANCELLED`.
      Idempotente por el mismo mecanismo de lock que `cancel()` — sin
      `idempotencyKey` propia, probado con dos devoluciones concurrentes de
      la misma venta (exactamente un `Refund`, un `CashMovement`).
- [x] Idempotencia y concurrencia con el mismo rigor de siempre: dos pagos
      concurrentes que juntos superarían un saldo (Receivable o Payable),
      retry/doble click en cada operación, pago concurrente con cierre de
      caja, dos reembolsos simultáneos — todo probado, nunca doble efecto,
      nunca saldo negativo.
- [x] Coherencia de estados entre `Sale`/`Payment`/`Receivable`/
      `Purchase`/`Payable`/`CashMovement`/`CashRegister`: `Receivable.status`
      se deriva y escribe únicamente desde eventos de `Sale` (nunca al
      revés), y ningún `CashMovement` es mutable — nunca puede haber un
      estado contradictorio entre estas entidades por construcción.
- [x] Multi-tenant: RLS ya cubría `receivables` desde la migración inicial;
      la tabla nueva `refunds` la agrega igual que el resto del esquema.
      Probado con HTTP real y SQL crudo, incluyendo el caso específico de
      esta fase (un tenant no puede mover la caja de otro indicando su
      `posTerminalId` en un pago/reembolso — la query queda scoped por RLS
      al organizationId del que hace el request, así que simplemente no
      encuentra ninguna caja y el movimiento se omite).
- [x] Permisos: se agregó `receivables.read` (antes solo `receivables.manage`
      existía, mismo motivo que llevó a agregar `payables.read`/`cash.read`/
      `expenses.read` en fases anteriores — sin él, AUDITOR no podía ver
      nada de Receivables). No se crearon permisos nuevos para Payables ni
      para reembolsos: se reutilizan `payables.manage`/`sales.delete`.
- [x] Frontend real: `/receivables` (listado con filtro por estado) y
      `/receivables/[id]` (detalle, historial de pagos, formulario de
      cobro); `/payables` (listado, enlaza al detalle de la compra donde ya
      vivía el formulario de pago, ahora con selector de caja); el
      formulario de pago de `/purchases/[id]` gana el selector de caja
      abierta; `/sales/[id]` muestra una sección "Reembolso" cuando la
      venta está `REFUNDED`.
- [x] Auditoría: `receivables.create`, `receivables.payment.create`,
      `payables.payment.create` (ya existía), `sales.refund.create`.
- [x] Regresión verificada: los 102 tests de Ventas+Compras+Inventario+Caja
      de las Fases Comerciales 2-5 siguen pasando sin cambios (138 tests en
      total con los 36 nuevos de esta fase), y un recorrido en navegador
      real confirmó el flujo completo: venta a crédito → Receivable →
      cobro en efectivo → `CashMovement` visible en Caja; y por separado,
      venta pagada en efectivo → devolución → `Refund` visible en el
      detalle de la venta → `CashMovement SALE_REFUND` visible en Caja.
      También se verificó visualmente el rechazo correcto (mensaje de error
      claro en la UI) de un pago a proveedor que superaba el saldo de la
      caja elegida.

**Pendiente explícito (NO pedido en esta fase)**: los pagos de `Payable`
solo se enlazan a Caja cuando el usuario indica explícitamente una caja —
no hay una noción de "caja por defecto" para Compras (Compras no tiene un
punto de venta como Ventas). Tampoco se resolvió la dependencia
documentada en la Fase Comercial 3 (devolución a proveedor que dejaría la
Payable por debajo de lo ya pagado, es decir, el proveedor terminaría
debiéndonos) — sigue rechazándose explícitamente, sin cambios; no fue
pedida en esta fase tampoco. Un modelo de devolución/reembolso PARCIAL
(por ítem) queda fuera de alcance — la devolución sigue siendo total,
como desde la Fase Comercial 2.

## Auditoría de integración comercial post-Fase 6 ✅

Auditoría de solo-lectura sobre las Fases Comerciales 2-6 ya
implementadas (sin nuevas features, sin tocar SIN/facturación
electrónica), pedida explícitamente para buscar inconsistencias entre
módulos antes de autorizar la Fase 7. Cubrió los 5 flujos comerciales
completos (venta→inventario→pago→caja; venta a crédito→receivable→
cobro→caja; compra→inventario→payable→pago→caja; devolución de venta→
reembolso→caja; pagos parciales/mixtos) y concurrencia/retries, releyendo
línea por línea `sales.service.ts`, `purchases.service.ts`,
`payables.service.ts` (y por diseño de la Fase 6, `receivables.service.ts`
delega en `sales.service.ts`), verificando locks, idempotencia, Decimal,
RLS y RBAC contra el código real (no solo contra los tests ya escritos).

- [x] **Bug real encontrado y corregido**: `PurchasesService
      .returnToSupplier()` (y `growOrCreatePayable()`, compartido con
      `receive()`) leían `Payable.amount`/`status` con un `SELECT` sin
      bloqueo (`tx.payable.findUnique`), confiando únicamente en el lock
      de `Purchase` (`lockPurchase`). Como `PayablesService.addPayment`
      solo bloquea la fila de `Payable` (nunca toca `Purchase`), una
      devolución al proveedor y un pago sobre la misma Payable, ejecutados
      concurrentemente, podían validarse cada uno contra un `amount`
      distinto (el pago contra el monto previo a la devolución) y dejar el
      balance final negativo (sobrepago) — exactamente uno de los
      resultados prohibidos explícitamente en el pedido de auditoría.
      Reproducido de forma determinística en
      `purchases.concurrency.spec.ts` antes del fix (ambas peticiones
      devolvían 201 y el balance quedaba en -300), corregido agregando
      `lockPayableByPurchase` (`SELECT ... FOR UPDATE` sobre `payables`
      por `purchaseId`) en ambos puntos de lectura-antes-de-escritura, y
      cubierto con un test de regresión que verifica la invariante
      (`balance >= 0`) sin importar el orden de la carrera. Batería
      completa re-ejecutada tras el fix: 139/139 tests, build
      backend/frontend limpios, `verify:tenant-isolation` 21/21, eslint
      limpio en los módulos comerciales, y los 4 flujos core
      re-verificados con Playwright sobre el código corregido.
- [x] Resto de los módulos auditados (Ventas, Inventario, Caja,
      Receivables — por delegación en Ventas) sin hallazgos: locks
      siempre antes de la lectura que determina el efecto, idempotencia
      vía `idempotencyKey` único + patrón `assertMatches`/P2002 fuera de
      la transacción original, dinero 100% `Prisma.Decimal` vía
      `common/money.ts`, RLS activo y forzado en todas las tablas
      tocadas (incluida la lectura sin scope explícito por
      `organizationId` de `paidAmountFor`, segura porque corre dentro de
      `TenantPrismaService.run` con RLS `FORCE`), y `@RequirePermissions`/
      `@NoPermissionRequired` presentes en todos los endpoints de las
      Fases 2-6.
- [x] No se implementó ninguna funcionalidad nueva ni se tocó Reportes,
      SIN o Facturación Electrónica — alcance estrictamente limitado al
      bug encontrado.

## Fase Comercial 7 — Reportes ✅

Entregable: módulo de reportes comerciales (NO fiscales) sobre los datos
reales de las Fases 2-6, más un dashboard con indicadores reales. Ver
`docs/architecture.md` sección 13 para el detalle técnico completo.

- [x] 17 reportes (`backend/src/reports/`, `ReportsService`/
      `ReportsController`, uno por endpoint `GET /reports/<clave>`): ventas,
      compras, ingresos, egresos, caja, inventario, kardex/movimientos,
      cuentas por cobrar, cuentas por pagar, productos más vendidos, ventas
      por producto/categoría/sucursal/POS/usuario, métodos de pago, ventas
      por rango de fechas.
- [x] Filtros comunes (fecha desde/hasta, sucursal, almacén, POS, usuario,
      producto, categoría, método de pago, estado) vía un único
      `ReportQueryDto` — cada reporte usa solo los que le aplican. Ningún
      filtro puede escapar el tenant: todo id se combina siempre con
      `organizationId` (y las tablas referenciadas tienen RLS `FORCE`), así
      que un id de otro tenant nunca filtra datos ajenos, simplemente no
      matchea nada.
- [x] **No se duplicó ningún motor de negocio**: `inventoryReport`/
      `movementsReport` reutilizan `InventoryService.listStock`/
      `listMovements` directamente; `incomeReport`/`expensesReport`/
      `cashReport` clasifican `CashMovement` con los mismos
      `CASH_INCREASE_TYPES`/`CASH_DECREASE_TYPES` que ya usa
      `CashService.computeBalance` (exportados desde ahí, no redeclarados);
      el resto son lecturas/agregaciones directas (Prisma `aggregate`/
      `groupBy`, algún `$queryRaw` de solo lectura para joins que Prisma no
      resuelve) sobre las tablas que Ventas/Compras/Receivables/Payables ya
      escriben — nunca se reimplementa cómo se confirma una venta, se
      recibe una compra o se calcula un saldo.
- [x] Exportación CSV y Excel real (`exceljs`) por reporte
      (`GET /reports/:key/export?format=csv|xlsx`), reutilizando EXACTO el
      mismo método/filtros que la vista en pantalla — nunca una consulta
      separada, así que pantalla y archivo nunca pueden divergir. Auditado
      (`reports.export`).
- [x] Dashboard (`OrganizationsService.getDashboardSummary`) ampliado con
      datos reales: ventas/compras del período, ingresos/egresos de caja,
      cuentas por cobrar/pagar pendientes, valorización de inventario,
      productos más vendidos (reutiliza `ReportsService.topProductsReport`).
      Se corrigió además un subconteo real heredado de Fase 1: "ventas del
      día/mes" solo contaba `status: 'CONFIRMED'`, dejando afuera toda
      venta ya `PARTIALLY_PAID`/`PAID` (la inmensa mayoría en la práctica).
- [x] **Utilidad comercial explícitamente NO calculada**: `SaleItem` no
      persiste el costo unitario al momento de la venta (a diferencia de
      `PurchaseItem.unitCost`, que sí es histórico) y no hay trazabilidad de
      lote/FIFO. El dashboard devuelve
      `grossMargin: { available: false, reason: '...' }` en vez de inventar
      una cifra con el costo actual del producto.
- [x] Seguridad: RLS + `TenantPrismaService` en todo, `@RequirePermissions('reports.read')`
      en los 17 endpoints + el export (permiso que ya existía en el
      catálogo desde Fase 1, asignado a OWNER/ADMIN/MANAGER/ACCOUNTANT/
      AUDITOR — no se creó ningún permiso nuevo). Probado con dos tenants
      reales, incluyendo filtrar explícitamente por ids (producto,
      almacén, sucursal, POS) del OTRO tenant desde el token propio: cero
      filas, nunca fuga.
- [x] Rendimiento: paginación real (`skip`/`take`) en los reportes
      tabulares, `summary` calculado con una query de agregación aparte
      (nunca trayendo todas las filas a memoria solo para sumarlas), sin
      N+1 (los `include`/joins necesarios van en la misma query).
- [x] Frontend real `/reports` (reemplaza el `ComingSoon` de Fase 1):
      selector de los 17 reportes agrupados, filtros contextuales, tarjetas
      de resumen, tabla paginada, estados de carga/vacío/error, exportación
      CSV/Excel. Dashboard (`/dashboard`) actualizado con los indicadores
      nuevos y la tabla de productos más vendidos.
- [x] Tests reales (`reports.integration.spec.ts` 27 casos,
      `reports.security.spec.ts` 14 casos): aislamiento de tenant,
      filtros/fechas/agregaciones sobre un escenario fijo con cifras
      conocidas de antemano, permisos (403 sin `reports.read`, 200 con
      él), exportación CSV/Excel verificando que el archivo trae las
      MISMAS cifras que la vista. Regresión completa: 180/180 tests
      (139 previos + 41 nuevos), sin cambios de esquema (ninguna migración
      nueva — no era necesaria).

**Pendiente explícito (NO pedido en esta fase)**: sin gráficos/visualizaciones
(solo tablas y tarjetas numéricas); sin reportes fiscales/de facturación
electrónica (fuera de alcance por diseño); "ventas por categoría" no tiene
selector de categoría en su propio filtro (no aplica: es precisamente lo
que agrupa); la utilidad comercial queda sin calcular hasta que exista
costo histórico por línea de venta (fuera de alcance de esta fase).

## Fase Comercial 8 — Recibos comerciales NO fiscales ✅

Entregable: `CommercialReceipt`, un documento comercial interno (NUNCA
fiscal) que una venta puede generar, con snapshot inmutable, numeración
segura bajo concurrencia, y PDF en A4 y ticket térmico 80mm. Ver
`docs/architecture.md` sección 14 para el detalle técnico completo, y la
sección "Recibos vs. Facturación" más abajo para la separación
arquitectónica explícita con el futuro módulo fiscal.

- [x] `CommercialReceipt` 1:1 estricto con `Sale` (`@@unique([saleId])` —
      una venta nunca puede tener dos recibos) en un módulo propio
      (`backend/src/receipts/`), completamente separado de `sales/` (que
      nunca importa nada de `receipts/`) y de cualquier futuro módulo
      `fiscal/` (que no existe todavía — ver más abajo).
- [x] Snapshot JSONB inmutable (`commercial_receipts.snapshot`): emisor
      (nombre, NIT, dirección, teléfono, sucursal, POS), operación
      (número, fecha, cajero, venta relacionada), cliente (nombre,
      NIT/CI si existe), detalle de ítems (producto, cantidad, precio,
      descuento, subtotal), pagos (métodos, mixtos, pagado, saldo). Se
      arma UNA vez al emitir y nunca se vuelve a escribir — probado
      explícitamente cambiando después el nombre de la empresa, del
      cliente y del producto, y confirmando que el recibo ya emitido no
      cambia.
- [x] Numeración `SERIE-NNNNNN` (`REC-000001`, ...) — un contador
      atómico por organización (`receipt_sequences`, `@unique` por
      `organizationId`), incrementado con un único
      `INSERT ... ON CONFLICT DO UPDATE ... RETURNING` (nunca
      `MAX(number) + 1`). Se decidió numeración a nivel de ORGANIZACIÓN
      completa, no por sucursal/POS: a diferencia de la numeración fiscal
      (que si se implementa a futuro sí sería por punto de venta/CUFD),
      un recibo comercial interno no tiene ese requisito normativo, y una
      sola secuencia continua es más simple de auditar para el dueño del
      negocio. Documentado como decisión explícita, revisable si una
      fase futura lo requiere.
- [x] Idempotencia: emitir el recibo de una venta que ya tiene uno
      devuelve el mismo recibo, nunca crea un segundo ni consume un
      número nuevo — probado con dos requests concurrentes reales y con
      10 requests concurrentes sobre la misma venta (`Promise.all`,
      nunca secuencial), además de emisión concurrente de recibos para
      ventas DISTINTAS confirmando numeración sin huecos ni duplicados.
- [x] Estados de `Sale` que admiten recibo: `CONFIRMED`, `PARTIALLY_PAID`,
      `PAID` — nunca `DRAFT` (la venta ni se concretó) ni `CANCELLED`
      (se revirtió). `REFUNDED` se excluye para EMITIR un recibo nuevo,
      pero un recibo ya emitido antes del reembolso sigue siendo válido
      como documento histórico (su snapshot no se toca).
- [x] PDF real en dos formatos (`pdfkit`, dependencia nueva) generado
      SIEMPRE desde el snapshot guardado — nunca reconsultando `Sale`/
      `Customer`/`Organization`/`Product`. "DOCUMENTO COMERCIAL NO FISCAL"
      visible de forma prominente en ambos formatos, además de "RECIBO DE
      VENTA" (nunca "Factura"). A4 para impresión de oficina, 80mm para
      impresora térmica de POS.
- [x] Frontend real en `/sales/[id]`: sección "Recibo comercial" que
      muestra si existe recibo, botón "Emitir recibo" (desaparece tras
      emitir — nunca doble emisión desde la UI, más allá de que el
      backend ya es idempotente), "Ver"/"Descargar" para cada formato de
      PDF (ver abre el PDF en una pestaña nueva del navegador, desde
      donde el usuario puede imprimir con el visor nativo).
- [x] Permisos nuevos: `receipts.manage` (emitir) y `receipts.read` (ver/
      descargar), asignados a OWNER/ADMIN (todos los permisos), MANAGER,
      CASHIER y SALES (son quienes emiten recibos en la práctica);
      ACCOUNTANT e INVENTORY no los tienen; AUDITOR los hereda vía su
      regla de "todo lo que termina en `.read`".
- [x] Seguridad: RLS `FORCE` + policy `tenant_isolation` en
      `commercial_receipts` y `receipt_sequences` (migración
      `20260817191458_commercial_receipts`, puramente aditiva). Probado
      con dos tenants reales: B no puede leer/descargar/listar-por-venta
      un recibo de A (404, nunca datos ajenos), la numeración de B es
      independiente (empieza en 1 aunque A ya tenga varios), y RLS crudo
      (sin pasar por Nest) confirma fail-closed con contexto de tenant
      inexistente.
- [x] Auditoría: `receipts.issue` (emisión) y `receipts.pdf.download`
      (cada descarga de PDF, con el formato).
- [x] Sin integración de email real (`MailService` sigue siendo un stub
      desde Fase 1) — explícitamente no pedido en esta fase.
- [x] Tests reales: 29 casos nuevos (`receipts.integration.spec.ts`,
      `receipts.concurrency.spec.ts`, `receipts.security.spec.ts`)
      cubriendo emisión/contenido/snapshot/inmutabilidad/numeración/
      concurrencia real/retry/doble click/tenant/RLS/RBAC/PDF A4/PDF
      térmico/estados permitidos. Regresión completa: 209/209 tests
      (180 previos + 29 nuevos), sin cambios destructivos de esquema.

## Fase Comercial 9 — Notificaciones y Email real ✅

Entregable: módulo real de notificaciones internas (listar, marcar
leída/todas, contador de no leídas, integradas en los eventos de negocio
importantes) y arquitectura de email real y desacoplada (interfaz
`EmailSender` + proveedores intercambiables por variable de entorno,
encolado vía BullMQ/Redis existente, con retries/backoff/idempotencia/
estado persistido en `EmailLog`). Ver `docs/architecture.md` sección 15
para el detalle técnico completo.

- [x] `NotificationsModule` (`backend/src/notifications/`): listar
      (paginado, filtro `unreadOnly`), `GET /unread-count`,
      `PATCH /:id/read`, `PATCH /read-all` — recurso personal
      (`@NoPermissionRequired()`, sin permiso de catálogo nuevo), aislado
      por `organizationId` (RLS) y por `userId` (aplicación: un usuario no
      puede marcar como leída la notificación de otro, ni siquiera dentro
      de la misma organización).
- [x] `Notification.userId` nunca `null` en la implementación real
      (aunque el campo sigue siendo nullable desde Fase 1) — decisión
      documentada para no compartir el booleano `read` entre usuarios.
      Integrada en: venta confirmada, pago recibido, compra recibida,
      cuenta por cobrar pendiente (venta a crédito nueva), cuenta por
      pagar pendiente (primera recepción con saldo real), apertura/cierre
      de caja, y diferencia de arqueo al cerrar caja (error operativo).
      Cada punto de integración guarda explícitamente contra duplicados
      en replays idempotentes — probado que un segundo `POST .../confirm`
      sobre una venta ya confirmada no genera una notificación extra.
- [x] `MailService` reemplazado por una arquitectura real: interfaz
      `EmailSender` (`ConsoleEmailSender` default sin credenciales,
      `SmtpEmailSender` vía `nodemailer`), proveedor elegido 100% por
      `EMAIL_PROVIDER` (variable de entorno, nunca hardcodeado). El
      dominio comercial (auth, members, sales, receipts) solo conoce
      `MailService` — nunca un proveedor concreto.
      `sendEmailVerification`/`sendPasswordReset`/`sendInvite` mantienen
      sus firmas ya usadas por `auth.service.ts`/`members.service.ts`; se
      suman `sendWelcome`, `sendSaleConfirmation`, `sendReceiptEmail`,
      `sendNotificationEmail`.
- [x] Cola: reutiliza el BullMQ/Redis ya existente (mismo patrón que
      `AuditModule`), cola nueva `email` — nunca un segundo sistema de
      colas. `attempts: 3`, backoff exponencial (delay 1000ms),
      `removeOnComplete`/`removeOnFail` — el request HTTP nunca espera al
      proveedor. `EmailLog` (ledger append-only, RLS) registra
      `to`/`template`/`status`/`provider`/`attempts`/`error`, escrito
      ÚNICAMENTE por `EmailProcessor` (nunca por `MailService`, para que
      un rollback de la transacción de negocio que originó el email no
      deje un registro fantasma). Idempotencia vía
      `EmailLog.idempotencyKey` única — pedir el email del mismo recibo
      dos veces no dispara un segundo envío.
- [x] Templates HTML + texto plano (`mail/templates/`): bienvenida,
      recuperación de contraseña, confirmación de email, invitación,
      confirmación de venta, recibo comercial, notificación genérica. El
      de recibo repite "DOCUMENTO COMERCIAL NO FISCAL" en el cuerpo del
      correo — el rótulo real vive en el PDF adjunto.
- [x] Email del recibo (`POST /receipts/:id/email`, `receipts.manage`):
      adjunta el MISMO PDF (formato A4) que ya genera
      `GET /receipts/:id/pdf`, siempre desde `receipt.snapshot` — nunca
      reconstruye desde `Sale`/`Customer`/`Organization` actuales.
      Destinatario explícito o, si se omite, el email del cliente de la
      venta; sin ninguno de los dos, 400 explícito (nunca omite el envío
      en silencio).
- [x] Frontend: `/notifications` real (lista paginada, filtro "solo no
      leídas", marcar una/todas como leídas, estados vacíos y de error
      reales) reemplaza el placeholder. `AppShell` suma un contador de no
      leídas junto al ítem del menú (poblado al montar y cada 30s).
- [x] Seguridad: RLS en `email_logs` (tabla nueva, migración puramente
      aditiva) y `notifications` (ya la tenía desde Fase 1). Secretos de
      email solo por variable de entorno (`EMAIL_PROVIDER`,
      `EMAIL_SMTP_*`, `EMAIL_FROM`, `FRONTEND_URL`), ninguno hardcodeado.
- [x] Sin tocar nada de `fiscal/` — sigue sin existir ni un placeholder.
- [x] Tests reales: 28 casos nuevos
      (`notifications.integration.spec.ts` — 11,
      `notifications.security.spec.ts` — 6, `mail.integration.spec.ts` —
      6, `email.processor.spec.ts` — 4, más 1 caso nuevo agregado a
      `receipts.security.spec.ts` para el endpoint de email del recibo,
      con sus asserts ampliados en los tests de RBAC/401 ya existentes)
      cubriendo notificaciones/tenant/RBAC/unread-count/mark-read/
      idempotencia/servicio de email/templates/cola real vía BullMQ+Redis/
      reintentos y agotamiento vía `EmailProcessor` directo/errores del
      proveedor/email de recibo con PDF adjunto. Regresión completa:
      237/237 tests (209 previos + 28 nuevos), sin cambios destructivos
      de esquema.
- [x] Renumeración: esta fase toma el número 9 (autorizado así
      explícitamente); Facturación/Fiscal/SIN pasa al número 10 (ver
      "Fases siguientes" abajo) — mismo criterio que la renumeración ya
      aplicada en Fase Comercial 8 para Recibos comerciales.

## Fase Comercial 10 — Planes, límites y suscripciones ✅

Entregable: los 4 planes reales (`free`/`basic`/`pro`/`enterprise`) con un
catálogo fuente único, ciclo de vida completo de `Subscription`
(activación, cambio de plan, cancelación, expiración perezosa, renovación
manual), y enforcement REAL (no solo declarado) de los límites que ya
existían en el esquema (`maxUsers`/`maxBranches`/`maxProducts`), seguro
bajo concurrencia. Ver `docs/architecture.md` sección 16 para el detalle
técnico completo.

- [x] Catálogo de 4 planes (`backend/src/subscriptions/plans.catalog.ts`,
      fuente única para seed/bootstrap/`SubscriptionsService`) — `free`
      (ya existía: 3 usuarios/1 sucursal/50 productos, Bs 0), `basic` (10/3/500,
      Bs 99), `pro` (30/10/5000, Bs 299), `enterprise` (ilimitado, Bs 799).
- [x] Alcance de límites deliberadamente acotado a los que YA estaban
      definidos en el código (`maxUsers`/`maxBranches`/`maxProducts`) — no
      se inventaron límites de almacenes/POS/clientes/proveedores/ventas/
      almacenamiento que el prompt mencionó como ejemplo pero que nunca
      existieron en el esquema ni en `prisma/seed.ts` antes de esta fase.
- [x] Ciclo de vida real (`SubscriptionsModule`,
      `/organizations/me/subscription*`): `GET` (resumen con uso vs.
      límite), `POST change-plan` (bloquea downgrade si el uso ya excede
      el plan destino, 409), `POST cancel`, `POST renew` (renovación
      manual — sin pasarela real, ver más abajo). Expiración perezosa:
      `ACTIVE` con `currentPeriodEnd` vencido pasa a `PAST_DUE` al leerse,
      sin cron dedicado. Cada transición deja `SubscriptionEvent` +
      `AuditLog` + `Notification` (reutiliza la infraestructura de la
      Fase Comercial 9, ningún sistema nuevo).
- [x] Enforcement real dentro de la transacción que crea el recurso
      (`MembersService.invite`/reactivación, `BranchesService.create`,
      `ProductsService.create`/`duplicate`), con `SELECT ... FOR UPDATE`
      sobre `subscriptions` para que sea seguro bajo concurrencia
      real — probado con 10 creaciones de producto y 8 invitaciones
      verdaderamente concurrentes (`Promise.all`) contra límites chicos:
      el conteo final nunca superó el límite.
- [x] Seguridad: `subscription.manage` (permiso nuevo, solo OWNER/ADMIN)
      protege cambiar de plan/cancelar/renovar — probado 403 para los 6
      roles restantes. El cliente nunca controla su plan/límites (DTO
      valida `planKey` contra las 4 claves reales; los límites se leen
      siempre del servidor). Suscripción CANCELLED bloquea creación de
      recursos con 403; alcanzar el límite numérico responde 402
      (`Payment Required`) — distingue "no podés" de "no podés MÁS sin
      upgradear".
- [x] `app_superadmin` revisado explícitamente — sigue sin ninguna
      superficie de aplicación (ningún endpoint lo usa); la gestión del
      catálogo de planes sigue siendo vía `prisma/seed.ts`.
- [x] Arquitectura de billing preparada, SIN pasarela real: no se cobra
      nada, no se almacenan tarjetas ni datos sensibles de pago.
      `changePlan`/`renew` ya separan "qué le pasa a la suscripción" de
      "cómo se cobra", y `SubscriptionEvent` es el lugar natural para que
      un futuro webhook de proveedor escriba eventos — sin acoplar
      `SubscriptionsService` a Mercado Pago/Stripe/ningún proveedor
      concreto (ver "Fases siguientes" abajo).
- [x] Frontend `/subscription` real: estado, uso con barras y porcentaje
      por límite, tarjetas de los 4 planes, cambiar/cancelar/renovar.
- [x] Sin tocar `fiscal/` — sigue sin existir ni un placeholder.
- [x] Tests reales: 34 casos nuevos
      (`subscriptions.integration.spec.ts` — 12,
      `subscriptions.security.spec.ts` — 13,
      `subscriptions.enforcement.spec.ts` — 9, esta última incluye los dos
      tests de concurrencia real) cubriendo los 4 planes, ciclo de vida
      completo, enforcement, límites, cambio de plan, expiración,
      cancelación, tenant isolation, RBAC, y concurrencia. Regresión
      completa: 271/271 tests (237 previos + 34 nuevos), sin cambios de
      esquema (cero migraciones nuevas en esta fase).
- [x] Renumeración: esta fase toma el número 10 (autorizado así
      explícitamente); Facturación/Fiscal/SIN pasa al número 11 (ver
      "Fases siguientes" abajo) — mismo criterio que las renumeraciones ya
      aplicadas en Fases Comerciales 8 y 9.

## Fases siguientes (dependen de la Parte 2 del prompt para el detalle fino)

- **Fase Comercial 11 — Facturación / Fiscal / SIN**: `Invoice`/
  `InvoiceItem`/`InvoiceEvent`/`TaxConfiguration` ya modelados de forma
  genérica, **sin** campos específicos del SIN todavía. Antes de tocar
  código fiscal real, hay que investigar la normativa vigente (RND, Anexo
  Técnico, algoritmo de CUF, servicios SOAP/REST) tal como exige el
  prompt — no se inventan reglas fiscales. Fuera de alcance hasta nueva
  autorización explícita. (Renumerada de nuevo: Planes/Suscripciones tomó
  el número 10 — arriba —, así que Facturación pasa a este número para no
  chocar con ella. `receipts/`, `notifications/` y `subscriptions/`
  quedan explícitamente separados de un futuro `fiscal/` — así que esta
  renumeración es solo de orden, no de dependencia.)
- **Fase Comercial 12 — Pasarela de pagos real**: conectar un proveedor
  real (Mercado Pago, Stripe, u otro) para que `change-plan`/`renew`
  cobren de verdad — la Fase Comercial 10 preparó el desacople (ver
  `docs/architecture.md` sección 16) pero deliberadamente no implementó
  ningún cobro real, sin especificación de proveedor definida todavía.

## Recibos vs. Facturación (aclaración explícita, sección 3/4 del master spec)

KIPU emite, desde la Fase Comercial 8, **recibos comerciales NO
FISCALES** (`CommercialReceipt`, `backend/src/receipts/`). Un recibo:

- NO es una factura ni un documento fiscal, y nunca se presenta como tal
  — el propio documento dice "RECIBO DE VENTA" / "DOCUMENTO COMERCIAL NO
  FISCAL" de forma prominente, en pantalla y en el PDF (A4 y ticket
  80mm).
- NO depende del SIN de Bolivia ni de ninguna integración fiscal — cero
  XML, cero CUF/CUIS/CUFD/CAFC, cero firma digital, cero SOAP/WSDL.
- NO modifica ni transforma la `Sale` que le da origen — es un documento
  adicional derivado, nunca reemplaza ni altera el ciclo de vida de la
  venta.

**`Sale` NO es `Invoice`. `Purchase` NO es `Invoice`. `CommercialReceipt`
tampoco es `Invoice`.** Los tres son parte del núcleo comercial (ventas/
compras/recibos reales, con su propio ciclo de vida) y son completamente
independientes del módulo de facturación fiscal (`Invoice`/
`TaxConfiguration`, todavía solo esquema genérico desde Fase 1). Ninguno
fue modificado para introducir dependencia alguna hacia el SIN.

Separación arquitectónica explícita, aplicada desde el código y no solo
documentada: `backend/src/sales/` nunca importa nada de
`backend/src/receipts/` (la relación es de un solo sentido — Receipts lee
Sale, Sales no sabe que Receipts existe), y ninguno de los dos importa ni
importará nada de un futuro `backend/src/fiscal/` (que no existe
todavía). Cuando se autorice Facturación Electrónica, el árbol de una
venta se verá así:

```
Sale
├── CommercialReceipt   (Fase Comercial 8 — ya construido, NO fiscal)
└── FiscalDocument      (Fase Comercial 11 — futuro, SIN Bolivia)
```

Son documentos DIFERENTES, con ciclos de vida y validez legal distintos:
`CommercialReceipt` nunca se convierte en `FiscalDocument`, y emitir uno
no emite ni implica el otro. La integración de facturación electrónica
con el SIN de Bolivia (`FiscalDocument`, XML/XSD, CUF/CUIS/CUFD/CAFC,
firma digital, XMLDSig, SOAP/WSDL, QR fiscal, anulación fiscal) queda
para esa fase futura independiente y explícitamente autorizada — no se
implementó nada de esto en ninguna fase hasta ahora, ni se modificó el
núcleo comercial (`Sale`/`Purchase`/`CommercialReceipt`) para introducir
ninguna dependencia hacia ella. La arquitectura prevista para cuando se
autorice sigue siendo `Sale → Fiscal Engine → Fiscal Document → SIN
Adapter → SIN Bolivia`, construida en un módulo `fiscal/` nuevo que
nunca necesitará modificar `receipts/` para funcionar.

## Fase Offline 1 — Preparación del backend ✅

Primera fase de la iniciativa de app offline (Android/Windows/impresión
térmica), a partir del informe de auditoría/diseño entregado al usuario.
Alcance estrictamente de backend, autorizado explícitamente: idempotencia
real en `POST /sales` y la infraestructura mínima de revocación de
sesiones/dispositivos. **No** se implementó (fuera de alcance explícito de
esta fase): Tauri, Capacitor, Electron, Flutter, React Native, IndexedDB,
Dexie, SQLite, Bluetooth, USB, ESC/POS, impresión, sincronización offline
completa, ni PWA offline completa. Tampoco se tocó nada fiscal ni
Cotizaciones. Ver `docs/architecture.md` sección 17 y `docs/security.md`
sección "Fase Offline 1" para el detalle técnico completo.

- [x] `POST /sales` (crear venta) gana `idempotencyKey` opcional
      (`sales.idempotencyKey`, `String? @unique`, migración
      `20260828190000_sales_create_idempotency`, aditiva, sin backfill).
      Mismo criterio arquitectónico que `Payment`/`PurchaseReceipt`/
      `PurchaseReturn`/`CashMovement`/`Expense`/`InventoryMovement`/
      `InventoryTransfer`: precheck + `assertMatches` para el retry
      secuencial, resolución de P2002 fuera de la transacción abortada
      para la carrera real. Opcional (no obligatoria como en `Payment`) a
      propósito: el POS web actual no la envía todavía, y hacerla
      obligatoria lo habría roto en producción — sin ella, el
      comportamiento es exactamente el de antes de esta fase.
- [x] Infraestructura mínima de revocación de sesiones/dispositivos:
      `POST /members/:id/revoke-sessions` (`users.manage`, mismo permiso
      que suspender/cambiar rol) revoca todos los `RefreshToken` activos
      de un miembro EN ESTA organización — cero migraciones nuevas,
      `RefreshToken` ya tenía todos los campos necesarios desde Fase 1.
      `MembersService.setStatus(..., 'SUSPENDED', ...)` ahora revoca
      sesiones como efecto colateral, en la misma transacción (cierra un
      hueco real preexistente: suspender no cerraba sesiones ya abiertas).
      Sin UI de administrador de dispositivos todavía — explícitamente
      fuera de esta fase (queda documentado como pendiente en
      `docs/security.md`).
- [x] Nada de lo ya construido se modificó: ningún módulo de negocio,
      ninguna tabla existente renombrada/eliminada, RLS/RBAC/auditoría sin
      cambios de comportamiento, Docker Compose intacto.
- [x] Tests reales: 13 casos nuevos (5 en `sales.integration.spec.ts` —
      venta normal con/sin key, retry secuencial, payload distinto → 409,
      rollback tras fallo de validación; 1 en `sales.concurrency.spec.ts`
      — dos requests verdaderamente concurrentes con la misma key; 7 en
      `members.revoke-sessions.spec.ts` — sesión válida→revocación→intento
      posterior falla, aislamiento entre usuarios, aislamiento entre
      tenants con id ajeno, aislamiento entre tenants con un usuario
      COMPARTIDO entre dos organizaciones, RBAC, doble revocación segura,
      suspender revoca sesiones). Regresión completa: 320/320 tests
      (307 previos + 13 nuevos), 34/34 suites, `verify:tenant-isolation`
      23/23, build backend limpio, lint limpio en todos los archivos
      tocados por esta fase.

## Reglas de desarrollo aplicadas (sección 16 del prompt)

- Se investigó el entorno antes de elegir versiones (Node 22, Prisma 7,
  Next 16, NestJS 11 — todas las que ya estaban disponibles/instalables).
- Cada pieza se compiló y probó antes de seguir con la siguiente (ver
  historial de commits y `npm run verify:tenant-isolation`).
- No se avanzó con errores críticos: cuando `tsx` colgó al cargar el
  cliente Prisma 7 (bug de interacción conocido, documentado en el propio
  script de verificación), se cambió de estrategia (compilar y correr con
  `node`) en vez de ignorar el problema.
- No hay botones falsos: toda sección del sidebar sin módulo de negocio
  real muestra un placeholder honesto, no una pantalla que aparenta
  funcionar.
