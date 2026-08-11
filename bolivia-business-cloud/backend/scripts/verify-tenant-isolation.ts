/**
 * Verificación automatizada de aislamiento de tenant (RLS).
 *
 * Por qué esto es un script compilado y no un test de Jest ni se corre con
 * `tsx`: el cliente Prisma 7 carga su compilador de queries WASM con
 * `import()` dinámico en el momento de construir `PrismaClient`.
 *   - Bajo `ts-jest` (transform CJS), ese `import()` dinámico revienta con
 *     "A dynamic import callback was invoked without --experimental-vm-modules".
 *   - Bajo `tsx` (ejecución TS on-the-fly), la construcción de `PrismaClient`
 *     directamente se queda colgada sin error ni output (se comprobó
 *     aislando el problema: hasta un módulo Nest trivial con solo
 *     ConfigModule + PrismaModule cuelga en `NestFactory.create` bajo tsx).
 *   - Compilado con `tsc` (igual que el resto de la app) y corrido con
 *     `node` normal, funciona sin problemas — es exactamente como corre la
 *     app real en producción (`node dist/src/main.js`).
 * Por eso `npm run verify:tenant-isolation` compila primero y ejecuta el
 * `.js` resultante. Este script hace lo mismo que haría un test e2e: levanta
 * la app Nest real en memoria, la golpea por HTTP, y además verifica a nivel
 * de SQL crudo. Si la interoperabilidad Prisma+Jest/tsx mejora en una
 * versión futura, esto se puede migrar a `test/*.e2e-spec.ts`.
 *
 * Uso: npm run verify:tenant-isolation
 */
import 'dotenv/config';
import assert from 'node:assert/strict';
import { NestFactory } from '@nestjs/core';
import { ValidationPipe, INestApplication } from '@nestjs/common';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';

function uniqueSuffix() {
  return `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
}

async function registerOrg(app: INestApplication, label: string) {
  const suffix = uniqueSuffix();
  const server = app.getHttpServer();
  const res = await fetchViaServer(server, 'POST', '/auth/register', {
    organizationName: `${label} ${suffix}`,
    legalName: `${label} SRL ${suffix}`,
    nit: `TEST-${suffix}`,
    branchName: `Sucursal ${label}`,
    ownerName: `Owner ${label}`,
    email: `owner-${suffix}@example.test`,
    password: 'Password123!',
  });
  assert.equal(res.status, 201, `registro de ${label} debía dar 201, dio ${res.status}: ${JSON.stringify(res.body)}`);
  return {
    accessToken: res.body.accessToken as string,
    organizationId: res.body.organization.id as string,
    branchName: `Sucursal ${label}`,
  };
}

// Helper minimalista de HTTP contra el server HTTP real (evita depender de
// supertest, que también choca con el mismo problema de ESM bajo ts-jest;
// bajo tsx no hace falta ese rodeo).
async function fetchViaServer(
  server: import('http').Server,
  method: string,
  path: string,
  body?: unknown,
  token?: string,
) {
  await new Promise<void>((resolve) => {
    if (server.listening) return resolve();
    server.listen(0, resolve);
  });
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : 0;
  const res = await fetch(`http://127.0.0.1:${port}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const json = await res.json().catch(() => undefined);
  return { status: res.status, body: json };
}

async function main() {
  const app = await NestFactory.create(AppModule, { logger: false });
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  await app.init();
  const httpServer = app.getHttpServer();
  const prisma = app.get(PrismaService);

  let failures = 0;
  function check(condition: boolean, message: string) {
    if (condition) {
      console.log(`  ✔ ${message}`);
    } else {
      failures++;
      console.error(`  ✘ ${message}`);
    }
  }

  try {
    console.log('1) Aislamiento vía API HTTP real');
    const orgA = await registerOrg(app, 'Tenant-A');
    const orgB = await registerOrg(app, 'Tenant-B');

    const branchesA = await fetchViaServer(httpServer, 'GET', '/branches', undefined, orgA.accessToken);
    const branchesB = await fetchViaServer(httpServer, 'GET', '/branches', undefined, orgB.accessToken);

    check(branchesA.body.length === 1, 'A ve exactamente 1 sucursal (la suya)');
    check(branchesA.body[0]?.organizationId === orgA.organizationId, 'la sucursal que ve A es de A');
    check(branchesB.body.length === 1, 'B ve exactamente 1 sucursal (la suya)');
    check(branchesB.body[0]?.organizationId === orgB.organizationId, 'la sucursal que ve B es de B');

    const idsA = branchesA.body.map((b: { id: string }) => b.id);
    const idsB = branchesB.body.map((b: { id: string }) => b.id);
    check(
      !idsA.some((id: string) => idsB.includes(id)),
      'ningún id de sucursal se repite entre las respuestas de A y B',
    );

    const membersA = await fetchViaServer(httpServer, 'GET', '/members', undefined, orgA.accessToken);
    check(membersA.body.length === 1, 'A ve exactamente 1 miembro (el suyo)');
    check(membersA.body[0]?.organizationId === orgA.organizationId, 'el miembro que ve A pertenece a A');

    console.log('\n2) Aislamiento a nivel de Postgres (RLS), consulta SIN WHERE, rol app_user (el mismo que usa la app)');

    const rowsForA = await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.current_tenant', ${orgA.organizationId}, true)`;
      return tx.branch.findMany();
    });
    check(rowsForA.length > 0, 'con contexto = A, la consulta sin WHERE devuelve filas');
    check(
      rowsForA.every((r) => r.organizationId === orgA.organizationId),
      'con contexto = A, TODAS las filas devueltas son de A (ninguna de B ni de otro tenant)',
    );

    const rowsNoTenant = await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.current_tenant', ${'org-inexistente'}, true)`;
      return tx.branch.findMany();
    });
    check(rowsNoTenant.length === 0, 'con contexto de un tenant inexistente, la consulta no devuelve NADA (fail-closed)');
  } finally {
    await app.close();
  }

  if (failures > 0) {
    console.error(`\n${failures} verificación(es) fallaron.`);
    process.exit(1);
  }
  console.log('\nTodas las verificaciones de aislamiento de tenant pasaron.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
