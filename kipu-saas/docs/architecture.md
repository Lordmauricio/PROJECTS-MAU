# Arquitectura — KIPU SAAS

## 1. Estilo de arquitectura: modular monolith

Un solo backend NestJS, dividido internamente en módulos independientes
(`auth`, `organizations`, `branches`, `warehouses`, `pos-terminals`, `roles`,
`members`, `customers`, `suppliers`, `products`, `product-categories`,
`product-units`, `inventory`, `sales`, `purchases`, `payables`, `audit`, y
los módulos de infraestructura `prisma`, `redis`). No se crearon
microservicios: para el tamaño de negocio objetivo
(PyMEs bolivianas empezando por Cochabamba) la complejidad operativa de
microservicios (service discovery, mensajería entre servicios, despliegues
independientes) no se justifica todavía.

La arquitectura sí está preparada para separar módulos a futuro si el
crecimiento lo exige: cada módulo de Nest ya es una unidad con límites
explícitos (providers/controllers propios, importa lo que necesita de otros
módulos vía sus `exports`), así que un módulo candidato a servicio propio
(por ejemplo `Fiscal`/`SIN` cuando se construya, o `Reports` si necesita su
propio motor de agregación) se puede extraer sin rediseñar el resto.

## 2. Stack y por qué

| Capa | Elección | Por qué |
|---|---|---|
| Backend | NestJS + TypeScript | Módulos con límites explícitos, DI, guards/interceptors nativos — necesario para mantener disciplina en un dominio de 30+ entidades sin que la lógica se disperse. |
| ORM | Prisma 7 (`@prisma/adapter-pg`, `moduleFormat = "cjs"`) | Migraciones versionadas legibles, tipado end-to-end. `moduleFormat = "cjs"` es necesario: el generador de Prisma 7 por defecto emite un cliente que asume ESM (usa `import.meta.url`), lo que revienta bajo un proyecto NestJS compilado a CommonJS — se fuerza CJS explícitamente en el generator block de `schema.prisma`. |
| Base de datos | PostgreSQL 16 | Row Level Security nativo (ver sección 3), `numeric` para montos (nunca float), robusto para reportes futuros. |
| Cache / colas | Redis + BullMQ (`@nestjs/bullmq`) | Redis como backend de colas; BullMQ para trabajo asíncrono. En esta fase se usa de verdad (no solo declarado) para procesar los eventos de auditoría — ver `src/audit/`. |
| Frontend | Next.js (App Router) + TypeScript + Tailwind CSS | Mismo framework en todo el front, client components para las pantallas interactivas (POS, formularios), fetch directo contra la API REST del backend. |
| Contenedores | Docker (`Dockerfile` en `backend/` y `frontend/`) + `docker-compose.yml` (Postgres + Redis + backend + frontend) | Reproducible sin atarse a un proveedor cloud específico todavía. |
| API | REST | Simple, bien entendido, suficiente para el tamaño del dominio. OpenAPI se agrega cuando haya más consumidores externos (ver `docs/PROJECT_PLAN.md`). |

No se agregó GraphQL, microservicios, ni un segundo lenguaje: cada pieza del
stack tiene una razón de ser ligada a un requisito real del prompt, no a
popularidad.

## 3. Multi-tenancy: estrategia elegida

**Base de datos compartida, aislamiento por `organizationId` en cada tabla,
reforzado con Row Level Security (RLS) de PostgreSQL como segunda barrera —
no solo un filtro en la capa de aplicación.**

### Cómo funciona en este proyecto

- Toda tabla propiedad de una empresa tiene `organizationId` como columna
  directa (incluso en tablas hijas como `sale_items`/`invoice_items`, que se
  denormalizan desde su padre para que la policy de RLS sea una comparación
  simple sin JOIN).
- La aplicación se conecta a Postgres con un rol (`app_user`) que **no**
  tiene `BYPASSRLS`. Las policies de RLS comparan `organizationId` contra
  `current_setting('app.current_tenant')`.
