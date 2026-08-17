import { INestApplication } from '@nestjs/common';
import {
  bootTestApp,
  callApi,
  registerTestOrg,
  TestTenant,
  uniqueSuffix,
} from '../test-support/integration-app';
import { TenantPrismaService } from '../prisma/tenant-prisma.service';

interface ApiPlan {
  key: string;
  name: string;
  priceMonthly: string;
  limits: {
    maxUsers: number | null;
    maxBranches: number | null;
    maxProducts: number | null;
  };
}

interface ApiSubscription {
  status: string;
  currentPeriodEnd: string | null;
  plan: ApiPlan;
  usage: {
    users: { used: number; limit: number | null };
    branches: { used: number; limit: number | null };
    products: { used: number; limit: number | null };
  };
}

describe('Suscripciones — planes y ciclo de vida (DB real)', () => {
  let app: INestApplication;
  let tenant: TestTenant;

  beforeAll(async () => {
    app = await bootTestApp();
    tenant = await registerTestOrg(app, 'Subscriptions-Integration');
  }, 30000);

  afterAll(async () => {
    await app.close();
  }, 15000);

  it('GET /organizations/me/subscription/plans devuelve los 4 planes con sus límites', async () => {
    const res = await callApi<ApiPlan[]>(
      app,
      'GET',
      '/organizations/me/subscription/plans',
      undefined,
      tenant.accessToken,
    );
    expect(res.status).toBe(200);
    const keys = res.body.map((p) => p.key).sort();
    expect(keys).toEqual(['basic', 'enterprise', 'free', 'pro']);
    const free = res.body.find((p) => p.key === 'free')!;
    expect(free.limits).toEqual({
      maxUsers: 3,
      maxBranches: 1,
      maxProducts: 50,
    });
    const enterprise = res.body.find((p) => p.key === 'enterprise')!;
    expect(enterprise.limits).toEqual({
      maxUsers: null,
      maxBranches: null,
      maxProducts: null,
    });
  });

  it('una organización nueva arranca en el plan free, TRIALING, sin vencimiento, con el uso real reflejado', async () => {
    const res = await callApi<ApiSubscription>(
      app,
      'GET',
      '/organizations/me/subscription',
      undefined,
      tenant.accessToken,
    );
    expect(res.status).toBe(200);
    expect(res.body.plan.key).toBe('free');
    expect(res.body.status).toBe('TRIALING');
    expect(res.body.currentPeriodEnd).toBeNull();
    // El bootstrap ya crea 1 sucursal y 1 usuario (el owner).
    expect(res.body.usage.branches.used).toBe(1);
    expect(res.body.usage.users.used).toBe(1);
    expect(res.body.usage.branches.limit).toBe(1);
  });

  it('cambiar a un plan pago activa la suscripción (ACTIVE) con vencimiento a ~30 días', async () => {
    const before = Date.now();
    const res = await callApi<ApiSubscription>(
      app,
      'POST',
      '/organizations/me/subscription/change-plan',
      { planKey: 'basic' },
      tenant.accessToken,
    );
    expect(res.status).toBe(201);
    expect(res.body.plan.key).toBe('basic');
    expect(res.body.status).toBe('ACTIVE');
    expect(res.body.currentPeriodEnd).not.toBeNull();
    const end = new Date(res.body.currentPeriodEnd!).getTime();
    const days = (end - before) / (1000 * 60 * 60 * 24);
    expect(days).toBeGreaterThan(29);
    expect(days).toBeLessThan(31);
  });

  it('cambiar al mismo plan que ya está activo es un no-op idempotente', async () => {
    const before = await callApi<ApiSubscription>(
      app,
      'GET',
      '/organizations/me/subscription',
      undefined,
      tenant.accessToken,
    );
    const res = await callApi<ApiSubscription>(
      app,
      'POST',
      '/organizations/me/subscription/change-plan',
      { planKey: before.body.plan.key },
      tenant.accessToken,
    );
    expect(res.status).toBe(201);
    expect(res.body.status).toBe(before.body.status);
    expect(res.body.currentPeriodEnd).toBe(before.body.currentPeriodEnd);
  });

  it('bloquea el downgrade cuando el uso actual ya supera el límite del plan destino (409)', async () => {
    // basic permite 3 sucursales; se crean 2 más (total 3) y se intenta
    // bajar a free (límite 1) — debe rechazarse, no dejar la cuenta
    // "ya excedida" apenas cambia de plan.
    const b1 = await callApi(
      app,
      'POST',
      '/branches',
      { name: `Sucursal Downgrade 1 ${uniqueSuffix()}` },
      tenant.accessToken,
    );
    const b2 = await callApi(
      app,
      'POST',
      '/branches',
      { name: `Sucursal Downgrade 2 ${uniqueSuffix()}` },
      tenant.accessToken,
    );
    expect(b1.status).toBe(201);
    expect(b2.status).toBe(201);

    const res = await callApi(
      app,
      'POST',
      '/organizations/me/subscription/change-plan',
      { planKey: 'free' },
      tenant.accessToken,
    );
    expect(res.status).toBe(409);
    expect(JSON.stringify(res.body)).toContain('sucursales');

    // Confirma que el plan NO cambió (sigue en basic).
    const current = await callApi<ApiSubscription>(
      app,
      'GET',
      '/organizations/me/subscription',
      undefined,
      tenant.accessToken,
    );
    expect(current.body.plan.key).toBe('basic');
  });

  it('un planKey inválido es rechazado por el DTO (400), nunca llega al service', async () => {
    const res = await callApi(
      app,
      'POST',
      '/organizations/me/subscription/change-plan',
      { planKey: 'platinum' },
      tenant.accessToken,
    );
    expect(res.status).toBe(400);
  });

  it('cancelar deja la suscripción CANCELLED; cancelar de nuevo es idempotente', async () => {
    const res = await callApi<ApiSubscription>(
      app,
      'POST',
      '/organizations/me/subscription/cancel',
      {},
      tenant.accessToken,
    );
    expect(res.status).toBe(201);
    expect(res.body.status).toBe('CANCELLED');

    const again = await callApi<ApiSubscription>(
      app,
      'POST',
      '/organizations/me/subscription/cancel',
      {},
      tenant.accessToken,
    );
    expect(again.status).toBe(201);
    expect(again.body.status).toBe('CANCELLED');
  });

  it('renovar una suscripción CANCELLED la reactiva (ACTIVE) — sirve como "renovación manual" / reactivación', async () => {
    const res = await callApi<ApiSubscription>(
      app,
      'POST',
      '/organizations/me/subscription/renew',
      {},
      tenant.accessToken,
    );
    expect(res.status).toBe(201);
    expect(res.body.status).toBe('ACTIVE');
    expect(res.body.currentPeriodEnd).not.toBeNull();
  });

  it('renovar el plan gratuito devuelve 400 (no tiene período que renovar)', async () => {
    const freeTenant = await registerTestOrg(app, 'Subscriptions-Renew-Free');
    const res = await callApi(
      app,
      'POST',
      '/organizations/me/subscription/renew',
      {},
      freeTenant.accessToken,
    );
    expect(res.status).toBe(400);
  });

  it('expiración perezosa: una suscripción ACTIVE con currentPeriodEnd vencido pasa a PAST_DUE al leerla', async () => {
    const expTenant = await registerTestOrg(app, 'Subscriptions-Expiry');
    await callApi(
      app,
      'POST',
      '/organizations/me/subscription/change-plan',
      { planKey: 'basic' },
      expTenant.accessToken,
    );

    // Fuerza el vencimiento directo en DB (no hay forma de "esperar 30
    // días" en un test) — mismo criterio que otros tests que mutan datos
    // directo vía Prisma cuando no hay endpoint de edición.
    const tenantPrisma = app.get(TenantPrismaService);
    await tenantPrisma.run(expTenant.organizationId, (tx) =>
      tx.subscription.update({
        where: { organizationId: expTenant.organizationId },
        data: { currentPeriodEnd: new Date(Date.now() - 1000 * 60 * 60) },
      }),
    );

    const res = await callApi<ApiSubscription>(
      app,
      'GET',
      '/organizations/me/subscription',
      undefined,
      expTenant.accessToken,
    );
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('PAST_DUE');

    const events = await tenantPrisma.run(expTenant.organizationId, (tx) =>
      tx.subscriptionEvent.findMany({
        where: { organizationId: expTenant.organizationId, type: 'expired' },
      }),
    );
    expect(events.length).toBeGreaterThan(0);
  });

  it('el uso (usage) refleja creaciones reales de sucursales y productos', async () => {
    const usageTenant = await registerTestOrg(app, 'Subscriptions-Usage');
    // free solo permite 1 sucursal (ya la trae el bootstrap) — se sube a
    // basic (3 sucursales) para poder probar que el conteo de uso crece
    // con una creación real, sin chocar con el propio límite del plan.
    await callApi(
      app,
      'POST',
      '/organizations/me/subscription/change-plan',
      { planKey: 'basic' },
      usageTenant.accessToken,
    );
    await callApi(
      app,
      'POST',
      '/branches',
      { name: `Sucursal Uso ${uniqueSuffix()}` },
      usageTenant.accessToken,
    );
    await callApi(
      app,
      'POST',
      '/products',
      { name: `Producto Uso ${uniqueSuffix()}`, price: 10 },
      usageTenant.accessToken,
    );
    await callApi(
      app,
      'POST',
      '/products',
      { name: `Producto Uso 2 ${uniqueSuffix()}`, price: 10 },
      usageTenant.accessToken,
    );

    const res = await callApi<ApiSubscription>(
      app,
      'GET',
      '/organizations/me/subscription',
      undefined,
      usageTenant.accessToken,
    );
    expect(res.body.usage.branches.used).toBe(2); // la principal del bootstrap + la nueva
    expect(res.body.usage.products.used).toBe(2);
  });

  it('registrar cambios de plan/cancelación/renovación deja SubscriptionEvent y AuditLog', async () => {
    const evTenant = await registerTestOrg(app, 'Subscriptions-Events');
    await callApi(
      app,
      'POST',
      '/organizations/me/subscription/change-plan',
      { planKey: 'pro' },
      evTenant.accessToken,
    );
    await callApi(
      app,
      'POST',
      '/organizations/me/subscription/cancel',
      {},
      evTenant.accessToken,
    );
    await callApi(
      app,
      'POST',
      '/organizations/me/subscription/renew',
      {},
      evTenant.accessToken,
    );

    const tenantPrisma = app.get(TenantPrismaService);
    const events = await tenantPrisma.run(evTenant.organizationId, (tx) =>
      tx.subscriptionEvent.findMany({
        where: { organizationId: evTenant.organizationId },
      }),
    );
    const types = events.map((e) => e.type).sort();
    expect(types).toEqual(['cancelled', 'plan_changed', 'renewed']);

    await new Promise((resolve) => setTimeout(resolve, 1000));
    const logs = await tenantPrisma.run(evTenant.organizationId, (tx) =>
      tx.auditLog.findMany({
        where: {
          organizationId: evTenant.organizationId,
          action: { startsWith: 'subscription.' },
        },
      }),
    );
    const actions = logs.map((l) => l.action).sort();
    expect(actions).toEqual([
      'subscription.cancelled',
      'subscription.plan_changed',
      'subscription.renewed',
    ]);
  });
});
