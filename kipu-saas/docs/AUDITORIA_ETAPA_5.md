# Auditoría de salón, caja e integridad — etapa 5

Fecha: 5 de noviembre de 2026 (America/La_Paz).

## Alcance y método

Revisión del código y pruebas de los flujos nuevos de salón y de su integración
con pedidos, cocina, ventas, inventario y caja. Se revisaron autorizaciones,
tenant/RLS, relaciones, bloqueos, reintentos, precisión monetaria, dependencias
y migración aditiva. Se usan PostgreSQL, Redis, API y Chromium locales reales.
No es una certificación de seguridad ni una auditoría externa de toda la plataforma.
No se inspeccionó infraestructura productiva, no se hicieron ataques externos ni
se confirmaron SMTP, proveedores de pagos, SIN o impresión física.

## Hallazgos corregidos

| Hallazgo | Efecto | Corrección |
| --- | --- | --- |
| Clave de pago repetida con método o monto distinto | El servidor respondía con el pago anterior sin señalar el cambio | Conflicto 409 en pagos y confirmaciones, conservando el reintento idéntico |
| Cobro de salón en efectivo sin caja abierta | Podía existir pago sin ingreso en el arqueo | Requiere movimiento en caja en la misma transacción; si falta caja se revierte el pago |
| Reembolso de salón en efectivo sin caja o sin saldo | Podía quedar devolución financiera sin egreso de caja | Se revierte la devolución completa si el egreso no puede registrarse |
| Asignación de mesero por la apertura | Podía eludirse el permiso de reasignación | Abrir a nombre de otro operador también exige autorización de encargado |
| Reintentos y consumo al enviar/cobrar | Riesgo de consumir stock en envío y nuevamente al cobrar | Envío confirma y descuenta una vez; pagos posteriores no reconfirman inventario |
| Unión simultánea en sentidos opuestos | Riesgo de bloqueo circular | Bloqueo ordenado por identificador, versiones y conflicto para la operación obsoleta |
| Compatibilidad de claves de pedidos previos | Cambiar la huella de mostrador invalidaría reintentos históricos | Se conserva exactamente la huella anterior cuando no hay cuenta de salón |

Los últimos tres son riesgos identificados y prevenidos durante el desarrollo,
no incidentes productivos. Las políticas nuevas de efectivo se aplican a salón;
las ventas comerciales previas conservan la política documentada en architecture.md.

## Dependencias de producción

`npm audit --omit=dev --json` reportó inicialmente 14 entradas en backend
(una crítica, diez altas, tres moderadas) y tres en frontend (una crítica y dos altas).
Son entradas del árbol de dependencias, no necesariamente vulnerabilidades únicas
ni demostración de que una aplicación concreta sea explotable.

Se actualizaron Next.js y eslint-config-next a 16.4.5; Prisma/generador/adaptador
alineados a 7.10.1; Nest plataforma Express a 11.2.8; Nodemailer a 10.3.1;
y las dependencias transitivas corregibles mediante lockfiles. Overrides acotados:
Multer 2.5 y UUID 11.1.1 bajo ExcelJS (se mantiene ExcelJS 4.4; no se acepta la
recomendación automática de bajarlo a 3.4). Se valida exportación XLSX con la suite.
La actualización de correo no confirma entrega SMTP real. El build de Next.js
usa Webpack, opción oficial, tras un fallo de puertos internos de Turbopack en
el entorno de compilación; no se revierte a una versión vulnerable.

Resultado de auditoría de dependencias de producción: **cero avisos en ambos
paquetes**, según el registro consultado en esta fecha. Debe repetirse periódicamente.
Los lockfiles forman parte de la entrega; no basta con cambiar node_modules.

## Pendiente de herramientas de desarrollo

La revisión completa del backend, incluyendo herramientas de desarrollo, conserva
**27 entradas: 25 moderadas y dos bajas; cero altas/críticas**. Se propagan desde
minimatch/glob/deepmerge hacia Jest, Nest CLI y TypeScript ESLint. No se resolvieron
forzando cambios mayores de herramientas dentro de esta etapa. Preparar una
actualización específica de CLI/Jest/ESLint y repetir compilación, generación y
suite completa. No procesar proyectos o configuraciones no confiables en CI.
No presentar este resultado como «todas las dependencias sin vulnerabilidades».

## Controles y límites

- Rol Mesero sin permisos para cobrar, anular ventas o configurar mesas.
- Lecturas y escrituras tenant mediante transacción; RLS habilitado y forzado
  en las tablas nuevas; FK compuestas impiden relacionar cuenta/mesa/pedido de
  otra empresa. Referencias de sucursal, almacén y terminal se validan en servidor.
- Cantidades e importes de menú se resuelven en servidor y se conservan en snapshots.
- Cierre bloqueado con deuda, preparación o entrega pendientes; propina separada
  de las ventas y registrada una sola vez. No hay devolución automática de propina.
- División por comandas completas: conserva pagos y venta original, no fracciona
  líneas pagadas ni mueve dinero entre ventas.
- No hay operación offline, actualización push del tablero ni reserva antes del
  envío. El tablero se actualiza manualmente. Reintento de respuesta incierta en
  la misma pestaña; recuperar el estado antes de repetir una operación tras recargar.
- La asignación de mesero no restringe visibilidad entre empleados de la empresa;
  el control de acceso separa roles y empresas. Los cambios quedan auditados.

La evidencia de pruebas y el estado de publicación están en `INFORME_ETAPA_5.md`.
