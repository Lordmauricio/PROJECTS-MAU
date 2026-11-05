# Operación gastronómica de KIPU

## Primer recorrido

1. Crear productos en Inventario, incluidos los ingredientes y el producto que
   representa el plato vendido. Registrar existencias en su almacén.
2. En Restaurante → Menú y combos, elegir el producto de venta, nombre,
   categoría, estación y precio. Definir los componentes consumidos por unidad:
   por ejemplo, un combo puede consumir 0.25 de pollo y una porción de papas.
   El producto de venta no necesita stock propio si consume otros componentes.
   La presentación opcional identifica, por ejemplo, cuarto, medio o entero.
   Cada presentación es una entrada independiente, con precio y composición propios.
3. Agregar extras con su precio y componentes. Una sustitución reemplaza un
   componente base completo; solo se permite una sustitución por componente.
4. Abrir caja en el punto de venta. En Caja gastronómica, elegir sucursal,
   almacén, platos, opciones, salón/para llevar y observaciones. Guardar pedido.
   «Revisar disponibilidad y total» consulta los precios y faltantes en servidor.
   Al guardar un pedido nuevo se realiza también esta revisión. Si no alcanza el
   stock, el carrito sigue editable y se muestran los componentes que faltan.
5. Cobrar el total con uno o varios métodos. QR es manual: el operador debe
   comprobar el abono. El cambio se muestra aparte y no infla el cobro ni caja.
6. En Cocina y despacho, iniciar preparación, marcar listo y entregar. El tablero
   actualiza cada 15 segundos y admite filtros por sucursal y estación.
7. Emitir el recibo comercial desde la venta y cerrar caja con efectivo contado.

## Cambios de menú y precios de temporada

El encargado puede agregar platos y editar nombre, presentación, categoría,
estación, composición, opciones y precio desde **Restaurante → Menú y combos**.
Cada presentación y cada extra puede tener su propio precio. Para retirar un
plato temporalmente, desmarcar «Visible en caja»; se conserva su historial.

Los precios del menú se pueden cambiar cuando el negocio lo necesite, incluidos
los cambios de temporada. El nuevo valor se aplica al revisar y guardar nuevos
pedidos. Los pedidos ya guardados, cobrados y sus recibos conservan el nombre,
composición y precio aceptados al crearse. Para rehacer un pedido sin cobrar
con otro precio, cancelarlo y crear uno nuevo. No se requiere modificar código
para agregar platos o actualizar precios desde estas pantallas.

Los pedidos se guardan antes del pago. Un fallo de red se recupera reintentando
el mismo pedido, sin crear otra venta. La pestaña conserva el intento en
sessionStorage cuando está disponible; los borradores guardados también aparecen
en caja. Después de guardar, los precios y componentes quedan congelados. Para
cambiar un pedido sin cobrar, cancelarlo y crear otro.

## Stock, cobro e historia

- Los descuentos requieren `sales.update` y no pueden superar el subtotal.
  El servidor determina precios; la API de pedidos no acepta precios enviados
  por el cajero. Los importes se calculan con Decimal y dos decimales.
- Cada línea conserva nombre, opciones, precios, estación y componentes. El
  recibo conserva el nombre histórico del plato y sus opciones.
  Los nuevos pedidos conservan además la presentación y `referenceUnitPrice`
  de cada componente: precio de catálogo al guardar, no un cargo adicional ni un
  reparto contable del precio del combo. El importe cobrado es el precio del
  menú más extras y menos el descuento autorizado. No se inventa este dato para
  pedidos anteriores.
- Guardar un pedido no reserva stock. Cobrar confirma la venta y descuenta todos
  sus componentes en una sola transacción. Si falta alguno, se revierte el cobro
  y todo el consumo. La disponibilidad mostrada es orientativa y se recalcula al
  cobrar; dos cajas pueden intentar vender la última porción.
  La revisión suma componentes compartidos por varias líneas, no solo cada línea
  por separado. La disponibilidad por porción usa Decimal, evitando perder una
  porción por errores binarios. Un plato cuya guarnición base esté agotada puede
  personalizarse si tiene opciones; la revisión valida la sustitución elegida.
- La clave del pedido es única por empresa; repetirla con contenido distinto
  devuelve 409. La confirmación de venta usa locks y las claves de pago existentes.
  Un pago completado se recupera antes de enviar el pedido a cocina si se perdió
  la respuesta entre ambas operaciones.
- Las transiciones usan versión y bloqueo: dos operadores no pueden avanzar un
  estado obsoleto. Un reintento de la misma transición no duplica su evento.
