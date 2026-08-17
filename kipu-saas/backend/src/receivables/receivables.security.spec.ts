import { INestApplication } from '@nestjs/common';
import {
  ApiReceivable,
  ApiSale,
  bootTestApp,
  callApi,
  createProductWithStock,
  createTestCustomer,
  createUserWithRole,
  registerTestOrg,
  TestTenant,
  uniqueSuffix,
} from '../test-support/integration-app';
import { PrismaService } from '../prisma/prisma.service';

describe('Receivables — tenant isolation, RLS y RBAC (integración, DB real)', () => {
  let app: INestApplication;
  let tenantA: TestTenant;
  let tenantB: TestTenant;
  let customerAId: string;

  beforeAll(async () => {
    app = await bootTestApp();
    tenantA = await registerTestOrg(app, 'Receivables-Security-A');
    tenantB = await registerTestOrg(app, 'Receivables-Security-B');
    customerAId = (await createTestCustomer(app, tenantA, 'Cliente A'))
      .customerId;
  }, 30000);

  afterAll(async () => {
    await app.close();
  }, 15000);

  async function creditSaleAsA() {
    const { productId } = await createProductWithStock(app, tenantA, {
      name: `Producto Seguridad ${uniqueSuffix()}`,
      price: 70,
      quantity: 5,
    });
    const sale = await callApi<ApiSale>(
      app,
      'POST',
      '/sales',
      {
        posTerminalId: tenantA.posTerminalId,
        warehouseId: tenantA.warehouseId,
        customerId: customerAId,
        items: [{ productId, quantity: 1 }],
      },
      tenantA.accessToken,
    );
    await callApi<ApiSale>(
      app,
      'POST',
      `/sales/${sale.body.id}/confirm`,
      {},
      tenantA.accessToken,
    );
    const list = await callApi<ApiReceivable[]>(
      app,
      'GET',
      '/receivables',
      undefined,
      tenantA.accessToken,
    );
    const receivable = list.body.find((r) => r.saleId === sale.body.id);
    if (!receivable) throw new Error('sin receivable');
    return receivable;
  }

  it('17) Tenant B nunca ve ni puede pagar una Receivable de Tenant A', async () => {
    const receivable = await creditSaleAsA();

    const readAsB = await callApi<ApiReceivable>(
      app,
      'GET',
      `/receivables/${receivable.id}`,
      undefined,
      tenantB.accessToken,
    );
    expect(readAsB.status).toBe(404);

    const payAsB = await callApi<ApiSale>(
      app,
      'POST',
      `/receivables/${receivable.id}/payments`,
      {
        method: 'CASH',
        amount: 1,
        idempotencyKey: `cross-tenant-recv-${uniqueSuffix()}`,
      },
      tenantB.accessToken,
    );
    expect(payAsB.status).toBe(404);

    const readAsA = await callApi<ApiReceivable>(
      app,
      'GET',
      `/receivables/${receivable.id}`,
      undefined,
      tenantA.accessToken,
    );
    expect(readAsA.status).toBe(200);
  });

  it('el listado de Receivables de B nunca incluye las de A, y viceversa', async () => {
    const listA = await callApi<ApiReceivable[]>(
      app,
      'GET',
      '/receivables',
      undefined,
      tenantA.accessToken,
    );
    const listB = await callApi<ApiReceivable[]>(
      app,
      'GET',
      '/receivables',
      undefined,
      tenantB.accessToken,
    );
    const idsA = listA.body.map((r) => r.id);
    const idsB = listB.body.map((r) => r.id);
    expect(idsA.some((id) => idsB.includes(id))).toBe(false);
  });

  it('18) RLS crudo: con contexto de tenant inexistente, receivables no devuelve nada (fail-closed)', async () => {
    const prisma = app.get(PrismaService);
    const receivable = await creditSaleAsA();

    const forA = await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.current_tenant', ${tenantA.organizationId}, true)`;
      return tx.receivable.findMany({ where: { id: receivable.id } });
    });
    expect(forA.length).toBeGreaterThan(0);
    expect(forA.every((r) => r.organizationId === tenantA.organizationId)).toBe(
      true,
    );

    const none = await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.current_tenant', ${'org-inexistente-receivable'}, true)`;
      return tx.receivable.findMany({ where: { id: receivable.id } });
    });
    expect(none).toHaveLength(0);
  });

  it('19) un usuario con receivables.read pero SIN receivables.manage puede consultar, pero no pagar (403)', async () => {
    const managerToken = await createUserWithRole(
      app,
      tenantA.organizationId,
      'MANAGER',
    ); // MANAGER: receivables.read, sin receivables.manage
    const receivable = await creditSaleAsA();

    const readAsManager = await callApi<ApiReceivable>(
      app,
      'GET',
      `/receivables/${receivable.id}`,
      undefined,
      managerToken,
    );
    expect(readAsManager.status).toBe(200);

    const payAsManager = await callApi<ApiSale>(
      app,
      'POST',
      `/receivables/${receivable.id}/payments`,
      {
        method: 'CASH',
        amount: 1,
        idempotencyKey: `rbac-manager-recv-${uniqueSuffix()}`,
      },
      managerToken,
    );
    expect(payAsManager.status).toBe(403);
  });

  it('un usuario con receivables.manage (ACCOUNTANT) sí puede pagar', async () => {
    const accountantToken = await createUserWithRole(
      app,
      tenantA.organizationId,
      'ACCOUNTANT',
    );
    const receivable = await creditSaleAsA();

    const pay = await callApi<ApiSale>(
      app,
      'POST',
      `/receivables/${receivable.id}/payments`,
      {
        method: 'CASH',
        amount: 1,
        idempotencyKey: `rbac-accountant-recv-${uniqueSuffix()}`,
      },
      accountantToken,
    );
    expect(pay.status).toBe(201);
  });

  it('un usuario sin ningún token no puede acceder a /receivables (401)', async () => {
    const res = await callApi<ApiReceivable[]>(app, 'GET', '/receivables');
    expect(res.status).toBe(401);
  });
});
