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
  el futuro backoffice del SaaS. Ningún código lo usa todavía en esta fase,
  y por eso se crea **`NOLOGIN` y sin contraseña**: siendo el único rol que
  puede leer y escribir los datos de cualquier tenant, no tiene por qué
  poder conectarse hasta que exista el backoffice que lo necesite. Se
  habilita definiendo `APP_SUPERADMIN_PASSWORD` y corriendo
  `npm run db:provision-roles`.

### Contraseñas de los roles Postgres

Las migraciones **crean los roles sin contraseña**. Una migración está
versionada en el repositorio, así que cualquier credencial escrita ahí sería
pública e idéntica en todos los despliegues; es exactamente el problema que
`20260817230000_db_roles_no_hardcoded_passwords` vino a remediar (esa
migración además le quita la contraseña a las bases que ya habían aplicado
la versión anterior de `init`).

La contraseña se asigna en un paso aparte, desde variables de entorno:

```bash
APP_USER_PASSWORD='...' npm run db:provision-roles   # scripts/provision-db-roles.ts
```

Ese mismo comando es el mecanismo de **rotación** (correrlo de nuevo con
otro valor). Es fail-closed a propósito: hasta que corra, `app_user` existe
—con sus GRANTs y sujeto a las policies— pero no puede autenticarse bajo
`scram-sha-256`/`md5`, así que la aplicación falla al conectar en vez de
arrancar con una credencial conocida. En Docker, `docker-entrypoint.sh` lo
ejecuta automáticamente después de `prisma migrate deploy`.

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

## 13. Fase Comercial 7 — Reportes: decisiones técnicas

### Un módulo de solo lectura, sin motor propio

`ReportsModule` (`backend/src/reports/`) no tiene tablas propias ni
lógica de negocio que mutar: los 17 reportes pedidos son lecturas y
agregaciones sobre tablas que Ventas/Compras/Inventario/Caja/Receivables/
Payables ya escriben desde las Fases 2-6. La regla explícita del pedido
("no crear otro motor de ventas/inventario/caja") se cumple por
construcción de dos formas distintas según el caso:

- **Reutilizando el servicio existente directamente**, cuando ya expone
  exactamente la lectura que hace falta: `inventoryReport`/
  `movementsReport` llaman a `InventoryService.listStock`/
  `listMovements` tal cual — cero reimplementación del cálculo de stock
  ni del kardex.
- **Reutilizando la misma CLASIFICACIÓN, no reinventándola**, cuando el
  dato es una agregación nueva sobre una tabla ya existente:
  `incomeReport`/`expensesReport`/`cashReport` necesitan saber qué tipos
  de `CashMovement` suman y cuáles restan del saldo de una caja — en vez
  de decidirlo de nuevo, importan `CASH_INCREASE_TYPES`/
  `CASH_DECREASE_TYPES` directamente desde `cash.service.ts` (exportados
  ahí puntualmente para esto). Si mañana Caja agrega un tipo de
  movimiento nuevo, Reportes lo clasifica bien automáticamente, sin tocar
  una sola línea acá.

El resto (`salesReport`, `purchasesReport`, `receivablesReport`,
`payablesReport`, y los 8 reportes agregados de Ventas —
`sales-by-*`/`top-products`/`payment-methods`) son lecturas directas vía
`TenantPrismaService.run` + Prisma `findMany`/`aggregate`/`groupBy` (y
`$queryRaw` de solo lectura para los 2 casos que cruzan relaciones que
Prisma no agrega directamente: ventas por categoría, que hace JOIN
`sale_items`→`products`→`product_categories`, y ventas por sucursal, que
resuelve `posTerminal.branchId`/`warehouse.branchId`) — el mismo patrón
que ya usaba `OrganizationsService.getDashboardSummary` desde Fase 1, no
uno nuevo.

### Filtros: un DTO compartido, resuelto contra el tenant siempre

Los 17 reportes aceptan el mismo `ReportQueryDto` (fecha desde/hasta,
sucursal, almacén, POS, usuario, producto, categoría, método de pago,
estado) y cada uno usa solo los campos que le aplican — evita 17 DTOs
casi idénticos. `Sale`/`Purchase` no tienen `branchId` como columna
propia (solo `warehouseId`/`posTerminalId`), así que "filtrar por
sucursal" se resuelve en dos pasos dentro de la misma transacción:
primero `resolveBranchScope` busca qué `warehouseId`/`posTerminalId` de
ESTE tenant pertenecen a esa sucursal, y luego ese resultado (posiblemente
vacío) entra al `WHERE` de la consulta real. Un `branchId`/`productId`/
`warehouseId`/etc. que pertenece a OTRO tenant nunca puede filtrar datos
ajenos: como el primer paso ya está scoped por `organizationId` (más RLS
`FORCE` de fondo), simplemente no encuentra nada y el filtro completo
devuelve cero filas — nunca la consulta "ignora" el filtro y devuelve
todo. Cubierto explícitamente en `reports.security.spec.ts` con un
segundo tenant real filtrando por ids reales del primero.

### Vista paginada vs. export: la misma función, distinto techo