- Cancelar un borrador no consume stock. Para devolver un pedido pagado, usar la
  devolución de venta. Se reponen los componentes de estaciones que no iniciaron
  preparación; lo ya iniciado no se repone automáticamente. La decisión queda
  registrada en el evento del pedido y el movimiento financiero conserva su
  auditoría. No equivale todavía a un módulo completo de mermas o producción.
- Las solicitudes de impresión quedan numeradas. Las copias posteriores llevan
  REIMPRESIÓN; el navegador no confirma que el papel haya salido físicamente.

## Permisos y límites actuales

Se reutilizan los permisos existentes: `products.read/create/update` para menú;
`sales.read/create/update/delete` para consulta, cobro, cocina y cancelación.
El cajero puede consultar y cobrar; el encargado administra menú y cocina.
Producción usa `inventory.read` para consultar y `inventory.manage` para operar.
Las tablas de restaurante y producción tienen RLS forzado por empresa. Sus eventos se escriben
en la misma transacción que el cambio de estado.

Cada estación tiene una comanda y versión propias. El filtro muestra las líneas
y el estado de esa estación; sin filtro se ve el estado agregado del pedido.
El pedido solo queda listo cuando todas las estaciones están listas y solo
entonces puede entregarse. Se registran los horarios de inicio/listo por estación
y el tiempo desde ingreso a cocina, actualizado cada 15 segundos. La acción sin
estación conserva el avance conjunto; no permite saltar estaciones sin iniciar.
La impresión filtrada conserva un contador de copias por estación independiente
del contador de impresión del pedido completo. Las copias filtradas incluyen
solo sus líneas, el estado y el nombre de estación.

La consulta muestra hasta 100 pedidos. No hay todavía mesas/cuentas abiertas,
delivery, lotes/vencimientos ni facturación SIN. Los reportes agrupan los combos
por su producto de venta; no presentan todavía un desglose de costo por receta.

## Producción por tandas

En **Restaurante → Producción por tandas**, planificar nombre, estación, almacén,
producto crudo/cantidad y producto preparado/cantidad prevista. Usar productos
distintos y cantidades en las unidades configuradas de cada producto. Configurar
el menú para consumir el preparado: un cuarto puede consumir 0.25 de pollo listo.

Planificar no mueve existencias. **Iniciar tanda** consume el crudo una sola vez,
o rechaza el inicio si no alcanza. **Registrar producción** agrega al almacén la
cantidad preparada real; puede diferir de la prevista. Los reintentos y las
acciones concurrentes no duplican consumo ni producción. Una tanda completada
ya no admite otra cantidad por el mismo intento.

Cancelar requiere motivo. Una tanda iniciada conserva el consumo crudo y no
produce stock preparado; cancelar no devuelve automáticamente materia prima.
Una tanda completada requiere ajustes de inventario para corregir existencias,
con su motivo y permisos. Se registran acciones y cantidades en auditoría.

El saldo disponible por porciones proviene del inventario agregado del producto
preparado, no de una supuesta cantidad restante por tanda. Esta entrega no
asigna ventas a lotes, convierte unidades ni recalcula costos o mermas detalladas;
esas ampliaciones corresponden a la etapa 6.

## API aditiva

- `GET/POST /restaurant/menu` y `PATCH /restaurant/menu/:id`.
  GET admite `warehouseId` y devuelve disponibilidad calculada de componentes.
  Acepta `presentation` opcional. GET incluye `customizable`, que permite abrir
  opciones aunque la composición base esté agotada; no garantiza disponibilidad.
- `POST /restaurant/quote`: recibe POS, almacén, servicio, líneas y descuento
  opcional, sin clave de pedido ni precios del cliente. Devuelve líneas calculadas,
  subtotal, descuento, total, `canFulfill` y faltantes con cantidades requeridas y
  disponibles. Usa los mismos permisos y cálculo que guardar el pedido. No crea
  ventas, pedidos, movimientos ni pagos, y no reserva existencias.
- `GET/POST /restaurant/orders` y `GET /restaurant/orders/:id`.
  Creación requiere `requestKey`, POS, almacén, servicio y líneas con IDs de menú,
  cantidades enteras y opciones. GET admite sucursal y estado; sin estado excluye
  entregados y cancelados.
- `POST /restaurant/orders/:id/checkout`: usa los mismos pagos que ventas.
- `POST /restaurant/orders/:id/status`: recibe estado siguiente y versión actual.
  Con `station` usa la versión de la comanda de esa estación. Sin estación usa
  la versión del pedido; `DELIVERED` requiere todas las estaciones listas.
