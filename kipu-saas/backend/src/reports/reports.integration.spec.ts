import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import {
  ApiPurchase,
  ApiReceivable,
  ApiSale,
  bootTestApp,
  callApi,
  createTestSupplier,
  createTestWarehouse,
  openCashRegister,
  registerTestOrg,
  TestTenant,
  uniqueSuffix,
} from '../test-support/integration-app';
import { ReportsService } from './reports.service';
import { InventoryService } from '../inventory/inventory.service';

function decodeJwtSub(token: string): string {
  const payload = token.split('.')[1];
  const json = Buffer.from(payload, 'base64url').toString('utf8');
  return (JSON.parse(json) as { sub: string }).sub;
}

interface ReportSalesRow {
  id: string;
  status: string;
}
interface ReportView<T> {
  rows: T[];
  totalRows?: number;
  page?: number;
  pageSize?: number;
  summary: Record<string, unknown>;
}

describe('Reportes — integración (datos reales, DB real)', () => {
  let app: INestApplication;
  let tenant: TestTenant;
  let ownerUserId: string;
  let productAId: string;
  let productBId: string;
  let categoryAId: string;
  let categoryBId: string;
  let customerId: string;
  let supplierId: string;
  let saleId1: string; // 2x A, CASH, 200
  let saleId2: string; // 3x B, CARD, 150
  let saleId3: string; // 1x A, crédito, luego pago parcial CASH 40
  let purchaseId: string;
  let payableId: string;
  let registerId: string;

  beforeAll(async () => {
    app = await bootTestApp();
    tenant = await registerTestOrg(app, 'Reports-Integration');
    ownerUserId = decodeJwtSub(tenant.accessToken);

    const catA = await callApi<{ id: string }>(
      app,
      'POST',
      '/product-categories',
      { name: `Categoría A ${uniqueSuffix()}` },
      tenant.accessToken,
    );
    const catB = await callApi<{ id: string }>(
      app,
      'POST',
      '/product-categories',
      { name: `Categoría B ${uniqueSuffix()}` },
      tenant.accessToken,
    );
    categoryAId = catA.body.id;
    categoryBId = catB.body.id;

    const prodA = await callApi<{ id: string }>(
      app,
      'POST',
      '/products',
      {
        name: `Producto A ${uniqueSuffix()}`,
        price: 100,
        cost: 60,
        categoryId: categoryAId,
      },
      tenant.accessToken,
    );
    const prodB = await callApi<{ id: string }>(
      app,
      'POST',
      '/products',
      {
        name: `Producto B ${uniqueSuffix()}`,
        price: 50,
        cost: 20,
        categoryId: categoryBId,
      },
      tenant.accessToken,
    );
    productAId = prodA.body.id;
    productBId = prodB.body.id;

    const customer = await callApi<{ id: string }>(
      app,
      'POST',
      '/customers',
      { name: `Cliente Reportes ${uniqueSuffix()}` },
      tenant.accessToken,
    );
    customerId = customer.body.id;
    supplierId = (
      await createTestSupplier(
        app,
        tenant,
        `Proveedor Reportes ${uniqueSuffix()}`,
      )
    ).supplierId;

    // Stock inicial: 100 de cada producto en el almacén principal.
    for (const [productId, qty] of [
      [productAId, 100],
      [productBId, 100],
    ] as const) {
      await callApi(
        app,
        'POST',
        '/inventory/movements',
        {
          warehouseId: tenant.warehouseId,
          productId,
          type: 'IN',
          quantity: qty,
          reason: 'Carga inicial (reportes)',
          idempotencyKey: `reportes-init-${productId}-${uniqueSuffix()}`,
        },
        tenant.accessToken,
      );
    }
    // Ajuste positivo (+5 A) para diversidad de tipos en el kardex.
    const adjustment = await callApi(
      app,
      'POST',
      '/inventory/movements',
      {
        warehouseId: tenant.warehouseId,
        productId: productAId,
        type: 'ADJUSTMENT',
        direction: 'INCREASE',
        quantity: 5,
        reason: 'Ajuste (reportes)',
        idempotencyKey: `reportes-ajuste-${productAId}-${uniqueSuffix()}`,
      },
      tenant.accessToken,
    );
    if (adjustment.status !== 201) {
      throw new Error(
        `ajuste de inventario debía dar 201, dio ${adjustment.status}: ${JSON.stringify(adjustment.body)}`,
      );
    }

    await openCashRegister(app, tenant, { openingAmount: 0 }).then((r) => {
      registerId = r.id;
    });

    // Venta 1: 2x A = 200, pagada CASH completa al confirmar.
    const sale1 = await callApi<ApiSale>(
      app,
      'POST',
      '/sales',
      {
        posTerminalId: tenant.posTerminalId,
        warehouseId: tenant.warehouseId,
        items: [{ productId: productAId, quantity: 2 }],
      },
      tenant.accessToken,
    );
    saleId1 = sale1.body.id;
    await callApi(
      app,
      'POST',
      `/sales/${saleId1}/confirm`,
      {
        payments: [
          {
            method: 'CASH',
            amount: 200,
            idempotencyKey: `pago-1-${uniqueSuffix()}`,
          },
        ],
      },
      tenant.accessToken,
    );

    // Venta 2: 3x B = 150, pagada CARD completa al confirmar.
    const sale2 = await callApi<ApiSale>(
      app,
      'POST',
      '/sales',
      {
        posTerminalId: tenant.posTerminalId,
        warehouseId: tenant.warehouseId,
        items: [{ productId: productBId, quantity: 3 }],
      },
      tenant.accessToken,
    );
    saleId2 = sale2.body.id;
    await callApi(
      app,
      'POST',
      `/sales/${saleId2}/confirm`,
      {
        payments: [
          {
            method: 'CARD',
            amount: 150,
            idempotencyKey: `pago-2-${uniqueSuffix()}`,
          },
        ],
      },
      tenant.accessToken,
    );

    // Venta 3 (crédito): 1x A = 100, sin pago al confirmar -> Receivable; luego pago parcial CASH 40.
    const sale3 = await callApi<ApiSale>(
      app,
      'POST',
      '/sales',
      {
        posTerminalId: tenant.posTerminalId,
        warehouseId: tenant.warehouseId,
        customerId,
        items: [{ productId: productAId, quantity: 1 }],
      },
      tenant.accessToken,
    );
    saleId3 = sale3.body.id;
    await callApi(
      app,
      'POST',
      `/sales/${saleId3}/confirm`,
      {},
      tenant.accessToken,
    );
    await callApi(
      app,
      'POST',
      `/sales/${saleId3}/payments`,
      {
        method: 'CASH',
        amount: 40,
        idempotencyKey: `pago-3-${uniqueSuffix()}`,
      },
      tenant.accessToken,
    );

    // Compra: 10x A a costo 60 = 600, recibida completa -> Payable; pago parcial CASH 200.
    const purchase = await callApi<ApiPurchase>(
      app,
      'POST',
      '/purchases',
      {
        supplierId,
        warehouseId: tenant.warehouseId,
        items: [{ productId: productAId, quantity: 10, unitCost: 60 }],
      },
      tenant.accessToken,
    );
    purchaseId = purchase.body.id;
    await callApi(
      app,
      'POST',
      `/purchases/${purchaseId}/confirm`,
      {},
      tenant.accessToken,
    );
    const received = await callApi<ApiPurchase>(
      app,
      'POST',
      `/purchases/${purchaseId}/receive`,
      {
        items: [{ purchaseItemId: purchase.body.items[0].id, quantity: 10 }],
        idempotencyKey: `recepcion-reportes-${uniqueSuffix()}`,
      },
      tenant.accessToken,
    );
    payableId = received.body.payables[0].id;
    await callApi(
      app,
      'POST',
      `/payables/${payableId}/payments`,
      {
        method: 'CASH',
        amount: 200,
        idempotencyKey: `pago-payable-reportes-${uniqueSuffix()}`,
        posTerminalId: tenant.posTerminalId,
      },
      tenant.accessToken,
    );

    // Movimientos de caja manuales + gasto.
    await callApi(
      app,
      'POST',
      `/cash-registers/${registerId}/movements`,
      {
        type: 'CASH_IN',
        amount: 50,
        idempotencyKey: `cashin-reportes-${uniqueSuffix()}`,
      },
      tenant.accessToken,
    );
    await callApi(
      app,
      'POST',
      `/cash-registers/${registerId}/movements`,
      {
        type: 'CASH_OUT',
        amount: 20,
        idempotencyKey: `cashout-reportes-${uniqueSuffix()}`,
      },
      tenant.accessToken,
    );
    await callApi(
      app,
      'POST',
      '/expenses',
      {
        cashRegisterId: registerId,
        amount: 30,
        category: 'Varios',
        description: 'Gasto de prueba (reportes)',
        idempotencyKey: `gasto-reportes-${uniqueSuffix()}`,
      },
      tenant.accessToken,
    );
  }, 60000);

  afterAll(async () => {
    await app.close();
  }, 15000);

  // ---------------------------------------------------------------------
  // 1) Reporte de ventas
  // ---------------------------------------------------------------------
  it('reporte de ventas: totales y conteo correctos sin filtros', async () => {
    const res = await callApi<ReportView<ReportSalesRow>>(
      app,
      'GET',
      '/reports/sales',
      undefined,
      tenant.accessToken,
    );
    expect(res.status).toBe(200);
    expect(res.body.summary.count).toBe(3);
    expect(Number(res.body.summary.total)).toBe(450);
  });

  it('reporte de ventas: filtro por estado PAID', async () => {
    const res = await callApi<ReportView<ReportSalesRow>>(
      app,
      'GET',
      '/reports/sales?status=PAID',
      undefined,
      tenant.accessToken,
    );
    expect(res.status).toBe(200);
    expect(res.body.summary.count).toBe(2);
    expect(Number(res.body.summary.total)).toBe(350);
  });

  it('reporte de ventas: filtro por método de pago CASH', async () => {
    const res = await callApi<ReportView<ReportSalesRow>>(
      app,
      'GET',
      '/reports/sales?paymentMethod=CASH',
      undefined,
      tenant.accessToken,
    );
    expect(res.status).toBe(200);
    expect(res.body.summary.count).toBe(2); // venta 1 y venta 3
  });

  it('reporte de ventas: filtro por producto', async () => {
    const res = await callApi<ReportView<ReportSalesRow>>(
      app,
      'GET',
      `/reports/sales?productId=${productAId}`,
      undefined,
      tenant.accessToken,
    );
    expect(res.status).toBe(200);
    expect(res.body.summary.count).toBe(2); // venta 1 y venta 3
    expect(Number(res.body.summary.total)).toBe(300);
  });

  it('reporte de ventas: filtro por usuario (creador)', async () => {
    const res = await callApi<ReportView<ReportSalesRow>>(
      app,
      'GET',
      `/reports/sales?userId=${ownerUserId}`,
      undefined,
      tenant.accessToken,
    );
    expect(res.body.summary.count).toBe(3);
  });

  it('reporte de ventas: filtro de fecha futura devuelve cero filas', async () => {
    const tomorrow = new Date(Date.now() + 86_400_000).toISOString();
    const res = await callApi<ReportView<ReportSalesRow>>(
      app,
      'GET',
      `/reports/sales?dateFrom=${tomorrow}`,
      undefined,
      tenant.accessToken,
    );
    expect(res.body.summary.count).toBe(0);
    expect(Number(res.body.summary.total)).toBe(0);
  });

  it('reporte de ventas: paginación respeta pageSize', async () => {
    const res = await callApi<ReportView<ReportSalesRow>>(
      app,
      'GET',
      '/reports/sales?pageSize=1',
      undefined,
      tenant.accessToken,
    );
    expect(res.body.rows.length).toBe(1);
    expect(res.body.totalRows).toBe(3);
    // El summary siempre es sobre TODO lo filtrado, no solo la página.
    expect(Number(res.body.summary.total)).toBe(450);
  });

  // ---------------------------------------------------------------------
  // 2) Reporte de compras
  // ---------------------------------------------------------------------
  it('reporte de compras: total correcto', async () => {
    const res = await callApi<ReportView<{ id: string }>>(
      app,
      'GET',
      '/reports/purchases',
      undefined,
      tenant.accessToken,
    );
    expect(res.body.summary.count).toBe(1);
    expect(Number(res.body.summary.total)).toBe(600);
  });

  // ---------------------------------------------------------------------
  // 3) / 4) Ingresos / egresos
  // ---------------------------------------------------------------------
  it('reporte de ingresos: suma CASH_IN + cobros en efectivo', async () => {
    const res = await callApi<ReportView<{ type: string }>>(
      app,
      'GET',
      '/reports/income',
      undefined,
      tenant.accessToken,
    );
    expect(Number(res.body.summary.total)).toBe(290); // 50 + 200 + 40
  });

  it('reporte de egresos: suma CASH_OUT + EXPENSE + pago a proveedor', async () => {
    const res = await callApi<ReportView<{ type: string }>>(
      app,
      'GET',
      '/reports/expenses',
      undefined,
      tenant.accessToken,
    );
    expect(Number(res.body.summary.total)).toBe(250); // 20 + 30 + 200
  });

  // ---------------------------------------------------------------------
  // 5) Reporte de caja
  // ---------------------------------------------------------------------
  it('reporte de caja: saldo actual = apertura + ingresos - egresos', async () => {
    const res = await callApi<
      ReportView<{ id: string; currentBalance: string }>
    >(
      app,
      'GET',
      `/reports/cash?posTerminalId=${tenant.posTerminalId}`,
      undefined,
      tenant.accessToken,
    );
    expect(res.body.rows.length).toBe(1);
    expect(Number(res.body.rows[0].currentBalance)).toBe(40); // 290 - 250
  });

  // ---------------------------------------------------------------------
  // 6) Reporte de inventario
  // ---------------------------------------------------------------------
  it('reporte de inventario: cantidades y valorización correctas', async () => {
    const res = await callApi<
      ReportView<{ productId: string; quantity: string; value: string }>
    >(
      app,
      'GET',
      `/reports/inventory?warehouseId=${tenant.warehouseId}`,
      undefined,
      tenant.accessToken,
    );
    const rowA = res.body.rows.find((r) => r.productId === productAId)!;
    const rowB = res.body.rows.find((r) => r.productId === productBId)!;
    // A: 100 inicial - 2 (venta1) - 1 (venta3) + 10 (compra) + 5 (ajuste) = 112
    expect(Number(rowA.quantity)).toBe(112);
    expect(Number(rowA.value)).toBe(112 * 60);
    // B: 100 inicial - 3 (venta2) = 97
    expect(Number(rowB.quantity)).toBe(97);
    expect(Number(rowB.value)).toBe(97 * 20);
  });

  // ---------------------------------------------------------------------
  // 7) Kardex / movimientos
  // ---------------------------------------------------------------------
  it('kardex: cuenta movimientos IN/OUT/ADJUSTMENT correctamente para un producto', async () => {
    const res = await callApi<
      ReportView<{ type: string }> & {
        summary: { in: number; out: number; adjustment: number };
      }
    >(
      app,
      'GET',
      `/reports/movements?warehouseId=${tenant.warehouseId}&productId=${productAId}`,
      undefined,
      tenant.accessToken,
    );
    // A: IN inicial, OUT venta1, OUT venta3, IN compra, ADJUSTMENT = 5 movimientos
    expect(res.body.rows.length).toBe(5);
    expect(res.body.summary.in).toBe(2);
    expect(res.body.summary.out).toBe(2);
    expect(res.body.summary.adjustment).toBe(1);
  });

  // ---------------------------------------------------------------------
  // 8) / 9) Receivables / Payables
  // ---------------------------------------------------------------------
  it('cuentas por cobrar: monto/pagado/saldo correctos', async () => {
    const res = await callApi<ApiReceivable[] | ReportView<{ id: string }>>(
      app,
      'GET',
      '/reports/receivables?status=PENDING',
      undefined,
      tenant.accessToken,
    );
    const body = res.body as ReportView<{
      id: string;
      amount: string;
      paidTotal: string;
      balance: string;
    }>;
    expect(body.rows.length).toBe(1);
    expect(Number(body.rows[0].amount)).toBe(100);
    expect(Number(body.rows[0].paidTotal)).toBe(40);
    expect(Number(body.rows[0].balance)).toBe(60);
  });

  it('cuentas por pagar: monto/pagado/saldo correctos', async () => {
    const res = await callApi<
      ReportView<{
        id: string;
        amount: string;
        paidTotal: string;
        balance: string;
      }>
    >(
      app,
      'GET',
      '/reports/payables?status=PENDING',
      undefined,
      tenant.accessToken,
    );
    expect(res.body.rows.length).toBe(1);
    expect(Number(res.body.rows[0].amount)).toBe(600);
    expect(Number(res.body.rows[0].paidTotal)).toBe(200);
    expect(Number(res.body.rows[0].balance)).toBe(400);
  });

  // ---------------------------------------------------------------------
  // 10) / 11) Productos más vendidos / ventas por producto
  // ---------------------------------------------------------------------
  it('productos más vendidos: ordenado desc por total, cantidades correctas', async () => {
    const res = await callApi<
      ReportView<{ productId: string; quantity: string; total: string }>
    >(app, 'GET', '/reports/top-products', undefined, tenant.accessToken);
    expect(res.body.rows[0].productId).toBe(productAId);
    expect(Number(res.body.rows[0].quantity)).toBe(3);
    expect(Number(res.body.rows[0].total)).toBe(300);
    expect(res.body.rows[1].productId).toBe(productBId);
    expect(Number(res.body.rows[1].total)).toBe(150);
  });

  // ---------------------------------------------------------------------
  // 12) Ventas por categoría
  // ---------------------------------------------------------------------
  it('ventas por categoría: totales por categoría correctos', async () => {
    const res = await callApi<
      ReportView<{ categoryId: string | null; total: string }>
    >(app, 'GET', '/reports/sales-by-category', undefined, tenant.accessToken);
    const catA = res.body.rows.find((r) => r.categoryId === categoryAId)!;
    const catB = res.body.rows.find((r) => r.categoryId === categoryBId)!;
    expect(Number(catA.total)).toBe(300);
    expect(Number(catB.total)).toBe(150);
  });

  // ---------------------------------------------------------------------
  // 13) / 14) Ventas por sucursal / POS
  // ---------------------------------------------------------------------
  it('ventas por sucursal: una sola sucursal con el total completo', async () => {
    const res = await callApi<ReportView<{ branchId: string; total: string }>>(
      app,
      'GET',
      '/reports/sales-by-branch',
      undefined,
      tenant.accessToken,
    );
    expect(res.body.rows.length).toBe(1);
    expect(res.body.rows[0].branchId).toBe(tenant.branchId);
    expect(Number(res.body.rows[0].total)).toBe(450);
  });

  it('ventas por POS: un solo terminal con el total completo', async () => {
    const res = await callApi<
      ReportView<{ posTerminalId: string; total: string }>
    >(app, 'GET', '/reports/sales-by-pos', undefined, tenant.accessToken);
    expect(res.body.rows.length).toBe(1);
    expect(res.body.rows[0].posTerminalId).toBe(tenant.posTerminalId);
    expect(Number(res.body.rows[0].total)).toBe(450);
  });

  // ---------------------------------------------------------------------
  // 15) Ventas por usuario
  // ---------------------------------------------------------------------
  it('ventas por usuario: un solo usuario con el total completo', async () => {
    const res = await callApi<
      ReportView<{ userId: string | null; total: string }>
    >(app, 'GET', '/reports/sales-by-user', undefined, tenant.accessToken);
    expect(res.body.rows.length).toBe(1);
    expect(res.body.rows[0].userId).toBe(ownerUserId);
    expect(Number(res.body.rows[0].total)).toBe(450);
  });

  // ---------------------------------------------------------------------
  // 16) Métodos de pago
  // ---------------------------------------------------------------------
  it('métodos de pago: CASH y CARD con sus totales correctos', async () => {
    const res = await callApi<ReportView<{ method: string; total: string }>>(
      app,
      'GET',
      '/reports/payment-methods',
      undefined,
      tenant.accessToken,
    );
    const cash = res.body.rows.find((r) => r.method === 'CASH')!;
    const card = res.body.rows.find((r) => r.method === 'CARD')!;
    expect(Number(cash.total)).toBe(240); // 200 + 40
    expect(Number(card.total)).toBe(150);
  });

  // ---------------------------------------------------------------------
  // 17) Ventas por rango de fechas
  // ---------------------------------------------------------------------
  it('ventas por fecha: un solo día con el total completo', async () => {
    const res = await callApi<ReportView<{ date: string; total: string }>>(
      app,
      'GET',
      '/reports/sales-by-date',
      undefined,
      tenant.accessToken,
    );
    expect(res.body.rows.length).toBe(1);
    expect(Number(res.body.rows[0].total)).toBe(450);
  });

  // ---------------------------------------------------------------------
  // Filtro de almacén con un segundo almacén (nunca mezcla stock entre almacenes)
  // ---------------------------------------------------------------------
  it('reporte de inventario: filtrar por un segundo almacén no mezcla stock', async () => {
    const otherWarehouse = await createTestWarehouse(
      app,
      tenant,
      `Otro Almacén ${uniqueSuffix()}`,
    );
    await callApi(
      app,
      'POST',
      '/inventory/movements',
      {
        warehouseId: otherWarehouse.warehouseId,
        productId: productAId,
        type: 'IN',
        quantity: 7,
        reason: 'Stock en otro almacén',
        idempotencyKey: `reportes-otro-almacen-${uniqueSuffix()}`,
      },
      tenant.accessToken,
    );
    const res = await callApi<
      ReportView<{ productId: string; quantity: string }>
    >(
      app,
      'GET',
      `/reports/inventory?warehouseId=${otherWarehouse.warehouseId}`,
      undefined,
      tenant.accessToken,
    );
    expect(res.body.rows.length).toBe(1);
    expect(res.body.rows[0].productId).toBe(productAId);
    expect(Number(res.body.rows[0].quantity)).toBe(7);
  });

  // ---------------------------------------------------------------------
  // Exportación: mismas cifras que la pantalla
  // ---------------------------------------------------------------------
  it('exportación CSV de ventas: mismo total que la vista en pantalla', async () => {
    const view = await callApi<ReportView<{ total: string }>>(
      app,
      'GET',
      '/reports/sales',
      undefined,
      tenant.accessToken,
    );
    const server = app.getHttpServer() as Parameters<typeof request>[0];
    const res = await request(server)
      .get('/reports/sales/export?format=csv')
      .set('Authorization', `Bearer ${tenant.accessToken}`);
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('text/csv');
    const csvText = res.text;
    const lines = csvText.trim().split('\r\n');
    // 1 header + 3 filas de venta (todo el filtrado, no solo la página en pantalla)
    expect(lines.length).toBe(4);
    // Suma la columna Total (última antes de Items) del CSV y compárala con
    // el summary de la vista — NUNCA debe divergir.
    const header = lines[0].replace(/^\uFEFF/, '').split(',');
    const totalIdx = header.indexOf('Total');
    const csvTotal = lines
      .slice(1)
      .reduce((acc, line) => acc + Number(line.split(',')[totalIdx]), 0);
    expect(csvTotal).toBe(Number(view.body.summary.total));
  });

  it('exportación XLSX de ventas: archivo válido y no vacío', async () => {
    const server = app.getHttpServer() as Parameters<typeof request>[0];
    const res = await request(server)
      .get('/reports/sales/export?format=xlsx')
      .set('Authorization', `Bearer ${tenant.accessToken}`)
      .buffer(true)
      .parse((response, callback) => {
        const chunks: Buffer[] = [];
        response.on('data', (chunk: Buffer) => chunks.push(chunk));
        response.on('end', () => callback(null, Buffer.concat(chunks)));
      });
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('spreadsheetml');
    const buffer = res.body as Buffer;
    expect(buffer.length).toBeGreaterThan(0);

    const ExcelJS = (await import('exceljs')).default;
    const workbook = new ExcelJS.Workbook();
    // Colisión de tipos entre dos `@types/node` resueltos (raíz vs. el que
    // trae `exceljs`) — el valor en runtime es un Buffer real, el cast es
    // solo para conformar al tipo.

    await workbook.xlsx.load(buffer as any);
    const sheet = workbook.worksheets[0];
    // 1 fila de encabezado + 3 filas de venta.
    expect(sheet.rowCount).toBe(4);
  });

  it('export de un reporte desconocido responde 400', async () => {
    const res = await callApi(
      app,
      'GET',
      '/reports/no-existe/export?format=csv',
      undefined,
      tenant.accessToken,
    );
    expect(res.status).toBe(400);
  });

  // ---------------------------------------------------------------------
  // Dashboard (Fase Comercial 7): mismos datos reales que los reportes,
  // nunca una segunda agregación que pueda divergir.
  // ---------------------------------------------------------------------
  it('dashboard: refleja los mismos totales reales que los reportes individuales', async () => {
    const res = await callApi<{
      salesMonth: { count: number; total: string | number };
      purchasesMonth: { count: number; total: string | number };
      incomeMonth: string | number;
      expensesMonth: string | number;
      pendingReceivables: { count: number; total: string | number };
      pendingPayables: { count: number; total: string | number };
      stockValue: string | number;
      topProducts: Array<{ productId: string }>;
      grossMargin: { available: boolean; reason: string };
    }>(
      app,
      'GET',
      '/organizations/me/dashboard',
      undefined,
      tenant.accessToken,
    );

    expect(res.status).toBe(200);
    expect(res.body.salesMonth.count).toBe(3);
    expect(Number(res.body.salesMonth.total)).toBe(450);
    expect(res.body.purchasesMonth.count).toBe(1);
    expect(Number(res.body.purchasesMonth.total)).toBe(600);
    expect(Number(res.body.incomeMonth)).toBe(290);
    expect(Number(res.body.expensesMonth)).toBe(250);
    expect(res.body.pendingReceivables.count).toBe(1);
    expect(Number(res.body.pendingReceivables.total)).toBe(100);
    expect(res.body.pendingPayables.count).toBe(1);
    expect(Number(res.body.pendingPayables.total)).toBe(600);
    expect(res.body.topProducts.length).toBeGreaterThan(0);
    expect(res.body.topProducts[0].productId).toBe(productAId);
    // Utilidad comercial: NUNCA inventada — explícitamente no disponible.
    expect(res.body.grossMargin.available).toBe(false);
    expect(res.body.grossMargin.reason.length).toBeGreaterThan(0);
  });
});

