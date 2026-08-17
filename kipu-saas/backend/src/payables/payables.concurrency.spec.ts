import { INestApplication } from '@nestjs/common';
import {
  ApiCashRegister,
  ApiPayable,
  ApiPurchase,
  bootTestApp,
  callApi,
  createTestPosTerminal,
  createTestProduct,
  createTestSupplier,
  openCashRegister,
  registerTestOrg,
  TestTenant,
  uniqueSuffix,
} from '../test-support/integration-app';

describe('Payables — concurrencia e idempotencia (integración, DB real)', () => {
  let app: INestApplication;
  let tenant: TestTenant;
  let supplierId: string;

  beforeAll(async () => {
    app = await bootTestApp();
    tenant = await registerTestOrg(app, 'Payables-Concurrency');
    supplierId = (
      await createTestSupplier(app, tenant, 'Proveedor Concurrencia')
    ).supplierId;
  }, 30000);

  afterAll(async () => {
    await app.close();
  }, 15000);

  async function receivedPayable(quantity: number, unitCost: number) {
    const { productId } = await createTestProduct(app, tenant, {
      name: `Producto Concurrencia Payable ${uniqueSuffix()}`,
    });
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
    const itemId = purchase.body.items[0].id;
    const received = await callApi<ApiPurchase>(
      app,
      'POST',
      `/purchases/${purchase.body.id}/receive`,
      {
        items: [{ purchaseItemId: itemId, quantity }],
        idempotencyKey: `conc-payable-recv-${uniqueSuffix()}`,
      },
      tenant.accessToken,
    );
    return received.body.payables[0];
  }

  async function pay(
    payableId: string,
    amount: number,
    idempotencyKey: string,
    posTerminalId?: string,
  ) {
    return callApi<ApiPayable>(
      app,
      'POST',
      `/payables/${payableId}/payments`,
      {
        method: 'CASH',
        amount,
        idempotencyKey,
        ...(posTerminalId ? { posTerminalId } : {}),
      },
      tenant.accessToken,
    );
  }

  it('13)+15) doble click (misma idempotencyKey) no duplica el pago', async () => {
    const payable = await receivedPayable(5, 20); // 100
    const key = `payable-doble-click-${uniqueSuffix()}`;

    const first = await pay(payable.id, 100, key);
    const second = await pay(payable.id, 100, key);
    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
    expect(second.body.status).toBe('PAID');
    expect(Number(second.body.balance)).toBe(0); // no -100
  });

  it('14) retry (mismo request repetido) con la misma idempotencyKey: efecto único', async () => {
    const payable = await receivedPayable(3, 10); // 30
    const key = `payable-retry-${uniqueSuffix()}`;

    const attempt1 = await pay(payable.id, 10, key);
    const attempt2 = await pay(payable.id, 10, key);
    expect(attempt1.status).toBe(201);
    expect(attempt2.status).toBe(201);
    expect(Number(attempt2.body.balance)).toBe(20); // 30 - 10, una sola vez
  });

  it('16) dos pagos concurrentes que juntos superarían el saldo pendiente: exactamente uno gana', async () => {
    const payable = await receivedPayable(10, 10); // 100

    const [a, b] = await Promise.all([
      pay(payable.id, 70, `payable-conc-a-${uniqueSuffix()}`),
      pay(payable.id, 70, `payable-conc-b-${uniqueSuffix()}`),
    ]);
    const statuses = [a.status, b.status].sort();
    expect(statuses).toEqual([201, 400]);

    const detail = await callApi<ApiPayable>(
      app,
      'GET',
      `/payables/${payable.id}`,
      undefined,
      tenant.accessToken,
    );
    expect(Number(detail.body.balance)).toBe(30);
  });

  it('pago concurrente con cierre de caja: si la caja se cierra justo antes, el pago se aplica igual sin movimiento de caja', async () => {
    const posTerminalId = (
      await createTestPosTerminal(
        app,
        tenant,
        `Payable Cierre Concurrente ${uniqueSuffix()}`,
      )
    ).posTerminalId;
    const register = await openCashRegister(app, tenant, {
      openingAmount: 200,
      posTerminalId,
    });
    await callApi<ApiCashRegister>(
      app,
      'POST',
      `/cash-registers/${register.id}/close`,
      {
        countedAmount: 200,
        idempotencyKey: `close-antes-payable-${uniqueSuffix()}`,
      },
      tenant.accessToken,
    );

    const payable = await receivedPayable(4, 10); // 40
    const pay1 = await pay(
      payable.id,
      40,
      `payable-caja-cerrada-${uniqueSuffix()}`,
      posTerminalId,
    );
    expect(pay1.status).toBe(201); // la caja cerrada no bloquea el pago, solo no genera movimiento
    expect(pay1.body.status).toBe('PAID');
  });

  it('dos egresos concurrentes en efectivo (un pago a proveedor y un egreso manual) que juntos excederían el saldo de caja: exactamente uno se aplica', async () => {
    const posTerminalId = (
      await createTestPosTerminal(
        app,
        tenant,
        `Payable Egreso Concurrente ${uniqueSuffix()}`,
      )
    ).posTerminalId;
    const register = await openCashRegister(app, tenant, {
      openingAmount: 100,
      posTerminalId,
    });
    const payable = await receivedPayable(7, 10); // 70

    const [payableResult, movementResult] = await Promise.all([
      pay(payable.id, 70, `payable-vs-egreso-${uniqueSuffix()}`, posTerminalId),
      callApi(
        app,
        'POST',
        `/cash-registers/${register.id}/movements`,
        {
          type: 'CASH_OUT',
          amount: 70,
          idempotencyKey: `egreso-vs-payable-${uniqueSuffix()}`,
        },
        tenant.accessToken,
      ),
    ]);
    const statuses = [payableResult.status, movementResult.status].sort();
    // Uno de los dos egresos (70 + 70 > 100 disponible) debe fallar: o el
    // pago a proveedor (400, sin afectar el saldo de la Payable) o el
    // egreso manual (400). Ambos comparten el mismo saldo bajo lock.
    expect(statuses).toContain(400);
    expect(statuses).toContain(201);
  });
});