- `POST /restaurant/orders/:id/cancel`: requiere motivo; solo antes del cobro.
- `POST /restaurant/orders/:id/print`: registra una solicitud y devuelve la copia.
  Admite `station`; devuelve `printStation` y `printCopy`. No confirma salida física.
- `GET/POST /restaurant/batches`: consulta por sucursal y planifica tandas con
  `requestKey`. Repetir la clave con otros datos devuelve 409.
- `POST /restaurant/batches/:id/status`: recibe versión y PREPARING, READY o
  CANCELLED; READY admite cantidad real y CANCELLED requiere motivo.

La migración es aditiva: agrega menú, pedidos/eventos y dos columnas opcionales
en líneas de venta. Las ventas existentes conservan el consumo directo de su
producto. No requiere reemplazar ni borrar datos existentes.

La ampliación de etapa 3 agrega una migración aditiva:
`20261105020000_menu_presentations`, con `menu_entries.presentation` nullable.
Desplegar primero el backend compatible y aplicar sus migraciones, después el
frontend que consulta `/restaurant/quote`. Respaldar la base antes de migrar un
entorno con datos. Las entradas anteriores siguen funcionando sin presentación.

La etapa 4 agrega `20261105030000_kitchen_stations_and_batches`. Crea comandas y
tandas con RLS forzado y una FK de comanda/pedido que incluye empresa. Genera las
comandas de pedidos previos conservando su estado global; no vuelve a cobrar ni
mueve stock durante esa adaptación. Desplegar backend/migración antes del frontend
con estaciones y producción. La aplicación local se probó sobre el contenedor
de desarrollo, sin aplicar migraciones en producción.

## Validación local

Con PostgreSQL, Redis, backend/.env y dependencias preparados:

```bash
cd backend
npx prisma migrate deploy
npm run build
npm test -- --runInBand
npm run verify:tenant-isolation
cd ../frontend
npm run lint
npm run build
npm run test:unit
PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/usr/bin/chromium npm run test:browser
PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/usr/bin/chromium npm run test:live
```

Ejecutar las suites de navegador una después de otra: ambas usan el puerto 3100.
`test:live` inicia backend en 4300 y frontend en 3100, crea empresas sintéticas y
usa la base local configurada. No ejecutarlo contra producción. Sin Chromium del
sistema, instalar el navegador de Playwright y omitir la variable de ruta.

## Salón y mesas (etapa 5)

`/restaurant/dining` muestra mesas por zona y sucursal, capacidad, ocupación,
cuentas abiertas y mesero asignado. Una mesa puede tener varias cuentas; solo
queda libre cuando todas están cerradas o unidas a otra cuenta. El encargado
crea y edita las mesas. El mesero abre cuentas, registra comandas adicionales y
las envía a cocina. El cajero registra pagos y cierra; el mesero no puede cobrar.

El envío confirma la venta sin pago y consume sus componentes, junto con las
comandas de estación, en una sola transacción. Si falta stock no cambia nada.
La cocina acepta ventas CONFIRMED/PARTIALLY_PAID solo si el pedido pertenece a
una cuenta de salón. Mostrador mantiene el pago previo. Un reintento de envío o
el cobro posterior no descuentan stock de nuevo. No hay reserva de stock antes
del envío. Los adicionales usan el precio vigente al guardarlos y conservan su
snapshot; los anteriores no se recalculan al editar el menú.

Dividir selecciona comandas completas y conserva cada venta, pago y estado de
cocina. Para separar platos individualmente, registrarlos como comandas distintas.
No se fracciona una línea histórica pagada ni se redistribuyen importes cobrados.
Unir mueve comandas a la cuenta de destino y marca la otra MERGED; requiere el
mismo punto de venta y almacén. Trasladar cambia la mesa dentro de la sucursal.
La unión bloquea cuentas en orden estable para evitar deadlocks. Cambios de mesa,
unión y asignación usan versiones; un operador obsoleto debe actualizar y revisar.

El cierre exige todas las ventas pagadas o anuladas y todas las comandas
entregadas o canceladas. Una devolución impaga no crea reembolso y solo repone
estaciones sin iniciar. El encargado la realiza desde la venta; no se borra la
historia. Las propinas son voluntarias y separadas de ventas: las de efectivo
registran CASH_IN en la caja abierta de la terminal, atómicamente con el cierre.
No se distribuyen a meseros ni se consideran ingreso por venta. La corrección o
entrega de propinas al personal corresponde a gestión de caja de etapa 7.
Los cobros de salón en efectivo también exigen caja abierta y se revierten si se
cierra simultáneamente; otros métodos se registran manualmente, sin proveedor.

