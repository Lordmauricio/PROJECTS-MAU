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

## 10. Fase Comercial 5 — Caja y Gastos: decisiones técnicas

### Una sola caja OPEN por terminal: índice único parcial, no un chequeo en la aplicación

La regla "a lo sumo una `CashRegister` OPEN por `posTerminalId`" NO se
implementa como "leer si hay una abierta, si no hay, crear" — ese patrón
tiene una carrera real bajo concurrencia (dos requests leen "no hay
ninguna" antes de que cualquiera de los dos inserte). Se implementa como
un índice único **parcial** a nivel de Postgres:
```sql
CREATE UNIQUE INDEX "cash_registers_one_open_per_terminal"
  ON "cash_registers"("posTerminalId") WHERE "status" = 'OPEN';
```
agregado a mano en la migración (Prisma DSL no expresa `WHERE` en
`@@unique`, mismo criterio ya usado para el `CHECK` constraint de
`payments` en la Fase Comercial 3). Dos `INSERT` concurrentes con
`status = 'OPEN'` para el mismo terminal: Postgres deja pasar uno y
rechaza el otro con una violación de unicidad, sin necesitar ningún lock
explícito de aplicación — mismo espíritu que el `UPDATE` condicional que
evita overselling en Inventario, aplicado acá a nivel de índice en vez de
`WHERE` en un `UPDATE`.

`CashService.open()` no distingue de antemano si un `P2002` es un retry
legítimo (misma `idempotencyKey`) o una carrera real perdida contra otra
apertura (índice parcial). Ambos casos entran al mismo bloque de
recuperación (fuera de la transacción abortada, mismo patrón que
`SalesService.runOrResolvePaymentConflict`): si existe una `CashRegister`
con la `openingIdempotencyKey` de ESTE request, es un replay → se
devuelve. Si no existe, es una caja ajena que ganó la carrera → `409`, sin
devolver en silencio la caja de otra apertura.

### Cierre: mismo patrón de lock que Sale/Purchase, con la corrección de idempotencia ya aplicada en Inventario

El cierre bloquea la fila (`SELECT ... FOR UPDATE`, mismo patrón que
`lockSale`/`lockPurchase`/`lockPayable`) y exige `idempotencyKey`. A
diferencia de `Sale.confirm`/`Sale.cancel` (que no necesitan
`idempotencyKey` porque no hay datos variables que decidir en un
retry — la transición de estado sola ya es idempotente), el cierre SÍ
recibe datos que varían por intento (`countedAmount`, `observation`), así
que se sigue el criterio ya establecido para Inventario en la Fase
Comercial 4: si la caja ya está `CLOSED` y la `idempotencyKey` coincide
con la que la cerró, es un retry → se devuelve el resultado ya aplicado.
Si NO coincide, es un segundo cierre genuinamente distinto llegando tarde
(dos cajeros intentando cerrar casi al mismo tiempo, con arqueos
distintos) → `409`, nunca se devuelve en silencio el arqueo de otro
cajero como si fuera el propio. Con el lock, dos cierres concurrentes
quedan serializados: el segundo, tras el commit del primero, ve
`status = CLOSED` y responde según la regla de arriba — "exactamente uno
completa la operación" se cumple sin inventar un mecanismo nuevo.

### Saldo de caja: calculado bajo lock, nunca una columna mutada directamente

No existe una columna `currentBalance` en `CashRegister` que se
incremente/decremente en cada movimiento (eso sería una fuente de
desincronización si algún camino de código la actualizara mal). El saldo
se calcula siempre bajo demanda, dentro de la transacción que ya bloqueó
la fila (`CashService.computeBalance`): `openingAmount` + suma de
movimientos `CASH_IN`/`SALE_PAYMENT` − suma de movimientos
`CASH_OUT`/`EXPENSE`. El signo nunca vive en `amount` (siempre positivo,
igual que `InventoryMovement.quantity`/`Payment.amount`) — vive en
`type`. Este cálculo bajo lock es lo que permite validar "no permitir
saldo negativo" (ver más abajo) de forma segura bajo concurrencia: un
segundo egreso/gasto concurrente que llega tras el primero ve el saldo YA
descontado por el primero, no un valor obsoleto.

### Decisión explícita: caja nunca puede quedar en negativo

El prompt de esta fase pidió decidir y documentar explícitamente si un
gasto/egreso puede superar el saldo disponible. Se decidió que **no**:
ni un `CASH_OUT` manual ni un `Expense` pueden exceder el saldo actual de
la caja (calculado como arriba) — se rechazan con `400`. Igual que
Inventario nunca permite stock negativo y Ventas/Compras nunca permiten
pagar más del saldo pendiente, permitir que una caja física quede en
negativo no representa ninguna situación real (no se puede entregar
efectivo que no está en el cajón) y habría sido una regla contable nueva
sin necesidad — la decisión sigue el mismo principio ya aplicado en el
resto del sistema en vez de inventar una excepción.

### Integración con Ventas: solo `CASH`, y solo si hay una caja OPEN — nunca bloquea la venta

`SalesService.applyPayment` (compartido por `confirm` y `addPayment`, sin
cambios de firma salvo el nuevo parámetro `posTerminalId`) llama a
`CashService.registerSalePaymentMovement` DENTRO de la misma transacción
que crea el `Payment`, así que el `CashMovement` (`type: 'SALE_PAYMENT'`)
queda atómico con el pago: si algo falla después, ninguno de los dos
queda aplicado a medias. Dos decisiones explícitas, ambas para no romper
el comportamiento de Ventas que ya funcionaba sin Caja desde la Fase
Comercial 2:
- Solo los pagos con `method: 'CASH'` generan movimiento de caja — un
  pago con tarjeta/transferencia/QR no mueve efectivo físico, así que no
  tiene nada que aportar a un arqueo. Esto es la distinción mínima que
  pidió el prompt ("efectivo" vs. "métodos que no impliquen efectivo
  físico"), sin inventar más categorías contables.
- Si no hay ninguna `CashRegister` OPEN para el `posTerminalId` de la
  venta (o la venta no tiene punto de venta asignado), el pago se aplica
  igual, sin generar ningún movimiento de caja — `registerSalePaymentMovement`
  devuelve `null` en silencio, no lanza. Bloquear el cobro de una venta
  porque no hay una caja abierta habría sido una regla nueva no pedida
  explícitamente, y habría roto los 27 tests de Ventas de las Fases
  Comerciales 2-4 (ninguno abre una caja). Se prefirió mantener Caja como
  una capa que se ENRIQUECE con la actividad de Ventas cuando existe, no
  una que la condiciona.

Explícitamente fuera de alcance de esta fase (no pedido por el prompt):
integrar los pagos de `Payable` (egresos a proveedores, Compras) con
Caja, e integrar la devolución de una venta (`Sale.return`) con un
reembolso de caja. Ambos quedan documentados como pendientes en
`docs/PROJECT_PLAN.md`.

### `CashMovement`/`Expense`: mismo patrón de idempotencia con `assertMatches` desde el día uno

A diferencia de Inventario (donde la verificación de que una
`idempotencyKey` reusada pertenezca a la misma operación fue una
corrección posterior, ver sección 9), acá se implementó directamente con
esa verificación desde el principio — tanto `registerMovement` como
`registerExpense` comparan los datos del registro existente contra el
`dto` actual (mismo `cashRegisterId`/`type`/`amount` para movimientos;
mismo `cashRegisterId`/`amount` para gastos) antes de tratar un choque de
unicidad como un replay válido, en el camino feliz y en el fallback de
`P2002` por igual.

### Caja y Gastos no son facturación electrónica

Igual que Ventas, Compras e Inventario, la apertura/cierre de caja, los
movimientos y los gastos no tienen ninguna relación con el SIN: no
generan XML, no calculan CUF/CUFD, no firman nada.

## 11. Fase Comercial 6 — Pagos y Cuentas: decisiones técnicas

### Receivable: entidad de proyección, NUNCA un segundo ledger de pagos

La decisión más importante de esta fase. `Receivable` nace de una venta a
crédito (`saleId` único) pero **no tiene su propia tabla de pagos** — a
propósito, no por omisión. Un pago sobre una Receivable ES literalmente
un `Payment` con `saleId` (el mismo modelo que Ventas ya usa desde la
Fase Comercial 2), y `ReceivablesService.addPayment` no hace más que
delegar en `SalesService.addPayment` ya existente:

```
POST /receivables/:id/payments → ReceivablesService.addPayment
                                → SalesService.addPayment(saleId, dto, ...)
```

Por qué NO se diseñó como un ledger propio (que habría sido el reflejo
"obvio" del patrón `Payable`/`Payment.payableId` usado en Compras desde
la Fase Comercial 3): `Payable` es una entidad genuinamente nueva sin
"dueño" previo que ya manejara sus pagos — Compras nunca tuvo un flujo de
cobro antes de Fase 3. `Receivable`, en cambio, nace DESPUÉS de que
Ventas ya tiene, desde la Fase Comercial 2, un `SalesService.addPayment`
completo, atómico, idempotente, con lock, con sobrepago bloqueado y —
desde la Fase Comercial 5 — ya integrado con Caja. Bifurcar en un segundo
camino de pago (`Payment.receivableId`) habría significado: (a) dos
lugares donde un pago de un cliente puede vivir según si la venta se
pagó al confirmar o después, una distinción arbitraria de cara al
dinero; y (b) mantener dos copias de la misma lógica de
idempotencia/concurrencia/Caja, con el riesgo real de que diverjan. Se
optó por la opción que no podía desincronizarse porque no hay nada que
sincronizar: el saldo de la Receivable SIEMPRE se calcula on-demand
desde `sale.payments` (`ReceivablesService.attachBalance`), igual que
Sales ya calculaba `paidTotal`/`balance` desde el día uno.

### Por qué `Receivable`/`Payable` no importan sus módulos entre sí (rompiendo un ciclo de dependencias)

`ReceivablesService.addPayment` necesita llamar a `SalesService`, así
que `ReceivablesModule` importa `SalesModule` — una dependencia real y
esperada. El problema inverso — que `SalesService` necesitara
`ReceivablesService` para crear/sincronizar la Receivable al confirmar
una venta — habría cerrado un ciclo (`SalesModule` ↔ `ReceivablesModule`),
algo que Nest permite con `forwardRef()` pero que es una señal de diseño
a evitar cuando hay una salida más simple. La salida: `SalesService`
manipula `tx.receivable` DIRECTAMENTE vía Prisma dentro de su propia
transacción (`createOrSyncReceivable`/`syncReceivableStatus`/
`cancelReceivableIfAny`, todos métodos privados) — exactamente el mismo
patrón que `PurchasesService.growOrCreatePayable` ya usaba desde la Fase
Comercial 3 para escribir en `tx.payable` sin depender de
`PayablesModule`. `SalesModule` nunca importa `ReceivablesModule`; la
dependencia es estrictamente unidireccional (Receivables → Sales).

### Integración de Caja con Payables: mismo patrón que Ventas, con una asimetría deliberada

`PayablesService.addPayment` ahora llama a
`CashService.registerPayablePaymentMovement` (nuevo, `CashModule`
importado por `PayablesModule`) cuando `method === 'CASH'`. A diferencia
de una venta (donde el `posTerminalId` viene implícito de la propia
venta), una Payable no tiene un punto de venta natural — el usuario
elige explícitamente desde qué caja sale el efectivo
(`CreatePayablePaymentDto.posTerminalId`, opcional). La asimetría
deliberada frente a `registerSalePaymentMovement`: un pago a proveedor
en efectivo que supera el saldo de la caja elegida se **rechaza con
`400`** (bloquea el pago completo, transacción revertida), mientras que
un cobro de venta en efectivo nunca se bloquea por Caja. Razón: pagar a
un proveedor "desde esta caja" es una decisión discrecional del usuario
sobre SU propio efectivo — igual que un `CASH_OUT` o un `Expense`
manuales, que ya se bloqueaban así desde la Fase Comercial 5 — mientras
que cobrar una venta es dinero que ENTRA sin ninguna decisión de saldo
que tomar (una entrada nunca puede "no alcanzar").

### Reembolsos de venta (`Refund`): por qué SÍ se bloquea Payables pero NO se bloquea un reembolso por falta de saldo en caja

Un reembolso (`SalesService.returnSale` → `Refund` + opcionalmente
`CashService.registerSaleRefundMovement`) es la tercera variante de
egreso de caja de esta fase, y aplica el criterio opuesto al de
Payables: si la caja elegida no tiene saldo suficiente, el movimiento de
caja simplemente **se omite** (`registerSaleRefundMovement` devuelve
`null`) — la devolución de mercadería, el `Refund` y el cambio de estado
de la venta a `REFUNDED` se aplican SIEMPRE. Motivo: un reembolso no es
una decisión discrecional de gasto — es la reversión obligatoria de una
venta que ya ocurrió, y bloquear la restauración de inventario de un
cliente porque la caja específica elegida no tiene efectivo en ESE
momento sería peor que registrar la deuda y dejar el movimiento de caja
pendiente de un ajuste manual posterior. La regla general "nunca saldo
negativo" se sigue cumpliendo (nunca se crea el `CashMovement` que lo
violaría) — lo que cambia es qué falla cuando no alcanza: para Payables,
todo el pago; para un reembolso, solo el rastro en caja, nunca la
devolución en sí.

Modelo de reembolso: se agrega un modelo nuevo, `Refund` (`saleId`,
`amount`, `reason`, `createdById`), ledger análogo a `PurchaseReturn`
pero para dinero. El monto reembolsado es siempre el `paidTotal` real de
la venta (nunca más, nunca una cifra inventada) — si la venta no tenía
ningún pago (crédito puro, impago), no se crea ningún `Refund` ("genera
reembolso CUANDO CORRESPONDE"). Del monto total reembolsado, solo la
porción pagada específicamente en `CASH` genera `CashMovement`
(`type: 'SALE_REFUND'`) — un reembolso de una venta pagada con
tarjeta/transferencia/QR no saca billetes de ningún cajón, mismo
criterio que ya distinguía `SALE_PAYMENT`.

Esta fase sigue tratando la devolución como TOTAL (todos los ítems, sin
cambios respecto a la Fase Comercial 2) — no se diseñó un modelo de
devolución/reembolso PARCIAL porque no fue pedido explícitamente. Si se
autoriza a futuro, un reembolso parcial necesitaría su propio DTO
(cantidades/montos por ítem) y su propia validación de "no reembolsar
más de lo pagado por ítem", documentado aparte en ese momento.

### Idempotencia del reembolso: sin `idempotencyKey` propia, por el mismo motivo que `cancel()`

`returnSale()` no exige una `idempotencyKey` en el body — sigue
exactamente el patrón ya usado por `confirm()`/`cancel()` desde la Fase
Comercial 2: `lockSale` (`SELECT ... FOR UPDATE`) + chequeo de estado
(`status === 'REFUNDED'` → devuelve el estado actual sin repetir ningún
efecto). Esto garantiza que el cuerpo de la función — restaurar stock,
crear el `Refund`, mover caja, cancelar la Receivable — corre A LO SUMO
UNA VEZ por venta, incluso con dos requests concurrentes: el lock
serializa, el segundo ve `REFUNDED` tras el commit del primero y no
repite nada. Probado explícitamente con dos devoluciones simultáneas de
la misma venta (`sales.concurrency.spec.ts`): exactamente un
`CashMovement SALE_REFUND`, nunca dos.

### Coherencia de estados entre Sale/Payment/Receivable/Purchase/Payable/CashMovement/CashRegister

Ninguna de estas entidades tiene una máquina de estados que pueda
contradecir a otra, porque las relaciones son de una sola dirección y
mayormente derivadas, no de sincronización bidireccional:
- `Receivable.status` se deriva y se escribe SOLO desde eventos de
  `Sale` (crear al confirmar con saldo pendiente, `PENDING`↔`PAID` en
  cada pago, `CANCELLED` al devolver) — nunca al revés.
- `Payable.status` sigue siendo autónomo (no deriva de nada, es la
  fuente de verdad de Compras), sin cambios en esta fase salvo la
  integración de Caja.
- `CashMovement` nunca es mutable una vez creado (ledger append-only,
  igual que `InventoryMovement`/`Payment` desde fases anteriores) — un
  reembolso o un pago no "corrigen" un movimiento anterior, generan uno
  nuevo.
- `CashRegister.status` (`OPEN`/`CLOSED`) es independiente de
  Sale/Purchase/Receivable/Payable: una caja cerrada simplemente deja de
  aceptar NUEVOS movimientos (incluidos los automáticos de
  Ventas/Payables/reembolsos, que se omiten en silencio en vez de
  fallar), pero nunca revierte ni bloquea la operación de negocio que
  los originó.

### Pagos y Cuentas no son facturación electrónica

Igual que el resto del sistema, Receivables, la integración de Caja con
Payables, y los reembolsos de venta no tienen ninguna relación con el
SIN: no generan XML, no calculan CUF/CUFD, no firman nada.

## 12. Auditoría post-Fase 6: el lock de `Payable` tiene que ser explícito, no heredado del de `Purchase`

Una auditoría de integración de solo-lectura sobre las Fases Comerciales
2-6 (sin nuevas features) encontró una corrección real de concurrencia en
Compras, con el mismo patrón de causa raíz que la corrección de
idempotencia de la Fase 4 (sección 9): un supuesto de "el lock de la
entidad padre alcanza" que dejó de cumplirse en cuanto otro módulo
empezó a bloquear la entidad hija de forma independiente.

`PurchasesService.returnToSupplier()` reduce `Payable.amount`
proporcionalmente a lo devuelto, y valida que el nuevo monto no quede por
debajo de lo ya pagado (la regla de "el proveedor no puede terminar
debiéndonos" de la Fase 3). Para eso lee el `Payable` actual — pero lo
leía con un `SELECT` normal (`tx.payable.findUnique`), confiando en que
`lockPurchase()` (bloqueo de la fila de `Purchase`, tomado al principio
de la función) fuera suficiente. No lo es: `PayablesService.addPayment()`
nunca toca ni bloquea `Purchase`, solo bloquea `Payable` directamente. Una
devolución y un pago concurrentes sobre la misma cuenta por pagar
terminan bloqueando filas distintas, así que Postgres no los serializa
entre sí — cada uno valida su propia operación contra un `amount` que el
otro está a punto de cambiar, y el resultado combinado puede dejar
`balance = amount - paidTotal` en negativo (sobrepago). El mismo patrón
de lectura-sin-lock existía en `growOrCreatePayable()` (compartido con
`receive()`), aunque ahí el `amount` solo crece, así que el riesgo real
era de un `status` inconsistente, no de sobrepago.

La corrección: `lockPayableByPurchase()`, un `SELECT ... FOR UPDATE`
sobre `payables` por `purchaseId`, usado en ambos puntos ANTES de leer
`amount`/`status`. Con el lock explícito sobre `Payable`, cualquier
intercalado posible entre una devolución y un pago concurrentes queda
serializado correctamente: quien pierda la carrera por el lock vuelve a
leer el `amount` ya actualizado por el otro, y su propia validación lo
rechaza si corresponde (nunca ambos pueden "pasar" a la vez). Reproducido
de forma determinística antes del fix y cubierto con un test de
regresión en `purchases.concurrency.spec.ts` que no depende de quién gane
la carrera — solo afirma la invariante financiera (`balance >= 0`) sin
importar el orden.

**Lección general, reafirmada**: cuando dos servicios distintos escriben
sobre la misma entidad (`Purchase`↔`Payable` acá, análogo al
`Sale`↔`Receivable` de la Fase 6 o al `CashRegister` compartido entre
Ventas/Payables/reembolsos), el lock tiene que tomarse sobre la entidad
que efectivamente se lee-y-luego-escribe, nunca asumido por transitividad
desde el lock de una entidad relacionada — sin importar qué tan
"naturalmente" parezcan estar unidas en el dominio.