Cada reporte "tabular" (ventas, compras, ingresos, egresos, caja,
cuentas por cobrar/pagar) acepta un `opts?: { maxPageSize }` opcional en
su método de `ReportsService`. La vista en pantalla lo omite (pagina de a
20, tope 100); el export le pasa `REPORT_EXPORT_MAX_ROWS` (20 000) — es
la MISMA función, con el MISMO `where`, solo cambia cuántas filas trae.
`ReportsController` mantiene un registro (`REPORTS`) que asocia cada
clave de URL con su método de vista y de export; el export nunca arma su
propia consulta, siempre llama al mismo método que ya devuelve el JSON
de pantalla, así que un archivo exportado no puede mostrar cifras
distintas a las que el usuario ya vio con los mismos filtros — la
sección "EXPORTACIÓN" del pedido ("no generar cifras diferentes entre
pantalla y exportación") se cumple porque literalmente es el mismo
código, no una promesa de mantenerlos sincronizados a mano.

El `summary` (totales) de cada reporte se calcula con su propia query de
agregación (`aggregate`/`groupBy`) sobre el `where` completo, nunca
sumando en memoria las filas ya traídas — así el total mostrado es
correcto incluso cuando la tabla en pantalla solo muestra la página
actual.

### CSV y Excel real, generados de los mismos `rows`/`columns`

`reports-export.util.ts` expone `rowsToCsv`/`rowsToXlsx`, ambas reciben
el mismo par `(columns, rows)` — un array de `{header, value: (row) =>
...}` por reporte, definido una sola vez en `reports.controller.ts`. CSV
es texto plano con BOM UTF-8 (para que Excel/LibreOffice detecten tildes
y ñ correctamente) y separador `,` con escape RFC-4180; Excel es un
`.xlsx` real (librería `exceljs`, agregada en esta fase — antes no había
ninguna dependencia de hojas de cálculo), no un CSV renombrado. Los
valores `Prisma.Decimal` se serializan con `.toFixed(2)` en ambos formatos
— nunca aritmética de exportación aparte del dato ya calculado por
`ReportsService`.

### Dashboard: mismo criterio de "no inventar", aplicado a utilidad comercial

El pedido pide explícitamente "utilidad comercial si puede calcularse
correctamente" y, si no, "No disponible" documentado — nunca inventada.
Se evaluó y se descartó: `SaleItem` no persiste el costo unitario al
momento de la venta (a diferencia de `PurchaseItem.unitCost`, que sí es
histórico desde Fase 3), y no existe trazabilidad de lote/FIFO que ligue
una unidad vendida a la compra que la abasteció. Aproximar el costo de
ventas pasadas con `Product.cost` ACTUAL daría una cifra incorrecta para
cualquier producto cuyo costo cambió desde entonces — exactamente el tipo
de "número que parece preciso pero está mal" que el resto del sistema
evita con `Prisma.Decimal`/locks/idempotencia. El dashboard devuelve
`grossMargin: { available: false, reason: '...' }` en vez de ese número.

De paso, ampliar el dashboard expuso una corrección real heredada de
Fase 1: `salesToday`/`salesMonth` filtraban `status: 'CONFIRMED'` a
secas — escrito antes de que Ventas tuviera su propia máquina de estados
(Fase Comercial 2). Una venta que ya se pagó pasa a `PARTIALLY_PAID`/
`PAID` y quedaba FUERA del conteo, subestimando sistemáticamente "ventas
del día/mes" para cualquier negocio con ventas pagadas (la inmensa
mayoría). Se corrigió a `status: { in: ['CONFIRMED', 'PARTIALLY_PAID',
'PAID'] }`, excluyendo `REFUNDED` deliberadamente (ese dinero ya se
devolvió, no es ingreso neto del período) y `CANCELLED`/`DRAFT` (nunca
fueron una venta real).

### Reportes no son facturación electrónica

Igual que el resto del sistema, los 17 reportes y el dashboard leen
`Sale`/`Purchase`/`Payment`/`CashMovement`/`Receivable`/`Payable`/
`Inventory` — nunca `Invoice`/`FiscalDocument`. No generan XML, no
calculan CUF/CUFD/CAFC, no son ni pretenden ser un sustituto de la
facturación exigida por el SIN; son reportes de gestión comercial interna.

## 14. Fase Comercial 8 — Recibos comerciales NO fiscales: decisiones técnicas

### Separación de código real, no solo documental: `sales/` vs. `receipts/` vs. `fiscal/`

El pedido exige una separación EXPLÍCITA entre ventas, recibos
comerciales y (a futuro) facturación fiscal — no como una nota en un
documento, sino como una propiedad verificable del código. Se logró así:

- `backend/src/receipts/` (`ReceiptsModule`) importa `AuditModule`
  únicamente. NO importa `SalesModule` ni inyecta `SalesService`:
  `ReceiptsService.issue` lee `Sale` directo vía su propio
  `TenantPrismaService`, dentro de la MISMA transacción en la que
  bloquea la numeración y crea el recibo — necesario para que el
  incremento de la secuencia y el `create` del recibo sean atómicos (ver
  más abajo), algo que no se puede lograr componiendo dos transacciones
  independientes de dos servicios distintos.
- `backend/src/sales/` (`SalesModule`) no importa nada de `receipts/` ni
  sabe que ese módulo existe. `sales.controller.ts` no tiene ninguna ruta
  de recibos; la UI de `/sales/[id]` consulta `GET /receipts/by-sale/:saleId`
  como un recurso independiente.
- No existe todavía ningún módulo `fiscal/` — ni una carpeta, ni un
  archivo, ni una importación. El pedido de esta fase prohíbe
  explícitamente tocar `FiscalDocument`/CUF/CUIS/CUFD/CAFC/SIN, así que
  no se crea ni siquiera un placeholder: la única superficie
  fiscal-adyacente que existe en el repo sigue siendo el modelo `Invoice`
  de Fase 1 (solo esquema, sin lógica), sin cambios en esta fase.

Cuando se autorice Facturación Electrónica, `fiscal/` se construirá como
un módulo nuevo que lee `Sale` (y opcionalmente `CommercialReceipt`, solo
para referenciarlo, nunca para mutarlo) de la misma forma en que
`receipts/` lee `Sale` hoy — sin que `sales/` ni `receipts/` necesiten
cambiar una sola línea para que eso funcione.