Roles: `WAITER` (Mesero) recibe `dining.read`, `dining.serve`, `products.read` y
`organization.branches.read`; no recibe `sales.create`, `sales.update` ni
`sales.delete`. Cajero cobra con `sales.create`; encargado configura mesas y
reasigna con `sales.update`. El envío y la creación desde salón requieren
`dining.serve`. La apertura con otro mesero también exige autorización de encargado.
Los operadores con servicio pueden colaborar sobre las cuentas de su empresa;
la asignación de mesero es responsabilidad operativa, no aislamiento entre empleados.
La lista de operadores expone solo identificador y nombre de miembros activos.

API bajo `/restaurant/dining`: GET `tables`, `waiters`, `accounts`,
`accounts/:id`; POST `tables`, `accounts`; PATCH `tables/:id`;
POST `accounts/:id/orders`, `accounts/:id/orders/:orderId/dispatch`,
`accounts/:id/orders/:orderId/payments`, y `accounts/:id/{move,waiter,split,merge,close}`.
Apertura, comanda, división y pago llevan claves de reintento. La interfaz
conserva la solicitud ante respuesta incierta y ofrece reintentar sin cambiar
sus datos; mantener la pestaña abierta hasta resolverla. Actualizar salón recupera
los estados de otros operadores. El historial de cuenta cerrada se conserva y
es consultable por identificador; el tablero lista las cuentas abiertas.

Migración aditiva `20261105040000_dining_accounts`: tablas con RLS forzado,
relaciones compuestas por empresa y campos opcionales para pedidos anteriores.
Incluye permisos nuevos y rol Mesero para empresas existentes; conserva roles
personalizados. Desplegar migración con rol administrativo, luego backend y
frontend. No usar credenciales administrativas en el servidor de aplicación.

Los reembolsos de salón con efectivo exigen caja abierta con saldo suficiente;
si no puede registrarse el egreso, toda la devolución se revierte. Esto evita
marcar el dinero como devuelto sin reflejarlo en el arqueo. Abrir/fondear la caja
y reintentar conserva la devolución única. Las ventas comerciales anteriores
conservan su política existente, documentada en `architecture.md`.

## Recetas, rendimientos y stock (etapa 6)

Pantallas: `/restaurant/recipes` y `/inventory/control`. Encargado e inventario
usan `inventory.manage`; las consultas requieren `inventory.read`. Cajero y
mesero no pueden publicar recetas, ingresar lotes, contar ni registrar mermas.

### Unidades y versiones

Definir primero la unidad base de cada producto: kg, g, litro, unidad, etc. No
se cambia el símbolo de una unidad existente; crear otra. No se cambia la unidad
base de un producto con existencia física. La receta guarda unidad ingresada,
factor explícito, cantidad base y nombres históricos. Ejemplo: 1000 g × 0.001 =
1 kg. El factor se define para ese ingrediente; el sistema no adivina densidad,
peso de una pieza ni equivalencias entre dimensiones. El stock conserva precisión
de 0.01 de la unidad base: una conversión con más decimales se rechaza, no se
redondea silenciosamente. Para consumos de gramos pequeños, usar g como unidad base.

Publicar crea una versión inmutable; editar requiere la revisión vigente y crea
otra. Apertura/publicación y planificación tienen claves de reintento. Una nueva
producción exige versión vigente; una ya planificada conserva su versión y sus
cantidades aunque se publique otra. Ingredientes repetidos o producto resultado
como ingrediente de sí mismo se rechazan. Las preparaciones intermedias son
productos con su propia receta y se producen por separado; consumirlas después
no vuelve a consumir su materia prima. No hay expansión recursiva automática.

Planificar no reserva ni descuenta. Iniciar registra todos los consumos reales
en unidad base (por defecto los teóricos), descuenta en una sola transacción y
congela el resultado. Si falta un ingrediente, no descuenta ninguno. Finalizar
registra producción real y, cuando corresponda, lote/vencimiento del preparado.
Reintentar no repite consumo ni producción; cambiar los datos del reintento
produce conflicto. Cancelar exige motivo; después del inicio no restaura materia
prima. Una producción completada se corrige mediante operaciones de stock
registradas, no reescribiendo la receta o la tanda.

### Lotes, vencimientos y disponibilidad

La recepción de compra permite código de lote y fecha por ítem. Repetir una
recepción con otros datos o lotes devuelve conflicto. No repetir el mismo ítem
dentro de una recepción/devolución: se rechaza para evitar saldos inconsistentes.
La entrada manual de Lotes y control no genera compra ni obligación al proveedor.

