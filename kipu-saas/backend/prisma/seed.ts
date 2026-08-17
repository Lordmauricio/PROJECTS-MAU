import { PrismaPg } from '@prisma/adapter-pg';
import { Prisma, PrismaClient } from '../generated/prisma/client';
import { PERMISSIONS_CATALOG } from '../src/permissions/permissions.catalog';
import {
  PLAN_DEFINITIONS,
  PLAN_KEYS,
} from '../src/subscriptions/plans.catalog';

// Corre con DATABASE_URL (rol admin), no con RUNTIME_DATABASE_URL: el
// catálogo de permisos y de planes son tablas globales sin RLS, y sembrarlas
// no requiere (ni debe requerir) contexto de tenant.
const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });

async function main() {
  for (const permission of PERMISSIONS_CATALOG) {
    await prisma.permission.upsert({
      where: { key: permission.key },
      update: {
        module: permission.module,
        description: permission.description,
      },
      create: permission,
    });
  }
  console.log(
    `Catálogo de permisos sembrado: ${PERMISSIONS_CATALOG.length} permisos.`,
  );

  // Los 4 planes vienen de un único catálogo fuente
  // (`src/subscriptions/plans.catalog.ts`) para que sembrado, bootstrap de
  // organización nueva, y `SubscriptionsService.getOrCreatePlan` nunca
  // diverjan sobre nombre/precio/límites de un plan.
  for (const key of PLAN_KEYS) {
    const def = PLAN_DEFINITIONS[key];
    const limits = def.limits as unknown as Prisma.InputJsonValue;
    const features = def.features as unknown as Prisma.InputJsonValue;
    await prisma.plan.upsert({
      where: { key: def.key },
      update: {
        name: def.name,
        priceMonthly: def.priceMonthly,
        limits,
        features,
      },
      create: {
        key: def.key,
        name: def.name,
        priceMonthly: def.priceMonthly,
        limits,
        features,
      },
    });
  }
  console.log(
    `Catálogo de planes sembrado: ${PLAN_KEYS.length} planes (${PLAN_KEYS.join(', ')}).`,
  );
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
