import { INestApplication } from '@nestjs/common';
import {
  ApiInventoryRow,
  ApiSale,
  bootTestApp,
  callApi,
  createProductWithStock,
  registerTestOrg,
  TestTenant,
} from '../test-support/integration-app';

describe('Ventas/POS — concurrencia e idempotencia (integración, DB real)', () => {
  let app: INestApplication;
  let tenant: TestTenant;

  beforeAll(async () => {
    app = await bootTestApp();
    tenant = await registerTestOrg(app, 'Sales-Concurrency');
  }, 30000);

  afterAll(async () => {
    await app.close();
  });

  async function makeDraftSale(productId: string, quantity: number) {
    return callApi<ApiSale>(
      app,
      'POST',
      '/sales',
      {
        posTerminalId: tenant.posTerminalId,
        warehouseId: tenant.warehouseId,
        items: [{ productId, quantity }],
      },
      tenant.accessToken,
    );
  }

  async function confirmSale(saleId: string) {
    return callApi<ApiSale>(
      app,
      'POST',
      `/sales/${saleId}/confirm`,
      {},
      tenant.accessToken,
    );
  }

  async function pay(saleId: string, amount: number, idempotencyKey: string) {
    return callApi<ApiSale>(
      app,
      'POST',
      `/sales/${saleId}/payments`,
      { method: 'CASH', amount, idempotencyKey },
      tenant.accessToken,
    );
  }

  it('12) doble click con el mismo idempotencyKey no duplica el pago (mismo request repetido secuencialmente)', async () => {
    const { productId } = await createProductWithStock(app, tenant, {
      name: 'Doble Click',
      price: 40,
      quantity: 5,
    });
    const sale = await makeDraftSale(productId, 1); // total 40
    await confirmSale(sale.body.id);

    const key = `doble-click-${sale.body.id}`;
    const first = await pay(sale.body.id, 40, key);
    const second = await pay(sale.body.id, 40, key);

    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
    expect(first.body.status).toBe('PAID');
    expect(second.body.status).toBe('PAID');
    // Un solo Payment aplicado, no dos (no se cobró el doble).
    expect(second.body.payments).toHaveLength(1);
    expect(Number(second.body.paidTotal)).toBe(40);
  });

  it('12b) dos requests concurrentes con el mismo idempotencyKey sobre la MISMA venta: se serializan por el lock de la venta, sin duplicar el pago', async () => {
    const { productId } = await createProductWithStock(app, tenant, {
      name: 'Concurrente Mismo',
      price: 20,
      quantity: 5,
    });
    const sale = await makeDraftSale(productId, 1); // total 20
    await confirmSale(sale.body.id);

    const key = `concurrente-misma-venta-${sale.body.id}`;
    const [a, b] = await Promise.all([
      pay(sale.body.id, 20, key),
      pay(sale.body.id, 20, key),
    ]);

    expect(a.status).toBe(201);
    expect(b.status).toBe(201);
    expect(a.body.payments).toHaveLength(1);
    expect(b.body.payments).toHaveLength(1);
  });

  it('reusar el mismo idempotencyKey en DOS ventas distintas (carrera real) deja exactamente 1 pago aplicado', async () => {
    const { productId } = await createProductWithStock(app, tenant, {
      name: 'Concurrente Distinta',
      price: 10,
      quantity: 10,
    });
    const saleA = await makeDraftSale(productId, 1);
    const saleB = await makeDraftSale(productId, 1);
    await confirmSale(saleA.body.id);
    await confirmSale(saleB.body.id);

    const key = `carrera-cross-sale-${saleA.body.id}`;
    const [a, b] = await Promise.all([
      pay(saleA.body.id, 10, key),
      pay(saleB.body.id, 10, key),
    ]);

    const statuses = [a.status, b.status].sort();
    // Exactamente una de las dos ventas queda pagada con esa key; la otra
    // choca contra la unique constraint (key ya usada por OTRA venta) → 409.
    expect(statuses).toEqual([201, 409]);
  });

  it('13) concurrencia sobre la última unidad de stock: exactamente 1 confirmación gana, 1 se rechaza, stock final correcto', async () => {
    const { productId } = await createProductWithStock(app, tenant, {
      name: 'Última Unidad',
      price: 15,
      quantity: 1,
    });
    const saleA = await makeDraftSale(productId, 1);
    const saleB = await makeDraftSale(productId, 1);

    const [confirmA, confirmB] = await Promise.all([
      confirmSale(saleA.body.id),
      confirmSale(saleB.body.id),
    ]);

    const statuses = [confirmA.status, confirmB.status].sort();
    expect(statuses).toEqual([201, 409]); // exactamente 1 éxito, 1 rechazo (stock insuficiente)

    const stock = await callApi<ApiInventoryRow[]>(
      app,
      'GET',
      `/inventory?warehouseId=${tenant.warehouseId}`,
      undefined,
      tenant.accessToken,
    );
    const row = stock.body.find((r) => r.productId === productId);
    expect(Number(row?.quantity)).toBe(0); // ni negativo ni sobrevendido: exactamente 1 unidad descontada
  }, 15000);
});
