# Decisión de contingencia gastronómica

## Estado de esta entrega

La caja, cocina y confirmación de pagos requieren conexión al servidor. No se
confirman ventas localmente ni se promete stock disponible durante un corte.
La pantalla conserva un intento incierto para reintentar su misma clave y permite
recuperar borradores del servidor. Esto es recuperación de red, no operación offline.

## Arquitectura elegida para una futura entrega offline

La sucursal tendrá un servidor local que sea la autoridad única de su operación
durante el turno. Caja, cocina e impresión hablarán con ese servidor a través de
la red local. El navegador no será una segunda autoridad para cobros o stock.
El servidor local sincronizará con el SaaS mediante una bandeja de eventos
persistente, claves únicas por empresa/sucursal/dispositivo e identificadores
de operación generados antes del envío.

Antes de activar esta modalidad se implementará una asignación explícita de
autoridad por sucursal que impida que el SaaS y el servidor local cobren o consuman
el mismo stock simultáneamente. La pérdida de conectividad no autorizará por sí
sola a un segundo servidor a tomar control. Se necesita un procedimiento de
recuperación con bloqueo del escritor anterior y conciliación de operaciones.

Las recetas y precios se distribuirán en versiones. Cada pedido conservará la
versión y el precio aceptados al crearse. La sincronización será reintentable y
deduplicada, con confirmaciones persistentes y sin resolver conflictos monetarios
mediante sobrescritura de la última edición. Los conflictos se enviarán a una
bandeja de conciliación con trazabilidad.

La impresión local usará trabajos persistentes con ID y número de copia. Un fallo
después de enviar al dispositivo se marcará como resultado incierto; un operador
decidirá la reimpresión identificada. QR automático, fiscalidad y pagos con tarjeta
dependerán de las garantías offline que ofrezca cada proveedor; no se simulará su
confirmación.

## Condiciones de activación

Probar corte de internet con LAN disponible, reinicio y reemplazo del servidor,
disco lleno, doble envío, pérdida de respuestas, reconexión, reloj incorrecto y
reintentos de impresión. Verificar que cada cobro y consumo aparece exactamente
una vez después de sincronizar y que ninguna empresa accede a datos de otra.
Probar respaldo y restauración del servidor local antes del piloto offline.

Esta decisión fija la dirección técnica; la instalación local, la sincronización
y los mecanismos de autoridad todavía no están implementados.
