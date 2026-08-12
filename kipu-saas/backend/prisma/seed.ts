import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../generated/prisma/client';
import { PERMISSIONS_CATALOG } from '../src/permissions/permissions.catalog';

// Corre con DATABASE_URL (rol admin), no con RUNTIME_DATABASE_URL: el
// catálogo de permisos y de planes son tablas globales sin RLS, y sembrarlas
// no requiere (ni debe requerir) contexto de tenant.
const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });

async function main() {
  for (const permission of PERMISSIONS_CATALOG) {
    await prisma.permission.upsert({
      where: { key: permission.key },
      update: { module: permission.module, description: permission.description },
      create: permission,
    });
  }
  console.log(`Catálogo de permisos sembrado: ${PERMISSIONS_CATALOG.length} permisos.`);

  await prisma.plan.upsert({
    where: { key: 'free' },
    update: {},
    create: {
      key: 'free',
      name: 'Gratis',
      priceMonthly: 0,
      limits: { maxUsers: 3, maxBranches: 1, maxProducts: 50 },
      features: { pos: true, inventory: true, invoicing: false },
    },
  });
  console.log('Plan gratuito sembrado.');
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
