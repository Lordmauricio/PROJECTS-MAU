/**
 * Verificación automatizada de aislamiento de tenant (RLS).
 *
 * Por qué esto es un script compilado y no un test de Jest ni se corre con
 * `tsx`: el cliente Prisma 7 carga su compilador de queries WASM con
 * `import()` dinámico en el momento de construir `PrismaClient`.
 *   - Bajo `ts-jest` (transform CJS), ese `import()` dinámico revienta con
 *     "A dynamic import callback was invoked without --experimental-vm-modules".
 *   - Bajo `tsx` (ejecución TS on-the-fly), la construcción de `PrismaClient`
 *     directamente se queda colgada sin error ni output.
 *   - Compilado con `tsc` (igual que el resto de la app) y corrido con
 *     `node` normal, funciona sin problemas — es exactamente como corre la
 *     app real en producción (`node dist/src/main.js`).
 * Por eso `npm run verify:tenant-isolation` compila primero y ejecuta el
 * `.js` resultante.
 *
 * Uso: npm run verify:tenant-isolation
 */
import 'dotenv/config';
import assert from 'node:assert/strict';
import * as argon2 from 'argon2';
import { NestFactory, Reflector } from '@nestjs/core';
import { ExecutionContext, ForbiddenException, ValidationPipe, INestApplication } from '@nestjs/common';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { TenantPrismaService } from '../src/prisma/tenant-prisma.service';
import { PermissionsGuard } from '../src/common/guards/permissions.guard';
import { RequirePermissions } from '../src/common/decorators/permissions.decorator';
import { NoPermissionRequired } from '../src/common/decorators/no-permission-required.decorator';

