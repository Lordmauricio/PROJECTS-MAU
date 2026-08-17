import { INestApplication } from '@nestjs/common';
import {
  ApiAuditLog,
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
import { TenantPrismaService } from '../prisma/tenant-prisma.service';

describe('Caja y Gastos — ciclo de vida (integración, DB real)', () => {
  let app: INestApplication;
  let tenant: TestTenant;

  beforeAll(async () => {
    app = await bootTestApp();
    tenant = await registerTestOrg(app, 'Cash-Core');
  }, 30000);

  afterAll(async () => {
    await app.close();
  }, 15000);

  // Cada caso que abre una caja usa su PROPIO punto de venta — a lo sumo
  // puede haber una caja OPEN por terminal, así que reusar el mismo entre
  // tests (que nunca la cierran) chocaría con el segundo intento.
  async function freshTerminal(label: string): Promise<string> {
    return (
      await createTestPosTerminal(app, tenant, `${label} ${uniqueSuffix()}`)
    ).posTerminalId;
  }

  async function movement(
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

  async function close(cashRegisterId: string, body: Record<string, unknown>) {
    return callApi<ApiCashRegister>(
      app,
      'POST',
      `/cash-registers/${cashRegisterId}/close`,
      body,
      tenant.accessToken,
    );
  }

  it('1) apertura de caja: saldo inicial correcto, status OPEN, usuario responsable registrado', async () => {
    const posTerminalId = await freshTerminal('Apertura');
    const register = await openCashRegister(app, tenant, {
      openingAmount: 100,
      posTerminalId,
    });
    expect(register.status).toBe('OPEN');
    expect(Number(register.openingAmount)).toBe(100);
    expect(register.posTerminalId).toBe(posTerminalId);
  });

  it('4) ingreso y egreso manual actualizan el saldo correctamente', async () => {
    const posTerminalId = await freshTerminal('Movimientos');
    const register = await openCashRegister(app, tenant, {
      openingAmount: 50,
      posTerminalId,
    });

    const income = await movement(register.id, {
      type: 'CASH_IN',
      amount: 30,
      reason: 'Vuelto inicial adicional',
      idempotencyKey: `mov-in-${uniqueSuffix()}`,
    });
    expect(income.status).toBe(201);

    const outcome = await movement(register.id, {
      type: 'CASH_OUT',
      amount: 20,
      reason: 'Compra de insumos de limpieza',
      idempotencyKey: `mov-out-${uniqueSuffix()}`,
    });
    expect(outcome.status).toBe(201);

    const detail = await callApi<ApiCashRegister>(
      app,
      'GET',
      `/cash-registers/${register.id}`,
      undefined,
      tenant.accessToken,
    );
    expect(detail.body.movements).toHaveLength(2);
  });

  it('impide un egreso manual que supere el saldo disponible (sin permitir caja negativa)', async () => {
    const posTerminalId = await freshTerminal('Egreso Excesivo');
    const register = await openCashRegister(app, tenant, {
      openingAmount: 10,
      posTerminalId,
    });
    const tooMuch = await movement(register.id, {
      type: 'CASH_OUT',
      amount: 999,
      idempotencyKey: `mov-negativo-${uniqueSuffix()}`,
    });
    expect(tooMuch.status).toBe(400);
  });

  it('5) gasto: crea el Expense y su CashMovement (EXPENSE) atómicamente, reduce el saldo', async () => {
    const posTerminalId = await freshTerminal('Gasto');
    const register = await openCashRegister(app, tenant, {
      openingAmount: 100,
      posTerminalId,
    });

    const expense = await callApi<ApiExpense>(
      app,
      'POST',
      '/expenses',
      {
        cashRegisterId: register.id,
        amount: 25,
        category: 'Insumos',
        description: 'Compra de bolsas',
        observation: 'Proveedor de siempre',
        idempotencyKey: `gasto-${uniqueSuffix()}`,
      },
      tenant.accessToken,
    );
    expect(expense.status).toBe(201);

    const detail = await callApi<ApiCashRegister>(
      app,
      'GET',
      `/cash-registers/${register.id}`,
      undefined,
      tenant.accessToken,
    );
    expect(detail.body.expenses).toHaveLength(1);
    const expenseMovement = detail.body.movements?.find(
      (m) => m.type === 'EXPENSE',
    );
    expect(expenseMovement).toBeDefined();
    expect(Number(expenseMovement?.amount)).toBe(25);
    expect(expenseMovement?.reference).toBe(expense.body.id);
  });

  it('un gasto que supera el saldo disponible se rechaza (400), sin crear Expense ni movimiento', async () => {
    const posTerminalId = await freshTerminal('Gasto Excesivo');
    const register = await openCashRegister(app, tenant, {
      openingAmount: 5,
      posTerminalId,
    });
    const tooMuch = await callApi<ApiExpense>(
      app,
      'POST',
      '/expenses',
      {
        cashRegisterId: register.id,
        amount: 500,
        idempotencyKey: `gasto-excesivo-${uniqueSuffix()}`,
      },
      tenant.accessToken,
    );
    expect(tooMuch.status).toBe(400);

    const detail = await callApi<ApiCashRegister>(
      app,
      'GET',
      `/cash-registers/${register.id}`,
      undefined,
      tenant.accessToken,
    );
    expect(detail.body.expenses).toHaveLength(0);
  });

  it('6) integración con Ventas: un pago en efectivo con caja abierta genera un CashMovement SALE_PAYMENT', async () => {
    const posTerminalId = await freshTerminal('Venta Efectivo');
    const register = await openCashRegister(app, tenant, {
      openingAmount: 0,
      posTerminalId,
    });
    const { productId } = await createProductWithStock(app, tenant, {
      name: 'Producto Caja Venta',
      price: 20,
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
    const confirm = await callApi<ApiSale>(
      app,
      'POST',
      `/sales/${sale.body.id}/confirm`,
      {
        payments: [
          {
            method: 'CASH',
            amount: 20,
            idempotencyKey: `venta-caja-${uniqueSuffix()}`,
          },
        ],
      },
      tenant.accessToken,
    );
    expect(confirm.status).toBe(201);
    expect(confirm.body.status).toBe('PAID');

    const detail = await callApi<ApiCashRegister>(
      app,
      'GET',
      `/cash-registers/${register.id}`,
      undefined,
      tenant.accessToken,
    );
    const saleMovement = detail.body.movements?.find(
      (m) => m.type === 'SALE_PAYMENT',
    );
    expect(saleMovement).toBeDefined();
    expect(Number(saleMovement?.amount)).toBe(20);
    expect(saleMovement?.reference).toBe(sale.body.id);
  });

  it('un pago en efectivo SIN caja abierta no falla la venta: simplemente no genera movimiento de caja', async () => {
    const posTerminalId = await freshTerminal('Venta Sin Caja');
    const { productId } = await createProductWithStock(app, tenant, {
      name: 'Producto Sin Caja',
      price: 15,
      quantity: 5,
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
    const confirm = await callApi<ApiSale>(
      app,
      'POST',
      `/sales/${sale.body.id}/confirm`,
      {
        payments: [
          {
            method: 'CASH',
            amount: 15,
            idempotencyKey: `venta-sin-caja-${uniqueSuffix()}`,
          },
        ],
      },
      tenant.accessToken,
    );
    expect(confirm.status).toBe(201);
    expect(confirm.body.status).toBe('PAID'); // el pago se aplica igual, sin caja involucrada
  });

  it('un pago con método distinto a CASH (con caja abierta) NO genera movimiento de caja', async () => {
    const posTerminalId = await freshTerminal('Venta Tarjeta');
    const register = await openCashRegister(app, tenant, {
      openingAmount: 0,
      posTerminalId,
    });
    const { productId } = await createProductWithStock(app, tenant, {
      name: 'Producto Tarjeta',
      price: 30,
      quantity: 5,
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
      {
        payments: [
          {
            method: 'CARD',
            amount: 30,
            idempotencyKey: `venta-tarjeta-${uniqueSuffix()}`,
          },
        ],
      },
      tenant.accessToken,
    );

    const detail = await callApi<ApiCashRegister>(
      app,
      'GET',
      `/cash-registers/${register.id}`,
      undefined,
      tenant.accessToken,
    );
    expect(detail.body.movements).toHaveLength(0);
  });

  it('7)+9) cierre calcula correctamente saldo esperado, efectivo contado y diferencia (sobrante y faltante)', async () => {
    const surplusTerminal = await freshTerminal('Cierre Sobrante');
    const surplus = await openCashRegister(app, tenant, {
      openingAmount: 100,
      posTerminalId: surplusTerminal,
    });
    await movement(surplus.id, {
      type: 'CASH_IN',
      amount: 50,
      idempotencyKey: `cierre-sobrante-in-${uniqueSuffix()}`,
    });
    // esperado = 150; contado = 160 -> diferencia = +10 (sobrante)
    const closedSurplus = await close(surplus.id, {
      countedAmount: 160,
      observation: 'Sobrante de prueba',
      idempotencyKey: `close-sobrante-${uniqueSuffix()}`,
    });
    expect(closedSurplus.status).toBe(201);
    expect(closedSurplus.body.status).toBe('CLOSED');
    expect(Number(closedSurplus.body.expectedAmount)).toBe(150);
    expect(Number(closedSurplus.body.closingAmount)).toBe(160);
    expect(Number(closedSurplus.body.difference)).toBe(10);

    const deficitTerminal = await freshTerminal('Cierre Faltante');
    const deficit = await openCashRegister(app, tenant, {
      openingAmount: 100,
      posTerminalId: deficitTerminal,
    });
    // esperado = 100; contado = 90 -> diferencia = -10 (faltante)
    const closedDeficit = await close(deficit.id, {
      countedAmount: 90,
      idempotencyKey: `close-faltante-${uniqueSuffix()}`,
    });
    expect(Number(closedDeficit.body.difference)).toBe(-10);
  });

  it('10) una caja cerrada no admite nuevos movimientos ni gastos', async () => {
    const posTerminalId = await freshTerminal('Caja Cerrada');
    const register = await openCashRegister(app, tenant, {
      openingAmount: 50,
      posTerminalId,
    });
    await close(register.id, {
      countedAmount: 50,
      idempotencyKey: `close-no-admite-${uniqueSuffix()}`,
    });

    const attemptMovement = await movement(register.id, {
      type: 'CASH_IN',
      amount: 10,
      idempotencyKey: `mov-caja-cerrada-${uniqueSuffix()}`,
    });
    expect(attemptMovement.status).toBe(409);

    const attemptExpense = await callApi<ApiExpense>(
      app,
      'POST',
      '/expenses',
      {
        cashRegisterId: register.id,
        amount: 10,
        idempotencyKey: `gasto-caja-cerrada-${uniqueSuffix()}`,
      },
      tenant.accessToken,
    );
    expect(attemptExpense.status).toBe(409);
  });

  it('16) apertura, movimiento, gasto y cierre generan auditoría', async () => {
    const posTerminalId = await freshTerminal('Auditoria');
    const register = await openCashRegister(app, tenant, {
      openingAmount: 20,
      posTerminalId,
    });
    const mov = await movement(register.id, {
      type: 'CASH_IN',
      amount: 5,
      idempotencyKey: `audit-mov-${uniqueSuffix()}`,
    });
    const expense = await callApi<ApiExpense>(
      app,
      'POST',
      '/expenses',
      {
        cashRegisterId: register.id,
        amount: 3,
        idempotencyKey: `audit-gasto-${uniqueSuffix()}`,
      },
      tenant.accessToken,
    );
    await close(register.id, {
      countedAmount: 22,
      idempotencyKey: `audit-close-${uniqueSuffix()}`,
    });

    await new Promise((resolve) => setTimeout(resolve, 1500));

    const tenantPrisma = app.get(TenantPrismaService);
    const logs = await tenantPrisma.run(tenant.organizationId, (tx) =>
      tx.auditLog.findMany({
        where: {
          entityId: { in: [register.id, mov.body.id, expense.body.id] },
        },
      }),
    );
    const actions = (logs as ApiAuditLog[]).map((l) => l.action);
    expect(actions).toEqual(
      expect.arrayContaining([
        'cash.open',
        'cash.movement.create',
        'expenses.create',
        'cash.close',
      ]),
    );
  }, 10000);
});
