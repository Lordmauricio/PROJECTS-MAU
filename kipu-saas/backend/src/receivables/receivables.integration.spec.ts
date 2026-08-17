import { INestApplication } from '@nestjs/common';
import {
  ApiAuditLog,
  ApiCashMovement,
  ApiCashRegister,
  ApiReceivable,
  ApiSale,
  bootTestApp,
  callApi,
  createProductWithStock,
  createTestCustomer,
  createTestPosTerminal,
  openCashRegister,
  registerTestOrg,
  TestTenant,
  uniqueSuffix,
} from '../test-support/integration-app';
import { TenantPrismaService } from '../prisma/tenant-prisma.service';

describe('Receivables — cuentas por cobrar (integración, DB real)', () => {
  let app: INestApplication;
  let tenant: TestTenant;
  let customerId: string;

  beforeAll(async () => {
    app = await bootTestApp();
    tenant = await registerTestOrg(app, 'Receivables-Core');
    customerId = (await createTestCustomer(app, tenant, 'Cliente Core'))
      .customerId;
  }, 30000);

  afterAll(async () => {
    await app.close();
  }, 15000);

  async function findReceivableForSale(saleId: string): Promise<ApiReceivable> {
    const list = await callApi<ApiReceivable[]>(
      app,
      'GET',
      '/receivables',
      undefined,
      tenant.accessToken,
    );
    const found = list.body.find((r) => r.saleId === saleId);
    if (!found) throw new Error(`sin Receivable para la venta ${saleId}`);
    return found;
  }

  it('1) confirmar una venta a crédito (con cliente, sin pago) genera una Receivable con saldo completo', async () => {
    const { productId } = await createProductWithStock(app, tenant, {
      name: 'Producto Crédito',
      price: 50,
      quantity: 10,
    });
    const sale = await callApi<ApiSale>(
      app,
      'POST',
      '/sales',
      {
        posTerminalId: tenant.posTerminalId,
        warehouseId: tenant.warehouseId,
        customerId,
        items: [{ productId, quantity: 2 }],
      },
      tenant.accessToken,
    );
    const confirm = await callApi<ApiSale>(
      app,
      'POST',
      `/sales/${sale.body.id}/confirm`,
      {},
      tenant.accessToken,
    );
    expect(confirm.status).toBe(201);
    expect(confirm.body.status).toBe('CONFIRMED');

    const receivable = await findReceivableForSale(sale.body.id);
    expect(receivable.status).toBe('PENDING');
    expect(Number(receivable.amount)).toBe(100);
    expect(Number(receivable.balance)).toBe(100);
    expect(receivable.customerId).toBe(customerId);
  });

  it('7) una venta sin cliente NO genera Receivable, aunque quede a crédito', async () => {
    const { productId } = await createProductWithStock(app, tenant, {
      name: 'Producto Sin Cliente',
      price: 20,
      quantity: 5,
    });
    const sale = await callApi<ApiSale>(
      app,
      'POST',
      '/sales',
      {
        posTerminalId: tenant.posTerminalId,
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

    const list = await callApi<ApiReceivable[]>(
      app,
      'GET',
      '/receivables',
      undefined,
      tenant.accessToken,
    );
    expect(list.body.some((r) => r.saleId === sale.body.id)).toBe(false);
  });

  it('una venta pagada por completo al confirmar NO genera Receivable (no es "a crédito")', async () => {
    const { productId } = await createProductWithStock(app, tenant, {
      name: 'Producto Pagado Completo',
      price: 30,
      quantity: 5,
    });
    const sale = await callApi<ApiSale>(
      app,
      'POST',
      '/sales',
      {
        posTerminalId: tenant.posTerminalId,
        warehouseId: tenant.warehouseId,
        customerId,
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
            amount: 30,
            idempotencyKey: `pago-completo-${uniqueSuffix()}`,
          },
        ],
      },
      tenant.accessToken,
    );
    expect(confirm.body.status).toBe('PAID');

    const list = await callApi<ApiReceivable[]>(
      app,
      'GET',
      '/receivables',
      undefined,
      tenant.accessToken,
    );
    expect(list.body.some((r) => r.saleId === sale.body.id)).toBe(false);
  });

  it('2)+3) pago parcial reduce el saldo, pago completo deja la Receivable PAID', async () => {
    const { productId } = await createProductWithStock(app, tenant, {
      name: 'Producto Pago Receivable',
      price: 100,
      quantity: 5,
    });
    const sale = await callApi<ApiSale>(
      app,
      'POST',
      '/sales',
      {
        posTerminalId: tenant.posTerminalId,
        warehouseId: tenant.warehouseId,
        customerId,
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
    const receivable = await findReceivableForSale(sale.body.id);

    const partial = await callApi<ApiSale>(
      app,
      'POST',
      `/receivables/${receivable.id}/payments`,
      {
        method: 'TRANSFER',
        amount: 40,
        idempotencyKey: `recv-partial-${uniqueSuffix()}`,
      },
      tenant.accessToken,
    );
    expect(partial.status).toBe(201);

    const afterPartial = await callApi<ApiReceivable>(
      app,
      'GET',
      `/receivables/${receivable.id}`,
      undefined,
      tenant.accessToken,
    );
    expect(afterPartial.body.status).toBe('PENDING');
    expect(Number(afterPartial.body.balance)).toBe(60);

    const complete = await callApi<ApiSale>(
      app,
      'POST',
      `/receivables/${receivable.id}/payments`,
      {
        method: 'TRANSFER',
        amount: 60,
        idempotencyKey: `recv-completo-${uniqueSuffix()}`,
      },
      tenant.accessToken,
    );
    expect(complete.status).toBe(201);

    const afterComplete = await callApi<ApiReceivable>(
      app,
      'GET',
      `/receivables/${receivable.id}`,
      undefined,
      tenant.accessToken,
    );
    expect(afterComplete.body.status).toBe('PAID');
    expect(Number(afterComplete.body.balance)).toBe(0);
  });

  it('4) impide sobrepago sobre una Receivable', async () => {
    const { productId } = await createProductWithStock(app, tenant, {
      name: 'Producto Sobrepago Receivable',
      price: 25,
      quantity: 5,
    });
    const sale = await callApi<ApiSale>(
      app,
      'POST',
      '/sales',
      {
        posTerminalId: tenant.posTerminalId,
        warehouseId: tenant.warehouseId,
        customerId,
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
    const receivable = await findReceivableForSale(sale.body.id);

    const overpay = await callApi<ApiSale>(
      app,
      'POST',
      `/receivables/${receivable.id}/payments`,
      {
        method: 'CASH',
        amount: 999,
        idempotencyKey: `recv-sobrepago-${uniqueSuffix()}`,
      },
      tenant.accessToken,
    );
    expect(overpay.status).toBe(400);
  });

  it('10) cobro de Receivable en efectivo con caja abierta genera un CashMovement SALE_PAYMENT', async () => {
    const posTerminalId = (
      await createTestPosTerminal(
        app,
        tenant,
        `Receivable Caja ${uniqueSuffix()}`,
      )
    ).posTerminalId;
    const register = await openCashRegister(app, tenant, {
      openingAmount: 0,
      posTerminalId,
    });
    const { productId } = await createProductWithStock(app, tenant, {
      name: 'Producto Receivable Caja',
      price: 80,
      quantity: 5,
    });
    const sale = await callApi<ApiSale>(
      app,
      'POST',
      '/sales',
      {
        posTerminalId,
        warehouseId: tenant.warehouseId,
        customerId,
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
    const receivable = await findReceivableForSale(sale.body.id);

    const payment = await callApi<ApiSale>(
      app,
      'POST',
      `/receivables/${receivable.id}/payments`,
      {
        method: 'CASH',
        amount: 80,
        idempotencyKey: `recv-caja-${uniqueSuffix()}`,
      },
      tenant.accessToken,
    );
    expect(payment.status).toBe(201);

    const detail = await callApi<ApiCashRegister>(
      app,
      'GET',
      `/cash-registers/${register.id}`,
      undefined,
      tenant.accessToken,
    );
    const cashMovement = detail.body.movements?.find(
      (m: ApiCashMovement) => m.type === 'SALE_PAYMENT',
    );
    expect(cashMovement).toBeDefined();
    expect(Number(cashMovement?.amount)).toBe(80);
  });

  it('20) creación de Receivable y pago quedan auditados', async () => {
    const { productId } = await createProductWithStock(app, tenant, {
      name: 'Producto Auditoria Receivable',
      price: 40,
      quantity: 5,
    });
    const sale = await callApi<ApiSale>(
      app,
      'POST',
      '/sales',
      {
        posTerminalId: tenant.posTerminalId,
        warehouseId: tenant.warehouseId,
        customerId,
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
    const receivable = await findReceivableForSale(sale.body.id);
    await callApi<ApiSale>(
      app,
      'POST',
      `/receivables/${receivable.id}/payments`,
      {
        method: 'TRANSFER',
        amount: 40,
        idempotencyKey: `recv-audit-${uniqueSuffix()}`,
      },
      tenant.accessToken,
    );

    await new Promise((resolve) => setTimeout(resolve, 1500));

    const tenantPrisma = app.get(TenantPrismaService);
    const logs = await tenantPrisma.run(tenant.organizationId, (tx) =>
      tx.auditLog.findMany({ where: { entityId: receivable.id } }),
    );
    const actions = (logs as ApiAuditLog[]).map((l) => l.action);
    expect(actions).toEqual(
      expect.arrayContaining([
        'receivables.create',
        'receivables.payment.create',
      ]),
    );
  }, 10000);
});
