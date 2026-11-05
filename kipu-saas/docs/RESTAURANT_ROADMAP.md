# KIPU gastronómico — plan de implementación

Ubicación del piloto: Cochabamba, Bolivia. Mercado: restaurantes, comida rápida y
pollerías. Moneda BOB, importes mostrados en Bs con dos decimales; zona horaria
America/La_Paz. Estas son decisiones de producto; su aplicación a todas las
pantallas se verificará durante la implementación.

Se continúa sobre KIPU SaaS y se conserva el aislamiento entre empresas, RBAC,
auditoría y precisión monetaria del backend. PROJECT_PLAN.md documenta el sistema
comercial previo; sus marcas de completitud no sustituyen la validación actual.

## 1. Estabilizar la base — validada localmente

- [x] Eliminar la descarga de fuentes externas durante la compilación del frontend.
- [x] Restaurar sesiones sin errores por JSON dañado o almacenamiento inaccesible.
- [x] Sincronizar sesión y cierre entre pestañas mediante suscripción al navegador.
- [x] Compilar frontend y verificar por HTTP formularios de acceso y registro.
- [x] Corregir los errores y advertencias de ESLint del frontend sin desactivar reglas.
- [x] Completar Prisma, migraciones, roles y seed con verificación de integridad.
- [x] Ejecutar suite backend y verificación de aislamiento con PostgreSQL y Redis.
- [x] Recorrer registro, login, venta, devolución, compras y cierre por API y UI.

Cierre de etapa: compilación y análisis estático limpios, pruebas ejecutadas y
flujos comerciales verificados; los fallos conocidos deberán quedar descritos.

## 2. Experiencia visual — entrega técnica validada, campo pendiente

- [x] Menú por categorías, búsqueda, tarjetas táctiles y estados de disponibilidad.
- [x] Carrito lateral en tablet/computadora y acceso fijo al pedido en móvil.
- [x] Navegación adaptable, etiquetas, foco visible y errores recuperables.
- [x] Decisión de contingencia: `OFFLINE_ARCHITECTURE.md`.
- [x] Revisión móvil de tablas y formularios administrativos; navegación por teclado.
- [x] Inicio con accesos operativos y recuperación de errores; Reportes adaptable.
- [x] Pruebas de interfaz y recorrido de administración con servicios reales.
- [ ] Validación presencial con cajero y encargado del negocio piloto.

Informe: `INFORME_ETAPA_2.md`. Criterios y protocolo de campo:
`EXPERIENCIA_VISUAL.md`. La validación técnica no cierra la prueba presencial.
El usuario autorizó continuar con la etapa 3 y mantener esta prueba aplazada.


Diseñar flujo táctil de caja, menú por categorías, carrito siempre visible y
estados de carga, error y agotado. Definir colores, tipografía y componentes con
contraste, foco visible, etiquetas y navegación por teclado. Adaptar caja a tablet
y computadora; administración a móvil. Validar diseños con datos reales.

Decidir arquitectura de contingencia antes de cerrar el diseño técnico: caja,
cocina e impresión local durante cortes de internet y posterior sincronización.
No se ha implementado ni prometido funcionamiento offline en la base existente.

## 3. Menú y POS de mostrador — entrega técnica validada, catálogo real pendiente

- [x] Menú configurable, combos, componentes por porción, extras y sustituciones.
- [x] Precios del servidor y descuentos restringidos a encargados.
- [x] Pedidos separados del cobro, salón/para llevar, pagos mixtos y cambio.
- [x] QR manual identificado y vínculo al recibo comercial no fiscal existente.
- [x] Snapshots históricos y reintentos de pedido/cobro sin duplicación.
- [x] Presentaciones identificadas y precio de referencia histórico por componente.
- [x] Menú y precios editables por el encargado, incluidos cambios de temporada,
  altas de platos y pausa de disponibilidad, conservando los pedidos anteriores.
- [x] Revisión previa de precios y faltantes de todo el carrito en servidor.
- [x] Sustitución de guarniciones agotadas y disponibilidad decimal por porción.
- [x] Concurrencia de la última porción sin doble cobro ni consumo.
- [ ] Validación comercial de todas las presentaciones del menú del piloto.

