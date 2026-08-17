import { INestApplication } from '@nestjs/common';
import {
  ApiCashRegister,
  ApiPurchase,
  ApiSale,
  bootTestApp,
  callApi,
  createProductWithStock,
  createTestCustomer,
  createTestPosTerminal,
  createTestProduct,
  createTestSupplier,
  openCashRegister,
  registerTestOrg,
  TestTenant,
  uniqueSuffix,
} from '../test-support/integration-app';
import { TenantPrismaService } from '../prisma/tenant-prisma.service';

interface ApiNotification {
  id: string;
  type: string;
  title: string;
  message: string;
  read: boolean;
  readAt: string | null;
  createdAt: string;
}

interface ApiNotificationsPage {
  items: ApiNotification[];
  total: number;
  page: number;
  pageSize: number;
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

async function notificationsOfType(
  app: INestApplication,
  organizationId: string,
  userId: string,
  type: string,
): Promise<ApiNotification[]> {
  const tenantPrisma = app.get(TenantPrismaService);
  return tenantPrisma.run(organizationId, (tx) =>
    tx.notification.findMany({ where: { organizationId, userId, type } }),
  ) as unknown as Promise<ApiNotification[]>;
}

describe('Notificaciones — integración (eventos reales de negocio, DB real)', () => {
  let app: INestApplication;
  let tenant: TestTenant;
  let ownerId: string;
  let productId: string;
  let customerId: string;

  beforeAll(async () => {
    app = await bootTestApp();
    tenant = await registerTestOrg(app, 'Notifications-Integration');
    ownerId = await meUserId(app, tenant.accessToken);
    productId = (
      await createProductWithStock(app, tenant, {
        name: `Producto Notif ${uniqueSuffix()}`,
        price: 100,
        quantity: 100,
      })
    ).productId;
    customerId = (
      await createTestCustomer(app, tenant, `Cliente Notif ${uniqueSuffix()}`)
    ).customerId;
    await openCashRegister(app, tenant, { openingAmount: 0 });
  }, 30000);

  afterAll(async () => {
    await app.close();
  }, 15000);

  it('confirmar una venta crea una notificación "sale.confirmed" para el actor', async () => {
    const before = await notificationsOfType(
      app,
      tenant.organizationId,
      ownerId,
      'sale.confirmed',
    );

    const createRes = await callApi<ApiSale>(
      app,
      'POST',
      '/sales',
      {
        posTerminalId: tenant.posTerminalId,
        warehouseId: tenant.warehouseId,
        items: [{ productId, quantity: 1, unitPrice: 100 }],
      },
      tenant.accessToken,
    );
    const confirmRes = await callApi<ApiSale>(
      app,
      'POST',
      `/sales/${createRes.body.id}/confirm`,
      {
        payments: [
          {
            method: 'CASH',
            amount: 100,
            idempotencyKey: `pago-${uniqueSuffix()}`,
          },
        ],
      },
      tenant.accessToken,
    );
    expect(confirmRes.status).toBe(201);

    const after = await notificationsOfType(
      app,
      tenant.organizationId,
      ownerId,
      'sale.confirmed',
    );
    expect(after.length).toBe(before.length + 1);
    expect(after[after.length - 1].message).toMatch(/100(\.00)?/);
  });

  it('un pago adicional sobre una venta a crédito crea "sale.payment_received" y NO duplica "sale.confirmed"', async () => {
    const createRes = await callApi<ApiSale>(
      app,
      'POST',
      '/sales',
      {
        posTerminalId: tenant.posTerminalId,
        warehouseId: tenant.warehouseId,
        customerId,
        items: [{ productId, quantity: 1, unitPrice: 100 }],
      },
      tenant.accessToken,
    );
    await callApi(
      app,
      'POST',
      `/sales/${createRes.body.id}/confirm`,
      { payments: [] },
      tenant.accessToken,
    );

    const beforePayment = await notificationsOfType(
      app,
      tenant.organizationId,
      ownerId,
      'sale.payment_received',
    );

    const paymentRes = await callApi(
      app,
      'POST',
      `/sales/${createRes.body.id}/payments`,
      {
        method: 'CASH',
        amount: 100,
        idempotencyKey: `saldo-${uniqueSuffix()}`,
      },
      tenant.accessToken,
    );
    expect(paymentRes.status).toBe(201);

    const afterPayment = await notificationsOfType(
      app,
      tenant.organizationId,
      ownerId,
      'sale.payment_received',
    );
    expect(afterPayment.length).toBe(beforePayment.length + 1);
  });

  it('una venta a crédito sin pago genera "receivable.pending"', async () => {
    const createRes = await callApi<ApiSale>(
      app,
      'POST',
      '/sales',
      {
        posTerminalId: tenant.posTerminalId,
        warehouseId: tenant.warehouseId,
        customerId,
        items: [{ productId, quantity: 1, unitPrice: 50 }],
      },
      tenant.accessToken,
    );
    const before = await notificationsOfType(
      app,
      tenant.organizationId,
      ownerId,
      'receivable.pending',
    );
    await callApi(
      app,
      'POST',
      `/sales/${createRes.body.id}/confirm`,
      { payments: [] },
      tenant.accessToken,
    );
    const after = await notificationsOfType(
      app,
      tenant.organizationId,
      ownerId,
      'receivable.pending',
    );
    expect(after.length).toBe(before.length + 1);
  });

  it('confirmar una venta ya confirmada (replay idempotente) NO genera una segunda notificación', async () => {
    const createRes = await callApi<ApiSale>(
      app,
      'POST',
      '/sales',
      {
        posTerminalId: tenant.posTerminalId,
        warehouseId: tenant.warehouseId,
        items: [{ productId, quantity: 1, unitPrice: 20 }],
      },
      tenant.accessToken,
    );
    await callApi(
      app,
      'POST',
      `/sales/${createRes.body.id}/confirm`,
      {
        payments: [
          {
            method: 'CASH',
            amount: 20,
            idempotencyKey: `pago-replay-${uniqueSuffix()}`,
          },
        ],
      },
      tenant.accessToken,
    );
    const before = await notificationsOfType(
      app,
      tenant.organizationId,
      ownerId,
      'sale.confirmed',
    );
    // Segundo POST /confirm sobre la misma venta ya CONFIRMED: no falla,
    // devuelve el mismo estado (ver SalesService.confirm), y no debe sumar
    // una notificación nueva.
    const second = await callApi(
      app,
      'POST',
      `/sales/${createRes.body.id}/confirm`,
      { payments: [] },
      tenant.accessToken,
    );
    expect(second.status).toBe(201);
    const after = await notificationsOfType(
      app,
      tenant.organizationId,
      ownerId,
      'sale.confirmed',
    );
    expect(after.length).toBe(before.length);
  });

  it('recibir una compra crea "purchase.received" y, en la primera recepción con saldo, "payable.pending"', async () => {
    const supplierId = (
      await createTestSupplier(app, tenant, `Proveedor Notif ${uniqueSuffix()}`)
    ).supplierId;
    const prod = (
      await createTestProduct(app, tenant, {
        name: `Producto Compra Notif ${uniqueSuffix()}`,
        cost: 30,
      })
    ).productId;
    const createRes = await callApi<ApiPurchase>(
      app,
      'POST',
      '/purchases',
      {
        supplierId,
        warehouseId: tenant.warehouseId,
        items: [{ productId: prod, quantity: 5, unitCost: 30 }],
      },
      tenant.accessToken,
    );
    await callApi(
      app,
      'POST',
      `/purchases/${createRes.body.id}/confirm`,
      {},
      tenant.accessToken,
    );

    const beforeReceived = await notificationsOfType(
      app,
      tenant.organizationId,
      ownerId,
      'purchase.received',
    );
    const beforePayable = await notificationsOfType(
      app,
      tenant.organizationId,
      ownerId,
      'payable.pending',
    );

    const item = createRes.body.items[0];
    const receiveRes = await callApi(
      app,
      'POST',
      `/purchases/${createRes.body.id}/receive`,
      {
        idempotencyKey: `recepcion-${uniqueSuffix()}`,
        items: [{ purchaseItemId: item.id, quantity: 5 }],
      },
      tenant.accessToken,
    );
    expect(receiveRes.status).toBe(201);

    const afterReceived = await notificationsOfType(
      app,
      tenant.organizationId,
      ownerId,
      'purchase.received',
    );
    const afterPayable = await notificationsOfType(
      app,
      tenant.organizationId,
      ownerId,
      'payable.pending',
    );
    expect(afterReceived.length).toBe(beforeReceived.length + 1);
    expect(afterPayable.length).toBe(beforePayable.length + 1);
  });

  it('abrir y cerrar caja crean "cash.opened" y "cash.closed"; un arqueo con diferencia crea "cash.discrepancy"', async () => {
    const posTerminalId = (
      await createTestPosTerminal(app, tenant, `POS Notif ${uniqueSuffix()}`)
    ).posTerminalId;
    const beforeOpen = await notificationsOfType(
      app,
      tenant.organizationId,
      ownerId,
      'cash.opened',
    );
    const register = await openCashRegister(app, tenant, {
      openingAmount: 10,
      posTerminalId,
    });
    const afterOpen = await notificationsOfType(
      app,
      tenant.organizationId,
      ownerId,
      'cash.opened',
    );
    expect(afterOpen.length).toBe(beforeOpen.length + 1);

    const beforeClose = await notificationsOfType(
      app,
      tenant.organizationId,
      ownerId,
      'cash.closed',
    );
    const beforeDiscrepancy = await notificationsOfType(
      app,
      tenant.organizationId,
      ownerId,
      'cash.discrepancy',
    );
    const closeRes = await callApi<ApiCashRegister>(
      app,
      'POST',
      `/cash-registers/${register.id}/close`,
      { countedAmount: 999, idempotencyKey: `cierre-${uniqueSuffix()}` },
      tenant.accessToken,
    );
    expect(closeRes.status).toBe(201);
    const afterClose = await notificationsOfType(
      app,
      tenant.organizationId,
      ownerId,
      'cash.closed',
    );
    const afterDiscrepancy = await notificationsOfType(
      app,
      tenant.organizationId,
      ownerId,
      'cash.discrepancy',
    );
    expect(afterClose.length).toBe(beforeClose.length + 1);
    expect(afterDiscrepancy.length).toBe(beforeDiscrepancy.length + 1); // 999 != 10 esperado
  });

  // ---------------------------------------------------------------------
  // API: listar / contador / marcar leída / marcar todas / paginación
  // ---------------------------------------------------------------------
  it('GET /notifications/unread-count refleja el número real de no leídas', async () => {
    const before = await callApi<{ count: number }>(
      app,
      'GET',
      '/notifications/unread-count',
      undefined,
      tenant.accessToken,
    );
    const posTerminalId = (
      await createTestPosTerminal(app, tenant, `POS Count ${uniqueSuffix()}`)
    ).posTerminalId;
    await openCashRegister(app, tenant, { openingAmount: 0, posTerminalId });
    const after = await callApi<{ count: number }>(
      app,
      'GET',
      '/notifications/unread-count',
      undefined,
      tenant.accessToken,
    );
    expect(after.body.count).toBe(before.body.count + 1);
  });

  it('PATCH /notifications/:id/read marca una notificación como leída y baja el contador', async () => {
    const posTerminalId = (
      await createTestPosTerminal(app, tenant, `POS Read ${uniqueSuffix()}`)
    ).posTerminalId;
    await openCashRegister(app, tenant, { openingAmount: 0, posTerminalId });
    const list = await callApi<ApiNotificationsPage>(
      app,
      'GET',
      '/notifications?unreadOnly=true&pageSize=1',
      undefined,
      tenant.accessToken,
    );
    expect(list.body.items.length).toBe(1);
    const target = list.body.items[0];
    expect(target.read).toBe(false);

    const before = await callApi<{ count: number }>(
      app,
      'GET',
      '/notifications/unread-count',
      undefined,
      tenant.accessToken,
    );
    const markRes = await callApi<ApiNotification>(
      app,
      'PATCH',
      `/notifications/${target.id}/read`,
      {},
      tenant.accessToken,
    );
    expect(markRes.status).toBe(200);
    expect(markRes.body.read).toBe(true);
    expect(markRes.body.readAt).not.toBeNull();
    const after = await callApi<{ count: number }>(
      app,
      'GET',
      '/notifications/unread-count',
      undefined,
      tenant.accessToken,
    );
    expect(after.body.count).toBe(before.body.count - 1);
  });

  it('PATCH /notifications/read-all deja el contador de no leídas en 0', async () => {
    const posTerminalId = (
      await createTestPosTerminal(app, tenant, `POS ReadAll ${uniqueSuffix()}`)
    ).posTerminalId;
    await openCashRegister(app, tenant, { openingAmount: 0, posTerminalId });
    const res = await callApi<{ updated: number }>(
      app,
      'PATCH',
      '/notifications/read-all',
      {},
      tenant.accessToken,
    );
    expect(res.status).toBe(200);
    expect(res.body.updated).toBeGreaterThan(0);
    const count = await callApi<{ count: number }>(
      app,
      'GET',
      '/notifications/unread-count',
      undefined,
      tenant.accessToken,
    );
    expect(count.body.count).toBe(0);
  });

  it('GET /notifications pagina correctamente (pageSize=1 nunca devuelve más de un ítem)', async () => {
    const res = await callApi<ApiNotificationsPage>(
      app,
      'GET',
      '/notifications?page=1&pageSize=1',
      undefined,
      tenant.accessToken,
    );
    expect(res.status).toBe(200);
    expect(res.body.items.length).toBeLessThanOrEqual(1);
    expect(res.body.pageSize).toBe(1);
    expect(res.body.total).toBeGreaterThan(0);
  });

  it('marcar como leída una notificación inexistente da 404', async () => {
    const res = await callApi(
      app,
      'PATCH',
      '/notifications/no-existe-123/read',
      {},
      tenant.accessToken,
    );
    expect(res.status).toBe(404);
  });
});
