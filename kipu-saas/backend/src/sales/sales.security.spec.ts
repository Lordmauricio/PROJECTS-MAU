import { INestApplication } from '@nestjs/common';
import {
  ApiSale,
  bootTestApp,
  callApi,
  createProductWithStock,
  createUserWithRole,
  registerTestOrg,
  TestTenant,
} from '../test-support/integration-app';

describe('Ventas/POS — tenant isolation, RLS y RBAC (integración, DB real)', () => {
  let app: INestApplication;
  let tenantA: TestTenant;
  let tenantB: TestTenant;

  beforeAll(async () => {
    app = await bootTestApp();
    tenantA = await registerTestOrg(app, 'Sales-Security-A');
    tenantB = await registerTestOrg(app, 'Sales-Security-B');
  }, 30000);

  afterAll(async () => {
    await app.close();
  });

  async function createSaleAs(
    tenant: TestTenant,
    token: string,
    productId: string,
  ) {
    return callApi<ApiSale>(
      app,
      'POST',
      '/sales',
      {
        posTerminalId: tenant.posTerminalId,
        warehouseId: tenant.warehouseId,
        items: [{ productId, quantity: 1 }],
      },
      token,
    );
  }

  it('14) Tenant B no puede leer, pagar, cancelar ni devolver una venta de Tenant A (aunque conozca el id)', async () => {
    const { productId } = await createProductWithStock(app, tenantA, {
      name: 'Aislada',
      price: 10,
      quantity: 10,
    });
    const sale = await createSaleAs(tenantA, tenantA.accessToken, productId);
    const saleId = sale.body.id;

    const readAsB = await callApi<ApiSale>(
      app,
      'GET',
      `/sales/${saleId}`,
      undefined,
      tenantB.accessToken,
    );
    expect(readAsB.status).toBe(404); // ni pistas de que la venta existe

    const confirmAsB = await callApi<ApiSale>(
      app,
      'POST',
      `/sales/${saleId}/confirm`,
      {},
      tenantB.accessToken,
    );
    expect(confirmAsB.status).toBe(404);

    const payAsB = await callApi<ApiSale>(
      app,
      'POST',
      `/sales/${saleId}/payments`,
      { method: 'CASH', amount: 1, idempotencyKey: `cross-tenant-${saleId}` },
      tenantB.accessToken,
    );
    expect(payAsB.status).toBe(404);

    const cancelAsB = await callApi<ApiSale>(
      app,
      'POST',
      `/sales/${saleId}/cancel`,
      {},
      tenantB.accessToken,
    );
    expect(cancelAsB.status).toBe(404);

    // A sigue viendo su propia venta sin problema.
    const readAsA = await callApi<ApiSale>(
      app,
      'GET',
      `/sales/${saleId}`,
      undefined,
      tenantA.accessToken,
    );
    expect(readAsA.status).toBe(200);
  });

  it('14b) el listado de B nunca incluye ventas de A, y viceversa', async () => {
    const listA = await callApi<ApiSale[]>(
      app,
      'GET',
      '/sales',
      undefined,
      tenantA.accessToken,
    );
    const listB = await callApi<ApiSale[]>(
      app,
      'GET',
      '/sales',
      undefined,
      tenantB.accessToken,
    );
    const idsA = listA.body.map((s) => s.id);
    const idsB = listB.body.map((s) => s.id);
    expect(idsA.some((id) => idsB.includes(id))).toBe(false);
  });

  it('16) un usuario con sales.create pero SIN sales.delete no puede cancelar ni devolver (403)', async () => {
    const salesToken = await createUserWithRole(
      app,
      tenantA.organizationId,
      'SALES',
    ); // SALES: sales.create/read, sin sales.delete
    const { productId } = await createProductWithStock(app, tenantA, {
      name: 'Rol Sales',
      price: 10,
      quantity: 10,
    });

    const sale = await createSaleAs(tenantA, salesToken, productId);
    expect(sale.status).toBe(201); // sales.create sí lo tiene

    const cancel = await callApi<ApiSale>(
      app,
      'POST',
      `/sales/${sale.body.id}/cancel`,
      {},
      salesToken,
    );
    expect(cancel.status).toBe(403); // sales.delete NO lo tiene

    await callApi<ApiSale>(
      app,
      'POST',
      `/sales/${sale.body.id}/confirm`,
      {},
      tenantA.accessToken,
    ); // confirmarla como OWNER para poder intentar devolución
    const ret = await callApi<ApiSale>(
      app,
      'POST',
      `/sales/${sale.body.id}/return`,
      {},
      salesToken,
    );
    expect(ret.status).toBe(403);
  });

  it('17) un usuario sin sales.create no puede crear ventas (403), y el endpoint nunca queda sin declaración de permiso', async () => {
    const inventoryToken = await createUserWithRole(
      app,
      tenantA.organizationId,
      'INVENTORY',
    ); // sin ningún permiso sales.*
    const { productId } = await createProductWithStock(app, tenantA, {
      name: 'Rol Inventory',
      price: 10,
      quantity: 10,
    });

    const attempt = await createSaleAs(tenantA, inventoryToken, productId);
    expect(attempt.status).toBe(403);
  });

  it('un usuario sin ningún token no puede acceder a /sales (401, no 200 ni 500)', async () => {
    const res = await callApi<ApiSale[]>(app, 'GET', '/sales');
    expect(res.status).toBe(401);
  });
});
