import { INestApplication } from '@nestjs/common';
import {
  ApiInventoryRow,
  ApiPurchase,
  bootTestApp,
  callApi,
  createTestProduct,
  createTestSupplier,
  registerTestOrg,
  TestTenant,
} from '../test-support/integration-app';

describe('Compras — concurrencia e idempotencia (integración, DB real)', () => {
  let app: INestApplication;
  let tenant: TestTenant;
  let supplierId: string;

  beforeAll(async () => {
    app = await bootTestApp();
    tenant = await registerTestOrg(app, 'Purchases-Concurrency');
    supplierId = (
      await createTestSupplier(app, tenant, 'Proveedor Concurrencia')
    ).supplierId;
  }, 30000);

  afterAll(async () => {
    await app.close();
  }, 15000);

  async function makeConfirmedPurchase(
    productId: string,
    quantity: number,
    unitCost: number,
  ) {
    const purchase = await callApi<ApiPurchase>(
      app,
      'POST',
      '/purchases',
      {
        supplierId,
        warehouseId: tenant.warehouseId,
        items: [{ productId, quantity, unitCost }],
      },
      tenant.accessToken,
    );
    await callApi<ApiPurchase>(
      app,
      'POST',
      `/purchases/${purchase.body.id}/confirm`,
      {},
      tenant.accessToken,
    );
    return purchase.body;
  }

  async function receive(
    purchaseId: string,
    purchaseItemId: string,
    quantity: number,
    idempotencyKey: string,
  ) {
    return callApi<ApiPurchase>(
      app,
      'POST',
      `/purchases/${purchaseId}/receive`,
      { items: [{ purchaseItemId, quantity }], idempotencyKey },
      tenant.accessToken,
    );
  }

  it('13)+14) doble click con la misma idempotencyKey en /receive no duplica inventario ni Payable (secuencial)', async () => {
    const { productId } = await createTestProduct(app, tenant, {
      name: 'Doble Click Recepción',
    });
    const purchase = await makeConfirmedPurchase(productId, 10, 5);
    const itemId = purchase.items[0].id;
    const key = `doble-click-recv-${purchase.id}`;

    const first = await receive(purchase.id, itemId, 10, key);
    const second = await receive(purchase.id, itemId, 10, key);

    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
    expect(Number(first.body.items[0].receivedQuantity)).toBe(10);
    expect(Number(second.body.items[0].receivedQuantity)).toBe(10); // no se duplicó
    expect(Number(second.body.payables[0].amount)).toBe(50); // no se duplicó

    const stock = await callApi<ApiInventoryRow[]>(
      app,
      'GET',
      `/inventory?warehouseId=${tenant.warehouseId}`,
      undefined,
      tenant.accessToken,
    );
    expect(
      Number(stock.body.find((r) => r.productId === productId)?.quantity),
    ).toBe(10);
  });

  it('dos requests concurrentes con la misma idempotencyKey sobre la MISMA compra: se serializan por el lock, sin duplicar', async () => {
    const { productId } = await createTestProduct(app, tenant, {
      name: 'Concurrente Misma Compra',
    });
    const purchase = await makeConfirmedPurchase(productId, 10, 5);
    const itemId = purchase.items[0].id;
    const key = `concurrente-misma-compra-${purchase.id}`;

    const [a, b] = await Promise.all([
      receive(purchase.id, itemId, 10, key),
      receive(purchase.id, itemId, 10, key),
    ]);

    expect(a.status).toBe(201);
    expect(b.status).toBe(201);
    expect(Number(a.body.items[0].receivedQuantity)).toBe(10);
    expect(Number(b.body.items[0].receivedQuantity)).toBe(10);
  });

  it('reusar la misma idempotencyKey en DOS compras distintas (carrera real) deja exactamente 1 recepción aplicada', async () => {
    const { productId: productA } = await createTestProduct(app, tenant, {
      name: 'Carrera Cross Compra A',
    });
    const { productId: productB } = await createTestProduct(app, tenant, {
      name: 'Carrera Cross Compra B',
    });
    const purchaseA = await makeConfirmedPurchase(productA, 5, 10);
    const purchaseB = await makeConfirmedPurchase(productB, 5, 10);
    const key = `carrera-cross-purchase-${purchaseA.id}`;

    const [a, b] = await Promise.all([
      receive(purchaseA.id, purchaseA.items[0].id, 5, key),
      receive(purchaseB.id, purchaseB.items[0].id, 5, key),
    ]);

    const statuses = [a.status, b.status].sort();
    expect(statuses).toEqual([201, 409]);
  });

  it('15)+16) dos recepciones concurrentes que juntas excederían lo pedido: el lock de la compra serializa y solo una gana', async () => {
    const { productId } = await createTestProduct(app, tenant, {
      name: 'Concurrencia Sobre-Recepción',
    });
    const purchase = await makeConfirmedPurchase(productId, 10, 5); // solo hay 10 unidades pedidas
    const itemId = purchase.items[0].id;

    // Cada request pide 8 (con keys DISTINTAS, son intentos legítimos
    // distintos, no un retry) — juntas suman 16, más de las 10 pedidas.
    const [a, b] = await Promise.all([
      receive(purchase.id, itemId, 8, `recv-race-a-${purchase.id}`),
      receive(purchase.id, itemId, 8, `recv-race-b-${purchase.id}`),
    ]);

    const statuses = [a.status, b.status].sort();
    expect(statuses).toEqual([201, 400]); // exactamente 1 acepta, 1 rechaza por exceder lo pendiente

    const detail = await callApi<ApiPurchase>(
      app,
      'GET',
      `/purchases/${purchase.id}`,
      undefined,
      tenant.accessToken,
    );
    expect(Number(detail.body.items[0].receivedQuantity)).toBe(8); // nunca 16
  }, 15000);
});
