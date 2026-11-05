# Informe de etapa 5 — salón y mesas

Fecha: 5 de noviembre de 2026, horario de Bolivia.

## Estado

Implementación técnica de salón y mesas. Validación presencial con meseros,
cajero y encargado pendiente; se conserva el aplazamiento del piloto y las
pruebas de campo de etapas anteriores. No se desplegó a producción.

## Entrega

- Mapa por zona y sucursal, capacidad, mesas libres/ocupadas, alta y edición.
- Cuentas abiertas y mesero asignado; nuevo rol Mesero, sin facultad de cobro.
- Comandas adicionales con precio del servidor y snapshot histórico. Envío a
  cocina antes del pago, con confirmación y consumo de stock en una transacción.
- Traslado, división por comandas completas y unión sin alterar ventas ni pagos.
  Versiones y bloqueos ordenados ante atención simultánea.
- Pagos parciales/mixtos por comanda; cierre solo con consumo cobrado y entregado
  o anulado. Propina voluntaria separada de venta, con ingreso único en caja si
  es efectivo. La mesa sigue ocupada si otra cuenta permanece abierta.
- Cocina y comanda identifican mesa, cuenta y mesero. Se mantiene el pago previo
  del mostrador y las estaciones independientes de etapa 4.
- Migración aditiva con RLS forzado y relaciones compuestas por empresa; permite
  pedidos anteriores sin cuenta y mantiene sus claves de reintento históricas.

## Auditoría y correcciones

Ver `AUDITORIA_ETAPA_5.md` para alcance, hallazgos y límites. Se corrigieron
reintentos con datos de pago diferentes, cobros/reembolsos de salón sin movimiento
de efectivo, y asignación de otro mesero sin autorización al abrir la cuenta.
Se verifican aislamiento, rollback por falta de stock y cierre con deuda/entrega
pendiente; no se vuelve a consumir inventario al cobrar ni mover cuentas.

Se actualizaron dependencias afectadas, incluidos Next.js, Prisma y Nodemailer,
y se conservan lockfiles reproducibles. La revisión de producción registra cero
avisos en backend/frontend; la revisión que incluye herramientas de desarrollo
del backend conserva 27 entradas bajas/moderadas. Su actualización mayor queda
como mantenimiento pendiente, sin afirmar seguridad total del sistema.

## Evidencia técnica

- Backend: 36 suites, 356 pruebas, incluidas 17 nuevas de salón/auditoría.
- Frontend: 11 pruebas unitarias y 14 regresiones de interfaz en Chromium.
- Siete escenarios de navegador con servicios reales aprobados: los seis
  anteriores en la suite de regresión y salón completo en ejecución focalizada
  en móvil tras estabilizar los selectores de la prueba. Dos comandas de Bs 25,
  división, traslado y unión; cocina entrega antes del cobro; Bs 10 QR + Bs 40
  efectivo y Bs 5 de propina. Con apertura Bs 100, arqueo Bs 145 y diferencia cero.
  Inventario inicial 10, final 8: se consumen dos platos, una sola vez cada uno.
- Compilación/TypeScript y ESLint de ambos proyectos; Prisma válido y verificación
  independiente de aislamiento de tenant. Captura móvil revisada y sin desborde.
  El artefacto standalone compilado también sirve el login en Chromium móvil,
  sin errores JavaScript ni desbordes; no equivale a desplegarlo en producción.
- Migración aplicada solo a PostgreSQL local de desarrollo verificado, con Redis
  local; no se modificaron bases de producción ni se publicaron credenciales.

El build de frontend usa la opción oficial `next build --webpack`: Turbopack
16.4.5 falló al abrir su puerto interno de transformación CSS en este entorno.
Se conserva la versión de seguridad y se valida el artefacto standalone con el
compilador alternativo soportado. El servidor de desarrollo mantiene Turbopack.

## Despliegue y pendientes

Entregar migración `20261105040000_dining_accounts`, backend y frontend juntos.
Aplicar migración con rol administrativo, después backend y frontend; instalar
con `npm ci` y regenerar Prisma. El servidor mantiene el rol limitado `app_user`.
El commit publicado y su SHA remoto verificado se informan en el chat.

Quedan prueba presencial, impresoras, confirmación del catálogo/precios del
piloto, avisos de desarrollo y validación SMTP externa. La división trabaja con
comandas completas, no con fracciones de líneas ya pagadas. No hay plano con
coordenadas arrastrables, servicio offline ni distribución de propinas al personal.
El historial se conserva por identificador; el tablero lista cuentas abiertas.

## Cierre

**Etapa completa: no.** La implementación y validación técnica no sustituyen la
aceptación presencial con meseros/cajero y la revisión operativa del piloto.

**Podemos pasar a la siguiente etapa: sí, para desarrollo técnico**, conservando
los pendientes y sin habilitar operación productiva por el solo hecho del push.
La etapa 6 corresponde a recetas, rendimientos, conversiones y control avanzado
de producción/stock, sobre la producción por tandas ya existente.
