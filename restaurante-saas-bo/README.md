# Restaurante SaaS Bolivia (MVP)

MVP funcional de un SaaS para un restaurante de comida rápida boliviano: backend
Node.js/TypeScript (Express + Prisma + PostgreSQL) y frontend Next.js. Incluye
POS, menú, pedidos, pagos y un módulo de facturación electrónica que sigue el
flujo general del SIN (CUIS → CUFD → CUF → XML → QR) en **ambiente simulado**.

> Este proyecto no está homologado ante el SIN. Ver `backend/src/modules/invoicing`
> para el punto de conexión con credenciales reales cuando la empresa las obtenga.

## Requisitos

- Node.js 22+
- PostgreSQL 14+

## Backend

```bash
cd backend
npm install
cp .env.example .env   # ajusta DATABASE_URL
npx prisma migrate dev
npx tsx prisma/seed.ts # crea empresa demo: admin@polloexpress.bo / Demo1234!
npm run dev            # http://localhost:4000
```

## Frontend

```bash
cd frontend
npm install
cp .env.local.example .env.local
npm run dev             # http://localhost:3000
```

## Estructura

- `backend/prisma/schema.prisma` — modelo de datos multi-tenant (empresa, sucursal, menú, pedidos, facturación).
- `backend/src/modules/invoicing/sin/` — módulo de facturación electrónica, desacoplado detrás de la interfaz `SinProvider` (hoy: `MockSinClient`).
- `frontend/src/app/` — POS, menú, pedidos, facturación, configuración fiscal.