function uniqueSuffix() {
  return `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
}

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

// Portador de handlers "de mentira" para el test de PermissionsGuard a nivel
// de guard (sin HTTP, sin DB): los decoradores reales (@RequirePermissions /
// @NoPermissionRequired) se aplican acá para que Reflector lea metadata
// real, exactamente como en un controlador de verdad.
class FakeController {}
class FakeRouteHandlers {
  static bare() {
    /* ruta protegida por PermissionsGuard que NO declara nada: debe denegar */
  }

  @NoPermissionRequired()
  static noPermissionRequired() {
    /* ruta marcada explícitamente como "solo requiere estar autenticado" */
  }
}

function fakeExecutionContext(handler: (...args: unknown[]) => unknown, user?: unknown): ExecutionContext {
  return {
    getHandler: () => handler,
    getClass: () => FakeController,
    switchToHttp: () => ({ getRequest: () => ({ user }) }),
  } as unknown as ExecutionContext;
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
    console.log('1) Aislamiento vía API HTTP real (branches, warehouses, pos-terminals, customers, products)');
    const orgA = await registerOrg(app, 'Tenant-A');
    const orgB = await registerOrg(app, 'Tenant-B');

    const branchesA = await fetchViaServer(httpServer, 'GET', '/branches', undefined, orgA.accessToken);
    const branchesB = await fetchViaServer(httpServer, 'GET', '/branches', undefined, orgB.accessToken);
    check(branchesA.body.length === 1, 'A ve exactamente 1 sucursal (la suya, con su almacén y POS anidados)');
    check(branchesA.body[0]?.warehouses?.length === 1, 'la sucursal de A trae su almacén principal');
    check(branchesA.body[0]?.posTerminals?.length === 1, 'la sucursal de A trae su punto de venta principal');
    check(branchesB.body.length === 1, 'B ve exactamente 1 sucursal (la suya)');

    const idsA = branchesA.body.map((b: { id: string }) => b.id);
    const idsB = branchesB.body.map((b: { id: string }) => b.id);
    check(!idsA.some((id: string) => idsB.includes(id)), 'ningún id de sucursal se repite entre A y B');

    // Crear un producto y un cliente para A, y verificar que B no los ve.
    const catA = await fetchViaServer(httpServer, 'POST', '/product-categories', { name: 'Categoría A' }, orgA.accessToken);
    await fetchViaServer(
      httpServer,
      'POST',
      '/products',
      { name: 'Producto de A', price: 10, categoryId: catA.body.id },
      orgA.accessToken,
    );
    await fetchViaServer(httpServer, 'POST', '/customers', { name: 'Cliente de A' }, orgA.accessToken);

    const productsA = await fetchViaServer(httpServer, 'GET', '/products', undefined, orgA.accessToken);
    const productsB = await fetchViaServer(httpServer, 'GET', '/products', undefined, orgB.accessToken);
    check(productsA.body.length === 1, 'A ve su producto');
    check(productsB.body.length === 0, 'B NO ve el producto de A');

    const customersA = await fetchViaServer(httpServer, 'GET', '/customers', undefined, orgA.accessToken);
    const customersB = await fetchViaServer(httpServer, 'GET', '/customers', undefined, orgB.accessToken);
    check(customersA.body.length === 1, 'A ve su cliente');
    check(customersB.body.length === 0, 'B NO ve el cliente de A');

    console.log('\n2) Aislamiento a nivel de Postgres (RLS), consulta SIN WHERE, rol app_user (el mismo que usa la app)');

    const rowsForA = await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.current_tenant', ${orgA.organizationId}, true)`;
      return tx.product.findMany();
    });
    check(rowsForA.length > 0, 'con contexto = A, la consulta sin WHERE devuelve filas');
    check(
      rowsForA.every((r) => r.organizationId === orgA.organizationId),
      'con contexto = A, TODAS las filas devueltas son de A (ninguna de B ni de otro tenant)',
    );

    const rowsNoTenant = await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.current_tenant', ${'org-inexistente'}, true)`;
      return tx.product.findMany();
    });
    check(rowsNoTenant.length === 0, 'con contexto de un tenant inexistente, la consulta no devuelve NADA (fail-closed)');

    // audit_logs pasa por el worker de BullMQ (proceso separado del request
    // HTTP), así que probarlo confirma que el aislamiento también se
    // respeta en el camino asíncrono, no solo en el request directo.
    await new Promise((resolve) => setTimeout(resolve, 1500));
    const auditForA = await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.current_tenant', ${orgA.organizationId}, true)`;
      return tx.auditLog.findMany();
    });
    check(auditForA.length > 0, 'los eventos de auditoría de A (procesados vía Redis/BullMQ) llegaron a la base');
    check(
      auditForA.every((r) => r.organizationId === orgA.organizationId),
      'todos los audit_logs visibles con contexto = A pertenecen a A',
    );

    console.log(
      '\n3) PermissionsGuard fail-closed (los 5 escenarios pedidos por el usuario + regresión de OWNER)',
    );

    // --- Escenario 3a (nivel guard, sin HTTP ni DB): ruta protegida por
    // PermissionsGuard que NO declara @RequirePermissions ni
    // @NoPermissionRequired debe denegar por defecto. ---
    const reflector = new Reflector();
    const tenantPrismaForGuard = app.get(TenantPrismaService);
    const guard = new PermissionsGuard(reflector, tenantPrismaForGuard);

    let bareThrewForbidden = false;
    try {
      await guard.canActivate(fakeExecutionContext(FakeRouteHandlers.bare, { organizationId: 'x', roleId: 'y' }));
    } catch (err) {
      bareThrewForbidden = err instanceof ForbiddenException;
    }
    check(
      bareThrewForbidden,
      'endpoint protegido SIN permiso declarado → PermissionsGuard deniega con ForbiddenException (fail-closed a nivel de guard)',
    );

    // --- @NoPermissionRequired() sí deja pasar a cualquier autenticado. ---
    const noPermissionResult = await guard.canActivate(
      fakeExecutionContext(FakeRouteHandlers.noPermissionRequired, { organizationId: 'x', roleId: 'y' }),
    );
    check(noPermissionResult === true, '@NoPermissionRequired() permite el acceso a cualquier autenticado');

    // --- Escenario: endpoint público → funciona sin autenticación. ---
    const publicRegister = await fetchViaServer(httpServer, 'POST', '/auth/register', {
      organizationName: `Público ${uniqueSuffix()}`,
      legalName: `Público SRL ${uniqueSuffix()}`,
      nit: `TEST-${uniqueSuffix()}`,
      branchName: 'Sucursal Público',
      ownerName: 'Owner Público',
      email: `owner-publico-${uniqueSuffix()}@example.test`,
      password: 'Password123!',
    });
    check(
      publicRegister.status === 201,
      'endpoint público (POST /auth/register) funciona sin ningún header de Authorization',
    );

    // --- Escenario: endpoint protegido con el permiso correcto → funciona
    // (regresión de OWNER contra los 5 endpoints recién protegidos por fix A). ---
    const ownerChecks: Array<[string, string]> = [
      ['GET', '/branches'],
      ['GET', '/warehouses'],
      ['GET', '/pos-terminals'],
      ['GET', '/members'],
      ['GET', '/roles'],
    ];
    for (const [method, path] of ownerChecks) {
      const res = await fetchViaServer(httpServer, method, path, undefined, orgA.accessToken);
      check(res.status === 200, `OWNER de A sigue accediendo a ${method} ${path} → 200 (no se rompió por el fail-closed)`);
    }

    // --- Crear un usuario de prueba con rol SALES directamente vía Prisma
    // (evita depender del flujo de "aceptar invitación", que no existe
    // todavía) para probar "autenticado SIN el permiso" y "autenticado CON
    // el permiso" con un rol de bajo privilegio real. ---
    const salesEmail = `sales-${uniqueSuffix()}@example.test`;
    const salesPassword = 'Password123!';
    await tenantPrismaForGuard.run(orgA.organizationId, async (tx) => {
      const salesRole = await tx.role.findFirstOrThrow({
        where: { organizationId: orgA.organizationId, key: 'SALES' },
      });
      const passwordHash = await argon2.hash(salesPassword);
      const user = await prisma.user.create({
        data: { email: salesEmail, name: 'Vendedor de prueba', passwordHash, emailVerifiedAt: new Date() },
      });
      await tx.organizationUser.create({
        data: {
          organizationId: orgA.organizationId,
          userId: user.id,
          roleId: salesRole.id,
          status: 'ACTIVE',
          joinedAt: new Date(),
        },
      });
    });

    const salesLogin = await fetchViaServer(httpServer, 'POST', '/auth/login', {
      email: salesEmail,
      password: salesPassword,
    });
    assert.equal(
      salesLogin.status,
      201,
      `login del usuario SALES de prueba debía dar 201/200, dio ${salesLogin.status}: ${JSON.stringify(salesLogin.body)}`,
    );
    const salesToken = salesLogin.body.accessToken as string;

    // --- Escenario: usuario autenticado SIN el permiso requerido → 403. ---
    const salesInvite = await fetchViaServer(
      httpServer,
      'POST',
      '/members/invite',
      { email: `invitado-${uniqueSuffix()}@example.test`, roleId: 'no-importa', name: 'x' },
      salesToken,
    );
    check(
      salesInvite.status === 403,
      'usuario SALES (sin users.manage) golpea POST /members/invite (@RequirePermissions users.manage) → 403',
    );

    // --- Escenario: usuario CON el permiso → acceso correcto. ---
    const salesProducts = await fetchViaServer(httpServer, 'GET', '/products', undefined, salesToken);
    check(salesProducts.status === 200, 'usuario SALES (con products.read) golpea GET /products → 200');

    const salesOrgMe = await fetchViaServer(httpServer, 'GET', '/organizations/me', undefined, salesToken);
    check(
      salesOrgMe.status === 200,
      'usuario SALES golpea GET /organizations/me (@NoPermissionRequired) → 200 (autenticado, sin permiso específico requerido)',
    );
  } finally {
    await app.close();
  }

  if (failures > 0) {
    console.error(`\n${failures} verificación(es) fallaron.`);
    process.exit(1);
  }
  console.log('\nTodas las verificaciones de aislamiento de tenant pasaron.');
  // Salida explícita: las conexiones de BullMQ/Redis abiertas por AuditModule
  // no siempre se cierran a tiempo con app.close(), lo que deja el proceso
  // colgado indefinidamente después de imprimir el resultado.
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