- Cada operación de negocio pasa por `TenantPrismaService.run(organizationId, tx => ...)`,
  que abre una transacción, fija `app.current_tenant` con
  `set_config(..., true)` (usando `set_config` en vez de `SET LOCAL` directo
  porque `SET` no acepta parámetros bind — `set_config` sí, evitando
  inyección), y ejecuta las queries dentro de esa misma transacción (una
  transacción está pineada a una única conexión física del pool; sin esto,
  dos queries sucesivas podrían caer en conexiones distintas y perder el
  contexto de tenant).
- Existe un segundo rol, `app_superadmin` (con `BYPASSRLS`), reservado para
  el futuro backoffice del SaaS. Ningún código lo usa todavía en esta fase.

### Por qué RLS y no solo `WHERE organizationId = ...` en cada query

Un `WHERE` olvidado en un query nuevo (o en un `$queryRaw` mal escrito)
filtra datos entre empresas. Con RLS, **incluso una consulta sin ningún
WHERE devuelve solo las filas del tenant activo** — se verificó
explícitamente con `npm run verify:tenant-isolation` (ver
`backend/scripts/verify-tenant-isolation.ts`), incluyendo el caso de una
consulta ejecutada por el worker de BullMQ (proceso separado del request
HTTP) para confirmar que el aislamiento también se respeta en el camino
asíncrono.

### Alternativas consideradas y descartadas

| Estrategia | Por qué no |
|---|---|
| Database-per-tenant | Con cientos/miles de empresas, significa cientos/miles de bases: migraciones, backups y monitoreo se vuelven un problema operativo antes que de producto. |
| Schema-per-tenant | Mismo problema de migraciones a escala, sin soporte de primera clase en Prisma. |
| Solo `organizationId` a nivel de aplicación, sin RLS | El aislamiento depende de que absolutamente todo el código presente y futuro recuerde filtrar — inaceptable para datos financieros. |

## 4. Autenticación

JWT de acceso de vida corta (15 min) + refresh token opaco (no JWT) con
rotación en cada uso y hash SHA-256 en base de datos (nunca se guarda el
token en texto plano). Passwords con Argon2id. Verificación de email y
recuperación de contraseña con tokens de un solo uso, expiración corta, y
revocación de todas las sesiones activas al cambiar la contraseña. Ver
`docs/security.md` para el detalle completo.

## 5. Permisos (RBAC)

Catálogo de permisos global (`permissions`, sin RLS — es un catálogo, no
datos de una empresa). Cada organización nueva clona 8 roles por defecto
(OWNER, ADMIN, MANAGER, ACCOUNTANT, CASHIER, INVENTORY, SALES, AUDITOR) con
sus permisos correspondientes en `roles`/`role_permissions` (estas sí
tenant-scoped). `PermissionsGuard` verifica permisos **en vivo** contra la
base en cada request — revocar un permiso a un rol tiene efecto inmediato,
no depende de que expire el access token.

## 6. Qué se construyó vs. qué queda para después

Ver `docs/PROJECT_PLAN.md` para el detalle fase por fase. Resumen: desde
Foundation + Fases Comerciales 2 y 3, tienen módulo NestJS con endpoints
reales: autenticación, organizaciones/sucursales/almacenes/puntos de venta,
roles y permisos, miembros, clientes, proveedores,
productos/categorías/unidades, inventario (núcleo mínimo: entrada
manual/ajuste + los movimientos que disparan Ventas y Compras), ventas/POS,
compras (orden → recepción → cuenta por pagar → devolución), y auditoría.
Caja, facturación, reportes, notificaciones y suscripciones/pagos tienen su
tabla lista pero ningún endpoint todavía — así se evita construir pantallas
o rutas a medias.

## 7. Fase Comercial 2 — Ventas/POS: decisiones técnicas

### Concurrencia sin overselling, sin locks explícitos de aplicación