Informe: `INFORME_ETAPA_3.md`. La etapa 2 conserva su prueba de campo pendiente.


Categorías, presentaciones, combos, extras y sustituciones con precios validados
por servidor. Separar pedido, preparación y pago. Soportar salón/para llevar,
pagos mixtos, cambio, descuentos autorizados y recibos no fiscales. QR manual
inicialmente, identificado como tal; confirmación automática requiere proveedor.

Cierre: vender un combo de pollo, cobrar una sola vez y conservar el detalle y
precio histórico de todos sus componentes.

## 4. Cocina y despacho — entrega técnica validada, piloto físico pendiente

- [x] Tablero por estado con filtros de sucursal y estación.
- [x] Preparación → listo → entrega, con control de versión y eventos auditados.
- [x] Solicitudes de impresión/reimpresión identificadas.
- [x] Stock de componentes y devoluciones según inicio de preparación.
- [x] Recorrido completo con servicios reales y pagos mixtos en Chromium.
- [x] Producción por tandas con consumo de crudo y registro de producción real.
- [x] Estados y versiones independientes por estación; entrega solo con todas listas.
- [x] Comandas filtradas con copias por estación y tiempos de preparación.
- [x] Devoluciones reponen únicamente componentes de estaciones sin iniciar.
- [x] Concurrencia, reintentos, permisos y recorrido de tanda a cierre con servicios reales.
- [ ] Prueba en pollería con operadores e impresoras físicas (aplazada).

Informe: `INFORME_ETAPA_4.md`. La entrega técnica no equivale al piloto presencial.


Comandas por estación, estados de preparación, tiempos, cambios y cancelaciones
auditadas; impresiones y reimpresiones identificadas. Producción por tandas y
disponibilidad de pollo según las porciones que maneje el negocio.

Cierre: pedido → cobro → cocina → entrega → cierre de caja en una pollería de una
sucursal. Verificar reintentos, pedidos simultáneos, errores de red y permisos.
El cierre de caja existente debe seguir funcionando durante todas las etapas.

## 5. Salón y mesas

Mapa de mesas, meseros, cuentas abiertas, pedidos adicionales, traslado de mesa,
división y unión de cuentas, propinas. Verificar atención simultánea y permisos.

## 6. Recetas, producción y stock

Ingredientes, conversiones, rendimientos, preparaciones intermedias y recetas
versionadas. Definir reserva/consumo de stock y tratamiento de cancelaciones ya
preparadas. Compras, conteos, lotes, vencimientos, mermas y consumo del personal.
Comparar costo teórico y real; impedir consumo duplicado al reintentar.

## 7. Caja y gestión

Turnos, arqueos, gastos, retiros, diferencias y conciliación por método de pago.
Cuentas de proveedores y reportes de margen bruto, desperdicio y tiempos. Mostrar
fechas del negocio en America/La_Paz y montos BOB de forma consistente.

## 8. Delivery y pedidos digitales

Zonas y tarifas configurables en Cochabamba, direcciones y referencias,
repartidores, retiro en local y menú QR. Confirmación antes de cocina, promociones
y fidelización. Integraciones sujetas a acceso técnico y comercial disponible.

## 9. Fiscal y continuidad

Investigar normativa vigente y modalidad SIN antes de implementar documentos
fiscales. Mantener separados pedido, venta, recibo comercial y documento fiscal.
Credenciales y habilitación son requisitos externos; nunca inventar reglas SIN.
Validar impresoras, respaldos/restauración, monitoreo, recuperación y contingencia.

## 10. SaaS comercial

Alta guiada, planes y límites, suscripciones con proveedor elegido, soporte
auditado y capacitación. Separar cobros de la suscripción de KIPU de los pagos que
recibe cada restaurante. No habilitar cobros reales sin requisitos y validación.

## Evidencia previa de estabilización — 4 de noviembre de 2026

El bloqueo de Prisma descrito aquí se resolvió en la validación posterior.

