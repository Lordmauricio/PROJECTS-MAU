# Informe de etapa 3 — menú y POS de mostrador

Fecha: 4 de noviembre de 2026, horario de Bolivia.

## Estado y alcance

Entrega técnica implementada y validada. Se conserva pendiente la revisión del
menú, precios y presentaciones reales del negocio piloto. El usuario autorizó
continuar desde la etapa 2 manteniendo su prueba presencial pendiente; esa etapa
no se marca como cerrada por esta entrega.

## Cambios y correcciones

- Presentaciones opcionales del menú (cuarto, medio, entero u otras), con precio
  y composición independientes. Aparecen en caja y en el historial del pedido y
  recibo, sin alterar pedidos ya guardados.
- Los nuevos pedidos conservan el precio de catálogo de referencia de cada
  componente. No se suma al cobro ni se presenta como un costo histórico o margen.
- Revisión previa del total y stock mediante `/restaurant/quote`, compartiendo
  el cálculo de guardado. No crea ventas ni pagos ni reserva existencias.
- La revisión suma ingredientes compartidos entre todas las líneas y devuelve
  faltantes. El POS revisa también antes de guardar un pedido nuevo y conserva
  el carrito editable si falta stock.
- Se permite personalizar un plato con guarnición agotada y elegir una sustitución
  disponible. La existencia se confirma según la selección, no solo el plato base.
- Disponibilidad por porciones con Decimal: 0.30 unidades / 0.10 por porción da
  tres porciones. Se conserva la comprobación definitiva al cobrar.
- Recuperación de un pedido incierto mediante su misma clave, incluso cuando
  cambió el stock después del intento inicial. Los reintentos no repiten cobros.

## Validación

- Backend completo: 34 suites y 329 pruebas aprobadas, siete nuevas para esta
  entrega. Incluyen presentaciones históricas, revisión sin efectos, componentes
  compartidos, sustituciones, decimales, permisos/tenant y última porción concurrente.
- Cuatro recorridos con servicios reales: comercial; combo con presentación,
  extra y pago mixto; administración móvil; faltantes y sustitución desde el POS.
- Frontend: 11 pruebas unitarias y 14 regresiones de navegador.
- Compilación, TypeScript, análisis estático y verificación independiente de
  aislamiento forman parte de las comprobaciones de esta entrega.

Las revisiones de disponibilidad no son reservas: dos cajas pueden obtener una
revisión positiva para la última porción. La prueba concurrente comprueba que
solo una logra cobrarla y que la otra conserva su pedido sin pago ni consumo.

## Entrega y despliegue

Incluye migración `20261105020000_menu_presentations`, nullable y aditiva. Publicar
backend y migración antes del frontend que usa la nueva ruta. No se desplegó a
producción. El commit y la confirmación de git push se informan en el chat una
vez verificado el SHA remoto.

## Cierre y siguiente paso

**Etapa completa: no.** El núcleo técnico cumple el recorrido de vender un combo,
cobrarlo una vez y conservar presentación, composición y precios; falta confirmar
el catálogo comercial real del piloto.

**Podemos pasar a la siguiente etapa: sí, para continuar el desarrollo técnico**,
con estos pendientes visibles antes del piloto real. La etapa 4 debe completar
estaciones independientes y producción por tandas; las pruebas presenciales e
impresión física siguen pendientes. Esta entrega no habilita operación offline,
QR automático ni facturación SIN.
