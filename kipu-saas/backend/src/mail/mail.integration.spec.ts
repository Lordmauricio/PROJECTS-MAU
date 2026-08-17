import { INestApplication } from '@nestjs/common';
import {
  ApiSale,
  bootTestApp,
  callApi,
  createProductWithStock,
  createTestCustomer,
  openCashRegister,
  registerTestOrg,
  TestTenant,
  uniqueSuffix,
} from '../test-support/integration-app';
import { TenantPrismaService } from '../prisma/tenant-prisma.service';
import { MailService } from './mail.service';

interface EmailLogRow {
  id: string;
  to: string;
  template: string;
  status: string;
  provider: string | null;
  error: string | null;
  attempts: number;
  idempotencyKey: string | null;
  relatedEntityType: string | null;
  relatedEntityId: string | null;
}

async function wait(ms: number) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

describe('Email — integración (cola BullMQ real, Redis/Postgres reales)', () => {
  let app: INestApplication;
  let tenant: TestTenant;

  async function emailLogsFor(relatedEntityId: string): Promise<EmailLogRow[]> {
    const tenantPrisma = app.get(TenantPrismaService);
    return tenantPrisma.run(tenant.organizationId, (tx) =>
      tx.emailLog.findMany({ where: { relatedEntityId } }),
    );
  }

  beforeAll(async () => {
    app = await bootTestApp();
    tenant = await registerTestOrg(app, 'Mail-Integration');
    await openCashRegister(app, tenant, { openingAmount: 0 });
  }, 30000);

  afterAll(async () => {
    await app.close();
  }, 15000);

  it('registrar una organización encola el email de bienvenida y termina SENT (proveedor console)', async () => {
    const suffix = uniqueSuffix();
    const email = `owner-welcome-${suffix}@example.test`;
    const res = await callApi(app, 'POST', '/auth/register', {
      organizationName: `Welcome Org ${suffix}`,
      legalName: `Welcome SRL ${suffix}`,
      nit: `TEST-${suffix}`,
      branchName: 'Sucursal Welcome',
      ownerName: 'Owner Welcome',
      email,
      password: 'Password123!',
    });
    expect(res.status).toBe(201);

    await wait(1500);

    const tenantPrisma = app.get(TenantPrismaService);
    const organizationId = (res.body as { organization: { id: string } })
      .organization.id;
    const logs = (await tenantPrisma.run(organizationId, (tx) =>
      tx.emailLog.findMany({ where: { to: email, template: 'welcome' } }),
    )) as unknown as EmailLogRow[];
    expect(logs.length).toBe(1);
    expect(logs[0].status).toBe('SENT');
    expect(logs[0].provider).toBe('console');
  });

  it('invitar a un miembro encola el email de invitación y termina SENT', async () => {
    const roles = await callApi<Array<{ id: string; key: string }>>(
      app,
      'GET',
      '/roles',
      undefined,
      tenant.accessToken,
    );
    const cashierRole = roles.body.find((r) => r.key === 'CASHIER')!;
    const email = `invitado-${uniqueSuffix()}@example.test`;

    const inviteRes = await callApi(
      app,
      'POST',
      '/members/invite',
      { email, roleId: cashierRole.id },
      tenant.accessToken,
    );
    expect(inviteRes.status).toBe(201);

    await wait(1500);

    const tenantPrisma = app.get(TenantPrismaService);
    const logs = (await tenantPrisma.run(tenant.organizationId, (tx) =>
      tx.emailLog.findMany({ where: { to: email, template: 'invite' } }),
    )) as unknown as EmailLogRow[];
    expect(logs.length).toBe(1);
    expect(logs[0].status).toBe('SENT');
  });

  it('enviar el recibo por email genera un EmailLog con el PDF adjunto (queued -> sent) y no bloquea el request', async () => {
    const productId = (
      await createProductWithStock(app, tenant, {
        name: `Producto Mail ${uniqueSuffix()}`,
        price: 80,
        quantity: 20,
      })
    ).productId;
    const customerId = (
      await createTestCustomer(app, tenant, `Cliente Mail ${uniqueSuffix()}`)
    ).customerId;
    // El cliente de `createTestCustomer` no tiene email — se sobreescribe
    // vía Prisma para probar el lookup automático (sin `email` en el DTO).
    const tenantPrisma = app.get(TenantPrismaService);
    const customerEmail = `cliente-recibo-${uniqueSuffix()}@example.test`;
    await tenantPrisma.run(tenant.organizationId, (tx) =>
      tx.customer.update({
        where: { id: customerId },
        data: { email: customerEmail },
      }),
    );

    const createRes = await callApi<ApiSale>(
      app,
      'POST',
      '/sales',
      {
        posTerminalId: tenant.posTerminalId,
        warehouseId: tenant.warehouseId,
        customerId,
        items: [{ productId, quantity: 1, unitPrice: 80 }],
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
            amount: 80,
            idempotencyKey: `pago-${uniqueSuffix()}`,
          },
        ],
      },
      tenant.accessToken,
    );
    const issued = await callApi<{ id: string }>(
      app,
      'POST',
      '/receipts',
      { saleId: createRes.body.id },
      tenant.accessToken,
    );
    expect(issued.status).toBe(201);

    const started = Date.now();
    const emailRes = await callApi(
      app,
      'POST',
      `/receipts/${issued.body.id}/email`,
      {},
      tenant.accessToken,
    );
    const elapsed = Date.now() - started;
    expect(emailRes.status).toBe(201);
    expect(emailRes.body).toEqual({ queued: true });
    // No debería tardar segundos esperando al "proveedor" — el request
    // solo encola. 2s es un margen generoso, muy por debajo de lo que
    // tardaría esperar sincrónicamente un envío real.
    expect(elapsed).toBeLessThan(2000);

    await wait(1500);

    const logs = await emailLogsFor(issued.body.id);
    expect(logs.length).toBe(1);
    expect(logs[0].to).toBe(customerEmail);
    expect(logs[0].template).toBe('receipt');
    expect(logs[0].status).toBe('SENT');
    expect(logs[0].relatedEntityType).toBe('CommercialReceipt');
    expect(logs[0].idempotencyKey).toBe(`receipt-email:${issued.body.id}`);
  });

  it('idempotencia: pedir el email del mismo recibo dos veces no produce dos EmailLog ni dos envíos', async () => {
    const productId = (
      await createProductWithStock(app, tenant, {
        name: `Producto Mail Idem ${uniqueSuffix()}`,
        price: 50,
        quantity: 20,
      })
    ).productId;
    const createRes = await callApi<ApiSale>(
      app,
      'POST',
      '/sales',
      {
        posTerminalId: tenant.posTerminalId,
        warehouseId: tenant.warehouseId,
        items: [{ productId, quantity: 1, unitPrice: 50 }],
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
            amount: 50,
            idempotencyKey: `pago-${uniqueSuffix()}`,
          },
        ],
      },
      tenant.accessToken,
    );
    const issued = await callApi<{ id: string }>(
      app,
      'POST',
      '/receipts',
      { saleId: createRes.body.id },
      tenant.accessToken,
    );

    const overrideEmail = `explicito-${uniqueSuffix()}@example.test`;
    const first = await callApi(
      app,
      'POST',
      `/receipts/${issued.body.id}/email`,
      { email: overrideEmail },
      tenant.accessToken,
    );
    expect(first.status).toBe(201);
    await wait(1500);

    const second = await callApi(
      app,
      'POST',
      `/receipts/${issued.body.id}/email`,
      { email: overrideEmail },
      tenant.accessToken,
    );
    expect(second.status).toBe(201);
    await wait(1500);

    const logs = await emailLogsFor(issued.body.id);
    // Dos jobs se encolaron (dos requests), pero el SEGUNDO reconoce que
    // ya existe un EmailLog SENT con la misma idempotencyKey y no reenvía
    // — sigue habiendo una sola fila.
    expect(logs.length).toBe(1);
    expect(logs[0].status).toBe('SENT');
    expect(logs[0].attempts).toBeLessThanOrEqual(1);
  });

  it('sin email de cliente y sin override explícito, devuelve 400 (no intenta adivinar ni omitir el envío en silencio)', async () => {
    const productId = (
      await createProductWithStock(app, tenant, {
        name: `Producto Mail Sin Email ${uniqueSuffix()}`,
        price: 30,
        quantity: 10,
      })
    ).productId;
    const createRes = await callApi<ApiSale>(
      app,
      'POST',
      '/sales',
      {
        posTerminalId: tenant.posTerminalId,
        warehouseId: tenant.warehouseId,
        items: [{ productId, quantity: 1, unitPrice: 30 }],
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
            amount: 30,
            idempotencyKey: `pago-${uniqueSuffix()}`,
          },
        ],
      },
      tenant.accessToken,
    );
    const issued = await callApi<{ id: string }>(
      app,
      'POST',
      '/receipts',
      { saleId: createRes.body.id },
      tenant.accessToken,
    );

    const res = await callApi(
      app,
      'POST',
      `/receipts/${issued.body.id}/email`,
      {},
      tenant.accessToken,
    );
    expect(res.status).toBe(400);
  });

  it('el template de notificación importante se encola y termina SENT (MailService.sendNotificationEmail)', async () => {
    const mail = app.get(MailService);
    const to = `notif-${uniqueSuffix()}@example.test`;
    await mail.sendNotificationEmail(
      tenant.organizationId,
      to,
      'Alerta de prueba',
      'Mensaje de prueba para el template de notificación.',
    );

    await wait(1500);

    const tenantPrisma = app.get(TenantPrismaService);
    const logs = (await tenantPrisma.run(tenant.organizationId, (tx) =>
      tx.emailLog.findMany({ where: { to, template: 'notification' } }),
    )) as unknown as EmailLogRow[];
    expect(logs.length).toBe(1);
    expect(logs[0].status).toBe('SENT');
  });
});
