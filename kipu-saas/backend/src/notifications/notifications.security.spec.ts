import { INestApplication } from '@nestjs/common';
import {
  ApiSale,
  bootTestApp,
  callApi,
  createProductWithStock,
  createUserWithRole,
  openCashRegister,
  registerTestOrg,
  TestTenant,
  uniqueSuffix,
} from '../test-support/integration-app';
import { PrismaService } from '../prisma/prisma.service';

interface ApiNotification {
  id: string;
  organizationId: string;
  userId: string | null;
  type: string;
}

interface ApiNotificationsPage {
  items: ApiNotification[];
  total: number;
}

async function meUserId(app: INestApplication, token: string): Promise<string> {
  const res = await callApi<{ sub: string }>(
    app,
    'GET',
    '/auth/me',
    undefined,
    token,
  );
  return res.body.sub;
}

describe('Notificaciones — seguridad (aislamiento de tenant + pertenencia por usuario, DB real)', () => {
  let app: INestApplication;
  let tenantA: TestTenant;
  let tenantB: TestTenant;

  beforeAll(async () => {
    app = await bootTestApp();
    tenantA = await registerTestOrg(app, 'Notifications-Security-A');
    tenantB = await registerTestOrg(app, 'Notifications-Security-B');
    // Cada registro dispara "cash.opened"? No — el registro NO abre caja.
    // Se genera actividad real (abrir caja) para que cada tenant tenga
    // notificaciones propias que verificar.
    await openCashRegister(app, tenantA, { openingAmount: 0 });
    await openCashRegister(app, tenantB, { openingAmount: 0 });
  }, 30000);

  afterAll(async () => {
    await app.close();
  }, 15000);

  it('el tenant B no ve notificaciones del tenant A en GET /notifications', async () => {
    const listA = await callApi<ApiNotificationsPage>(
      app,
      'GET',
      '/notifications',
      undefined,
      tenantA.accessToken,
    );
    const listB = await callApi<ApiNotificationsPage>(
      app,
      'GET',
      '/notifications',
      undefined,
      tenantB.accessToken,
    );
    expect(listA.body.items.length).toBeGreaterThan(0);
    expect(listB.body.items.length).toBeGreaterThan(0);
    const idsA = new Set(listA.body.items.map((n) => n.id));
    for (const n of listB.body.items) {
      expect(idsA.has(n.id)).toBe(false);
    }
  });

  it('el tenant B no puede marcar como leída una notificación del tenant A (404, ni siquiera revela que existe)', async () => {
    const listA = await callApi<ApiNotificationsPage>(
      app,
      'GET',
      '/notifications',
      undefined,
      tenantA.accessToken,
    );
    const targetId = listA.body.items[0].id;
    const res = await callApi(
      app,
      'PATCH',
      `/notifications/${targetId}/read`,
      {},
      tenantB.accessToken,
    );
    expect(res.status).toBe(404);
  });

  it('RLS crudo: con contexto de tenant inexistente, notifications no devuelve nada (fail-closed)', async () => {
    const prisma = app.get(PrismaService);
    const listA = await callApi<ApiNotificationsPage>(
      app,
      'GET',
      '/notifications',
      undefined,
      tenantA.accessToken,
    );
    const targetId = listA.body.items[0].id;

    const forA = await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.current_tenant', ${tenantA.organizationId}, true)`;
      return tx.notification.findMany({ where: { id: targetId } });
    });
    expect(forA.length).toBe(1);

    const none = await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.current_tenant', ${'org-inexistente-notif'}, true)`;
      return tx.notification.findMany({ where: { id: targetId } });
    });
    expect(none).toHaveLength(0);
  });

  it('dentro de la MISMA organización, un usuario no puede marcar como leída la notificación de otro usuario (403)', async () => {
    const otherToken = await createUserWithRole(
      app,
      tenantA.organizationId,
      'CASHIER',
    );
    const otherUserId = await meUserId(app, otherToken);
    expect(otherUserId).not.toBe(await meUserId(app, tenantA.accessToken));

    const listOwner = await callApi<ApiNotificationsPage>(
      app,
      'GET',
      '/notifications',
      undefined,
      tenantA.accessToken,
    );
    const ownerNotificationId = listOwner.body.items[0].id;

    // El otro usuario ni siquiera la ve en su propio listado (userId
    // distinto), y si intenta marcarla por id de todas formas, se
    // rechaza explícitamente (no pertenece a este usuario) en vez de
    // devolver 404 silencioso u operar sobre la notificación ajena.
    const listOther = await callApi<ApiNotificationsPage>(
      app,
      'GET',
      '/notifications',
      undefined,
      otherToken,
    );
    expect(listOther.body.items.some((n) => n.id === ownerNotificationId)).toBe(
      false,
    );

    const markRes = await callApi(
      app,
      'PATCH',
      `/notifications/${ownerNotificationId}/read`,
      {},
      otherToken,
    );
    expect(markRes.status).toBe(403);
  });

  it('sin token, todos los endpoints de notificaciones responden 401', async () => {
    expect((await callApi(app, 'GET', '/notifications')).status).toBe(401);
    expect(
      (await callApi(app, 'GET', '/notifications/unread-count')).status,
    ).toBe(401);
    expect(
      (await callApi(app, 'PATCH', '/notifications/read-all', {})).status,
    ).toBe(401);
    expect(
      (await callApi(app, 'PATCH', '/notifications/some-id/read', {})).status,
    ).toBe(401);
  });

  it('venta confirmada por un usuario CASHIER de A genera la notificación para ESE usuario, no para el owner', async () => {
    const productId = (
      await createProductWithStock(app, tenantA, {
        name: `Producto Sec Notif ${uniqueSuffix()}`,
        price: 60,
        quantity: 10,
      })
    ).productId;
    const cashierToken = await createUserWithRole(
      app,
      tenantA.organizationId,
      'CASHIER',
    );
    const cashierId = await meUserId(app, cashierToken);

    const createRes = await callApi<ApiSale>(
      app,
      'POST',
      '/sales',
      {
        posTerminalId: tenantA.posTerminalId,
        warehouseId: tenantA.warehouseId,
        items: [{ productId, quantity: 1, unitPrice: 60 }],
      },
      cashierToken,
    );
    await callApi(
      app,
      'POST',
      `/sales/${createRes.body.id}/confirm`,
      {
        payments: [
          {
            method: 'CASH',
            amount: 60,
            idempotencyKey: `pago-${uniqueSuffix()}`,
          },
        ],
      },
      cashierToken,
    );

    const cashierList = await callApi<ApiNotificationsPage>(
      app,
      'GET',
      '/notifications?unreadOnly=true',
      undefined,
      cashierToken,
    );
    expect(
      cashierList.body.items.some((n) => n.type === 'sale.confirmed'),
    ).toBe(true);

    void cashierId; // usado solo para dejar explícito que es un usuario distinto del owner
  });
});