`InventoryService.applyMovement` decrementa stock con una única sentencia
SQL condicional (`UPDATE inventories SET quantity = quantity - $1 WHERE
... AND quantity >= $1`, vía `updateMany` de Prisma). Bajo concurrencia,
Postgres serializa los `UPDATE` que tocan la misma fila: la segunda
transacción espera a que la primera cierre, ve el stock ya descontado, y su
propio `UPDATE` afecta 0 filas → se rechaza con stock insuficiente. No hace
falta `SELECT ... FOR UPDATE` para este caso — la propia semántica del
`UPDATE` condicional ya serializa correctamente.

### Transiciones de estado de `Sale`: `SELECT ... FOR UPDATE` + máquina de estados

`confirm`/`addPayment`/`cancel`/`return` sí necesitan leer el estado actual
de la venta y decidir la transición antes de escribir, así que bloquean
explícitamente la fila (`SELECT ... FOR UPDATE`) al inicio de la
transacción. Dos confirmaciones concurrentes de la MISMA venta quedan
serializadas por ese lock: la segunda ve el estado ya cambiado (no
`DRAFT`) y responde con el estado actual en vez de repetir el efecto — es
la idempotencia natural del patrón, sin necesitar una idempotency key para
`confirm`/`cancel`/`return`.

### Por qué `Payment` sí necesita `idempotencyKey` explícita

A diferencia de confirmar/cancelar/devolver (transiciones de estado con un
único resultado posible), dos pagos del mismo monto sobre la misma venta
podrían ser dos cobros legítimos distintos o un doble click — el sistema no
puede distinguirlos solo por el monto. `Payment.idempotencyKey` (columna
única, generada por el cliente una vez por intento de cobro) resuelve esto.
Importante: el catch de esa colisión de unicidad se maneja **fuera** de la
transacción que la generó (`SalesService.runOrResolvePaymentConflict`), no
con un `try/catch` alrededor del `INSERT` dentro de la misma transacción —
Postgres marca la transacción entera como abortada en cuanto una sentencia
falla, así que cualquier sentencia siguiente en esa misma transacción
(el `UPDATE` del estado de la venta, por ejemplo) fallaría igual aunque el
`catch` de JavaScript nunca vea el error. Ver el comentario en
`sales.service.ts` para el detalle.

### Dinero: `Prisma.Decimal` siempre, nunca `number` de JS para aritmética

`common/money.ts` centraliza la conversión/redondeo (half-up, 2 decimales).
Los DTOs siguen aceptando `number` en la entrada (convención ya establecida
en Foundation, y JSON no tiene un tipo Decimal nativo), pero ese `number`
se convierte a `Prisma.Decimal` inmediatamente y toda operación posterior
(sumas, comparaciones de saldo, totales) usa esa representación exacta.

### `Sale` no es `Invoice`

Ver `docs/PROJECT_PLAN.md`, sección "Recibos vs. Facturación".

## 8. Fase Comercial 3 — Compras: decisiones técnicas

### Un solo motor de inventario, reutilizado

`PurchasesService.receive()` y `.returnToSupplier()` llaman al MISMO
`InventoryService.applyMovement` de la Fase Comercial 2 (tipos `IN` y
`OUT` respectivamente) que ya usa `SalesService`. No existe un segundo
motor de stock para Compras — la atomicidad/anti-overselling descrita en
la sección 7 (`UPDATE` condicional, sin `FOR UPDATE` necesario a nivel de
`inventories`) aplica igual acá.

### `PurchaseReceipt`/`PurchaseReturn`: el mismo patrón de ledger que `Payment`

En vez de mutar `PurchaseItem.receivedQuantity`/`returnedQuantity`
directamente sin dejar rastro, cada recepción y cada devolución quedan
como una fila propia (`PurchaseReceipt`/`PurchaseReturn`, con sus
`*Item` hijos) con su propia `idempotencyKey` única. Es el mismo principio
de trazabilidad que `Payment` en Ventas, aplicado a eventos de mercadería
en vez de eventos de dinero.

### Por qué el lock de `Purchase` también sirve para evitar sobre-recepción

