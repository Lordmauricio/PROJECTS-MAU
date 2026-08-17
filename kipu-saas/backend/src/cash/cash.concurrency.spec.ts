import { INestApplication } from '@nestjs/common';
import {
  ApiCashMovement,
  ApiCashRegister,
  ApiExpense,
  ApiSale,
  bootTestApp,
  callApi,
  createProductWithStock,
  createTestPosTerminal,
  openCashRegister,
  registerTestOrg,
  TestTenant,
  uniqueSuffix,
} from '../test-support/integration-app';
import { CASH_DECREASE_TYPES, CASH_INCREASE_TYPES } from './cash.service';

describe('Caja y Gastos — concurrencia e idempotencia (integración, DB real)', () => {
  let app: INestApplication;
  let tenant: TestTenant;

  beforeAll(async () => {
    app = await bootTestApp();
    tenant = await registerTestOrg(app, 'Cash-Concurrency');
  }, 30000);

  afterAll(async () => {
    await app.close();
  }, 15000);

  async function freshTerminal(label: string): Promise<string> {
    return (
      await createTestPosTerminal(app, tenant, `${label} ${uniqueSuffix()}`)
    ).posTerminalId;
  }

  async function openReq(
    posTerminalId: string,
    idempotencyKey: string,
    openingAmount = 0,
  ) {
    return callApi<ApiCashRegister>(
      app,
      'POST',
      '/cash-registers',
      { posTerminalId, openingAmount, idempotencyKey },
      tenant.accessToken,
    );
  }

  async function closeReq(
    cashRegisterId: string,
    countedAmount: number,
    idempotencyKey: string,
  ) {
    return callApi<ApiCashRegister>(
      app,
      'POST',
      `/cash-registers/${cashRegisterId}/close`,
      { countedAmount, idempotencyKey },
      tenant.accessToken,
    );
  }

  async function movementReq(
    cashRegisterId: string,
    body: Record<string, unknown>,
  ) {
    return callApi<ApiCashMovement>(
      app,
      'POST',
      `/cash-registers/${cashRegisterId}/movements`,
      body,
      tenant.accessToken,
    );
  }

  it('2) impide una segunda caja abierta para el mismo terminal (secuencial)', async () => {
    const posTerminalId = await freshTerminal('Segunda Caja Secuencial');
    const first = await openReq(posTerminalId, `open-a-${uniqueSuffix()}`, 10);
    expect(first.status).toBe(201);

    const second = await openReq(posTerminalId, `open-b-${uniqueSuffix()}`, 20);
    expect(second.status).toBe(409);
  });

  it('3) dos aperturas concurrentes (idempotencyKeys DISTINTAS) para el mismo terminal: exactamente una gana', async () => {
    const posTerminalId = await freshTerminal('Apertura Concurrente');
    const [a, b] = await Promise.all([
      openReq(posTerminalId, `open-conc-a-${uniqueSuffix()}`, 10),
      openReq(posTerminalId, `open-conc-b-${uniqueSuffix()}`, 20),
    ]);
    const statuses = [a.status, b.status].sort();
    expect(statuses).toEqual([201, 409]); // el índice único parcial impide las dos OPEN
  });

  it('11)+12) doble click/retry en la apertura (misma idempotencyKey, secuencial y concurrente): un único registro', async () => {
    const posTerminalId = await freshTerminal('Retry Apertura');
    const key = `open-retry-${uniqueSuffix()}`;

    const first = await openReq(posTerminalId, key, 15);
    const second = await openReq(posTerminalId, key, 15); // retry secuencial
    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
    expect(first.body.id).toBe(second.body.id);

    // Cerrar y reabrir con OTRA key para probar el caso concurrente real
    // (dos requests simultáneos con la MISMA key sobre un terminal libre).
    await closeReq(first.body.id, 15, `close-para-retry-${uniqueSuffix()}`);
    const posTerminalId2 = await freshTerminal('Retry Apertura Concurrente');
    const concurrentKey = `open-retry-conc-${uniqueSuffix()}`;
    const [a, b] = await Promise.all([
      openReq(posTerminalId2, concurrentKey, 5),
      openReq(posTerminalId2, concurrentKey, 5),
    ]);
    expect(a.status).toBe(201);
    expect(b.status).toBe(201);
    expect(a.body.id).toBe(b.body.id);
  });

  it('8) dos cierres concurrentes de la MISMA caja (idempotencyKeys DISTINTAS): exactamente uno completa la operación', async () => {
    const posTerminalId = await freshTerminal('Cierre Concurrente');
    const register = await openCashRegister(app, tenant, {
      openingAmount: 100,
      posTerminalId,
    });

    const [a, b] = await Promise.all([
      closeReq(register.id, 100, `close-conc-a-${uniqueSuffix()}`),
      closeReq(register.id, 90, `close-conc-b-${uniqueSuffix()}`),
    ]);
    const statuses = [a.status, b.status].sort();
    expect(statuses).toEqual([201, 409]);

    const detail = await callApi<ApiCashRegister>(
      app,
      'GET',
      `/cash-registers/${register.id}`,
      undefined,
      tenant.accessToken,
    );
    expect(detail.body.status).toBe('CLOSED'); // nunca queda en un estado intermedio
  });

  it('doble click/retry en el cierre (misma idempotencyKey, concurrente): un único cierre aplicado', async () => {
    const posTerminalId = await freshTerminal('Cierre Retry');
    const register = await openCashRegister(app, tenant, {
      openingAmount: 40,
      posTerminalId,
    });
    const key = `close-retry-${uniqueSuffix()}`;

    const [a, b] = await Promise.all([
      closeReq(register.id, 40, key),
      closeReq(register.id, 40, key),
    ]);
    expect(a.status).toBe(201);
    expect(b.status).toBe(201);
    expect(Number(a.body.closingAmount)).toBe(40);
    expect(Number(b.body.closingAmount)).toBe(40);
  });

  it('movimiento concurrente: dos egresos que juntos excederían el saldo — exactamente uno se acepta', async () => {
    const posTerminalId = await freshTerminal('Egreso Concurrente');
    const register = await openCashRegister(app, tenant, {
      openingAmount: 100,
      posTerminalId,
    });

    const [a, b] = await Promise.all([
      movementReq(register.id, {
        type: 'CASH_OUT',
        amount: 70,
        idempotencyKey: `egreso-conc-a-${uniqueSuffix()}`,
      }),
      movementReq(register.id, {
        type: 'CASH_OUT',
        amount: 70,
        idempotencyKey: `egreso-conc-b-${uniqueSuffix()}`,
      }),
    ]);
    const statuses = [a.status, b.status].sort();
    expect(statuses).toEqual([201, 400]); // 100 - 70 = 30, no alcanza para el segundo
  });

  it('gasto concurrente: dos gastos que juntos excederían el saldo — exactamente uno se acepta', async () => {
    const posTerminalId = await freshTerminal('Gasto Concurrente');
    const register = await openCashRegister(app, tenant, {
      openingAmount: 50,
      posTerminalId,
    });

    const [a, b] = await Promise.all([
      callApi<ApiExpense>(
        app,
        'POST',
        '/expenses',
        {
          cashRegisterId: register.id,
          amount: 40,
          idempotencyKey: `gasto-conc-a-${uniqueSuffix()}`,
        },
        tenant.accessToken,
      ),
      callApi<ApiExpense>(
        app,
        'POST',
        '/expenses',
        {
          cashRegisterId: register.id,
          amount: 40,
          idempotencyKey: `gasto-conc-b-${uniqueSuffix()}`,
        },
        tenant.accessToken,
      ),
    ]);
    const statuses = [a.status, b.status].sort();
    expect(statuses).toEqual([201, 400]); // 50 - 40 = 10, no alcanza para el segundo
  });

  it('doble click/retry en un movimiento manual (misma idempotencyKey): no duplica el efecto en el saldo', async () => {
    const posTerminalId = await freshTerminal('Movimiento Retry');
    const register = await openCashRegister(app, tenant, {
      openingAmount: 20,
      posTerminalId,
    });
    const key = `mov-retry-${uniqueSuffix()}`;
    const body = { type: 'CASH_IN', amount: 10, idempotencyKey: key };

    const first = await movementReq(register.id, body);
    const second = await movementReq(register.id, body);
    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
    expect(first.body.id).toBe(second.body.id);

    const detail = await callApi<ApiCashRegister>(
      app,
      'GET',
      `/cash-registers/${register.id}`,
      undefined,
      tenant.accessToken,
    );
    expect(detail.body.movements).toHaveLength(1); // no se duplicó
  });

  it('reusar la misma idempotencyKey en DOS movimientos con datos distintos: se rechaza (409), nunca aplica el ajeno', async () => {
    const posTerminalId = await freshTerminal('Movimiento Colision');
    const register = await openCashRegister(app, tenant, {
      openingAmount: 50,
      posTerminalId,
    });
    const key = `mov-colision-${uniqueSuffix()}`;

    const first = await movementReq(register.id, {
      type: 'CASH_IN',
      amount: 10,
      idempotencyKey: key,
    });
    expect(first.status).toBe(201);

    const second = await movementReq(register.id, {
      type: 'CASH_OUT', // datos distintos, misma key
      amount: 5,
      idempotencyKey: key,
    });
    expect(second.status).toBe(409);
  });

  it('cobro en efectivo concurrente con el cierre de la MISMA caja: jamás queda un CashMovement huérfano fuera del arqueo congelado (regresión)', async () => {
    // Reproduce la raza: `registerSalePaymentMovement` leía la caja OPEN sin
    // lock, así que un cobro en efectivo de una venta podía intercalarse
    // entre el `findFirst` (ve OPEN) y el `close()` de otro usuario, e
    // insertar el CashMovement sobre una caja que `close()` ya había dejado
    // CLOSED con `expectedAmount`/`difference` congelados sin verlo. La
    // corrección re-bloquea y revalida `status === 'OPEN'` (igual que sus
    // hermanas `registerPayablePaymentMovement`/`registerSaleRefundMovement`)
    // antes de insertar. Invariante verificado acá, sin importar en qué
    // orden ganó la carrera: el saldo recalculado a partir de TODOS los
    // movimientos que terminan adjuntos a la caja cerrada debe coincidir
    // exactamente con su `expectedAmount` congelado — un movimiento
    // "huérfano" post-cierre rompería esa igualdad.
    for (let i = 0; i < 5; i++) {
      const posTerminalId = await freshTerminal(`Race Cobro-Cierre ${i}`);
      const register = await openCashRegister(app, tenant, {
        openingAmount: 100,
        posTerminalId,
      });

      const { productId } = await createProductWithStock(app, tenant, {
        name: `Race Cobro-Cierre ${uniqueSuffix()}`,
        price: 25,
        quantity: 10,
      });
      const sale = await callApi<ApiSale>(
        app,
        'POST',
        '/sales',
        {
          posTerminalId,
          warehouseId: tenant.warehouseId,
          items: [{ productId, quantity: 1 }],
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

      const [payRes, closeRes] = await Promise.all([
        callApi<ApiSale>(
          app,
          'POST',
          `/sales/${sale.body.id}/payments`,
          {
            method: 'CASH',
            amount: 25,
            idempotencyKey: `race-pay-${posTerminalId}-${uniqueSuffix()}`,
          },
          tenant.accessToken,
        ),
        closeReq(register.id, 100, `race-close-${posTerminalId}`),
      ]);

      expect(payRes.status).toBe(201); // el pago SIEMPRE se aplica, con o sin caja
      expect(closeRes.status).toBe(201);

      const detail = await callApi<ApiCashRegister>(
        app,
        'GET',
        `/cash-registers/${register.id}`,
        undefined,
        tenant.accessToken,
      );
      expect(detail.body.status).toBe('CLOSED');

      const recomputed = (detail.body.movements ?? []).reduce((balance, m) => {
        const amount = Number(m.amount);
        if (CASH_INCREASE_TYPES.has(m.type)) return balance + amount;
        if (CASH_DECREASE_TYPES.has(m.type)) return balance - amount;
        return balance;
      }, Number(detail.body.openingAmount));

      expect(recomputed).toBeCloseTo(Number(detail.body.expectedAmount), 6);
    }
  });
});
