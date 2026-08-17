import { INestApplication } from '@nestjs/common';
import {
  ApiReceivable,
  ApiSale,
  bootTestApp,
  callApi,
  createProductWithStock,
  createTestCustomer,
  registerTestOrg,
  TestTenant,
  uniqueSuffix,
} from '../test-support/integration-app';

describe('Receivables — concurrencia e idempotencia (integración, DB real)', () => {
  let app: INestApplication;
  let tenant: TestTenant;
  let customerId: string;

  beforeAll(async () => {
    app = await bootTestApp();
    tenant = await registerTestOrg(app, 'Receivables-Concurrency');
    customerId = (await createTestCustomer(app, tenant, 'Cliente Concurrencia'))
      .customerId;
  }, 30000);

  afterAll(async () => {
    await app.close();
  }, 15000);

  async function creditSale(quantity: number, price: number) {
    const { productId } = await createProductWithStock(app, tenant, {
      name: `Producto Concurrencia ${uniqueSuffix()}`,
      price,
      quantity: quantity + 10,
    });
    const sale = await callApi<ApiSale>(
      app,
      'POST',
      '/sales',
      {
        posTerminalId: tenant.posTerminalId,
        warehouseId: tenant.warehouseId,
        customerId,
        items: [{ productId, quantity }],
      },
      tenant.accessToken,
    );
    await callApi<ApiSale>(
      app,
      'POST',
      `/sales/${sale.body.id}/confirm`,
      {},
      tenant.accessToken,
    );
    const list = await callApi<ApiReceivable[]>(
      app,
      'GET',
      '/receivables',
      undefined,
      tenant.accessToken,
    );
    const receivable = list.body.find((r) => r.saleId === sale.body.id);
    if (!receivable) throw new Error('sin receivable');
    return receivable;
  }

  async function pay(
    receivableId: string,
    amount: number,
    idempotencyKey: string,
  ) {
    return callApi<ApiSale>(
      app,
      'POST',
      `/receivables/${receivableId}/payments`,
      { method: 'CASH', amount, idempotencyKey },
      tenant.accessToken,
    );
  }

  it('13)+15) doble click (misma idempotencyKey, secuencial) no duplica el cobro', async () => {
    const receivable = await creditSale(1, 100);
    const key = `recv-doble-click-${uniqueSuffix()}`;

    const first = await pay(receivable.id, 100, key);
    const second = await pay(receivable.id, 100, key);
    expect(first.status).toBe(201);
    expect(second.status).toBe(201);

    const detail = await callApi<ApiReceivable>(
      app,
      'GET',
      `/receivables/${receivable.id}`,
      undefined,
      tenant.accessToken,
    );
    expect(detail.body.status).toBe('PAID');
    expect(Number(detail.body.balance)).toBe(0); // no 100 - 200 = -100
  });

  it('14) retry (mismo request repetido) con la misma idempotencyKey: efecto único', async () => {
    const receivable = await creditSale(1, 60);
    const key = `recv-retry-${uniqueSuffix()}`;
    const body = { method: 'CASH', amount: 20, idempotencyKey: key };

    const attempt1 = await callApi<ApiSale>(
      app,
      'POST',
      `/receivables/${receivable.id}/payments`,
      body,
      tenant.accessToken,
    );
    const attempt2 = await callApi<ApiSale>(
      app,
      'POST',
      `/receivables/${receivable.id}/payments`,
      body,
      tenant.accessToken,
    );
    expect(attempt1.status).toBe(201);
    expect(attempt2.status).toBe(201);

    const detail = await callApi<ApiReceivable>(
      app,
      'GET',
      `/receivables/${receivable.id}`,
      undefined,
      tenant.accessToken,
    );
    expect(Number(detail.body.balance)).toBe(40); // 60 - 20, una sola vez
  });

  it('16) dos pagos concurrentes que juntos superarían el saldo: exactamente uno gana', async () => {
    const receivable = await creditSale(1, 100); // saldo 100

    const [a, b] = await Promise.all([
      pay(receivable.id, 70, `recv-conc-a-${uniqueSuffix()}`),
      pay(receivable.id, 70, `recv-conc-b-${uniqueSuffix()}`),
    ]);
    const statuses = [a.status, b.status].sort();
    expect(statuses).toEqual([201, 400]); // 100 - 70 = 30, no alcanza para el segundo

    const detail = await callApi<ApiReceivable>(
      app,
      'GET',
      `/receivables/${receivable.id}`,
      undefined,
      tenant.accessToken,
    );
    expect(Number(detail.body.balance)).toBe(30); // nunca queda negativo
  });

  it('pago concurrente sobre saldo restante exacto: dos mitades exactas, ambas se aplican, saldo llega a 0 sin pasarse', async () => {
    const receivable = await creditSale(1, 100); // saldo 100

    const [a, b] = await Promise.all([
      pay(receivable.id, 50, `recv-mitad-a-${uniqueSuffix()}`),
      pay(receivable.id, 50, `recv-mitad-b-${uniqueSuffix()}`),
    ]);
    const statuses = [a.status, b.status].sort();
    expect(statuses).toEqual([201, 201]); // el lock de la venta serializa, ambas caben justo

    const detail = await callApi<ApiReceivable>(
      app,
      'GET',
      `/receivables/${receivable.id}`,
      undefined,
      tenant.accessToken,
    );
    expect(detail.body.status).toBe('PAID');
    expect(Number(detail.body.balance)).toBe(0);
  });
});