/**
 * Regresión — auditoría pre-producción (Fase 10+): `inventoryReport` y
 * `movementsReport` truncaban silenciosamente sus resultados a 200 filas
 * (el tope hardcodeado de `InventoryService.listStock`/`listMovements`),
 * incluyendo el `summary` (valorización total) del reporte de inventario
 * y el export (que intentaba pedir hasta `REPORT_EXPORT_MAX_ROWS` filas
 * sin que el override tuviera ningún efecto real). Se llama a
 * `ReportsService`/`InventoryService` directamente (organización propia,
 * sin pasar por HTTP) para poder forzar un tope bajo y probar la
 * corrección sin tener que crear cientos de filas reales.
 */
describe('Reportes de Inventario — regresión: summary NUNCA limitado a las filas visibles', () => {
  let app: INestApplication;
  let reportsService: ReportsService;
  let inventoryService: InventoryService;
  let tenant: TestTenant;
  const products: Array<{ id: string; cost: number; quantity: number }> = [];

  beforeAll(async () => {
    app = await bootTestApp();
    reportsService = app.get(ReportsService);
    inventoryService = app.get(InventoryService);
    tenant = await registerTestOrg(app, 'Reports-Truncation-Regression');

    // 5 productos con costo/cantidad distintos -> 5 filas de Inventory.
    const specs = [
      { cost: 10, quantity: 3 },
      { cost: 20, quantity: 5 },
      { cost: 7, quantity: 11 },
      { cost: 15, quantity: 2 },
      { cost: 30, quantity: 1 },
    ];
    for (const spec of specs) {
      const prod = await callApi<{ id: string }>(
        app,
        'POST',
        '/products',
        {
          name: `Trunc ${uniqueSuffix()}`,
          price: spec.cost * 2,
          cost: spec.cost,
        },
        tenant.accessToken,
      );
      const mv = await callApi(
        app,
        'POST',
        '/inventory/movements',
        {
          warehouseId: tenant.warehouseId,
          productId: prod.body.id,
          type: 'IN',
          quantity: spec.quantity,
          reason: 'Carga inicial (regresión truncamiento)',
          idempotencyKey: `trunc-${prod.body.id}-${uniqueSuffix()}`,
        },
        tenant.accessToken,
      );
      if (mv.status !== 201) {
        throw new Error(`carga inicial falló: ${JSON.stringify(mv.body)}`);
      }
      products.push({
        id: prod.body.id,
        cost: spec.cost,
        quantity: spec.quantity,
      });
    }
  }, 30000);

  afterAll(async () => {
    await app.close();
  }, 15000);

  it('inventoryReport: summary.totalValue/totalQuantity/count reflejan TODAS las filas, aunque `rows` se recorte a maxPageSize', async () => {
    const expectedTotalQuantity = products.reduce((a, p) => a + p.quantity, 0);
    const expectedTotalValue = products.reduce(
      (a, p) => a + p.cost * p.quantity,
      0,
    );

    const capped = await reportsService.inventoryReport(
      tenant.organizationId,
      { warehouseId: tenant.warehouseId },
      { maxPageSize: 2 },
    );

    expect(capped.rows.length).toBe(2); // vista/export SÍ se recortan a maxPageSize
    expect(capped.summary.count).toBe(5); // pero el summary es sobre las 5 filas reales
    expect(Number(capped.summary.totalQuantity)).toBe(expectedTotalQuantity);
    expect(Number(capped.summary.totalValue)).toBe(expectedTotalValue);

    const uncapped = await reportsService.inventoryReport(
      tenant.organizationId,
      { warehouseId: tenant.warehouseId },
      { maxPageSize: 200 },
    );
    expect(uncapped.rows.length).toBe(5);
    expect(Number(uncapped.summary.totalValue)).toBe(expectedTotalValue);
  });

  it('movementsReport / listMovements: `opts.maxPageSize` realmente amplía el tope (antes hardcodeado a 200 sin forma de override)', async () => {
    const narrow = await inventoryService.listMovements(
      tenant.organizationId,
      { warehouseId: tenant.warehouseId, pageSize: 1000 },
      { maxPageSize: 2 },
    );
    expect(narrow.length).toBe(2); // el override SÍ reduce el tope efectivo

    const wide = await inventoryService.listMovements(
      tenant.organizationId,
      { warehouseId: tenant.warehouseId, pageSize: 1000 },
      { maxPageSize: 20000 },
    );
    expect(wide.length).toBe(5); // el override SÍ permite superar el viejo tope de 200

    const viaReport = await reportsService.movementsReport(
      tenant.organizationId,
      { warehouseId: tenant.warehouseId, pageSize: 1000 },
      { maxPageSize: 20000 },
    );
    expect(viaReport.rows.length).toBe(5);
  });
});

