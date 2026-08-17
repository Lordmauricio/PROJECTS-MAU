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

/**
 * El aislamiento general de Payables (lectura/pago cruzado entre tenants,
 * RLS crudo, RBAC de payables.manage/read) ya está cubierto en
 * `purchases.security.spec.ts` desde la Fase Comercial 3. Este archivo
 * cubre específicamente la superficie NUEVA de la Fase Comercial 6: que la
 * integración con Caja (posTerminalId explícito en el pago) no permita a un
 * tenant afectar la caja de otro.
 */
describe('Payables — aislamiento de la integración con Caja (integración, DB real)', () => {
  let app: INestApplication;
  let tenantA: TestTenant;
  let tenantB: TestTenant;
  let supplierBId: string;

  beforeAll(async () => {
    app = await bootTestApp();
    tenantA = await registerTestOrg(app, 'Payables-Cash-Security-A');
    tenantB = await registerTestOrg(app, 'Payables-Cash-Security-B');
    supplierBId = (await createTestSupplier(app, tenantB, 'Proveedor B'))
      .supplierId;
  }, 30000);

  afterAll(async () => {
    await app.close();
  }, 15000);

  it('Tenant B no puede pagar SU Payable indicando un posTerminalId de Tenant A (el pago se aplica igual, sin afectar la caja de A)', async () => {
    const posTerminalIdA = (
      await createTestPosTerminal(app, tenantA, `Terminal A ${uniqueSuffix()}`)
    ).posTerminalId;
    const registerA = await openCashRegister(app, tenantA, {
      openingAmount: 500,
      posTerminalId: posTerminalIdA,
    });

    const { productId } = await createTestProduct(app, tenantB, {
      name: `Producto Cross Payable ${uniqueSuffix()}`,
    });
    const purchase = await callApi<ApiPurchase>(
      app,
      'POST',
      '/purchases',
      {
        supplierId: supplierBId,
        warehouseId: tenantB.warehouseId,
        items: [{ productId, quantity: 5, unitCost: 10 }],
      },
      tenantB.accessToken,
    );
    await callApi<ApiPurchase>(
      app,
      'POST',
      `/purchases/${purchase.body.id}/confirm`,
      {},
      tenantB.accessToken,
    );
    const itemId = purchase.body.items[0].id;
    const received = await callApi<ApiPurchase>(
      app,
      'POST',
      `/purchases/${purchase.body.id}/receive`,
      {
        items: [{ purchaseItemId: itemId, quantity: 5 }],
        idempotencyKey: `cross-recv-${uniqueSuffix()}`,
      },
      tenantB.accessToken,
    );
    const payableB = received.body.payables[0];

    const pay = await callApi<ApiPayable>(
      app,
      'POST',
      `/payables/${payableB.id}/payments`,
      {
        method: 'CASH',
        amount: 50,
        posTerminalId: posTerminalIdA, // terminal de OTRO tenant
        idempotencyKey: `cross-tenant-payable-caja-${uniqueSuffix()}`,
      },
      tenantB.accessToken,
    );
    // El pago sobre LA PROPIA payable de B es válido — 201 — pero el
    // posTerminalId de A, bajo el contexto RLS de B, no encuentra ninguna
    // caja OPEN (la query de CashService está scoped a organizationId de
    // B), así que el pago se aplica SIN mover la caja de A.
    expect(pay.status).toBe(201);

    const registerAAfter = await callApi<ApiCashRegister>(
      app,
      'GET',
      `/cash-registers/${registerA.id}`,
      undefined,
      tenantA.accessToken,
    );
    expect(registerAAfter.body.movements).toHaveLength(0); // nunca se tocó
  });
});
