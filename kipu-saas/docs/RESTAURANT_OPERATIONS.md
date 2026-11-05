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
  devolución de venta. Antes de preparación, repone sus componentes; después de
  iniciarla, devuelve dinero sin reponer comida preparada. La decisión queda
  registrada en el evento del pedido y el movimiento financiero conserva su
  auditoría. No equivale todavía a un módulo completo de mermas o producción.
- Las solicitudes de impresión quedan numeradas. Las copias posteriores llevan
  REIMPRESIÓN; el navegador no confirma que el papel haya salido físicamente.

## Permisos y límites actuales

Se reutilizan los permisos existentes: `products.read/create/update` para menú;
`sales.read/create/update/delete` para consulta, cobro, cocina y cancelación.
El cajero puede consultar y cobrar; el encargado administra menú y cocina.
Las tres tablas nuevas tienen RLS forzado por empresa. Sus eventos se escriben
en la misma transacción que el cambio de estado.

La preparación se controla por pedido completo. El filtro de estación muestra
sus líneas, pero el operador debe coordinar todas las estaciones antes de cambiar
el estado global. La consulta muestra hasta 100 pedidos. No hay todavía estados
independientes por estación, producción por tandas, mesas/cuentas abiertas,
delivery, lotes/vencimientos ni facturación SIN. Los reportes agrupan los combos
por su producto de venta; no presentan todavía un desglose de costo por receta.

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
- `POST /restaurant/orders/:id/cancel`: requiere motivo; solo antes del cobro.
- `POST /restaurant/orders/:id/print`: registra una solicitud y devuelve la copia.

La migración es aditiva: agrega menú, pedidos/eventos y dos columnas opcionales
en líneas de venta. Las ventas existentes conservan el consumo directo de su
producto. No requiere reemplazar ni borrar datos existentes.

La ampliación de etapa 3 agrega una migración aditiva:
`20261105020000_menu_presentations`, con `menu_entries.presentation` nullable.
Desplegar primero el backend compatible y aplicar sus migraciones, después el
frontend que consulta `/restaurant/quote`. Respaldar la base antes de migrar un
entorno con datos. Las entradas anteriores siguen funcionando sin presentación.

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