El saldo anterior al despliegue se conserva como existencia sin lote. Usar
«Clasificar existencia sin lote» para asignarle código y fecha, sin aumentar el
inventario. Después puede activarse «Exigir lotes», que requiere identificar
el saldo de todos los almacenes. Desde entonces toda entrada debe declarar lote;
no se convierten registros previos en lotes inventados. El vencimiento de un
código existente no se modifica. Se permiten entradas físicas ya vencidas para
registrar y retirar existencias reales; no se habilitan para consumo.

Las salidas consumen primero el lote apto con vencimiento más próximo (FEFO),
después los aptos sin fecha y, solo si el producto lo permite, el stock sin lote.
La fecha es inclusiva hasta terminar ese día en America/La_Paz. Vencidos o
bloqueados no se venden ni se usan en producción o consumo del personal.
Menú y revisión previa muestran stock utilizable; las ventas vuelven a comprobarlo
en la transacción de confirmación. El saldo físico puede ser mayor que el
vendible. Los reportes comerciales anteriores siguen mostrando existencia física;
para revisar aptitud usar Lotes y control.

Las transferencias conservan códigos, bloqueo, fechas y cantidades, incluso para
trasladar vencidos sin habilitarlos. Devoluciones de venta sin preparar restauran
los lotes consumidos y conservan el vencimiento: una devolución posterior al
vencimiento vuelve a stock físico, no a disponible. La preparación iniciada
conserva la política de no reponer comida ya preparada. Una devolución histórica
sin lote identificable, para un producto que ahora exige lotes, ingresa bloqueada
como `DEVOLUCION-SIN-LOTE`; requiere revisión física y no se vende automáticamente.
La devolución a proveedor admite `lotId` opcional por línea en API; si se omite,
selecciona por vencimiento incluyendo vencidos. Confirmar físicamente qué lote se
entrega al proveedor; la pantalla previa de devolución conserva selección automática.

«Ver historial» consulta los últimos 100 movimientos del lote, con entradas,
salidas, cantidad, motivo y referencia a venta, compra, traslado o producción.
La clasificación inicial queda en el historial de control porque no mueve stock.
No se fabricó trazabilidad de movimientos anteriores a esta entrega.

### Conteos, mermas y personal

Conteos con lotes se realizan por lote. En stock sin lotes puede contarse el total.
Enviar la existencia observada junto con la cantidad contada; si otro movimiento
cambió el saldo, se rechaza y exige volver a revisar. La diferencia se registra
como ajuste, con signo correcto en el historial, motivo y actor. Cero diferencias
también deja constancia del conteo. Merma retira stock incluso vencido/bloqueado;
consumo de personal solo usa aptos. Ambos conservan kardex, costo de referencia
y clave de reintento. No registran ventas ni movimientos de caja.

### Costos y límites

Se guardan costo de referencia de la versión y precios de ingredientes vigentes
al planificar. El costo teórico escala cantidades de la receta; el costo del
consumo real usa cantidades efectivamente descontadas por esos precios congelados.
El rendimiento compara preparado real con previsto; costo unitario real divide
el consumo valorizado entre la producción real (cuatro decimales). La interfaz
muestra diferencia total y rendimiento. No es costeo contable FIFO/promedio,
no incluye mano de obra/energía ni recalcula automáticamente el costo maestro del
preparado o de una preparación intermedia. Mantener esos costos de referencia
actualizados antes de planificar. Conciliación de márgenes/costos contables es
trabajo posterior de gestión, no una capacidad fiscal de esta entrega.

API: GET/POST `/restaurant/recipes`, PATCH `/restaurant/recipes/:id`,
GET/POST `/restaurant/recipes/runs`, POST `/restaurant/recipes/runs/:id/status`;
GET/POST `/inventory/control`, POST `/inventory/control/products/:id/tracking`,
GET `/inventory/control/lots/:id/movements`. Operaciones nuevas usan claves de
reintento y el historial se registra en la misma transacción. Bloqueos por producto
y empresa serializan los movimientos también entre almacenes; los consumidores
de varios productos adquieren sus bloqueos ordenados para evitar interbloqueos.

Despliegue: migración `20261105050000_recipes_lot_inventory` con rol administrativo,
backend y después frontend. Seis tablas nuevas con RLS forzado y claves compuestas
por empresa. Se conservan inventario, compras y pedidos anteriores. Respaldar y
aplicar en ventana de mantenimiento; la aplicación conserva `app_user`. No se
validó aún en la pollería ni se habilitó operación offline o impresión física.
