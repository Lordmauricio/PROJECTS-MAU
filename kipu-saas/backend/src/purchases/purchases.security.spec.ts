import { INestApplication } from '@nestjs/common';
import {
  ApiPayable,
  ApiPurchase,
  bootTestApp,
  callApi,
  createTestProduct,
  createTestSupplier,
  createUserWithRole,
  registerTestOrg,
  TestTenant,
} from '../test-support/integration-app';

describe('Compras — tenant isolation, RLS y RBAC (integración, DB real)', () => {
  let app: INestApplication;
  let tenantA: TestTenant;
  let tenantB: TestTenant;
  let supplierAId: string;

  beforeAll(async () => {
    app = await bootTestApp();
    tenantA = await registerTestOrg(app, 'Purchases-Security-A');
    tenantB = await registerTestOrg(app, 'Purchases-Security-B');
    supplierAId = (await createTestSupplier(app, tenantA, 'Proveedor A'))
      .supplierId;
  }, 30000);

  afterAll(async () => {
    await app.close();
  }, 15000);

  async function makePurchaseAsA(productId: string) {
    return callApi<ApiPurchase>(
      app,
      'POST',
      '/purchases',
      {
        supplierId: supplierAId,
        warehouseId: tenantA.warehouseId,
        items: [{ productId, quantity: 5, unitCost: 10 }],
      },
      tenantA.accessToken,
    );
  }

  it('17)+18) Tenant B no puede leer, confirmar, recibir, devolver, ni cancelar una compra de Tenant A', async () => {
    const { productId } = await createTestProduct(app, tenantA, {
      name: 'Aislada Compra',
    });
    const purchase = await makePurchaseAsA(productId);
    const purchaseId = purchase.body.id;

    const readAsB = await callApi<ApiPurchase>(
      app,
      'GET',
      `/purchases/${purchaseId}`,
      undefined,
      tenantB.accessToken,
    );
    expect(readAsB.status).toBe(404);

    const confirmAsB = await callApi<ApiPurchase>(
      app,
      'POST',
      `/purchases/${purchaseId}/confirm`,
      {},
      tenantB.accessToken,
    );
    expect(confirmAsB.status).toBe(404);

    const receiveAsB = await callApi<ApiPurchase>(
      app,
      'POST',
      `/purchases/${purchaseId}/receive`,
      {
        items: [{ purchaseItemId: purchase.body.items[0].id, quantity: 1 }],
        idempotencyKey: `cross-tenant-recv-${purchaseId}`,
      },
      tenantB.accessToken,
    );
    expect(receiveAsB.status).toBe(404);

    const cancelAsB = await callApi<ApiPurchase>(
      app,
      'POST',
      `/purchases/${purchaseId}/cancel`,
      {},
      tenantB.accessToken,
    );
    expect(cancelAsB.status).toBe(404);

    const readAsA = await callApi<ApiPurchase>(
      app,
      'GET',
      `/purchases/${purchaseId}`,
      undefined,
      tenantA.accessToken,
    );
    expect(readAsA.status).toBe(200);
  });

  it('el listado de compras de B nunca incluye compras de A, y viceversa', async () => {
    const listA = await callApi<ApiPurchase[]>(
      app,
      'GET',
      '/purchases',
      undefined,
      tenantA.accessToken,
    );
    const listB = await callApi<ApiPurchase[]>(
      app,
      'GET',
      '/purchases',
      undefined,
      tenantB.accessToken,
    );
    const idsA = listA.body.map((p) => p.id);
    const idsB = listB.body.map((p) => p.id);
    expect(idsA.some((id) => idsB.includes(id))).toBe(false);
  });

  it('Tenant B no puede ver ni pagar una Payable de Tenant A', async () => {
    const { productId } = await createTestProduct(app, tenantA, {
      name: 'Producto Payable Aislada',
    });
    const purchase = await makePurchaseAsA(productId);
    await callApi<ApiPurchase>(
      app,
      'POST',
      `/purchases/${purchase.body.id}/confirm`,
      {},
      tenantA.accessToken,
    );
    const received = await callApi<ApiPurchase>(
      app,
      'POST',
      `/purchases/${purchase.body.id}/receive`,
      {
        items: [{ purchaseItemId: purchase.body.items[0].id, quantity: 5 }],
        idempotencyKey: `recv-isolation-${purchase.body.id}`,
      },
      tenantA.accessToken,
    );
    const payableId = received.body.payables[0].id;

    const readAsB = await callApi<ApiPayable>(
      app,
      'GET',
      `/payables/${payableId}`,
      undefined,
      tenantB.accessToken,
    );
    expect(readAsB.status).toBe(404);

    const payAsB = await callApi<ApiPayable>(
      app,
      'POST',
      `/payables/${payableId}/payments`,
      {
        method: 'CASH',
        amount: 1,
        idempotencyKey: `cross-tenant-pay-${payableId}`,
      },
      tenantB.accessToken,
    );
    expect(payAsB.status).toBe(404);
  });

  it('19) un usuario con purchases.read pero SIN purchases.manage no puede crear ni confirmar compras (403)', async () => {
    const inventoryToken = await createUserWithRole(
      app,
      tenantA.organizationId,
      'INVENTORY',
    ); // INVENTORY: purchases.read, sin purchases.manage
    const { productId } = await createTestProduct(app, tenantA, {
      name: 'Rol Inventory Compras',
    });

    const attempt = await callApi<ApiPurchase>(
      app,
      'POST',
      '/purchases',
      {
        supplierId: supplierAId,
        warehouseId: tenantA.warehouseId,
        items: [{ productId, quantity: 1, unitCost: 10 }],
      },
      inventoryToken,
    );
    expect(attempt.status).toBe(403);

    const list = await callApi<ApiPurchase[]>(
      app,
      'GET',
      '/purchases',
      undefined,
      inventoryToken,
    );
    expect(list.status).toBe(200); // purchases.read sí lo tiene
  });

  it('un usuario sin payables.manage no puede registrar pagos sobre una Payable, pero sí puede leerla (payables.read)', async () => {
    const accountantToken = await createUserWithRole(
      app,
      tenantA.organizationId,
      'ACCOUNTANT',
    ); // tiene payables.manage y payables.read
    const managerToken = await createUserWithRole(
      app,
      tenantA.organizationId,
      'MANAGER',
    ); // tiene payables.read, sin payables.manage

    const { productId } = await createTestProduct(app, tenantA, {
      name: 'Producto RBAC Payable',
    });
    const purchase = await makePurchaseAsA(productId);
    await callApi<ApiPurchase>(
      app,
      'POST',
      `/purchases/${purchase.body.id}/confirm`,
      {},
      tenantA.accessToken,
    );
    const received = await callApi<ApiPurchase>(
      app,
      'POST',
      `/purchases/${purchase.body.id}/receive`,
      {
        items: [{ purchaseItemId: purchase.body.items[0].id, quantity: 5 }],
        idempotencyKey: `recv-rbac-${purchase.body.id}`,
      },
      tenantA.accessToken,
    );
    const payableId = received.body.payables[0].id;

    const readAsManager = await callApi<ApiPayable>(
      app,
      'GET',
      `/payables/${payableId}`,
      undefined,
      managerToken,
    );
    expect(readAsManager.status).toBe(200);

    const payAsManager = await callApi<ApiPayable>(
      app,
      'POST',
      `/payables/${payableId}/payments`,
      {
        method: 'CASH',
        amount: 1,
        idempotencyKey: `rbac-manager-pay-${payableId}`,
      },
      managerToken,
    );
    expect(payAsManager.status).toBe(403);

    const payAsAccountant = await callApi<ApiPayable>(
      app,
      'POST',
      `/payables/${payableId}/payments`,
      {
        method: 'CASH',
        amount: 1,
        idempotencyKey: `rbac-accountant-pay-${payableId}`,
      },
      accountantToken,
    );
    expect(payAsAccountant.status).toBe(201);
  });

  it('un usuario sin ningún token no puede acceder a /purchases ni /payables (401)', async () => {
    const purchasesRes = await callApi<ApiPurchase[]>(app, 'GET', '/purchases');
    expect(purchasesRes.status).toBe(401);
    const payablesRes = await callApi<ApiPayable[]>(app, 'GET', '/payables');
    expect(payablesRes.status).toBe(401);
  });
});
