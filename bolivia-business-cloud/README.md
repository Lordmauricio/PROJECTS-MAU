# Bolivia Business Cloud

SaaS multiempresa para PyMEs en Bolivia (ventas, inventario, POS, caja,
compras, cuentas por cobrar/pagar, reportes) con facturación electrónica
integrada a los servicios del SIN, diseñado para operar también como
proveedor/tercero de facturación cuando la asociación y autorización
correspondientes estén confirmadas por el SIN para cada contribuyente.

Este es un proyecto **nuevo y separado** del MVP previo (`../restaurante-saas-bo`),
construido con una arquitectura multi-tenant real (Postgres + Row Level
Security) y un backend modular (NestJS) pensado para crecer a decenas de
módulos sin perder aislamiento entre módulos ni entre empresas (tenants).

## Empezar por acá

1. `docs/ARCHITECTURE.md` — por qué esta estrategia de multi-tenancy y este
   stack, y cómo están separados los módulos.
2. `docs/sin/README.md` — todo lo investigado sobre la normativa e
   integración técnica con el SIN, **con los huecos marcados explícitamente**
   que hay que cerrar con acceso directo al portal antes de programar el
   adapter fiscal real.
3. `docs/ROADMAP.md` — el plan de construcción por fases y en qué fase está
   el proyecto ahora mismo.

## Estado actual

Fase 0 completa (documentación fundacional). Código de Fase 1 (backbone
multi-tenant + auth + RBAC) todavía no iniciado — ver `docs/ROADMAP.md`.
