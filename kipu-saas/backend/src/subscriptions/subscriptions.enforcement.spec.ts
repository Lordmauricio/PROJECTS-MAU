import { INestApplication } from '@nestjs/common';
import {
  bootTestApp,
  callApi,
  registerTestOrg,
  setOrganizationPlanLimits,
  uniqueSuffix,
} from '../test-support/integration-app';

describe('Suscripciones — enforcement real de límites (DB real, incluye concurrencia)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    app = await bootTestApp();
  }, 30000);

  afterAll(async () => {
    await app.close();
  }, 15000);

  it('maxBranches del plan free (1): la organización ya tiene 1 de bootstrap, crear una 2da da 402', async () => {
    const tenant = await registerTestOrg(app, 'Enforcement-Branches');
    const res = await callApi(
      app,
      'POST',
      '/branches',
      { name: `Sucursal Extra ${uniqueSuffix()}` },
      tenant.accessToken,
    );
    expect(res.status).toBe(402);
    expect(JSON.stringify(res.body)).toContain('sucursales');
    expect(JSON.stringify(res.body)).toContain('Gratis');
  });

  it('subir de plan levanta el límite de inmediato (basic permite 3 sucursales)', async () => {
    const tenant = await registerTestOrg(app, 'Enforcement-Branches-Upgrade');
    await callApi(
      app,
      'POST',
      '/organizations/me/subscription/change-plan',
      { planKey: 'basic' },
      tenant.accessToken,
    );
    const res = await callApi(
      app,
      'POST',
      '/branches',
      { name: `Sucursal Post-Upgrade ${uniqueSuffix()}` },
      tenant.accessToken,
    );
    expect(res.status).toBe(201);
  });

  it('maxUsers del plan free (3): owner + 2 invitaciones ok, la 3ra invitación da 402', async () => {
    const tenant = await registerTestOrg(app, 'Enforcement-Users');
    const roles = await callApi<Array<{ id: string; key: string }>>(
      app,
      'GET',
      '/roles',
      undefined,
      tenant.accessToken,
    );
    const cashierRole = roles.body.find((r) => r.key === 'CASHIER')!;

    const invite1 = await callApi(
      app,
      'POST',
      '/members/invite',
      { email: `u1-${uniqueSuffix()}@example.test`, roleId: cashierRole.id },
      tenant.accessToken,
    );
    expect(invite1.status).toBe(201);

    const invite2 = await callApi(
      app,
      'POST',
      '/members/invite',
      { email: `u2-${uniqueSuffix()}@example.test`, roleId: cashierRole.id },
      tenant.accessToken,
    );
    expect(invite2.status).toBe(201); // owner + 2 = 3, al límite pero no lo supera

    const invite3 = await callApi(
      app,
      'POST',
      '/members/invite',
      { email: `u3-${uniqueSuffix()}@example.test`, roleId: cashierRole.id },
      tenant.accessToken,
    );
    expect(invite3.status).toBe(402);
    expect(JSON.stringify(invite3.body)).toContain('usuarios');
  });

  it('suspender y reactivar un usuario respeta el límite (reactivar también cuenta como "sumar" un cupo)', async () => {
    const tenant = await registerTestOrg(app, 'Enforcement-Reactivate');
    const roles = await callApi<Array<{ id: string; key: string }>>(
      app,
      'GET',
      '/roles',
      undefined,
      tenant.accessToken,
    );
    const cashierRole = roles.body.find((r) => r.key === 'CASHIER')!;

    const invite1 = await callApi(
      app,
      'POST',
      '/members/invite',
      { email: `r1-${uniqueSuffix()}@example.test`, roleId: cashierRole.id },
      tenant.accessToken,
    );
    expect(invite1.status).toBe(201);
    const invite2 = await callApi(
      app,
      'POST',
      '/members/invite',
      { email: `r2-${uniqueSuffix()}@example.test`, roleId: cashierRole.id },
      tenant.accessToken,
    );
    expect(invite2.status).toBe(201); // total 3 (owner + 2), al límite

    const member2Id = (invite2.body as { id: string }).id;
    const suspend = await callApi(
      app,
      'PATCH',
      `/members/${member2Id}/suspend`,
      {},
      tenant.accessToken,
    );
    expect(suspend.status).toBe(200);

    // Con el 2do suspendido hay 2 ACTIVE (owner + invite1) — invitar un
    // 3ro ahora SÍ debería entrar (vuelve a estar bajo el límite).
    const invite3 = await callApi(
      app,
      'POST',
      '/members/invite',
      { email: `r3-${uniqueSuffix()}@example.test`, roleId: cashierRole.id },
      tenant.accessToken,
    );
    expect(invite3.status).toBe(201);

    // Ahora hay 3 ACTIVE otra vez (owner + invite1 + invite3) — reactivar
    // al suspendido superaría el límite.
    const reactivate = await callApi(
      app,
      'PATCH',
      `/members/${member2Id}/reactivate`,
      {},
      tenant.accessToken,
    );
    expect(reactivate.status).toBe(402);
  });

  it('maxProducts (límite chico sintético): crea hasta el límite (402 al pasarse, incluye duplicar) y liberar un cupo (borrar) permite crear de nuevo', async () => {
    // Un solo tenant para las 3 aserciones (create hasta el límite,
    // duplicate respeta el mismo límite, delete libera un cupo) — evita
    // sumar registros de organización de más y chocar con el throttle
    // de `/auth/register` (10/60s), que es real y no se debe debilitar
    // solo para tests.
    const tenant = await registerTestOrg(app, 'Enforcement-Products');
    await setOrganizationPlanLimits(app, tenant.organizationId, {
      maxUsers: null,
      maxBranches: null,
      maxProducts: 2,
    });

    const p1 = await callApi<{ id: string }>(
      app,
      'POST',
      '/products',
      { name: `Producto Límite 1 ${uniqueSuffix()}`, price: 10 },
      tenant.accessToken,
    );
    const p2 = await callApi(
      app,
      'POST',
      '/products',
      { name: `Producto Límite 2 ${uniqueSuffix()}`, price: 10 },
      tenant.accessToken,
    );
    expect(p1.status).toBe(201);
    expect(p2.status).toBe(201);

    const p3 = await callApi(
      app,
      'POST',
      '/products',
      { name: `Producto Límite 3 ${uniqueSuffix()}`, price: 10 },
      tenant.accessToken,
    );
    expect(p3.status).toBe(402);
    expect(JSON.stringify(p3.body)).toContain('productos');

    const dup = await callApi(
      app,
      'POST',
      `/products/${p1.body.id}/duplicate`,
      {},
      tenant.accessToken,
    );
    expect(dup.status).toBe(402); // duplicar también cuenta como crear un producto, mismo límite

    const removed = await callApi(
      app,
      'DELETE',
      `/products/${p1.body.id}`,
      undefined,
      tenant.accessToken,
    );
    expect(removed.status).toBe(200);

    const nowFits = await callApi(
      app,
      'POST',
      '/products',
      { name: `Producto Repuesto ${uniqueSuffix()}`, price: 10 },
      tenant.accessToken,
    );
    expect(nowFits.status).toBe(201); // borrar liberó el cupo
  });

  it('plan enterprise (límites null) nunca bloquea por número, sin importar cuánto se cree', async () => {
    const tenant = await registerTestOrg(app, 'Enforcement-Enterprise');
    await callApi(
      app,
      'POST',
      '/organizations/me/subscription/change-plan',
      { planKey: 'enterprise' },
      tenant.accessToken,
    );

    for (let i = 0; i < 5; i++) {
      const res = await callApi(
        app,
        'POST',
        '/branches',
        { name: `Sucursal Enterprise ${i} ${uniqueSuffix()}` },
        tenant.accessToken,
      );
      expect(res.status).toBe(201);
    }
  });

  it('una suscripción CANCELLED bloquea creación de usuarios/sucursales/productos con 403 (no 402 — no es un límite numérico)', async () => {
    const tenant = await registerTestOrg(app, 'Enforcement-Cancelled');
    await callApi(
      app,
      'POST',
      '/organizations/me/subscription/cancel',
      {},
      tenant.accessToken,
    );

    const roles = await callApi<Array<{ id: string; key: string }>>(
      app,
      'GET',
      '/roles',
      undefined,
      tenant.accessToken,
    );
    const cashierRole = roles.body.find((r) => r.key === 'CASHIER')!;

    const invite = await callApi(
      app,
      'POST',
      '/members/invite',
      {
        email: `cancelled-${uniqueSuffix()}@example.test`,
        roleId: cashierRole.id,
      },
      tenant.accessToken,
    );
    expect(invite.status).toBe(403);

    const branch = await callApi(
      app,
      'POST',
      '/branches',
      { name: `Sucursal Cancelled ${uniqueSuffix()}` },
      tenant.accessToken,
    );
    expect(branch.status).toBe(403);

    const product = await callApi(
      app,
      'POST',
      '/products',
      { name: `Producto Cancelled ${uniqueSuffix()}`, price: 10 },
      tenant.accessToken,
    );
    expect(product.status).toBe(403);
  });

  // ---------------------------------------------------------------------
  // Concurrencia real: el límite nunca se supera bajo carrera (Promise.all,
  // nunca secuencial) — mismo criterio que Ventas/Compras/Pagos/Caja.
  // ---------------------------------------------------------------------
  it('concurrencia: 10 creaciones de producto simultáneas con límite=3 dejan EXACTAMENTE 3, nunca más', async () => {
    const tenant = await registerTestOrg(
      app,
      'Enforcement-Concurrency-Products',
    );
    await setOrganizationPlanLimits(app, tenant.organizationId, {
      maxUsers: null,
      maxBranches: null,
      maxProducts: 3,
    });

    const attempts = Array.from({ length: 10 }, (_, i) =>
      callApi(
        app,
        'POST',
        '/products',
        { name: `Producto Concurrente ${i} ${uniqueSuffix()}`, price: 10 },
        tenant.accessToken,
      ),
    );
    const results = await Promise.all(attempts);

    const succeeded = results.filter((r) => r.status === 201).length;
    const blocked = results.filter((r) => r.status === 402).length;
    expect(succeeded).toBe(3);
    expect(blocked).toBe(7);

    const summary = await callApi<{ usage: { products: { used: number } } }>(
      app,
      'GET',
      '/organizations/me/subscription',
      undefined,
      tenant.accessToken,
    );
    expect(summary.body.usage.products.used).toBe(3);
  });

  it('concurrencia: 8 invitaciones simultáneas con maxUsers=2 (owner ya cuenta 1) dejan EXACTAMENTE 1 invitación exitosa', async () => {
    const tenant = await registerTestOrg(app, 'Enforcement-Concurrency-Users');
    await setOrganizationPlanLimits(app, tenant.organizationId, {
      maxUsers: 2,
      maxBranches: null,
      maxProducts: null,
    });
    const roles = await callApi<Array<{ id: string; key: string }>>(
      app,
      'GET',
      '/roles',
      undefined,
      tenant.accessToken,
    );
    const cashierRole = roles.body.find((r) => r.key === 'CASHIER')!;

    const attempts = Array.from({ length: 8 }, (_, i) =>
      callApi(
        app,
        'POST',
        '/members/invite',
        {
          email: `concurrent-${i}-${uniqueSuffix()}@example.test`,
          roleId: cashierRole.id,
        },
        tenant.accessToken,
      ),
    );
    const results = await Promise.all(attempts);
    const succeeded = results.filter((r) => r.status === 201).length;
    expect(succeeded).toBe(1);

    const summary = await callApi<{ usage: { users: { used: number } } }>(
      app,
      'GET',
      '/organizations/me/subscription',
      undefined,
      tenant.accessToken,
    );
    expect(summary.body.usage.users.used).toBe(2);
  });
});