`receive()` bloquea la fila de `Purchase` (`SELECT ... FOR UPDATE`) igual
que las transiciones de estado de `Sale`. Esto no es solo para la máquina
de estados: como la validación "no recibir más de lo pedido" lee
`PurchaseItem.receivedQuantity` (que solo se actualiza dentro de esa misma
transacción bloqueada), dos recepciones concurrentes sobre la MISMA
compra quedan serializadas — la segunda ve el `receivedQuantity` ya
actualizado por la primera y valida contra el remanente real, no contra un
valor obsoleto. Probado explícitamente: dos recepciones concurrentes que
juntas excederían lo pedido → exactamente una se acepta.

### Cómo crece la `Payable` con cada recepción parcial

`Payable.amount` no se fija de una vez al confirmar la orden — crece con
cada recepción real (nunca se le debe a un proveedor por mercadería que no
llegó). Para que, una vez recibido todo, la `Payable` coincida
exactamente con `Purchase.total` (incluyendo el descuento a nivel de
orden, no solo el de cada ítem), el valor de cada recepción se prorratea
en dos pasos: primero por el costo neto por unidad de cada ítem
(`item.subtotal / item.quantity`, que ya descuenta el descuento de ese
ítem), y luego por `purchase.total / purchase.subtotal` (que reparte el
descuento de la orden proporcionalmente). Ver el comentario en
`growOrCreatePayable` (`purchases.service.ts`) para la fórmula exacta.

### `Payment` genérico: Sale XOR Payable

`Payment` pasó a ser el ledger genérico de dinero tanto para Ventas
(`saleId`, dinero que entra) como para Compras (`payableId`, dinero que
sale) — no se creó un modelo `PayablePayment` separado. Un CHECK
constraint en SQL (`payments_exactly_one_target_check`, agregado a mano en
la migración `20260817121351_purchases_core` — Prisma no expresa CHECK
entre columnas en su DSL) exige que tenga exactamente uno de los dos, nunca
ambos ni ninguno. La resolución de conflictos de `idempotencyKey` fuera de
la transacción (ver sección 7) es idéntica para pagos de Compras.

### Dependencia de Caja documentada, no resuelta a medias

Una devolución al proveedor reduce la `Payable`. Si esa reducción dejaría
el monto por debajo de lo ya pagado, significaría que el proveedor nos
debe dinero — un concepto de "crédito a favor" que no existe todavía en
el modelo (necesitaría la Fase Comercial 5/6, Caja/Cuentas). En vez de
inventar una solución temporal, `returnToSupplier()` **rechaza
explícitamente** esa devolución con un mensaje que explica la dependencia.
Ver `docs/PROJECT_PLAN.md` para el seguimiento de este pendiente.

### `Purchase` no es `Invoice`

Igual que `Sale` — ver `docs/PROJECT_PLAN.md`, sección "Recibos vs.
Facturación".

## 9. Fase Comercial 4 — Inventario avanzado: decisiones técnicas

### Un solo motor de stock, extendido en vez de reemplazado

`InventoryService.applyMovement` sigue siendo el único punto que toca
`inventories`/`inventory_movements` — no se creó un segundo motor. El
único cambio de forma es que ahora recibe `type` (qué se guarda en el
kardex: `IN`/`OUT`/`TRANSFER`/`ADJUSTMENT`/`RETURN`) y `direction`
(`INCREASE`/`DECREASE`, hacia dónde mueve el stock) como parámetros
separados, en vez de que `type` implicara la dirección. Antes de Fase 4,
`IN` siempre incrementaba y `OUT` siempre decrementaba, así que no hacía
falta la distinción; con `ADJUSTMENT` (puede subir o bajar) y `TRANSFER`
(una pierna de cada) esa implicitud dejó de alcanzar. `SalesService` y
`PurchasesService` se actualizaron mecánicamente (4 call sites) para pasar
`direction` explícito — su comportamiento no cambió.

### Kardex real: `stockBefore`/`stockAfter` persistidos, no recalculados

