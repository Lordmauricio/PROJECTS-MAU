# KIPU gastronómico — plan de implementación

Ubicación del piloto: Cochabamba, Bolivia. Mercado: restaurantes, comida rápida y
pollerías. Moneda BOB, importes mostrados en Bs con dos decimales; zona horaria
America/La_Paz. Estas son decisiones de producto; su aplicación a todas las
pantallas se verificará durante la implementación.

Se continúa sobre KIPU SaaS y se conserva el aislamiento entre empresas, RBAC,
auditoría y precisión monetaria del backend. PROJECT_PLAN.md documenta el sistema
comercial previo; sus marcas de completitud no sustituyen la validación actual.

## 1. Estabilizar la base — en curso

- [x] Eliminar la descarga de fuentes externas durante la compilación del frontend.
- [x] Restaurar sesiones sin errores por JSON dañado o almacenamiento inaccesible.
- [x] Sincronizar sesión y cierre entre pestañas mediante suscripción al navegador.
- [x] Compilar frontend y verificar por HTTP formularios de acceso y registro.
- [x] Corregir los errores y advertencias de ESLint del frontend sin desactivar reglas.
- [ ] Completar Prisma, migraciones, roles y seed con verificación de integridad.
- [ ] Ejecutar suite backend y verificación de aislamiento con PostgreSQL y Redis.
- [ ] Recorrer registro, login, venta, devolución, compras y cierre por API y UI.

Cierre de etapa: compilación y análisis estático limpios, pruebas ejecutadas y
flujos comerciales verificados; los fallos conocidos deberán quedar descritos.

## 2. Experiencia visual

Diseñar flujo táctil de caja, menú por categorías, carrito siempre visible y
estados de carga, error y agotado. Definir colores, tipografía y componentes con
contraste, foco visible, etiquetas y navegación por teclado. Adaptar caja a tablet
y computadora; administración a móvil. Validar diseños con datos reales.

Decidir arquitectura de contingencia antes de cerrar el diseño técnico: caja,
cocina e impresión local durante cortes de internet y posterior sincronización.
No se ha implementado ni prometido funcionamiento offline en la base existente.

## 3. Menú y POS de mostrador

Categorías, presentaciones, combos, extras y sustituciones con precios validados
por servidor. Separar pedido, preparación y pago. Soportar salón/para llevar,
pagos mixtos, cambio, descuentos autorizados y recibos no fiscales. QR manual
inicialmente, identificado como tal; confirmación automática requiere proveedor.

Cierre: vender un combo de pollo, cobrar una sola vez y conservar el detalle y
precio histórico de todos sus componentes.

## 4. Cocina y despacho — primer piloto

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

## Evidencia de estabilización — 4 de noviembre de 2026

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