### `CommercialReceipt`: snapshot JSONB, no un JOIN en el momento de imprimir

La decisión central de esta fase: un recibo comercial se construye UNA
vez, en el momento de emitirlo, leyendo todo lo necesario de `Sale`,
`SaleItem`/`Product`, `Payment`, `Customer`, `Organization`, `Branch` y
`POSTerminal` — y ese resultado se congela en
`commercial_receipts.snapshot` (JSONB). Ni la vista en pantalla ni el PDF
vuelven a tocar esas tablas después: `ReceiptsController.pdf` y el
frontend leen exclusivamente `receipt.snapshot`. Esto es deliberado y no
una optimización: si mañana cambia el nombre de la empresa, el logo, el
precio de un producto, o el nombre de un cliente, un recibo ya emitido
hace un año debe verse EXACTAMENTE igual que el día que se imprimió — un
documento comercial que "cambia solo" retroactivamente no sirve como
comprobante. Probado explícitamente: se emite un recibo, se cambian
nombre de cliente (vía `PATCH /customers/:id`), nombre/precio de producto
(vía `PATCH /products/:id`) y nombre de la organización (directo en la
base, no hay endpoint de edición todavía), y se vuelve a leer el mismo
recibo — su snapshot no cambió.

### Numeración: `SERIE-NNNNNN` con un contador atómico por organización, nunca `MAX() + 1`

`receipt_sequences` tiene exactamente una fila por organización
(`organizationId` `@unique`). Obtener el siguiente número es un único
statement:

```sql
INSERT INTO receipt_sequences (id, "organizationId", series, "lastNumber", "updatedAt")
VALUES ($1, $2, 'REC', 1, now())
ON CONFLICT ("organizationId")
DO UPDATE SET "lastNumber" = receipt_sequences."lastNumber" + 1, "updatedAt" = now()
RETURNING series, "lastNumber"
```

Bajo concurrencia real, Postgres serializa los `UPDATE`/`INSERT ON
CONFLICT` sobre la misma fila: la segunda transacción que intenta
incrementar la secuencia de la misma organización espera a que la
primera confirme (o revierta) antes de tomar su propio número — nunca
puede leer el mismo `lastNumber` que otra transacción concurrente
todavía no confirmada, que es exactamente la clase de bug que
`MAX(number) + 1` no puede evitar (dos transacciones pueden leer el mismo
máximo antes de que ninguna haya insertado su fila).

Esto corre DENTRO de la misma transacción que el `create` del recibo — no
antes, como un paso separado. Es la pieza que hace que la idempotencia y
la numeración sean consistentes juntas: si dos requests concurrentes
intentan emitir el recibo de la MISMA venta, ambos pueden entrar a la
transacción (el pre-check de "¿ya existe?" no alcanzó a ver al otro
todavía), pero cuando ambos intentan el `INSERT` final en
`commercial_receipts` (que tiene `@@unique([saleId])`), exactamente uno
tiene éxito y el otro dispara `P2002` — y como el incremento de secuencia
ocurrió en la MISMA transacción que ese `INSERT` fallido, Postgres
revierte AMBOS a la vez: el número nunca se "gasta" en una carrera
perdida. El perdedor cae al mismo patrón de `runOrResolveConflict` que
`Sales`/`Purchases`/`Payables` ya usan: una transacción nueva y limpia
que busca el recibo que sí ganó la carrera (por `saleId`, único) y lo
devuelve — nunca un error al cliente que solo estaba reintentando.
Probado con 2, 5 (ventas distintas) y 10 (misma venta) requests
verdaderamente concurrentes vía `Promise.all`, nunca secuenciales.

Decisión documentada sobre el alcance de la numeración: es POR
ORGANIZACIÓN completa, no por sucursal ni por punto de venta. A
diferencia de una futura numeración fiscal (que si se implementa sí
tendría requisitos normativos de asociarse a un CUFD/punto de venta
específico), un recibo comercial interno no tiene esa obligación — una
sola secuencia continua por empresa es más simple de razonar y auditar
para el dueño del negocio. Si una fase futura necesita numeración por
sucursal, `receipt_sequences` puede extenderse (agregando `branchId` a la
clave única) sin romper nada existente.

### Estados de `Sale` que admiten recibo

`ELIGIBLE_SALE_STATUSES = ['CONFIRMED', 'PARTIALLY_PAID', 'PAID']` — los
mismos tres estados que `RETURNABLE_STATUSES`/`OPEN_FOR_PAYMENT_STATUSES`
ya usan en `sales.service.ts` desde la Fase Comercial 2 para "esta venta
es real y está vigente". `DRAFT` nunca calificó (la venta ni se
concretó). `CANCELLED` nunca calificó (se revirtió antes de completarse).
`REFUNDED` se excluye deliberadamente solo para EMITIR un recibo nuevo —
la venta ya se revirtió comercialmente después de concretada — pero un
recibo emitido ANTES del reembolso sigue siendo un documento histórico
válido: `SalesService.returnSale()` nunca toca `commercial_receipts`, así
que ese snapshot sigue reflejando fielmente lo que pasó en el momento de
la venta.

### PDF: `pdfkit`, A4 y ticket 80mm, siempre desde el snapshot

