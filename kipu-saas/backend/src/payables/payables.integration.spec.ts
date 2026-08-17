import { INestApplication } from '@nestjs/common';
import {
  ApiAuditLog,
  ApiCashMovement,
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
import { TenantPrismaService } from '../prisma/tenant-prisma.service';

describe('Payables — pagos y Caja (integración, DB real)', () => {
  let app: INestApplication;
  let tenant: TestTenant;
  let supplierId: string;

  beforeAll(async () => {
    app = await bootTestApp();
    tenant = await registerTestOrg(app, 'Payables-Core');
    supplierId = (await createTestSupplier(app, tenant, 'Proveedor Core'))
      .supplierId;
  }, 30000);

  afterAll(async () => {
    await app.close();
  }, 15000);

  async function receivedPayable(quantity: number, unitCost: number) {
    const { productId } = await createTestProduct(app, tenant, {
      name: `Producto Payable ${uniqueSuffix()}`,
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
        idempotencyKey: `payable-recv-${uniqueSuffix()}`,
      },
      tenant.accessToken,
    );
    return received.body.payables[0];
  }

  it('5) recibir una compra genera su Payable con el saldo pendiente correcto', async () => {
    const payable = await receivedPayable(10, 8); // 80
    expect(Number(payable.amount)).toBe(80);
    expect(payable.status).toBe('PENDING');
  });

  it('6)+7) pago parcial reduce el saldo, pago completo deja la Payable PAID', async () => {
    const payable = await receivedPayable(10, 10); // 100

    const partial = await callApi<ApiPayable>(
      app,
      'POST',
      `/payables/${payable.id}/payments`,
      {
        method: 'TRANSFER',
        amount: 40,
        idempotencyKey: `payable-partial-${uniqueSuffix()}`,
      },
      tenant.accessToken,
    );
    expect(partial.status).toBe(201);
    expect(Number(partial.body.balance)).toBe(60);
    expect(partial.body.status).toBe('PENDING');

    const complete = await callApi<ApiPayable>(
      app,
      'POST',
      `/payables/${payable.id}/payments`,
      {
        method: 'TRANSFER',
        amount: 60,
        idempotencyKey: `payable-completo-${uniqueSuffix()}`,
      },
      tenant.accessToken,
    );
    expect(complete.status).toBe(201);
    expect(complete.body.status).toBe('PAID');
    expect(Number(complete.body.balance)).toBe(0);
  });

  it('8) impide pagar más del saldo pendiente', async () => {
    const payable = await receivedPayable(5, 10); // 50
    const overpay = await callApi<ApiPayable>(
      app,
      'POST',
      `/payables/${payable.id}/payments`,
      {
        method: 'CASH',
        amount: 999,
        idempotencyKey: `payable-sobrepago-${uniqueSuffix()}`,
      },
      tenant.accessToken,
    );
    expect(overpay.status).toBe(400);
  });

  it('9) pago en efectivo con caja abierta indicada genera un CashMovement PAYABLE_PAYMENT', async () => {
    const posTerminalId = (
      await createTestPosTerminal(app, tenant, `Payable Caja ${uniqueSuffix()}`)
    ).posTerminalId;
    const register = await openCashRegister(app, tenant, {
      openingAmount: 200,
      posTerminalId,
    });
    const payable = await receivedPayable(6, 10); // 60

    const pay = await callApi<ApiPayable>(
      app,
      'POST',
      `/payables/${payable.id}/payments`,
      {
        method: 'CASH',
        amount: 60,
        posTerminalId,
        idempotencyKey: `payable-caja-${uniqueSuffix()}`,
      },
      tenant.accessToken,
    );
    expect(pay.status).toBe(201);
    expect(pay.body.status).toBe('PAID');

    const detail = await callApi<ApiCashRegister>(
      app,
      'GET',
      `/cash-registers/${register.id}`,
      undefined,
      tenant.accessToken,
    );
    const movement = detail.body.movements?.find(
      (m: ApiCashMovement) => m.type === 'PAYABLE_PAYMENT',
    );
    expect(movement).toBeDefined();
    expect(Number(movement?.amount)).toBe(60);
    expect(movement?.reference).toBe(payable.id);
  });

  it('un pago en efectivo que supera el saldo de la caja indicada se rechaza (400) y no afecta la Payable', async () => {
    const posTerminalId = (
      await createTestPosTerminal(
        app,
        tenant,
        `Payable Caja Insuficiente ${uniqueSuffix()}`,
      )
    ).posTerminalId;
    await openCashRegister(app, tenant, { openingAmount: 5, posTerminalId });
    const payable = await receivedPayable(10, 10); // 100

    const pay = await callApi<ApiPayable>(
      app,
      'POST',
      `/payables/${payable.id}/payments`,
      {
        method: 'CASH',
        amount: 100,
        posTerminalId,
        idempotencyKey: `payable-caja-insuf-${uniqueSuffix()}`,
      },
      tenant.accessToken,
    );
    expect(pay.status).toBe(400);

    const detail = await callApi<ApiPayable>(
      app,
      'GET',
      `/payables/${payable.id}`,
      undefined,
      tenant.accessToken,
    );
    expect(Number(detail.body.balance)).toBe(100); // el pago no se aplicó
  });

  it('un pago en efectivo sin indicar caja se aplica igual, sin movimiento de caja', async () => {
    const payable = await receivedPayable(3, 10); // 30
    const pay = await callApi<ApiPayable>(
      app,
      'POST',
      `/payables/${payable.id}/payments`,
      {
        method: 'CASH',
        amount: 30,
        idempotencyKey: `payable-sin-caja-${uniqueSuffix()}`,
      },
      tenant.accessToken,
    );
    expect(pay.status).toBe(201);
    expect(pay.body.status).toBe('PAID');
  });

  it('20) el pago de una Payable queda auditado', async () => {
    const payable = await receivedPayable(2, 10); // 20
    await callApi<ApiPayable>(
      app,
      'POST',
      `/payables/${payable.id}/payments`,
      {
        method: 'TRANSFER',
        amount: 20,
        idempotencyKey: `payable-audit-${uniqueSuffix()}`,
      },
      tenant.accessToken,
    );

    await new Promise((resolve) => setTimeout(resolve, 1500));

    const tenantPrisma = app.get(TenantPrismaService);
    const logs = await tenantPrisma.run(tenant.organizationId, (tx) =>
      tx.auditLog.findMany({ where: { entityId: payable.id } }),
    );
    const actions = (logs as ApiAuditLog[]).map((l) => l.action);
    expect(actions).toEqual(
      expect.arrayContaining(['payables.payment.create']),
    );
  }, 10000);
});