/**
 * Regresión — hallazgo ALTO #2 de la auditoría final: los reportes de
 * ventas/compras solo filtraban por estado si el cliente lo pedía
 * explícitamente. Sin filtro, el "Total vendido" sumaba también borradores
 * nunca confirmados, ventas anuladas y devueltas — un número mayor y
 * engañoso frente a lo que realmente ingresó.
 *
 * El criterio por defecto NO es nuevo: es el que el Dashboard ya aplicaba
 * (`REAL_SALE_STATUSES`/`REAL_PURCHASE_STATUSES`), ahora compartido para que
 * Reportes y Dashboard no puedan divergir.
 */
describe('Reportes de ventas/compras — regresión: criterio de estado por defecto', () => {
  let app: INestApplication;
  let tenant: TestTenant;
  let realSaleId: string;
  let draftSaleId: string;
  let refundedSaleId: string;
  let cancelledSaleId: string;
  let realPurchaseId: string;
  let draftPurchaseId: string;

  // Venta real 2x50=100 · devuelta 1x50=50 · borrador 3x50=150 · anulada 1x50=50
  const REAL_SALE_TOTAL = 100;

  beforeAll(async () => {
    app = await bootTestApp();
    tenant = await registerTestOrg(app, 'Reports-Status-Default');

    const prod = await callApi<{ id: string }>(
      app,
      'POST',
      '/products',
      { name: `Estado ${uniqueSuffix()}`, price: 50, cost: 20 },
      tenant.accessToken,
    );
    const productId = prod.body.id;
    await callApi(
      app,
      'POST',
      '/inventory/movements',
      {
        warehouseId: tenant.warehouseId,
        productId,
        type: 'IN',
        quantity: 100,
        reason: 'Carga inicial (estados)',
        idempotencyKey: `estado-init-${productId}-${uniqueSuffix()}`,
      },
      tenant.accessToken,
    );

    const newSale = async (quantity: number) => {
      const res = await callApi<ApiSale>(
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
      return res.body.id;
    };

    // 1) Venta REAL: confirmada y pagada -> PAID. Debe contar siempre.
    realSaleId = await newSale(2);
    await callApi(
      app,
      'POST',
      `/sales/${realSaleId}/confirm`,
      {
        payments: [
          {
            method: 'CASH',
            amount: REAL_SALE_TOTAL,
            idempotencyKey: `real-${uniqueSuffix()}`,
          },
        ],
      },
      tenant.accessToken,
    );

    // 2) Venta DEVUELTA -> REFUNDED. El dinero volvió: no es ingreso neto.
    refundedSaleId = await newSale(1);
    await callApi(
      app,
      'POST',
      `/sales/${refundedSaleId}/confirm`,
      {
        payments: [
          {
            method: 'CASH',
            amount: 50,
            idempotencyKey: `ref-${uniqueSuffix()}`,
          },
        ],
      },
      tenant.accessToken,
    );
    const returned = await callApi(
      app,
      'POST',
      `/sales/${refundedSaleId}/return`,
      { reason: 'Devolución (test de criterio de estado)' },
      tenant.accessToken,
    );
    expect(returned.status).toBe(201);

    // 3) Venta en BORRADOR: nunca se confirmó, ni siquiera descontó stock.
    draftSaleId = await newSale(3);

    // 4) Venta ANULADA en borrador -> CANCELLED.
    cancelledSaleId = await newSale(1);
    const cancelled = await callApi(
      app,
      'POST',
      `/sales/${cancelledSaleId}/cancel`,
      {},
      tenant.accessToken,
    );
    expect(cancelled.status).toBe(201);

    // Compras: una confirmada (real) y una en borrador.
    const supplierId = (
      await createTestSupplier(app, tenant, `Prov Estado ${uniqueSuffix()}`)
    ).supplierId;
    const mkPurchase = async (quantity: number) => {
      const res = await callApi<ApiPurchase>(
        app,
        'POST',
        '/purchases',
        {
          supplierId,
          warehouseId: tenant.warehouseId,
          items: [{ productId, quantity, unitCost: 10 }],
        },
        tenant.accessToken,
      );
      return res.body.id;
    };
    realPurchaseId = await mkPurchase(5); // 50
    await callApi(
      app,
      'POST',
      `/purchases/${realPurchaseId}/confirm`,
      {},
      tenant.accessToken,
    );
    draftPurchaseId = await mkPurchase(7); // 70, queda en DRAFT
  }, 60000);

  afterAll(async () => {
    await app.close();
  }, 15000);

  it('ventas SIN filtro de estado: solo cuenta ventas reales (excluye DRAFT/CANCELLED/REFUNDED)', async () => {
    const res = await callApi<ReportView<ReportSalesRow>>(
      app,
      'GET',
      '/reports/sales',
      undefined,
      tenant.accessToken,
    );
    const ids = res.body.rows.map((r) => r.id);
    expect(ids).toContain(realSaleId);
    expect(ids).not.toContain(draftSaleId);
    expect(ids).not.toContain(cancelledSaleId);
    expect(ids).not.toContain(refundedSaleId);
    // El total NO incluye el borrador (150), la anulada (50) ni la devuelta (50).
    expect(Number(res.body.summary.total)).toBe(REAL_SALE_TOTAL);
    expect(res.body.summary.count).toBe(1);
  });

  it('ventas CON filtro de estado explícito: el filtro del usuario gana y los estados excluidos siguen siendo auditables', async () => {
    for (const [status, expectedId] of [
      ['DRAFT', draftSaleId],
      ['CANCELLED', cancelledSaleId],
      ['REFUNDED', refundedSaleId],
    ] as const) {
      const res = await callApi<ReportView<ReportSalesRow>>(
        app,
        'GET',
        `/reports/sales?status=${status}`,
        undefined,
        tenant.accessToken,
      );
      const ids = res.body.rows.map((r) => r.id);
      expect(ids).toContain(expectedId);
      expect(res.body.rows.every((r) => r.status === status)).toBe(true);
    }
  });

  it('compras SIN filtro: excluye DRAFT; CON filtro explícito la muestra', async () => {
    const def = await callApi<ReportView<{ id: string }>>(
      app,
      'GET',
      '/reports/purchases',
      undefined,
      tenant.accessToken,
    );
    const ids = def.body.rows.map((r) => r.id);
    expect(ids).toContain(realPurchaseId);
    expect(ids).not.toContain(draftPurchaseId);
    expect(Number(def.body.summary.total)).toBe(50); // sin el borrador de 70

    const drafts = await callApi<ReportView<{ id: string }>>(
      app,
      'GET',
      '/reports/purchases?status=DRAFT',
      undefined,
      tenant.accessToken,
    );
    expect(drafts.body.rows.map((r) => r.id)).toContain(draftPurchaseId);
  });

  it('exportación aplica EXACTAMENTE la misma regla que la pantalla', async () => {
    const view = await callApi<ReportView<ReportSalesRow>>(
      app,
      'GET',
      '/reports/sales',
      undefined,
      tenant.accessToken,
    );
    const server = app.getHttpServer() as Parameters<typeof request>[0];
    const res = await request(server)
      .get('/reports/sales/export?format=csv')
      .set('Authorization', `Bearer ${tenant.accessToken}`);
    expect(res.status).toBe(200);
    const lines = res.text.trim().split('\r\n');
    // 1 encabezado + solo las ventas reales: el export no puede traer los
    // borradores/anuladas/devueltas que la pantalla ya excluyó.
    expect(lines.length).toBe(view.body.rows.length + 1);

    const header = lines[0].replace(/^\uFEFF/, '').split(',');
    const totalIdx = header.indexOf('Total');
    const csvTotal = lines
      .slice(1)
      .reduce((acc, line) => acc + Number(line.split(',')[totalIdx]), 0);
    expect(csvTotal).toBe(Number(view.body.summary.total));
    expect(csvTotal).toBe(REAL_SALE_TOTAL);
  });

  it('el Dashboard y el reporte de ventas usan el MISMO criterio (no pueden divergir)', async () => {
    const dashboard = await callApi<{
      salesMonth: { count: number; total: string | number };
    }>(
      app,
      'GET',
      '/organizations/me/dashboard',
      undefined,
      tenant.accessToken,
    );
    const report = await callApi<ReportView<ReportSalesRow>>(
      app,
      'GET',
      '/reports/sales',
      undefined,
      tenant.accessToken,
    );
    expect(Number(dashboard.body.salesMonth.total)).toBe(
      Number(report.body.summary.total),
    );
    expect(dashboard.body.salesMonth.count).toBe(report.body.summary.count);
  });
});

/**
 * Regresión — hallazgo ALTO #3 de la auditoría final:
 * `salesByBranchReport`, `salesByCategoryReport` y `salesByDateReport`
 * hacían `findMany` sin `take`, cargando en memoria de Node TODAS las ventas
 * que matchean el filtro (potencialmente años de historial, ya que el filtro
 * de fecha es opcional). Ahora agregan del lado de Postgres o recorren por
 * lotes acotados (`SALE_SCAN_BATCH_SIZE`).
 *
 * Lo que hay que proteger es que la optimización NO cambió las cifras. Para
 * eso se fuerza el camino multi-lote: se crean más ventas que el tamaño de
 * lote usado en el test y se compara cada reporte contra la suma calculada
 * de forma independiente, además de contra `/reports/sales`.
 */
describe('Reportes agregados — regresión: mismas cifras sin cargar todo en memoria', () => {
  let app: INestApplication;
  let reportsService: ReportsService;
  let tenant: TestTenant;
  let categoryId: string;
  const SALES = 7; // > 1 lote con el batch chico que fuerza el test
  const UNIT_PRICE = 30;
  const QTY_PER_SALE = 2;
  const expectedTotal = SALES * UNIT_PRICE * QTY_PER_SALE;

  beforeAll(async () => {
    app = await bootTestApp();
    reportsService = app.get(ReportsService);
    tenant = await registerTestOrg(app, 'Reports-Aggregate-Regression');

    const cat = await callApi<{ id: string }>(
      app,
      'POST',
      '/product-categories',
      { name: `Cat Agg ${uniqueSuffix()}` },
      tenant.accessToken,
    );
    categoryId = cat.body.id;

    const prod = await callApi<{ id: string }>(
      app,
      'POST',
      '/products',
      {
        name: `Agg ${uniqueSuffix()}`,
        price: UNIT_PRICE,
        cost: 5,
        categoryId,
      },
      tenant.accessToken,
    );
    const productId = prod.body.id;
    await callApi(
      app,
      'POST',
      '/inventory/movements',
      {
        warehouseId: tenant.warehouseId,
        productId,
        type: 'IN',
        quantity: 500,
        reason: 'Carga inicial (agregados)',
        idempotencyKey: `agg-init-${productId}-${uniqueSuffix()}`,
      },
      tenant.accessToken,
    );

    for (let i = 0; i < SALES; i++) {
      const sale = await callApi<ApiSale>(
        app,
        'POST',
        '/sales',
        {
          posTerminalId: tenant.posTerminalId,
          warehouseId: tenant.warehouseId,
          items: [{ productId, quantity: QTY_PER_SALE }],
        },
        tenant.accessToken,
      );
      const confirmed = await callApi(
        app,
        'POST',
        `/sales/${sale.body.id}/confirm`,
        {
          payments: [
            {
              method: 'CASH',
              amount: UNIT_PRICE * QTY_PER_SALE,
              idempotencyKey: `agg-pago-${i}-${uniqueSuffix()}`,
            },
          ],
        },
        tenant.accessToken,
      );
      if (confirmed.status !== 201) {
        throw new Error(
          `confirmar venta ${i} debía dar 201, dio ${confirmed.status}: ${JSON.stringify(confirmed.body)}`,
        );
      }
    }
  }, 60000);

  afterAll(async () => {
    await app.close();
  }, 15000);

  it('sales-by-branch: total y salesCount coinciden con el reporte de ventas', async () => {
    const branch = await callApi<{
      rows: Array<{ branchId: string; total: string; salesCount: number }>;
      summary: { branches: number; total: string; salesCount: number };
    }>(app, 'GET', '/reports/sales-by-branch', undefined, tenant.accessToken);
    const sales = await callApi<ReportView<ReportSalesRow>>(
      app,
      'GET',
      '/reports/sales',
      undefined,
      tenant.accessToken,
    );

    expect(Number(branch.body.summary.total)).toBe(expectedTotal);
    expect(branch.body.summary.salesCount).toBe(SALES);
    // Nunca puede divergir del reporte de ventas: mismo `where`.
    expect(Number(branch.body.summary.total)).toBe(
      Number(sales.body.summary.total),
    );
    expect(branch.body.summary.salesCount).toBe(sales.body.summary.count);
    // La sucursal se deriva del POS: todas las ventas caen en la misma.
    expect(branch.body.rows.length).toBe(1);
    expect(branch.body.rows[0].salesCount).toBe(SALES);
    expect(branch.body.rows[0].branchId).toBe(tenant.branchId);
  });

  it('sales-by-date: agrupa por día sin perder ni duplicar ventas', async () => {
    const res = await callApi<{
      rows: Array<{ date: string; total: string; salesCount: number }>;
      summary: { days: number; total: string; salesCount: number };
    }>(app, 'GET', '/reports/sales-by-date', undefined, tenant.accessToken);

    expect(Number(res.body.summary.total)).toBe(expectedTotal);
    expect(res.body.summary.salesCount).toBe(SALES);
    // La suma de las filas diarias tiene que dar el mismo total del resumen.
    const sumRows = res.body.rows.reduce((a, r) => a + Number(r.total), 0);
    const countRows = res.body.rows.reduce((a, r) => a + r.salesCount, 0);
    expect(sumRows).toBe(expectedTotal);
    expect(countRows).toBe(SALES);
  });

  it('sales-by-category: cantidades y totales exactos', async () => {
    const res = await callApi<{
      rows: Array<{
        categoryId: string | null;
        quantity: string;
        total: string;
        salesCount: number;
      }>;
      summary: { categories: number; quantity: string; total: string };
    }>(app, 'GET', '/reports/sales-by-category', undefined, tenant.accessToken);

    const row = res.body.rows.find((r) => r.categoryId === categoryId)!;
    expect(row).toBeDefined();
    expect(Number(row.quantity)).toBe(SALES * QTY_PER_SALE);
    expect(Number(row.total)).toBe(expectedTotal);
    // `COUNT(DISTINCT saleId)` fusionado entre lotes: cada venta cuenta 1 vez.
    expect(row.salesCount).toBe(SALES);
    expect(Number(res.body.summary.total)).toBe(expectedTotal);
  });

  it('el recorrido por lotes da EXACTAMENTE el mismo resultado que en un solo lote', async () => {
    // Se fuerza el camino multi-lote monkey-patcheando el tamaño de lote a 2
    // (con 7 ventas ⇒ 4 lotes, incluido uno incompleto al final). Si el
    // cursor estuviera mal, acá aparecerían ventas duplicadas o salteadas.
    const service = reportsService as unknown as {
      forEachSaleBatch: (...args: unknown[]) => Promise<void>;
    };
    const original = service.forEachSaleBatch;

    const singleBatch = {
      date: await reportsService.salesByDateReport(tenant.organizationId, {}),
      category: await reportsService.salesByCategoryReport(
        tenant.organizationId,
        {},
      ),
    };

    let batchesSeen = 0;
    // Reemplaza el helper por uno idéntico pero con lotes de 2 filas.
    service.forEachSaleBatch = async function patched(
      this: unknown,
      tx: never,
      where: never,
      select: never,
      onBatch: (batch: Array<{ id: string }>) => void | Promise<void>,
    ) {
      const txAny = tx as unknown as {
        sale: {
          findMany: (args: unknown) => Promise<Array<{ id: string }>>;
        };
      };
      let cursor: string | undefined;
      for (;;) {
        const batch = await txAny.sale.findMany({
          where,
          select: { ...(select as object), id: true },
          orderBy: { id: 'asc' },
          take: 2,
          ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
        });
        if (batch.length === 0) return;
        batchesSeen += 1;
        await onBatch(batch);
        if (batch.length < 2) return;
        cursor = batch[batch.length - 1].id;
      }
    };

    try {
      const multiBatch = {
        date: await reportsService.salesByDateReport(tenant.organizationId, {}),
        category: await reportsService.salesByCategoryReport(
          tenant.organizationId,
          {},
        ),
      };

      // Si esto fuera 0/1, el test sería vacío: probaría un solo lote contra
      // otro solo lote. Con 7 ventas y lotes de 2 hay 4 lotes por reporte.
      expect(batchesSeen).toBeGreaterThan(2);

      expect(multiBatch.date.summary.salesCount).toBe(SALES);
      expect(String(multiBatch.date.summary.total)).toBe(
        String(singleBatch.date.summary.total),
      );
      expect(multiBatch.date.rows.length).toBe(singleBatch.date.rows.length);

      expect(String(multiBatch.category.summary.total)).toBe(
        String(singleBatch.category.summary.total),
      );
      expect(String(multiBatch.category.summary.quantity)).toBe(
        String(singleBatch.category.summary.quantity),
      );
      expect(multiBatch.category.rows[0].salesCount).toBe(
        singleBatch.category.rows[0].salesCount,
      );
    } finally {
      service.forEachSaleBatch = original;
    }
  });
});