Dependencia nueva (`pdfkit`, sin dependencias externas de red ni fuentes
externas — usa las fuentes base de PDF, `Helvetica`/`Helvetica-Bold`).
`receipt-pdf.util.ts` expone `renderReceiptPdf(snapshot, format)`, que
arma un PDF completo en memoria (buffer, vía el patrón estándar de
`pdfkit`: escuchar `data`/`end` y concatenar) — nunca escribe a disco.
Ambos formatos leen EXCLUSIVAMENTE el objeto `snapshot` ya explicado
arriba. La etiqueta "DOCUMENTO COMERCIAL NO FISCAL" se dibuja en rojo,
inmediatamente debajo de "RECIBO DE VENTA", en la posición más prominente
posible de ambos documentos (arriba de todo) — y se repite, en texto más
chico, como advertencia al pie. El ticket de 80mm usa un ancho fijo en
puntos PDF (80mm × 2.8346 pt/mm) y una altura generosa con salto de
página automático (mismo tamaño de página) si un ticket con muchos ítems
no entra en una sola hoja continua.

### Frontend: nunca doble emisión, PDF autenticado vía blob

El botón "Emitir recibo" en `/sales/[id]` desaparece en cuanto existe un
recibo (la sección cambia a mostrar el número y los botones de PDF) — una
protección de UX adicional sobre la idempotencia que el backend ya
garantiza. Como los endpoints de recibos requieren `Authorization:
Bearer`, un `<a href>` normal no serviría para ver/descargar el PDF (la
navegación del navegador no manda headers custom): el frontend usa
`fetch` con el token, arma un `Blob`, y lo abre en una pestaña nueva
(`window.open` sobre una blob URL) para "Ver" o dispara la descarga real
del navegador para "Descargar" — mismo patrón ya establecido para
exportar CSV/Excel en la Fase Comercial 7 (`lib/api.ts`).

### Recibos comerciales no son facturación electrónica

Ver la sección "Recibos vs. Facturación" de `docs/PROJECT_PLAN.md` para
la aclaración completa. En una frase: `CommercialReceipt` no genera XML,
no calcula CUF/CUIS/CUFD/CAFC, no firma nada, no anula nada fiscalmente,
y el propio documento (pantalla y PDF) dice explícitamente "DOCUMENTO
COMERCIAL NO FISCAL" — nunca se presenta ni se puede confundir con una
factura.

## 15. Fase Comercial 9 — Notificaciones y email real: decisiones técnicas

### Notificaciones internas: un destinatario concreto por fila, nunca `userId = null`

