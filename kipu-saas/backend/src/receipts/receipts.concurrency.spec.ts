import { INestApplication } from '@nestjs/common';
import {
  ApiSale,
  bootTestApp,
  callApi,
  createProductWithStock,
  registerTestOrg,
  TestTenant,
  uniqueSuffix,
} from '../test-support/integration-app';

interface CommercialReceiptBody {
  id: string;
  saleId: string;
  series: string;
  number: number;
}

describe('Recibos comerciales — concurrencia real (DB real)', () => {
  let app: INestApplication;
  let tenant: TestTenant;
  let productId: string;

  beforeAll(async () => {
    app = await bootTestApp();
    tenant = await registerTestOrg(app, 'Receipts-Concurrency');
    productId = (
      await createProductWithStock(app, tenant, {
        name: `Producto Recibos Concurrencia ${uniqueSuffix()}`,
        price: 50,
        quantity: 100,
      })
    ).productId;
  }, 30000);

  afterAll(async () => {
    await app.close();
  }, 15000);

  async function createAndConfirmSale() {
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
    return createRes.body.id;
  }

  it('6)+9) dos requests CONCURRENTES para emitir el recibo de la MISMA venta producen exactamente UN recibo', async () => {
    const saleId = await createAndConfirmSale();

    const [a, b] = await Promise.all([
      callApi<CommercialReceiptBody>(
        app,
        'POST',
        '/receipts',
        { saleId },
        tenant.accessToken,
      ),
      callApi<CommercialReceiptBody>(
        app,
        'POST',
        '/receipts',
        { saleId },
        tenant.accessToken,
      ),
    ]);

    expect(a.status).toBe(201);
    expect(b.status).toBe(201);
    expect(a.body.id).toBe(b.body.id);
    expect(a.body.number).toBe(b.body.number);

    // Confirmar en la base que quedó exactamente UNA fila para esta venta
    // (no dos filas con distinto id que la respuesta HTTP esconda).
    const list = await callApi<CommercialReceiptBody>(
      app,
      'GET',
      `/receipts/by-sale/${saleId}`,
      undefined,
      tenant.accessToken,
    );
    expect(list.body.id).toBe(a.body.id);
  });

  it('emisión concurrente de recibos para VENTAS DISTINTAS nunca duplica ni salta números', async () => {
    const saleIds = await Promise.all([
      createAndConfirmSale(),
      createAndConfirmSale(),
      createAndConfirmSale(),
      createAndConfirmSale(),
      createAndConfirmSale(),
    ]);

    const results = await Promise.all(
      saleIds.map((saleId) =>
        callApi<CommercialReceiptBody>(
          app,
          'POST',
          '/receipts',
          { saleId },
          tenant.accessToken,
        ),
      ),
    );

    for (const r of results) {
      expect(r.status).toBe(201);
    }
    const numbers = results.map((r) => r.body.number).sort((x, y) => x - y);
    // Sin duplicados.
    expect(new Set(numbers).size).toBe(numbers.length);
    // Sin huecos entre el mínimo y el máximo obtenido en esta ronda.
    for (let i = 1; i < numbers.length; i++) {
      expect(numbers[i]).toBe(numbers[i - 1] + 1);
    }
  });

  it('doble click real (10 requests concurrentes, misma venta) produce un único recibo y un único número consumido', async () => {
    const saleId = await createAndConfirmSale();

    const results = await Promise.all(
      Array.from({ length: 10 }, () =>
        callApi<CommercialReceiptBody>(
          app,
          'POST',
          '/receipts',
          { saleId },
          tenant.accessToken,
        ),
      ),
    );

    for (const r of results) {
      expect(r.status).toBe(201);
    }
    const ids = new Set(results.map((r) => r.body.id));
    const numbers = new Set(results.map((r) => r.body.number));
    expect(ids.size).toBe(1);
    expect(numbers.size).toBe(1);
  });
});
