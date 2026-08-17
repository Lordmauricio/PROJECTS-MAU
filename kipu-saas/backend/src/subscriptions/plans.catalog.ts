/**
 * Catálogo de planes comerciales del SaaS (no confundir con `Plan` de
 * Prisma, que es la fila persistida — esto es la definición fuente,
 * sembrada en `plans` por `prisma/seed.ts` y por
 * `SubscriptionsService.getOrCreatePlan`, mismo criterio que
 * `PERMISSIONS_CATALOG`). `limits.maxX = null` significa "sin límite" —
 * usado por ENTERPRISE.
 *
 * Solo se declaran los límites que YA existían en el esquema desde antes
 * de esta fase (`Plan.limits` = `{ maxUsers, maxBranches, maxProducts }`,
 * ver `prisma/seed.ts`/`organizations.service.ts` previos). No se inventan
 * límites nuevos (almacenes, POS, clientes, proveedores, ventas,
 * almacenamiento, etc.) que no estuvieran ya definidos en el código — ver
 * `docs/architecture.md` sección 16 para la aclaración explícita de este
 * alcance.
 */
export type PlanKey = 'free' | 'basic' | 'pro' | 'enterprise';

export const PLAN_KEYS: PlanKey[] = ['free', 'basic', 'pro', 'enterprise'];

export interface PlanLimits {
  maxUsers: number | null;
  maxBranches: number | null;
  maxProducts: number | null;
}

export interface PlanFeatures {
  pos: boolean;
  inventory: boolean;
  invoicing: boolean;
}

export interface PlanDefinition {
  key: PlanKey;
  name: string;
  priceMonthly: number;
  limits: PlanLimits;
  features: PlanFeatures;
}

export const PLAN_DEFINITIONS: Record<PlanKey, PlanDefinition> = {
  free: {
    key: 'free',
    name: 'Gratis',
    priceMonthly: 0,
    limits: { maxUsers: 3, maxBranches: 1, maxProducts: 50 },
    features: { pos: true, inventory: true, invoicing: false },
  },
  basic: {
    key: 'basic',
    name: 'Básico',
    priceMonthly: 99,
    limits: { maxUsers: 10, maxBranches: 3, maxProducts: 500 },
    features: { pos: true, inventory: true, invoicing: true },
  },
  pro: {
    key: 'pro',
    name: 'Pro',
    priceMonthly: 299,
    limits: { maxUsers: 30, maxBranches: 10, maxProducts: 5000 },
    features: { pos: true, inventory: true, invoicing: true },
  },
  enterprise: {
    key: 'enterprise',
    name: 'Enterprise',
    priceMonthly: 799,
    limits: { maxUsers: null, maxBranches: null, maxProducts: null },
    features: { pos: true, inventory: true, invoicing: true },
  },
};

export type LimitedResource = 'users' | 'branches' | 'products';

export const RESOURCE_TO_LIMIT_KEY: Record<LimitedResource, keyof PlanLimits> =
  {
    users: 'maxUsers',
    branches: 'maxBranches',
    products: 'maxProducts',
  };

export const RESOURCE_LABELS: Record<LimitedResource, string> = {
  users: 'usuarios',
  branches: 'sucursales',
  products: 'productos',
};

export function isPlanKey(value: string): value is PlanKey {
  return (PLAN_KEYS as string[]).includes(value);
}