Cada `InventoryMovement` ahora graba el saldo exacto antes y después del
movimiento en el momento en que ocurre (columnas `stockBefore`/
`stockAfter`, `NOT NULL`, calculadas dentro de la misma transacción que
aplica el cambio). Antes de Fase 4 se calculaban pero se descartaban. Sin
esto, reconstruir "cuál era el saldo en tal fecha" requeriría sumar todo
el historial cada vez — con el saldo grabado, el kardex (`GET
/inventory/kardex`, orden cronológico ascendente) se lee directamente
como una cuenta corriente: el `stockAfter` de una fila es el
`stockBefore` de la siguiente.

### Transferencias: entidad de ledger propia (`InventoryTransfer`), dos movimientos, una transacción

Una transferencia crea una fila `InventoryTransfer` (cabecera con
`fromWarehouseId`/`toWarehouseId`/`quantity`/`idempotencyKey` propios) y
llama a `applyMovement` DOS veces dentro de la MISMA transacción: una
`DECREASE` en el almacén de origen y una `INCREASE` en el destino, ambas
`type: 'TRANSFER'`, ambas con `reference` apuntando al id de la
`InventoryTransfer` (así quedan ligadas sin necesitar una tabla puente).
Si la salida falla por stock insuficiente, Postgres revierte la
transacción completa — la entrada nunca llega a aplicarse. Nunca puede
quedar una transferencia a medias.

### Ajustes: signo explícito, nunca implícito

`ADJUSTMENT` sin `direction` es rechazado (400) — a diferencia de `IN`/
`OUT`, un ajuste no tiene una dirección "natural", así que el DTO exige
que el cliente la declare (`INCREASE` para un sobrante de conteo físico,
`DECREASE` para un faltante). Un ajuste negativo que dejaría stock
negativo se rechaza igual que cualquier `DECREASE` (ver más abajo).

### Idempotencia: mismo patrón que Ventas/Compras, con una corrección real encontrada durante la implementación

`registerManualMovement`/`transfer` exigen `idempotencyKey` (antes
opcional/inexistente) y resuelven la colisión de unicidad (P2002) **fuera**
de la transacción que la generó — mismo patrón que
`SalesService.runOrResolvePaymentConflict` /
`PurchasesService.runOrResolveReceiptConflict`. Al escribir los tests de
concurrencia se encontró una brecha real: la primera versión, al ver una
`idempotencyKey` ya usada, devolvía en silencio lo que fuera que hubiera
en esa fila — sin verificar que perteneciera a la MISMA operación
(mismo producto/almacén/tipo/cantidad, o mismo producto/origen/destino/
cantidad para transferencias). Eso significa que reusar una
`idempotencyKey` por error entre dos operaciones distintas devolvía el
resultado de la operación equivocada con `201`, en vez de avisar del
conflicto — silenciosamente peor que un `409`, porque el cliente creería
que SU movimiento se aplicó. Se corrigió agregando una verificación
(`assertMatches`) tanto en el camino feliz como en el fallback de P2002,
siguiendo el precedente ya establecido en Compras
(`existingReceipt.purchaseId !== purchaseId` → 409). Con la corrección,
reusar una `idempotencyKey` entre dos operaciones distintas siempre
responde `409`, nunca `201` con datos ajenos.

### Stock por almacén vs. stock global

`GET /inventory` siempre requiere pensar en términos de
`(productId, warehouseId)`, nunca solo `productId` — el mismo producto
mantiene saldos independientes por almacén (fila única en `inventories`
por esa combinación, `@@unique([warehouseId, productId])` ya existente
desde Fase 2). No se agregó ningún endpoint de "stock total sumado entre
almacenes": si se necesita a futuro, se agrega como una agregación
explícita sobre las filas existentes, nunca como una columna nueva que
pueda desincronizarse.

### Inventario avanzado no es facturación electrónica

Igual que `Sale`/`Purchase` no son `Invoice`, el kardex, las
transferencias y los ajustes de esta fase no tienen ninguna relación con
el SIN: no generan XML, no calculan CUF/CUFD, no firman nada. Ver
`docs/PROJECT_PLAN.md`, sección "Recibos vs. Facturación".
