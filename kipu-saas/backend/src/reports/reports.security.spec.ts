import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import {
  ApiPurchase,
  ApiSale,
  bootTestApp,
  callApi,
  createTestSupplier,
  createUserWithRole,
  openCashRegister,
  registerTestOrg,
  TestTenant,
  uniqueSuffix,
} from '../test-support/integration-app';

interface ReportView<T> {
  rows: T[];
  summary: Record<string, unknown>;
}

// Endpoints con su clave de export — usado para recorrer los 17 reportes
// de forma genérica en los tests de aislamiento/permisos, en vez de repetir
// 17 veces el mismo cuerpo de test.
const REPORT_ENDPOINTS = [
  '/reports/sales',
  '/reports/purchases',
  '/reports/income',
  '/reports/expenses',
  '/reports/cash',
  '/reports/inventory',
  '/reports/movements',
  '/reports/receivables',
  '/reports/payables',
  '/reports/top-products',
  '/reports/sales-by-product',
  '/reports/sales-by-category',
  '/reports/sales-by-branch',
  '/reports/sales-by-pos',
  '/reports/sales-by-user',
  '/reports/payment-methods',
  '/reports/sales-by-date',
];

describe('Reportes — seguridad (aislamiento de tenant + RBAC, DB real)', () => {
  let app: INestApplication;
  let tenantA: TestTenant;
  let tenantB: TestTenant;
  let productAId: string;
  let saleAId: string;
  let purchaseAId: string;

  beforeAll(async () => {
    app = await bootTestApp();
    tenantA = await registerTestOrg(app, 'Reports-Security-A');
    tenantB = await registerTestOrg(app, 'Reports-Security-B');

    const productRes = await callApi<{ id: string }>(
      app,
      'POST',
      '/products',
      { name: `Producto Seguridad A ${uniqueSuffix()}`, price: 80, cost: 40 },
      tenantA.accessToken,
    );
    productAId = productRes.body.id;
    await callApi(
      app,
      'POST',
      '/inventory/movements',
      {
        warehouseId: tenantA.warehouseId,
        productId: productAId,
        type: 'IN',
        quantity: 20,
        idempotencyKey: `sec-stock-${uniqueSuffix()}`,
      },
      tenantA.accessToken,
    );
    await openCashRegister(app, tenantA, { openingAmount: 0 });

    const sale = await callApi<ApiSale>(
      app,
      'POST',
      '/sales',
      {
        posTerminalId: tenantA.posTerminalId,
        warehouseId: tenantA.warehouseId,
        items: [{ productId: productAId, quantity: 2 }],
      },
      tenantA.accessToken,
    );
    saleAId = sale.body.id;
    await callApi(
      app,
      'POST',
      `/sales/${saleAId}/confirm`,
      {
        payments: [
          {
            method: 'CASH',
            amount: 160,
            idempotencyKey: `sec-pago-${uniqueSuffix()}`,
          },
        ],
      },
      tenantA.accessToken,
    );

    const supplierA = await createTestSupplier(
      app,
      tenantA,
      `Proveedor Seguridad A ${uniqueSuffix()}`,
    );
    const purchase = await callApi<ApiPurchase>(
      app,
      'POST',
      '/purchases',
      {
        supplierId: supplierA.supplierId,
        warehouseId: tenantA.warehouseId,
        items: [{ productId: productAId, quantity: 5, unitCost: 40 }],
      },
      tenantA.accessToken,
    );
    purchaseAId = purchase.body.id;
    await callApi(
      app,
      'POST',
      `/purchases/${purchaseAId}/confirm`,
      {},
      tenantA.accessToken,
    );
  }, 60000);

  afterAll(async () => {
    await app.close();
  }, 15000);

  // ---------------------------------------------------------------------
  // Aislamiento de tenant: B nunca ve datos de A, ni siquiera pidiéndolos
  // explícitamente por id (productId/branchId/warehouseId/posTerminalId de
  // A) desde el token de B.
  // ---------------------------------------------------------------------
  it('reporte de ventas: el tenant B no ve las ventas del tenant A', async () => {
    const res = await callApi<ReportView<{ id: string }>>(
      app,
      'GET',
      '/reports/sales',
      undefined,
      tenantB.accessToken,
    );
    expect(res.status).toBe(200);
    expect(res.body.rows.find((r) => r.id === saleAId)).toBeUndefined();
    expect(res.body.summary.count).toBe(0);
  });

  it('reporte de compras: el tenant B no ve las compras del tenant A', async () => {
    const res = await callApi<ReportView<{ id: string }>>(
      app,
      'GET',
      '/reports/purchases',
      undefined,
      tenantB.accessToken,
    );
    expect(res.body.rows.find((r) => r.id === purchaseAId)).toBeUndefined();
  });

  it('tenant B filtrando por el productId de A: cero filas, nunca datos de A', async () => {
    const res = await callApi<ReportView<{ id: string }>>(
      app,
      'GET',
      `/reports/sales?productId=${productAId}`,
      undefined,
      tenantB.accessToken,
    );
    expect(res.status).toBe(200);
    expect(res.body.rows.length).toBe(0);
    expect(res.body.summary.count).toBe(0);
  });

  it('tenant B filtrando por el warehouseId de A: cero filas', async () => {
    const res = await callApi<ReportView<{ id: string }>>(
      app,
      'GET',
      `/reports/inventory?warehouseId=${tenantA.warehouseId}`,
      undefined,
      tenantB.accessToken,
    );
    expect(res.status).toBe(200);
    expect(res.body.rows.length).toBe(0);
  });

  it('tenant B filtrando por el branchId de A: cero filas (no revela la sucursal ajena)', async () => {
    const res = await callApi<ReportView<{ id: string }>>(
      app,
      'GET',
      `/reports/sales?branchId=${tenantA.branchId}`,
      undefined,
      tenantB.accessToken,
    );
    expect(res.status).toBe(200);
    expect(res.body.rows.length).toBe(0);
  });

  it('tenant B filtrando por el posTerminalId de A: cero filas', async () => {
    const res = await callApi<ReportView<{ id: string }>>(
      app,
      'GET',
      `/reports/sales?posTerminalId=${tenantA.posTerminalId}`,
      undefined,
      tenantB.accessToken,
    );
    expect(res.status).toBe(200);
    expect(res.body.rows.length).toBe(0);
  });

  it('cuentas por cobrar/pagar: el tenant B no ve nada del tenant A', async () => {
    const receivables = await callApi<ReportView<{ id: string }>>(
      app,
      'GET',
      '/reports/receivables',
      undefined,
      tenantB.accessToken,
    );
    const payables = await callApi<ReportView<{ id: string }>>(
      app,
      'GET',
      '/reports/payables',
      undefined,
      tenantB.accessToken,
    );
    expect(receivables.body.rows.length).toBe(0);
    expect(payables.body.rows.length).toBe(0);
  });

  it('export: el tenant B exportando ventas nunca incluye filas de A', async () => {
    const server = app.getHttpServer() as Parameters<typeof request>[0];
    const res = await request(server)
      .get('/reports/sales/export?format=csv')
      .set('Authorization', `Bearer ${tenantB.accessToken}`);
    expect(res.status).toBe(200);
    const csvText = res.text;
    expect(csvText).not.toContain(saleAId);
  });

  it('todos los reportes responden 200 y datos propios para el tenant A (recorrido completo)', async () => {
    for (const endpoint of REPORT_ENDPOINTS) {
      const res = await callApi(
        app,
        'GET',
        endpoint,
        undefined,
        tenantA.accessToken,
      );
      expect(res.status).toBe(200);
    }
  });

  // ---------------------------------------------------------------------
  // RBAC: reports.read es requerido en TODOS los endpoints (fail-closed).
  // ---------------------------------------------------------------------
  it('un usuario sin reports.read (rol SALES) recibe 403 en cada reporte', async () => {
    const salesToken = await createUserWithRole(
      app,
      tenantA.organizationId,
      'SALES',
    );
    for (const endpoint of REPORT_ENDPOINTS) {
      const res = await callApi(app, 'GET', endpoint, undefined, salesToken);
      expect(res.status).toBe(403);
    }
  });

  it('un usuario sin reports.read no puede exportar', async () => {
    const salesToken = await createUserWithRole(
      app,
      tenantA.organizationId,
      'SALES',
    );
    const res = await callApi(
      app,
      'GET',
      '/reports/sales/export?format=csv',
      undefined,
      salesToken,
    );
    expect(res.status).toBe(403);
  });

  it('un usuario con reports.read (rol ACCOUNTANT) sí puede ver los reportes', async () => {
    const accountantToken = await createUserWithRole(
      app,
      tenantA.organizationId,
      'ACCOUNTANT',
    );
    for (const endpoint of REPORT_ENDPOINTS) {
      const res = await callApi(
        app,
        'GET',
        endpoint,
        undefined,
        accountantToken,
      );
      expect(res.status).toBe(200);
    }
  });

  it('un usuario con reports.read (rol AUDITOR) sí puede ver y exportar', async () => {
    const auditorToken = await createUserWithRole(
      app,
      tenantA.organizationId,
      'AUDITOR',
    );
    const view = await callApi(
      app,
      'GET',
      '/reports/sales',
      undefined,
      auditorToken,
    );
    expect(view.status).toBe(200);
    const exportRes = await callApi(
      app,
      'GET',
      '/reports/sales/export?format=csv',
      undefined,
      auditorToken,
    );
    expect(exportRes.status).toBe(200);
  });

  it('sin token, todos los reportes responden 401', async () => {
    for (const endpoint of REPORT_ENDPOINTS) {
      const res = await callApi(app, 'GET', endpoint);
      expect(res.status).toBe(401);
    }
  });
});