- Frontend: `npm run lint` pasa sin errores ni advertencias. Se conservan las
  reglas de React; las cargas utilizan un hook compartido que descarta respuestas
  obsoletas y callbacks de pantallas desmontadas.
- Frontend: build de producción, TypeScript y generación de páginas completados.
- `npm run test:unit`: 11 casos aprobados de sesión y concurrencia de peticiones.
- `npm run test:browser`: 8 casos aprobados en Chromium: sesión dañada, recuperación
  tras error HTTP, carga de caja/inventario/notificaciones, cambio de reporte sin
  filtros anteriores, logout entre pestañas y respuestas de ventas fuera de orden.
  Usan API simulada; NO demuestran integridad de ventas, caja ni aislamiento RLS.
- Backend: 17 pruebas de validación de configuración aprobadas.
- Backend bloqueado: `prisma generate` y la variante oficial `--no-engine` reciben
  HTTP 403 al descargar el motor/checksum desde binaries.prisma.sh. Se mantiene la
  verificación TLS y de integridad. El dominio está guardado en el borrador del
  entorno, pero la política aplicada aún no lo incluye.
- `npm run build` del backend falla por ausencia de generated/prisma/client y
  errores derivados de tipos. Su análisis estático tampoco permite cerrar la
  validación sin el cliente generado. No se han corregido como supuestos defectos
  miles de diagnósticos derivados de ese prerrequisito ausente.
- Migraciones, seed, autenticación real, suite comercial y aislamiento entre
  empresas permanecen sin validar. La etapa 1 continúa abierta.
- No se ha desplegado a producción ni publicado una nueva imagen del entorno.

### Cómo reanudar el backend

Aplicar en la configuración del entorno el dominio pendiente binaries.prisma.sh.
Después, desde backend/:

```bash
npm ci --no-audit --no-fund
npx prisma migrate deploy
npm run db:provision-roles
npx prisma db seed
npm run build
npm test -- --runInBand
npm run verify:tenant-isolation
```

Usar PostgreSQL y Redis locales y la configuración ignorada existente; no imprimir
secretos ni sobrescribir una base de datos de producción. Volver a ejecutar el
análisis estático del backend con el cliente generado y diagnosticar los errores
que persistan. Finalmente iniciar la API, comprobar /health y /health/ready y
recorrer los flujos comerciales desde navegador con servicios reales.


## Validación del backend retomada — 4 de noviembre de 2026

- La política activa permite `binaries.prisma.sh`; `npm ci` genera Prisma Client
  7.9.1 correctamente, manteniendo TLS y checksums.
- Se prepararon PostgreSQL 16 y Redis 7 locales, con puertos ligados a loopback,
  volumen de PostgreSQL y secretos nuevos en `.env` ignorado. No se restauraron
  datos de la instancia anterior ni se modificó una base de producción.
- Las 12 migraciones se aplicaron; `db:provision-roles` habilitó `app_user` y
  mantuvo `app_superadmin` sin login. Seed: 39 permisos y cuatro planes.
- `npm run build`: aprobado. ESLint del backend: cero errores y advertencias,
  tras corregir formato, tipos de autenticación y transformación, duplicación de
  productos y el tipo del Buffer de la prueba Excel, sin desactivar reglas.
- `npm test -- --runInBand`: 33 suites y 307 pruebas aprobadas con PostgreSQL y
  Redis reales. Incluyen ventas, devoluciones, compras, caja, concurrencia y
  permisos. Comprobación posterior focalizada de ventas y dinero: 21 aprobadas.
- `npm run verify:tenant-isolation`: aprobado por API y SQL sin WHERE, con
  `app_user`, auditoría asíncrona y denegación por defecto de permisos.
- API local: `/health` devuelve `ok`; `/health/ready` confirma base y caché `ok`.
- `test:e2e` no tiene archivos de prueba en `test/`; no constituye validación
  adicional. Las suites de integración anteriores viven en `src/`.
- Queda pendiente recorrer los flujos desde el navegador con la API real. Las
  pruebas anteriores de Chromium usan API simulada. La etapa 1 sigue abierta.
- No se desplegó a producción. Los cambios quedan en el checkout para revisión.


## Evidencia de implementación gastronómica — 4 de noviembre de 2026