`Notification.userId` sigue siendo nullable desde el esquema de Fase 1
(pensado originalmente como "notificación de toda la organización"), pero
`NotificationsService.create` NUNCA crea una fila con `userId = null` en
la implementación real. Motivo: `read` es una sola columna booleana por
fila — si una notificación fuera compartida por todos los usuarios de la
organización, que uno solo la marque leída la ocultaría (o la mostraría
como leída) para el resto, que es un bug de datos compartidos, no una
característica. En vez de rediseñar el esquema (tabla de destinatarios
separada, fuera de alcance de esta fase), cada notificación se crea con
UN destinatario concreto: el actor que originó el evento de negocio (el
`userId` del token de acceso de quien hizo el request). Esto convierte el
centro de notificaciones en un feed de actividad personal ("confirmaste
esta venta", "abriste esta caja") en vez de un mecanismo de difusión
multi-usuario — una limitación real y documentada, no un intento de
simularlo.

Puntos de integración reales (todos después de que la transacción de
negocio ya confirmó, mismo momento en que se llama `AuditService.log`, y
solo cuando el evento REALMENTE ocurrió — nunca en un replay idempotente):

- `SalesService.confirm` → `sale.confirmed` (siempre) y
  `receivable.pending` (solo si `createOrSyncReceivable` reporta
  `created: true` — venta a crédito nueva, no cada vez que se sincroniza
  el estado de una receivable ya existente).
- `SalesService.addPayment` → `sale.payment_received`, solo en el camino
  real (nunca en el replay de `existingPayment`).
- `PurchasesService.receive` → `purchase.received` (solo en la recepción
  real, no en el replay de `existingReceipt`) y `payable.pending` (solo
  cuando `growOrCreatePayable` reporta `created: true` — primera
  recepción con saldo pendiente real, no cada recepción parcial que solo
  hace crecer una Payable ya existente).
- `CashService.open`/`close` → `cash.opened`/`cash.closed` (solo en la
  apertura/cierre real, no en el replay idempotente). `close` además
  dispara `cash.discrepancy` cuando el arqueo (`countedAmount` vs.
  `expectedAmount`, ya calculado por `computeBalance`) da una diferencia
  distinta de cero — el caso de "error operativo relevante" pedido por el
  alcance, usando un cálculo que el servicio ya hacía, sin mecanismo
  nuevo.

Todos estos guardan explícitamente contra duplicados: cada punto de
integración usa una variable de closure (`saleConfirmedNow`,
`paymentRecorded`, `receivedNow`, `openedNow`, `closedNow`, o el resultado
tipado `created` de `growOrCreatePayable`/`createOrSyncReceivable`) que
solo se vuelve `true` en el camino que efectivamente mutó algo — nunca en
un retry/doble-click que `runOrResolve*Conflict` ya neutralizó a nivel de
negocio.

`NotificationsService.create` nunca tumba la operación que la origina
(mismo criterio que `AuditService.log`): escribe directo vía
`TenantPrismaService` (no por cola — es una escritura rápida, a
diferencia del email, no hay proveedor externo lento de por medio) dentro
de un `try/catch` que solo loguea si falla.

### API de notificaciones: recurso personal, sin permiso de catálogo nuevo

`NotificationsController` usa `@NoPermissionRequired()` (mismo patrón que
`OrganizationsController#me`) en vez de agregar un permiso al catálogo:
"mis notificaciones" no es un recurso de negocio con RBAC por rol, es
personal de cada usuario autenticado. La pertenencia real la valida
`NotificationsService`, no un rol: `markRead` compara
`notification.userId` contra el `sub` del token y devuelve 403 si no
coincide (después de que RLS ya garantizó que la fila es de la
organización correcta) — un CASHIER no puede marcar como leída la
notificación de un OWNER de la misma organización. `list`/`unreadCount`
filtran por `organizationId` (RLS) Y `userId` (aplicación) juntos.

Paginación explícita (`page`/`pageSize`, tope 100) con `total` devuelto
junto a los ítems — mismo patrón `skip`/`take` que `SalesService.list` ya
usa, con un `Promise.all([findMany, count])` agregado porque acá sí hace
falta el total para la paginación del frontend.

### Email: interfaz `EmailSender` + proveedor seleccionado por variable de entorno

El dominio comercial nunca conoce un proveedor de email concreto — solo
conoce `MailService` (`backend/src/mail/mail.service.ts`), que arma el
mensaje (vía los templates de `mail/templates/`) y lo encola. Quien
efectivamente llama al proveedor es `EmailProcessor`
(`mail/email.processor.ts`), inyectando la interfaz `EmailSender`
(`mail/email-sender.interface.ts`) bajo el token `EMAIL_SENDER`. La
selección del proveedor real es 100% por configuración, en
`mail.module.ts`:

```ts
{
  provide: EMAIL_SENDER,
  inject: [ConfigService, ConsoleEmailSender, SmtpEmailSender],
  useFactory: (config, consoleSender, smtpSender) =>
    config.get('EMAIL_PROVIDER') === 'smtp' ? smtpSender : consoleSender,
}
```

`ConsoleEmailSender` (default) solo loguea — no requiere credenciales, así
que el sistema funciona out-of-the-box en desarrollo/CI. `SmtpEmailSender`
usa `nodemailer` con host/puerto/usuario/password/from leídos
exclusivamente de variables de entorno (`EMAIL_PROVIDER`,
`EMAIL_SMTP_HOST`, `EMAIL_SMTP_PORT`, `EMAIL_SMTP_USER`,
`EMAIL_SMTP_PASSWORD`, `EMAIL_FROM`, documentadas en `.env.example` sin
ningún valor real) — nada hardcodeado. Agregar un proveedor nuevo (una
API HTTP de terceros, por ejemplo) es implementar `EmailSender` y sumarlo
a esa factory; ningún llamador del dominio comercial cambia.

### Cola: reutiliza BullMQ/Redis existente, mismo patrón que `AuditModule`

No se crea un segundo sistema de colas. `MailModule` registra su propia
cola (`BullModule.registerQueue({ name: EMAIL_QUEUE })`, `EMAIL_QUEUE =
'email'`) con el mismo mecanismo que `AuditModule` ya usa para `'audit'`,
sobre el mismo Redis (`BullModule.forRootAsync` en `app.module.ts`,
compartido por toda la app). `MailService.enqueue` nunca llama al
proveedor: agrega el job con `attempts: 3, backoff: { type:
'exponential', delay: 1000 }, removeOnComplete: true, removeOnFail: 100`
(mismos valores que `AuditService.log`) y retorna — el request HTTP nunca
espera al proveedor de email. `EmailProcessor` (un `@Processor(EMAIL_QUEUE)
extends WorkerHost`, igual que `AuditProcessor`) es quien corre fuera del
ciclo de vida del request.

Los adjuntos (el PDF del recibo) viajan en el payload del job serializados
en base64 (`EmailAttachmentPayload.contentBase64`) — un job de BullMQ se
persiste como JSON en Redis, así que un `Buffer` no sobrevive tal cual; el
processor lo reconstruye (`Buffer.from(base64, 'base64')`) antes de
pasarlo al `EmailSender`.

### `EmailLog`: quién es dueño de escribirlo, y por qué no es `MailService`

`EmailLog` (ledger append-only, mismo espíritu que `AuditLog`/`Payment`)
lo crea y actualiza ÚNICAMENTE `EmailProcessor` — nunca `MailService`.
Motivo concreto: `MembersService.invite` llama `mail.sendInvite(...)`
desde DENTRO de una transacción de negocio (`tenantPrisma.run`). Si
`MailService` escribiera el `EmailLog` sincrónicamente ahí, y esa
transacción hiciera rollback después (por cualquier otra razón), quedaría
un registro "fantasma" de un email que el sistema cree haber encolado pero
cuyo contexto de negocio nunca existió — el `queue.add()` de BullMQ ya
escribió en Redis, que no participa de la transacción de Postgres, así que
ese job se ejecuta igual. Dejar que el processor sea la única fuente de
verdad evita esa inconsistencia: `EmailLog` siempre refleja jobs que
realmente se ejecutaron.

Reservado a emails con contexto de organización ya resuelto —
`welcome`, `invite`, `sale-confirmation`, `receipt`, `notification`. Los
emails de identidad pre-tenant (`email-verification`, `password-reset`)
se encolan y envían igual, con sus propios reintentos, pero no generan
fila en `EmailLog` (no siempre hay una organización "actual" inequívoca en
ese punto del flujo de auth).

Idempotencia: `EmailLog.idempotencyKey` es única y opcional (mismo patrón
que `payments.idempotencyKey` desde Fase Comercial 2). `EmailProcessor`
chequea, ANTES de llamar al proveedor, si ya existe una fila `SENT` con
esa key — si la hay, no reenvía. `sendSaleConfirmation` usa
`sale-confirmation:{saleId}` y `sendReceiptEmail` usa
`receipt-email:{receiptId}`: pedir el email del mismo recibo dos veces no
dispara un segundo correo.

### Reintentos: `onFailed` distingue "todavía puede reintentar" de "se agotaron los intentos"

El evento `'failed'` de un `Worker` de BullMQ se dispara en CADA intento
fallido, no solo cuando se agotan los reintentos (a diferencia de lo que
el nombre sugiere a primera lectura). `EmailProcessor.onFailed` compara
`job.attemptsMade` contra `job.opts.attempts`: si todavía quedan
reintentos, solo loguea un `warn` y no toca `EmailLog` (el envío puede
recuperarse solo); si se agotaron, recién ahí escribe/actualiza
`EmailLog` con `status = FAILED` y el mensaje de error (truncado a 1000
caracteres). Verificado con un test que llama a `onFailed` directamente
con intentos 1, 2 y 3 de 3: ninguna fila hasta el intento 3, y recién ahí
`FAILED`.

Nota de testing: probar este camino disparando el proceso completo
(SMTP real apuntando a un host inalcanzable) resultó ser una carrera
contra el resto de la batería — CUALQUIER `.spec.ts` que levanta la app
(vía `bootTestApp()`) registra su propio `EmailProcessor` escuchando la
MISMA cola `email` sobre el MISMO Redis compartido, así que un job
encolado desde un archivo puede terminar siendo procesado por el worker
de OTRO archivo corriendo en paralelo (con SU proveedor `console`, que
nunca falla) — BullMQ está diseñado exactamente para eso (varios workers
compitiendo por la misma cola), pero eso vuelve no-determinístico un test
que necesita que sea SU proveedor el que procese el job. La solución
(`mail/email.processor.spec.ts`) instancia `EmailProcessor` directamente
con un `TenantPrismaService` real (de una app real) y un `EmailSender`
falso controlado a mano, invocado FUERA de BullMQ — mismo Postgres real,
sin la cola compartida de por medio.

### Templates: HTML + texto plano, sin dependencias externas

`mail/templates/` — un layout compartido (`layout.ts`, estilos inline
porque los clientes de correo ignoran `<style>` con frecuencia, sin
imágenes ni fuentes remotas) y un archivo por tipo: bienvenida,
recuperación de contraseña, confirmación de email, invitación,
confirmación de venta, recibo comercial, notificación genérica. Cada uno
devuelve `{ subject, html, text }`. El template de recibo
(`receipt.template.ts`) repite explícitamente "DOCUMENTO COMERCIAL NO
FISCAL — no es una factura ni un documento tributario válido ante el SIN"
en el cuerpo del correo — el rótulo real vive en el PDF adjunto (ver
abajo), pero queda dicho también en texto plano por si el destinatario no
abre el adjunto.

### Email del recibo: el PDF adjunto sale del snapshot inmutable, nunca se reconstruye

`ReceiptsService.sendByEmail` (`POST /receipts/:id/email`,
`receipts.manage`) reutiliza EXACTAMENTE el mismo `renderReceiptPdf`
(formato A4) que ya usa `GET /receipts/:id/pdf` — nunca vuelve a leer
`Sale`/`Customer`/`Organization`/`Product`, solo `receipt.snapshot`. El
destinatario: si no se pasa `email` explícito en el body, se busca
`sale.customer.email`; si no hay ninguno de los dos, 400 explícito (nunca
omite el envío en silencio ni inventa un destinatario). No introduce
ninguna lógica fiscal — es solo "adjuntar el mismo PDF no-fiscal que ya
existía por otro medio".

### Seguridad

- `email_logs` tiene RLS igual que toda tabla tenant-scoped
  (`ENABLE`/`FORCE ROW LEVEL SECURITY` + policy `tenant_isolation`, mismo
  patrón exacto que el resto del esquema desde Fase 1).
- `notifications` ya tenía RLS desde la migración inicial (Fase 1); esta
  fase solo agrega la columna `readAt`, sin nueva policy.
- Ningún secreto de email hardcodeado — `EMAIL_PROVIDER`,
  `EMAIL_SMTP_HOST/PORT/USER/PASSWORD`, `EMAIL_FROM`, `FRONTEND_URL` solo
  por variables de entorno, documentadas en `.env.example` sin valores
  reales.
- `EmailLog`/`Notification` nunca exponen contenido de un tenant a otro
  (RLS) ni de un usuario a otro dentro de la misma organización
  (`NotificationsService` valida `userId` en la aplicación).

### Frontend: `/notifications` real + indicador en la navegación

`/notifications` reemplaza el placeholder `ComingSoon`: lista paginada,
filtro "solo no leídas", marcar una o todas como leídas, estados vacíos y
de error reales (mismo patrón `loading`/`loadError` que `/receivables`).
`AppShell` agrega un contador de no leídas junto al ítem "Notificaciones"
del menú, poblado con `GET /notifications/unread-count` al montar y cada
30 segundos (`setInterval`) — no hay push en tiempo real en esta fase, es
polling explícito y documentado como tal.

## 16. Fase Comercial 10 — Planes, límites y suscripciones: decisiones técnicas

### Qué ya existía vs. qué se construyó

`Plan`/`Subscription`/`SubscriptionEvent` (modelos), `SubscriptionStatus`
(`TRIALING`/`ACTIVE`/`PAST_DUE`/`CANCELLED`), y un plan `free` sembrado
con `limits: { maxUsers: 3, maxBranches: 1, maxProducts: 50 }` ya existían
desde Fase 1 — pero sin API de ciclo de vida y, sobre todo, sin
**enforcement**: cualquier organización podía superar esos límites sin
que nada lo impidiera. Esta fase no cambia el esquema (cero migraciones
nuevas) — construye el módulo `subscriptions/` sobre exactamente los
campos que ya estaban ahí.

### Catálogo de planes: fuente única, 4 planes reales

`backend/src/subscriptions/plans.catalog.ts` es la ÚNICA fuente de
verdad de nombre/precio/límites por plan — `prisma/seed.ts`,
`OrganizationsService.bootstrapOrganization` (plan `free` al registrar
una empresa) y `SubscriptionsService.getOrCreatePlan` leen todos del
mismo objeto, para que nunca diverjan silenciosamente sobre qué trae
cada plan:

| Plan | Precio/mes | maxUsers | maxBranches | maxProducts |
|---|---|---|---|---|
| `free` | Bs 0 | 3 | 1 | 50 |
| `basic` | Bs 99 | 10 | 3 | 500 |
| `pro` | Bs 299 | 30 | 10 | 5000 |
| `enterprise` | Bs 799 | ilimitado (`null`) | ilimitado | ilimitado |

Los precios/límites de `basic`/`pro`/`enterprise` son valores iniciales
razonables (no había ninguno definido en el código antes de esta fase
más allá de `free`) — ajustables desde `plans.catalog.ts` sin tocar
enforcement ni el resto del sistema.

**Alcance deliberadamente acotado de los límites**: el pedido de esta
fase listó, a modo de ejemplo, límites de sucursales, almacenes, POS,
productos, clientes, proveedores, ventas y almacenamiento como "ya
definidos". Al revisar el código, SOLO `maxUsers`/`maxBranches`/
`maxProducts` existían realmente en `Plan.limits` — el resto nunca se
implementó en ninguna fase anterior. Siguiendo la instrucción explícita
de "no inventar límites nuevos si no están definidos", esta fase
implementa enforcement real ÚNICAMENTE para esos tres. `features` (JSON,
`{ pos, inventory, invoicing }`) sigue siendo puramente descriptivo — no
se inventó gating de funcionalidades por feature flag, tampoco pedido
explícitamente y no definido en ningún lado antes.

### Ciclo de vida de `Subscription`

- **Alta**: toda organización nueva arranca en el plan `free`,
  `TRIALING`, sin `currentPeriodEnd` (no vence) — comportamiento ya
  existente, sin cambios.
- **Activación / cambio de plan** (`POST
  .../subscription/change-plan`): elegir un plan pago activa la
  suscripción (`ACTIVE`, `currentPeriodEnd` = hoy + 30 días — sin
  pasarela de pago real todavía, ver más abajo); volver a `free` la deja
  `TRIALING` sin vencimiento. Cambiar al mismo plan que ya está activo es
  un no-op idempotente. **El downgrade se bloquea (409)** si el uso
  ACTUAL de la organización ya supera algún límite del plan destino — se
  compara usuarios/sucursales/productos reales contra los límites del
  plan elegido ANTES de aplicar el cambio, para nunca dejar una cuenta
  "ya excedida" apenas cambia de plan.
- **Expiración perezosa**: no hay cron/worker dedicado (no hace falta sin
  pasarela de pagos real todavía). Cada vez que se lee la suscripción
  (`SubscriptionsService.getEffective`, usado por el `GET` del resumen),
  si está `ACTIVE` y su `currentPeriodEnd` ya pasó, se transiciona a
  `PAST_DUE` ahí mismo, se persiste, y se dejar un `SubscriptionEvent`
  tipo `expired`. `PAST_DUE` es informativo (no bloquea creación de
  recursos en esta fase) — distinto de `CANCELLED`, que sí bloquea (ver
  Enforcement).
- **Cancelación** (`POST .../subscription/cancel`): pasa a `CANCELLED`.
  Idempotente (cancelar dos veces no falla ni duplica el
  `SubscriptionEvent`).
- **Renovación manual** (`POST .../subscription/renew`): sin pasarela de
  pagos real, esto SIMULA el efecto de un cobro exitoso — extiende
  `currentPeriodEnd` 30 días desde el vencimiento actual (o desde hoy si
  ya venció) y reactiva la suscripción (`ACTIVE`) si estaba `PAST_DUE` o
  `CANCELLED`. El plan `free` no tiene período que renovar (400
  explícito). Es también el mecanismo de "reactivar" una suscripción
  cancelada — no existe un endpoint `activate` separado, reactivar ES
  renovar.
- Todas las transiciones dejan `SubscriptionEvent` (`plan_changed`,
  `cancelled`, `expired`, `renewed`) Y un `AuditLog` (vía `AuditService`,
  mismo patrón asíncrono que el resto del sistema) Y una `Notification`
  al usuario que hizo la acción (reutiliza `NotificationsService` de la
  Fase Comercial 9 — ningún sistema de notificaciones nuevo).

### Enforcement real: dónde vive, y por qué es seguro bajo concurrencia

`SubscriptionsService.assertWithinLimit(tx, organizationId, resource)` es
el único punto de enforcement. Se llama SIEMPRE desde DENTRO de la misma
transacción (`tx`) que va a crear el recurso — nunca desde el
controller, nunca confiando en nada que venga del cliente:

- `MembersService.invite` → `assertWithinLimit(tx, org, 'users')` antes
  de crear la membresía. También en `MembersService.setStatus` cuando
  reactiva un usuario `SUSPENDED` → `ACTIVE` (reactivar también consume
  un cupo — probado explícitamente).
- `BranchesService.create` → `assertWithinLimit(tx, org, 'branches')`.
- `ProductsService.create` y `ProductsService.duplicate` →
  `assertWithinLimit(tx, org, 'products')` (duplicar cuenta como crear
  uno nuevo, mismo límite).

**Por qué `SELECT ... FOR UPDATE` sobre la fila de `Subscription`, y no
solo un `COUNT` antes del `INSERT`**: bajo el nivel de aislamiento por
defecto de Postgres (READ COMMITTED), dos transacciones concurrentes
podrían ambas leer el mismo conteo ANTES de que ninguna confirme su
`INSERT`, ambas ver que están bajo el límite, y ambas insertar — superando
el límite. `assertWithinLimit` bloquea primero la fila de `subscriptions`
de esa organización con `FOR UPDATE`: la segunda transacción concurrente
que intenta crear el mismo tipo de recurso en la MISMA organización queda
esperando a que la primera confirme (o revierta) antes de poder siquiera
leer el conteo — mismo patrón exacto que `lockSale`/`lockPurchase`/
`lockPayableByPurchase` ya usan en Ventas/Compras/Pagos desde fases
anteriores. Probado con 10 creaciones de producto verdaderamente
concurrentes (`Promise.all`, nunca secuencial) contra un límite de 3:
exactamente 3 succeeded, 7 con 402 — nunca 4 o más. Mismo resultado con 8
invitaciones concurrentes contra `maxUsers: 2`.

**Cancelada bloquea distinto de límite alcanzado**: una suscripción
`CANCELLED` bloquea CUALQUIER creación de usuario/sucursal/producto con
`403 Forbidden` (no es un límite numérico, es que la cuenta no tiene plan
activo). Alcanzar el límite numérico de un plan vigente responde `402
Payment Required` — código HTTP reservado exactamente para este caso,
que le permite al frontend distinguir "no podés hacer esto" (403) de "no
podés hacer MÁS de esto sin actualizar tu plan" (402).

### Seguridad: nada confía en lo que manda el cliente

El usuario nunca puede alterar su plan o sus límites manipulando un
request HTTP: `ChangePlanDto.planKey` se valida contra las 4 claves reales
del catálogo (`@IsIn(PLAN_KEYS)`, 400 si no coincide); los LÍMITES nunca
viajan en ningún request — siempre se leen del lado del servidor desde
`Plan.limits` de la suscripción vigente de la organización autenticada
(vía el JWT, nunca un `organizationId` en el body). `subscription.manage`
(permiso nuevo, solo `OWNER`/`ADMIN` vía `ALL_PERMISSION_KEYS`) protege
`change-plan`/`cancel`/`renew`; el `GET` del resumen es
`@NoPermissionRequired()` (cualquier autenticado puede ver el plan y uso
de su propia empresa, mismo criterio que `GET /organizations/me`).

### Arquitectura de billing futura (sin pasarela real todavía)

Punto 7/8 del pedido: NO se implementó ninguna pasarela de pagos real
(Mercado Pago/Stripe/otra), NO se cobra nada de verdad, NO se almacenan
tarjetas ni ningún dato sensible de pago. La preparación deliberada para
cuando se autorice una pasarela real:

- `changePlan`/`renew` YA separan "decidir qué debería pasar con la
  suscripción" (lógica 100% en `SubscriptionsService`) de "cómo se
  cobra" (que hoy simplemente no existe) — conectar una pasarela real
  significaría agregar un paso ANTES de estos métodos (iniciar un cobro,
  esperar el webhook de confirmación) sin tener que rediseñar el ciclo de
  vida de `Subscription` que ya existe.
- `SubscriptionEvent` (ya modelado desde Fase 1, ahora realmente usado)
  es el lugar natural donde un futuro webhook de la pasarela escribiría
  eventos (`payment_succeeded`, `payment_failed`) con el mismo patrón
  append-only que `plan_changed`/`cancelled`/`renewed` ya usan.
  `payload` (`String?` @db.Text) ya admite guardar el JSON crudo del
  webhook del proveedor si hiciera falta para auditoría.
- Cuando exista un proveedor real, la integración se construiría como
  un módulo nuevo (`billing/` o similar) con su propia abstracción de
  proveedor (mismo criterio que `EmailSender`/`ConsoleEmailSender`/
  `SmtpEmailSender` de la Fase Comercial 9: una interfaz, el dominio
  nunca conoce al proveedor concreto, la selección es 100% por variable
  de entorno) — nunca se acopla `SubscriptionsService` directamente a
  Mercado Pago o Stripe.
- Ningún placeholder de credenciales se agregó a `.env.example` en esta
  fase — no hay todavía ninguna variable de entorno de pagos que
  documentar, porque no se decidió proveedor ni se escribió código que
  las necesite.

### `app_superadmin`: sigue reservado, sin superficie nueva

El rol Postgres `app_superadmin` (`BYPASSRLS`, creado desde Fase 1) se
revisó explícitamente para esta fase. Ningún código de aplicación lo usa
todavía — no existe un contrato de "backoffice" definido en ningún lado
del proyecto para implementar contra él, así que no se construyó ningún
controller/endpoint de administración de planes. La gestión del catálogo
de planes (agregar o ajustar `basic`/`pro`/`enterprise`) sigue siendo vía
`prisma/seed.ts` (mismo mecanismo que el catálogo de permisos) — un
backoffice real que use `app_superadmin` queda para cuando haya un
diseño explícito de esa superficie, que hoy no existe en la
documentación ni en el código.

### Frontend: `/subscription` real

Reemplaza la página de solo lectura anterior: plan actual, estado (con
colores por estado — `TRIALING`/`ACTIVE`/`PAST_DUE`/`CANCELLED`), barras
de uso con porcentaje por cada límite (usuarios/sucursales/productos,
"Ilimitado" cuando el límite es `null`), tarjetas de los 4 planes
disponibles con botón "cambiar a este plan", y botones de
cancelar/renovar. Ningún botón se deshabilita preventivamente por rol
(el backend ya es fail-closed vía RBAC) — los errores 402/403/409 del
backend se muestran tal cual (mismo patrón `err.message` ya usado en
`/users`, `/settings`, `/inventory/products`), así que un mensaje de
límite alcanzado es automáticamente claro y accionable sin lógica nueva
en el frontend.
