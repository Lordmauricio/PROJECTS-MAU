# Roadmap de construcción — Bolivia Business Cloud

El spec original tiene 33 secciones (visión, multi-tenancy, stack, base de
datos, auth, onboarding, dashboard, productos, inventario, POS, facturación,
integración SIN, modelo proveedor, token delegado, CUIS/CUFD, catálogos, XML
fiscal, firma digital, envío SIN, SOAP/REST, idempotencia, colas,
contingencia, anulaciones, PDF, portal cliente, reportes, backoffice SaaS,
suscripciones, pagos, notificaciones, y más). Construir eso "de una" no
produce software de producción real: produce código no probado y decisiones
tributarias sin validar. Se construye por fases, cada una entregando algo que
corre de verdad.

## Fase 0 — Fundación (este documento + los otros dos en `docs/`)

- [x] `docs/sin/README.md` — investigación normativa/técnica (con huecos
      explícitos que requieren acceso directo al portal del SIN).
- [x] `docs/ARCHITECTURE.md` — decisión de multi-tenancy (Postgres + RLS) y
      stack (Nest + Prisma + Next.js).
- [x] `docs/ROADMAP.md` — este archivo.

## Fase 1 — Backbone multi-tenant + Auth + RBAC (sin nada fiscal todavía)

Entregable: un usuario puede registrarse, crear su `organization`, invitar
usuarios, asignarles roles con permisos granulares, y el aislamiento por
tenant está probado con un test que intenta leer datos de otro tenant y
falla.

- Proyecto Nest + Prisma scaffolding real (no Express a mano).
- Esquema: `organizations`, `users`, `organization_users`, `roles`,
  `permissions`, `role_permissions`, `branches`.
- RLS activo desde la primera migración, con test de aislamiento.
- Auth: registro, login, verificación de email, recuperación de contraseña,
  rate limiting básico.

## Fase 2 — Catálogo, inventario, clientes/proveedores

- `products`, `product_categories`, `product_units`, `warehouses`,
  `inventories`, `inventory_movements`, `customers`, `suppliers`.
- CRUD completo + import/export CSV.

## Fase 3 — Ventas / POS + Caja + Compras

- `sales`, `sale_items`, `cash_registers`, `cash_movements`, `purchases`,
  `purchase_items`, `payments`.
- POS funcional (sin emitir factura fiscal real todavía — factura "interna"
  como recibo, sin CUF).

## Fase 4 — Dominio de facturación (sin SIN todavía)

- `invoices`, `invoice_items`, `invoice_events`, `invoice_sequences`.
- `billing/` module completo operando contra un `FiscalProvider` **mock**
  (mismo patrón que se probó en el MVP `restaurante-saas-bo`, pero ahora
  detrás de interfaces Nest reales y con idempotencia a nivel de base de
  datos).

## Fase 5 — Integración SIN real (bloqueada por investigación completa)

**No se empieza esta fase hasta cerrar los "huecos" del documento SIN**
(algoritmo CUF exacto, lista completa de operaciones SOAP, XSD, fase 1 de
autorización, mecanismo de contingencia). Incluye:

- `sin_configurations`, `sin_tokens`, `sin_certificates`, `sin_sync_logs`,
  `sin_catalogs`, `sin_requests`, `sin_responses`.
- `SinCuisService`, `SinCufdService`, `SinCatalogSyncService`.
- `FiscalXmlBuilder`, `FiscalXmlValidator`, `XmlSigner`, `FiscalHashService`.
- `SinBoliviaProvider` (adapter SOAP) implementando `FiscalProvider`.
- Máquina de estados de homologación por organización (no configurado →
  piloto → producción → suspendido/revocado).
- Flujo de asociación de terceros + confirmación del contribuyente.

## Fase 6 — Contingencia, anulaciones, PDF/QR, portal del cliente

## Fase 7 — Reportes

## Fase 8 — Backoffice del SaaS (planes, suscripciones, métricas, soporte)

## Fase 9 — Pagos de suscripción, notificaciones multicanal

---

## Cómo se decide cuándo pasar de fase

Cada fase termina cuando lo construido en ella **corre de verdad** (build sin
errores, migraciones aplicadas, flujo probado extremo a extremo como se hizo
con el POS del MVP), no cuando el código "está escrito". Fase 5 en particular
no arranca sin que alguien con acceso normal a internet valide los huecos
técnicos del SIN — construir el adapter real sobre suposiciones es
exactamente lo que el spec pide evitar.
