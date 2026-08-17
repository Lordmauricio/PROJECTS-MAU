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
      Fase Comercial 6 más abajo) — Ventas/POS de esta fase no lo toca ni
      depende de él. Una `Sale` podrá generar en el futuro un documento
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

## Fases siguientes (dependen de la Parte 2 del prompt para el detalle fino)

- **Fase Comercial 4 — Inventario avanzado**: el núcleo atómico
  (`InventoryService.applyMovement`, IN/OUT/RETURN) ya existe desde la Fase
  Comercial 2 y lo usan tanto Ventas como Compras; falta `TRANSFER` entre
  almacenes, ajustes con motivo estructurado más allá del mínimo manual
  actual, y kardex/reportería completa.
- **Fase Comercial 5 — Caja**: `CashRegister`/`CashMovement` ya modelados; falta
  apertura/cierre/arqueo. Los `Payment` de Ventas y de Compras (cobros a
  clientes y pagos a proveedores, ambos ya reales desde Fase Comercial 2 y
  3) todavía NO se enlazan a una caja abierta — eso se define en esta
  fase. También es la fase que resuelve la dependencia documentada en
  Compras: qué pasa cuando una devolución al proveedor implicaría que nos
  deben dinero.
- **Fase Comercial 6 — Facturación / Fiscal / SIN**: `Invoice`/`InvoiceItem`/
  `InvoiceEvent`/`TaxConfiguration` ya modelados de forma genérica, **sin**
  campos específicos del SIN todavía. Antes de tocar código fiscal real,
  hay que investigar la normativa vigente (RND, Anexo Técnico, algoritmo de
  CUF, servicios SOAP/REST) tal como exige el prompt — no se inventan
  reglas fiscales. Fuera de alcance hasta nueva autorización explícita.
- **Fase Comercial 7 — Reportes**: depende de que exista actividad real en
  ventas/compras/inventario/caja/facturación para tener algo que reportar
  (ventas ya generan esa actividad desde esta fase).
- **Fase Comercial 8 — Recibos comerciales no fiscales**: numeración
  comercial segura bajo concurrencia, snapshot inmutable, PDF A4/ticket
  80mm. Explícitamente distinto de un documento fiscal — ver sección
  "Recibos vs. Facturación" más abajo.
- **Fase Comercial 9 — Notificaciones y proveedor de email real**: hoy
  `MailService` es un stub que loguea; `notifications`/`files` tienen
  tabla pero no API.
- **Fase Comercial 10 — Suscripciones y pagos reales**: hoy existe un plan
  "Gratis" automático y la página de Suscripción es de solo lectura; falta
  pasarela de pago para cambiar de plan.

## Recibos vs. Facturación (aclaración explícita, sección 3/4 del master spec)

KIPU emite actualmente, y seguirá emitiendo hasta nueva orden, **recibos
comerciales NO FISCALES** (Fase Comercial 8, todavía no implementada). Un
recibo:

- NO es una factura ni un documento fiscal, y nunca se presenta como tal.
- NO depende del SIN de Bolivia ni de ninguna integración fiscal.
- NO modifica ni transforma la `Sale` que le da origen.

**`Sale` NO es `Invoice`. `Purchase` NO es `Invoice`.** Ambos son parte del
núcleo comercial (ventas/compras reales, con su propio ciclo de vida,
inventario y cuentas) y son completamente independientes del módulo de
facturación fiscal (`Invoice`/`TaxConfiguration`, todavía solo esquema
genérico desde Fase 1). Ninguno de los dos fue modificado en la Fase
Comercial 3 para introducir dependencia alguna hacia el SIN.

La integración de facturación electrónica con el SIN de Bolivia
(`FiscalDocument`, XML/XSD, CUF/CUIS/CUFD/CAFC, firma digital, XMLDSig,
SOAP/WSDL, QR fiscal, anulación fiscal) queda para una fase futura
independiente y explícitamente autorizada — no se implementó nada de esto
en las Fases Comerciales 2 ni 3, ni se modificó el núcleo comercial
(`Sale`/`Purchase`) para introducir ninguna dependencia hacia ella. La
arquitectura prevista para cuando se autorice es `Sale → Fiscal Engine →
Fiscal Document → SIN Adapter → SIN Bolivia`, pero hoy esa cadena no
existe más allá del `Sale`/`Purchase` inicial.

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