- Migración aditiva `20261105010000_restaurant_pilot`: menú, pedidos y eventos
  con RLS forzado; snapshots opcionales en líneas de venta, sin borrar datos.
- Backend: 34 suites, 322 pruebas aprobadas. Las 15 pruebas nuevas cubren combos,
  sustituciones, precios históricos, reintentos concurrentes, pagos mixtos,
  descuentos autorizados, stock insuficiente, devoluciones y aislamiento.
- Verificación independiente de tenant aprobada después de ampliar el esquema.
- Frontend: 11 pruebas unitarias y 8 pruebas de regresión de navegador aprobadas.
- Dos recorridos nuevos con PostgreSQL/Redis/API reales: registro/login,
  compra/recepción, venta/devolución y arqueo; combo con extra, pérdida de respuestas,
  recuperación, cobro mixto, cocina/despacho y cierre con diferencia cero.
- Compilaciones de backend/frontend y análisis estático aprobados en la validación
  de esta entrega. Capturas revisadas en tablet; la suite comprueba desbordes.
- Operación y APIs: `RESTAURANT_OPERATIONS.md`. Contingencia futura:
  `OFFLINE_ARCHITECTURE.md`; no se implementó operación offline.
- Las etapas 5–10 siguen pendientes; esta entrega no completa todo el roadmap.
  No se conectaron proveedores de pagos, SIN ni suscripciones, ni se desplegó.

- Arranque local final comprobado: API en 4200 con `/health/ready` sano y frontend
  compilado en 3000. Se corrigió `start:prod` para usar `dist/src/main.js`.
- Smoke de Chromium en móvil sobre el frontend compilado: formulario de acceso
  visible, sin errores de JavaScript ni desborde horizontal.


## Entrega técnica de etapa 2 — 4 de noviembre de 2026

Administración adaptada a móvil, tablas desplazables, etiquetas persistentes,
controles táctiles, navegación con foco/Escape y estados recuperables en Inicio.
Reportes utiliza un selector compacto en móvil y filtros etiquetados. Se conserva
la arquitectura de contingencia documentada, sin operación offline.

Validación: compilación/TypeScript y ESLint; 11 unitarias; 14 pruebas de navegador
(seis nuevas y ocho regresiones); tres recorridos con servicios reales, incluyendo
administración móvil de Inicio, clientes, productos, caja, compras, reportes,
configuración y usuarios. El protocolo de campo sigue pendiente.


## Entrega técnica de etapa 3 — 4 de noviembre de 2026

Presentaciones, historial de precios por componente y revisión previa del pedido,
sin reservas ni efectos comerciales. Se conserva el cálculo de precios del
servidor y la confirmación atómica de stock/pago. Migración aditiva de presentación.

Validación: 329 pruebas backend (34 suites), cinco recorridos de navegador con
servicios reales, 11 unitarias frontend y 14 regresiones de interfaz. Se verifican
compilaciones, análisis estático y aislamiento. Catálogo real del piloto y prueba
presencial aplazados; no se marca la etapa completa ni se despliega a producción.


## Entrega técnica de etapa 4 — 4 de noviembre de 2026

Estaciones independientes, impresión filtrada con copias por ámbito, tiempos y
producción por tandas. Las tandas consumen crudo al iniciar y registran preparado
real al completar; el menú consume el preparado por porciones. Cancelar una tanda
iniciada no restaura materia prima. Una devolución de pedido repone solo estaciones
sin iniciar. No se implementaron aún lotes, vencimientos ni costeo avanzado.

Validación: 339 pruebas backend en 35 suites; seis recorridos con servicios reales;
11 unitarias frontend y 14 regresiones de navegador; compilación, Prisma, ESLint
verificados y aislamiento de tenant aprobado. Migración aditiva con backfill de
comandas para pedidos existentes, aplicada únicamente a la base local de pruebas.
El servidor HTTP de integración se mantiene abierto por suite para evitar cierres
concurrentes al emitir recibos. Prueba presencial e impresoras pendientes; sin
producción desplegada. El siguiente bloque técnico es salón y mesas (etapa 5).
