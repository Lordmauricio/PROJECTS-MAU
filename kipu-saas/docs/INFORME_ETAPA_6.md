# Informe de etapa 6 — recetas, producción y control de stock

Fecha: 5 de noviembre de 2026, America/La_Paz.

## Estado real

Entrega técnica implementada y validada localmente. Recetas, equivalencias,
rendimientos, fechas de vida útil y conteos deben validarse con el encargado del
piloto. Se conservan aplazadas las pruebas presenciales de etapas anteriores.
No se desplegó a producción ni se modificaron datos productivos.

## Cambios entregados

- Recetas con ingredientes, factor explícito a unidad base y versiones inmutables.
  Publicar/editar y planificar admiten reintentos sin duplicación. Una producción
  planificada conserva su versión y precios aunque se publique otra.
- Preparaciones intermedias como productos preparados: producir primero y después
  consumir su existencia, sin volver a descontar la materia prima original.
- Consumo real de ingredientes atómico al iniciar; producción real al completar.
  Cancelaciones con motivo, sin restaurar materia prima ya consumida.
- Lotes y vencimientos en compra, entrada manual, recetas y tandas previas.
  Clasificar saldos anteriores no aumenta stock; exigencia de lote configurable
  por producto, después de identificar existencias en todos sus almacenes.
- Salidas por vencimiento más próximo entre lotes aptos (FEFO). Menú y revisión
  previa excluyen vencidos/bloqueados; ventas, salón, producción y personal lo
  vuelven a comprobar al consumir, con bloqueo por producto/empresa.
- Transferencias conservan lote y fecha; devoluciones sin preparar restauran los
  lotes originales. Un vencido devuelto no vuelve a estar disponible para venta.
- Conteos con saldo observado y rechazo si cambió; mermas y consumo del personal
  con motivo, actor, kardex, costo de referencia y claves de reintento.
- Historial consultable por lote, incluidas referencias a venta, compra, traslado
  y producción. Operaciones nuevas y auditoría se confirman juntas.

## Costos y alcance

Se comparan cantidades teóricas y reales, su valoración con precios congelados
al planificar, rendimiento y costo por unidad obtenida. Esto no implementa
valuación contable FIFO/promedio ni incluye mano de obra/energía. El costo maestro
de un preparado o de una preparación intermedia no se sobrescribe automáticamente;
actualizar su costo de referencia antes de planificar recetas que lo utilicen.

Las conversiones deben producir cantidades representables con 0.01 de la unidad
base; se rechaza pérdida de precisión. No se infieren densidades ni peso de piezas.
El símbolo de la unidad es estable y no puede cambiarse; el producto no cambia de
unidad con stock físico. No hay reserva al planificar: se valida todo al iniciar.

## Validación y correcciones

- Suite completa: **37 suites y 378 pruebas backend aprobadas**. Incluye 22 casos
  nuevos de receta/versiones, conversiones, rendimiento, stock, permisos, FEFO,
  devoluciones, merma, conteos concurrentes, recepción y RLS. Comprobación final
  focalizada de los 22 tras revisar historial y signo de merma: aprobada.
- **Ocho recorridos de navegador con servicios reales aprobados**. Se mantienen
  mostrador, compras, devoluciones, caja, menú, tandas y salón. Repetición final
  focalizada del nuevo recorrido, incluido historial de lote: aprobada.
- El nuevo recorrido móvil recibe 5 kg aptos y 2 kg vencidos; convierte 1000 g
  a 1 kg en receta, planifica 4 unidades y consume realmente 1.2 kg + condimento.
  Produce 3.5 unidades: rendimiento 87.5 %, costo teórico Bs 12, consumo valorizado
  Bs 14 y costo unitario Bs 4.0000. Vende y devuelve una unidad al lote original;
  retira 1 kg vencido como merma. Saldos finales: 4.8 kg físicos, 3.8 kg aptos y
  3.5 preparados. La caja abre/cierra en Bs 100, diferencia cero.
- **14 regresiones de interfaz y 11 unitarias frontend aprobadas**. Capturas de
  recetas y lotes revisadas en móvil; sin desbordes horizontales en el recorrido.
- Compilaciones de backend/frontend, TypeScript, ESLint, Prisma y comprobación
  independiente de aislamiento. La migración está aplicada en la base local.
  Artefacto standalone iniciado por HTTP y revisado en Chromium móvil: login
  visible, sin errores JavaScript ni desborde; no es despliegue productivo.
- Se corrigieron la aceptación silenciosa de un ajuste reintentado con dirección
  opuesta, ítems repetidos en recepciones/devoluciones y cambios de datos/lote al
  repetir una recepción nueva. Se preservan reintentos de recepciones históricas
  cuyo hash no existía. Nuevas merma/salidas muestran delta negativo en el historial.

## Despliegue y pendientes

Migración aditiva `20261105050000_recipes_lot_inventory`: seis tablas con RLS
forzado, referencias compuestas por empresa y campos compatibles con datos
anteriores. No se inventan lotes ni fechas de existencias históricas. Desplegar
migración administrativa primero, luego backend y frontend; mantener `app_user`
en runtime, instalar con `npm ci` y regenerar Prisma. El build frontend conserva
Webpack y Next.js corregido de etapa 5. El SHA y push verificados se informan en
el chat. No se construyó/publicó una imagen Docker ni se desplegó a producción.

Pendientes: validar recetas, costos de referencia, equivalencias, vida útil y
conteos con el negocio; identificar físicamente el stock anterior; pruebas de
operadores/impresoras de etapas previas. No se incorporan funcionamiento offline,
impresión física validada ni costeo contable. Dependencias no cambiaron: permanece
el mantenimiento de herramientas de desarrollo identificado en la auditoría de
etapa 5; esta entrega no vuelve a certificar todo el árbol de dependencias.

Guía y APIs: `RESTAURANT_OPERATIONS.md`, sección de etapa 6.

## Cierre

**Etapa completa: no.** La entrega técnica está validada; faltan aceptación del
piloto, recetas/vida útil reales y conciliación de conteos con el encargado.

**Podemos pasar a la siguiente etapa: sí, para desarrollo técnico**, manteniendo
estos pendientes antes de operar en producción. La etapa 7 corresponde a caja y
gestión: turnos, arqueos, gastos, retiros, diferencias y reportes operativos.
