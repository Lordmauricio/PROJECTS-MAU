import { INestApplication } from '@nestjs/common';
import {
  bootTestApp,
  callApi,
  createUserWithRole,
  registerTestOrg,
  TestTenant,
} from '../test-support/integration-app';
import { PrismaService } from '../prisma/prisma.service';

interface ApiSubscription {
  status: string;
  plan: { key: string };
}

describe('Suscripciones — seguridad (RBAC + aislamiento de tenant, DB real)', () => {
  let app: INestApplication;
  let tenantA: TestTenant;
  let tenantB: TestTenant;

  beforeAll(async () => {
    app = await bootTestApp();
    tenantA = await registerTestOrg(app, 'Subscriptions-Security-A');
    tenantB = await registerTestOrg(app, 'Subscriptions-Security-B');
  }, 30000);

  afterAll(async () => {
    await app.close();
  }, 15000);

  // ---------------------------------------------------------------------
  // RBAC: solo OWNER/ADMIN pueden mutar la suscripción
  // ---------------------------------------------------------------------
  it.each([
    'MANAGER',
    'ACCOUNTANT',
    'CASHIER',
    'INVENTORY',
    'SALES',
    'AUDITOR',
  ] as const)(
    'un usuario %s (sin subscription.manage) recibe 403 en change-plan/cancel/renew, sin importar qué mande',
    async (roleKey) => {
      const token = await createUserWithRole(
        app,
        tenantA.organizationId,
        roleKey,
      );

      const changePlan = await callApi(
        app,
        'POST',
        '/organizations/me/subscription/change-plan',
        { planKey: 'enterprise' },
        token,
      );
      expect(changePlan.status).toBe(403);

      const cancel = await callApi(
        app,
        'POST',
        '/organizations/me/subscription/cancel',
        {},
        token,
      );
      expect(cancel.status).toBe(403);

      const renew = await callApi(
        app,
        'POST',
        '/organizations/me/subscription/renew',
        {},
        token,
      );
      expect(renew.status).toBe(403);
    },
  );

  it('un usuario de cualquier rol SÍ puede ver la suscripción (GET, sin permiso específico)', async () => {
    const token = await createUserWithRole(
      app,
      tenantA.organizationId,
      'INVENTORY',
    );
    const res = await callApi(
      app,
      'GET',
      '/organizations/me/subscription',
      undefined,
      token,
    );
    expect(res.status).toBe(200);
  });

  it('OWNER sí puede cambiar de plan, cancelar y renovar', async () => {
    const changePlan = await callApi(
      app,
      'POST',
      '/organizations/me/subscription/change-plan',
      { planKey: 'basic' },
      tenantA.accessToken,
    );
    expect(changePlan.status).toBe(201);

    const cancel = await callApi(
      app,
      'POST',
      '/organizations/me/subscription/cancel',
      {},
      tenantA.accessToken,
    );
    expect(cancel.status).toBe(201);

    const renew = await callApi(
      app,
      'POST',
      '/organizations/me/subscription/renew',
      {},
      tenantA.accessToken,
    );
    expect(renew.status).toBe(201);
  });

  it('ADMIN también puede administrar la suscripción (mismo criterio que OWNER)', async () => {
    const adminToken = await createUserWithRole(
      app,
      tenantA.organizationId,
      'ADMIN',
    );
    const res = await callApi(
      app,
      'POST',
      '/organizations/me/subscription/change-plan',
      { planKey: 'pro' },
      adminToken,
    );
    expect(res.status).toBe(201);
  });

  // ---------------------------------------------------------------------
  // Aislamiento de tenant
  // ---------------------------------------------------------------------
  it('cambiar el plan del tenant A no afecta al tenant B', async () => {
    await callApi(
      app,
      'POST',
      '/organizations/me/subscription/change-plan',
      { planKey: 'enterprise' },
      tenantA.accessToken,
    );
    const bBefore = await callApi<ApiSubscription>(
      app,
      'GET',
      '/organizations/me/subscription',
      undefined,
      tenantB.accessToken,
    );
    expect(bBefore.body.plan.key).not.toBe('enterprise');
  });

  it('cancelar la suscripción del tenant A no cancela la del tenant B', async () => {
    await callApi(
      app,
      'POST',
      '/organizations/me/subscription/cancel',
      {},
      tenantA.accessToken,
    );
    const bStatus = await callApi<ApiSubscription>(
      app,
      'GET',
      '/organizations/me/subscription',
      undefined,
      tenantB.accessToken,
    );
    expect(bStatus.body.status).not.toBe('CANCELLED');
  });

  it('RLS crudo: con contexto de tenant inexistente, subscriptions/subscription_events no devuelven nada (fail-closed)', async () => {
    const prisma = app.get(PrismaService);

    const forA = await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.current_tenant', ${tenantA.organizationId}, true)`;
      return tx.subscription.findMany({
        where: { organizationId: tenantA.organizationId },
      });
    });
    expect(forA.length).toBe(1);

    const none = await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.current_tenant', ${'org-inexistente-subs'}, true)`;
      return tx.subscription.findMany({
        where: { organizationId: tenantA.organizationId },
      });
    });
    expect(none).toHaveLength(0);

    const eventsNone = await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.current_tenant', ${'org-inexistente-subs'}, true)`;
      return tx.subscriptionEvent.findMany({
        where: { organizationId: tenantA.organizationId },
      });
    });
    expect(eventsNone).toHaveLength(0);
  });

  it('sin token, todos los endpoints de suscripción responden 401', async () => {
    expect(
      (await callApi(app, 'GET', '/organizations/me/subscription')).status,
    ).toBe(401);
    expect(
      (await callApi(app, 'GET', '/organizations/me/subscription/plans'))
        .status,
    ).toBe(401);
    expect(
      (
        await callApi(
          app,
          'POST',
          '/organizations/me/subscription/change-plan',
          { planKey: 'pro' },
        )
      ).status,
    ).toBe(401);
    expect(
      (await callApi(app, 'POST', '/organizations/me/subscription/cancel', {}))
        .status,
    ).toBe(401);
    expect(
      (await callApi(app, 'POST', '/organizations/me/subscription/renew', {}))
        .status,
    ).toBe(401);
  });
});
