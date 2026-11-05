# Informe de etapa 4 — cocina y despacho

Fecha: 4 de noviembre de 2026, horario de Bolivia.

## Estado

Entrega técnica de estaciones independientes y producción por tandas implementada.
Las pruebas presenciales con personal e impresoras físicas continúan pendientes;
se mantiene el aplazamiento solicitado por el usuario y no se consideran aprobadas.

## Implementación

- Comandas por estación con versiones propias, preparación y listo independientes.
  El estado del pedido se agrega a partir de todas sus comandas; no se entrega
  mientras alguna siga pendiente. Se conservan acciones conjuntas compatibles.
- Horas de inicio/listo y minutos de cocina; filtros por sucursal y estación.
- Impresión por estación, con sus líneas, nombre, estado y contador de copias.
  Original y reimpresión se distinguen por ámbito: estación o pedido completo.
- Tandas planificadas, inicio con consumo de crudo y finalización con la cantidad
  preparada real. Se usan productos distintos para crudo/preparado y el menú
  consume el preparado según sus porciones.
- Reintentos y concurrencia sin duplicar consumo ni producción. Cancelaciones
  con motivo y auditoría, sin reponer automáticamente crudo ya consumido.
- Devoluciones cancelan las comandas y reponen solo componentes de estaciones
  sin iniciar, manteniendo el consumo de lo que empezó a prepararse.
- Nuevas tablas con RLS forzado y relación de comanda/pedido validada por empresa.
  Migración aditiva con adaptación de pedidos previos sin cobros ni stock repetidos.

## Validación y correcciones

- 35 suites y 339 pruebas backend aprobadas; diez pruebas nuevas de estaciones,
  tandas, versiones, reintentos, devoluciones, permisos y aislamiento.
- Se corrigió el ciclo de vida del servidor de integración: queda abierto por
  suite para evitar desconexiones al emitir recibos concurrentemente.
- Seis recorridos con servicios reales. El nuevo caso planifica una tanda,
  consume cuatro pollos crudos, registra 3.5 preparados y comprueba 14 cuartos
  disponibles; vende un cuarto con bebida, prepara ambas estaciones, imprime
  solo Bebidas, entrega y cierra caja con diferencia cero. El stock final conserva
  seis crudos y 3.25 preparados, sin doble consumo de materia prima.
- 11 pruebas unitarias frontend y 14 regresiones de navegador.
- Compilaciones, TypeScript, ESLint, Prisma y verificación independiente de tenant
  forman parte de las comprobaciones de entrega. Se revisaron capturas en móvil y tablet.

## Límites y despliegue

No hay confirmación de impresión física desde el navegador. No se implementaron
lotes/vencimientos, conversión de unidades, costeo de recetas ni asignación del
consumo de ventas a una tanda concreta: corresponden a la etapa 6. La existencia
disponible es el saldo agregado del producto preparado en su almacén.

Incluye la migración `20261105030000_kitchen_stations_and_batches`. Desplegar primero
backend y migración, luego frontend. No se desplegó a producción. Código, pruebas,
migración e informe se publican juntos; el chat informa el SHA remoto verificado.

## Cierre

**Etapa completa: no.** La implementación técnica está validada; faltan la prueba
con operadores e impresoras físicas y la aceptación del piloto en la pollería.

**Podemos pasar a la siguiente etapa: sí, para desarrollo técnico**, conservando
los pendientes visibles antes del uso real. La etapa 5 corresponde a salón y mesas:
meseros, cuentas abiertas y división/unión de cuentas. La prueba presencial de la
etapa 2 y la confirmación del menú/precios reales de etapa 3 también siguen pendientes.
