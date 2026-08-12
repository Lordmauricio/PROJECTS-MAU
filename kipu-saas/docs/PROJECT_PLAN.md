# Plan de proyecto — KIPU SAAS

## Estado de este documento

Este plan corresponde a la **Parte 1** del prompt maestro (Fase 0 —
investigación/arquitectura — y Fase 1 — Foundation). El usuario indicó que
enviaría una Parte 2 (probablemente Facturación/Fiscal/SIN, Reportes,
Notificaciones, Suscripciones/Pagos) que todavía no llegó al momento de
escribir esto. Cuando llegue, se planifica como fase(s) nueva(s) sin
reabrir lo ya construido y verificado acá.

Este es el **tercer** intento de SaaS de esta sesión (después de
`restaurante-saas-bo` y `bolivia-business-cloud`, ambos eliminados a
pedido explícito del usuario para arrancar KIPU SAAS desde cero). El
patrón de multi-tenancy con RLS ya se había probado y verificado en el
intento anterior, así que acá se reaplica directamente en vez de
re-investigarlo — ver `docs/architecture.md`.

## Fase 0 — Investigación + Arquitectura ✅

- [x] Inspección del entorno (Node 22, PostgreSQL 16, Redis disponibles).
- [x] Decisión de arquitectura (modular monolith) y stack, documentada en
      `docs/architecture.md`.
- [x] Diseño de base de datos completo (todas las entidades del dominio),
      documentado en `docs/database.md`.
- [x] Diseño de seguridad, documentado en `docs/security.md`.

## Fase 1 — Foundation ✅

Entregable: un usuario puede registrar su empresa (con su sucursal, almacén
y punto de venta principales creados automáticamente), invitar usuarios,
asignarles roles con permisos granulares, gestionar clientes, proveedores y
catálogo de productos — y el aislamiento entre empresas está probado
automáticamente, no solo asumido.

- [x] Proyecto NestJS + Prisma 7 (`backend/`) y Next.js + Tailwind
      (`frontend/`).
- [x] PostgreSQL con Row Level Security activo desde la primera migración
      (rol `app_user` sin `BYPASSRLS` + policies en 32 tablas
      tenant-scoped + `organizations`).
- [x] Redis + BullMQ configurados y usados de verdad (cola de auditoría),
      no solo declarados.
- [x] Docker: `Dockerfile` en `backend/` y `frontend/`,
      `docker-compose.yml` con Postgres + Redis + backend + frontend.
      (Nota: el build de las imágenes Docker no se pudo ejecutar en este
      entorno de desarrollo por no tener el daemon de Docker disponible;
      `docker compose config` valida la sintaxis correctamente y los
      Dockerfiles se revisaron a mano. **Pendiente**: correr
      `docker compose build` en un entorno con Docker real antes de
      confiar en el despliegue containerizado.)
- [x] Autenticación completa: registro (bootstrap atómico de organización),
      login (con selección de organización si el usuario pertenece a
      varias), refresh con rotación, logout, recuperación de contraseña,
      verificación de email (envío real de correo es Fase 9 —
      Notificaciones), rate limiting.
- [x] Multi-tenancy verificada automáticamente
      (`npm run verify:tenant-isolation`, dentro de `backend/`).
- [x] Roles y permisos granulares: OWNER, ADMIN, MANAGER, ACCOUNTANT,
      CASHIER, INVENTORY, SALES, AUDITOR con catálogo de 29 permisos.
- [x] Empresas, sucursales, almacenes y puntos de venta (CRUD real).
- [x] Clientes y proveedores (CRUD real, con vista de compras/facturas/
      pagos/cuenta corriente lista para poblarse cuando existan).
- [x] Productos, categorías y unidades (CRUD real, con crear/editar/
      eliminar/duplicar; import/export CSV y edición masiva quedan para
      una fase siguiente).
- [x] Auditoría (`audit_logs`, vía cola de BullMQ) registrando login,
      creación de empresa, y creación/edición de las entidades de
      Foundation.
- [x] Frontend: sidebar exacto de la sección 8 del prompt, dashboard con
      datos reales (nunca inventados — si no hay actividad, el número es
      0 honesto), pantallas CRUD reales para las entidades de Foundation,
      y placeholders explícitos ("disponible en una fase siguiente") para
      las secciones cuyo módulo de negocio todavía no existe — nunca
      botones que aparenten funcionar sin hacerlo.

## Fases siguientes (dependen de la Parte 2 del prompt para el detalle fino)

- **Fase 2 — Ventas / POS**: `Sale`/`SaleItem` ya modelados; falta el
  módulo de negocio (búsqueda de productos, carrito, cobro, métodos de
  pago) y la pantalla real de `/sales/pos`.
- **Fase 3 — Compras**: `Purchase`/`PurchaseItem` ya modelados; falta
  órdenes de compra y recepción.
- **Fase 4 — Inventario avanzado**: `InventoryMovement`/`Inventory` ya
  modelados; falta la lógica de movimientos (entradas/salidas/
  transferencias/ajustes/devoluciones) disparada por ventas/compras, y
  kardex.
- **Fase 5 — Caja**: `CashRegister`/`CashMovement` ya modelados; falta
  apertura/cierre/arqueo.
- **Fase 6 — Facturación / Fiscal / SIN**: `Invoice`/`InvoiceItem`/
  `InvoiceEvent`/`TaxConfiguration` ya modelados de forma genérica, **sin**
  campos específicos del SIN todavía. Antes de tocar código fiscal real,
  hay que investigar la normativa vigente (RND, Anexo Técnico, algoritmo de
  CUF, servicios SOAP/REST) tal como exige el prompt — no se inventan
  reglas fiscales. El prompt es explícito: esto no arranca hasta que
  Foundation esté sólido, lo cual ya se cumplió acá.
- **Fase 7 — Reportes**: depende de que exista actividad real en ventas/
  compras/inventario/caja/facturación para tener algo que reportar.
- **Fase 8 — Backoffice del SaaS**: rol `app_superadmin` (con `BYPASSRLS`)
  ya existe en la base de datos, reservado, sin usar todavía.
- **Fase 9 — Notificaciones y proveedor de email real**: hoy
  `MailService` es un stub que loguea; `notifications`/`files` tienen
  tabla pero no API.
- **Fase 10 — Suscripciones y pagos reales**: hoy existe un plan "Gratis"
  automático y la página de Suscripción es de solo lectura; falta
  pasarela de pago para cambiar de plan.

## Reglas de desarrollo aplicadas (sección 16 del prompt)

- Se investigó el entorno antes de elegir versiones (Node 22, Prisma 7,
  Next 16, NestJS 11 — todas las que ya estaban disponibles/instalables).
- Cada pieza se compiló y probó antes de seguir con la siguiente (ver
  historial de commits y `npm run verify:tenant-isolation`).
- No se avanzó con errores críticos: cuando `tsx` colgó al cargar el
  cliente Prisma 7 (bug de interacción conocido, documentado en el propio
  script de verificación), se cambió de estrategia (compilar y correr con
  `node`) en vez de ignorar el problema.
- No hay botones falsos: toda sección del sidebar sin módulo de negocio
  real muestra un placeholder honesto, no una pantalla que aparenta
  funcionar.
