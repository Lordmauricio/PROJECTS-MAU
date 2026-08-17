import { INestApplication } from '@nestjs/common';
import {
  ApiSale,
  bootTestApp,
  callApi,
  createProductWithStock,
  createUserWithRole,
  registerTestOrg,
  TestTenant,
  uniqueSuffix,
} from '../test-support/integration-app';
import { PrismaService } from '../prisma/prisma.service';

interface CommercialReceiptBody {
  id: string;
  saleId: string;
  organizationId: string;
  series: string;
  number: number;
}

describe('Recibos comerciales — seguridad (aislamiento de tenant + RLS + RBAC, DB real)', () => {
  let app: INestApplication;
  let tenantA: TestTenant;
  let tenantB: TestTenant;
  let productA: string;

  async function issueReceiptAsA() {
    const prod = productA;
    const createRes = await callApi<ApiSale>(
      app,
      'POST',
      '/sales',
      {
        posTerminalId: tenantA.posTerminalId,
        warehouseId: tenantA.warehouseId,
        items: [{ productId: prod, quantity: 1, unitPrice: 40 }],
      },
      tenantA.accessToken,
    );
    await callApi(
      app,
      'POST',
      `/sales/${createRes.body.id}/confirm`,
      {
        payments: [
          {
            method: 'CASH',
            amount: 40,
            idempotencyKey: `pago-${uniqueSuffix()}`,
          },
        ],
      },
      tenantA.accessToken,
    );
    const issued = await callApi<CommercialReceiptBody>(
      app,
      'POST',
      '/receipts',
      { saleId: createRes.body.id },
      tenantA.accessToken,
    );
    return { saleId: createRes.body.id, receipt: issued.body };
  }

  beforeAll(async () => {
    app = await bootTestApp();
    tenantA = await registerTestOrg(app, 'Receipts-Security-A');
    tenantB = await registerTestOrg(app, 'Receipts-Security-B');
    productA = (
      await createProductWithStock(app, tenantA, {
        name: `Producto Seguridad Recibos ${uniqueSuffix()}`,
        price: 40,
        quantity: 20,
      })
    ).productId;
  }, 30000);

  afterAll(async () => {
    await app.close();
  }, 15000);

  // ---------------------------------------------------------------------
  // Aislamiento de tenant vía API
  // ---------------------------------------------------------------------
  it('el tenant B no puede consultar por ID un recibo del tenant A (404, no 200 con datos ajenos)', async () => {
    const { receipt } = await issueReceiptAsA();
    const res = await callApi(
      app,
      'GET',
      `/receipts/${receipt.id}`,
      undefined,
      tenantB.accessToken,
    );
    expect(res.status).toBe(404);
  });

  it('el tenant B no puede pedir el envío por email de un recibo del tenant A (404)', async () => {
    const { receipt } = await issueReceiptAsA();
    const res = await callApi(
      app,
      'POST',
      `/receipts/${receipt.id}/email`,
      { email: 'ajeno@example.test' },
      tenantB.accessToken,
    );
    expect(res.status).toBe(404);
  });

  it('el tenant B no puede descargar el PDF de un recibo del tenant A (404)', async () => {
    const { receipt } = await issueReceiptAsA();
    const res = await callApi(
      app,
      'GET',
      `/receipts/${receipt.id}/pdf`,
      undefined,
      tenantB.accessToken,
    );
    expect(res.status).toBe(404);
  });

  it('el tenant B consultando por el saleId del tenant A no ve el recibo (null, no el de A)', async () => {
    const { saleId } = await issueReceiptAsA();
    // NestJS serializa un valor de retorno `null` como body vacío — se
    // verifica que responde 200 (no error) sin ningún campo de un recibo.
    const res = await callApi(
      app,
      'GET',
      `/receipts/by-sale/${saleId}`,
      undefined,
      tenantB.accessToken,
    );
    expect(res.status).toBe(200);
    expect(res.body).not.toHaveProperty('id');
  });

  it('la numeración del tenant B es independiente: emite su propio "REC-000001" aunque A ya tenga varios', async () => {
    await issueReceiptAsA();
    await issueReceiptAsA();
    await issueReceiptAsA();

    const prodB = (
      await createProductWithStock(app, tenantB, {
        name: `Producto Seguridad Recibos B ${uniqueSuffix()}`,
        price: 40,
        quantity: 20,
      })
    ).productId;
    const createRes = await callApi<ApiSale>(
      app,
      'POST',
      '/sales',
      {
        posTerminalId: tenantB.posTerminalId,
        warehouseId: tenantB.warehouseId,
        items: [{ productId: prodB, quantity: 1, unitPrice: 40 }],
      },
      tenantB.accessToken,
    );
    await callApi(
      app,
      'POST',
      `/sales/${createRes.body.id}/confirm`,
      {
        payments: [
          {
            method: 'CASH',
            amount: 40,
            idempotencyKey: `pago-b-${uniqueSuffix()}`,
          },
        ],
      },
      tenantB.accessToken,
    );
    const issuedB = await callApi<CommercialReceiptBody>(
      app,
      'POST',
      '/receipts',
      { saleId: createRes.body.id },
      tenantB.accessToken,
    );
    expect(issuedB.status).toBe(201);
    expect(issuedB.body.number).toBe(1); // nunca continúa la secuencia de A
  });

  it('el tenant B no puede emitir un recibo para una venta del tenant A (404, aunque adivine el saleId)', async () => {
    const { saleId } = await issueReceiptAsA();
    // Vuelve a intentar con una venta NUEVA de A (sin recibo todavía) para
    // que el 404 sea inequívocamente "no la encuentro", no "ya tiene recibo".
    const createRes = await callApi<ApiSale>(
      app,
      'POST',
      '/sales',
      {
        posTerminalId: tenantA.posTerminalId,
        warehouseId: tenantA.warehouseId,
        items: [{ productId: productA, quantity: 1, unitPrice: 40 }],
      },
      tenantA.accessToken,
    );
    await callApi(
      app,
      'POST',
      `/sales/${createRes.body.id}/confirm`,
      {
        payments: [
          {
            method: 'CASH',
            amount: 40,
            idempotencyKey: `pago-${uniqueSuffix()}`,
          },
        ],
      },
      tenantA.accessToken,
    );
    const attempt = await callApi(
      app,
      'POST',
      '/receipts',
      { saleId: createRes.body.id },
      tenantB.accessToken,
    );
    expect(attempt.status).toBe(404);
    expect(saleId).toBeDefined();
  });

  // ---------------------------------------------------------------------
  // RLS crudo, sin pasar por Nest DI — mismo patrón que
  // receivables.security.spec.ts
  // ---------------------------------------------------------------------
  it('RLS crudo: con contexto de tenant inexistente, commercial_receipts no devuelve nada (fail-closed)', async () => {
    const prisma = app.get(PrismaService);
    const { receipt } = await issueReceiptAsA();

    const forA = await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.current_tenant', ${tenantA.organizationId}, true)`;
      return tx.commercialReceipt.findMany({ where: { id: receipt.id } });
    });
    expect(forA.length).toBe(1);
    expect(forA[0].organizationId).toBe(tenantA.organizationId);

    const none = await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.current_tenant', ${'org-inexistente-receipts'}, true)`;
      return tx.commercialReceipt.findMany({ where: { id: receipt.id } });
    });
    expect(none).toHaveLength(0);
  });

  it('RLS crudo: sin WHERE, el contexto de A solo trae recibos de A', async () => {
    const prisma = app.get(PrismaService);
    await issueReceiptAsA();

    const rows = await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.current_tenant', ${tenantA.organizationId}, true)`;
      return tx.commercialReceipt.findMany();
    });
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((r) => r.organizationId === tenantA.organizationId)).toBe(
      true,
    );
  });

  it('RLS crudo: receipt_sequences también queda aislado por tenant', async () => {
    const prisma = app.get(PrismaService);
    await issueReceiptAsA();

    const rows = await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.current_tenant', ${tenantA.organizationId}, true)`;
      return tx.receiptSequence.findMany();
    });
    expect(rows.length).toBe(1);
    expect(rows[0].organizationId).toBe(tenantA.organizationId);
  });

  // ---------------------------------------------------------------------
  // RBAC fail-closed
  // ---------------------------------------------------------------------
  it('un usuario sin receipts.manage/receipts.read (rol INVENTORY) recibe 403 en emitir/consultar/descargar', async () => {
    const inventoryToken = await createUserWithRole(
      app,
      tenantA.organizationId,
      'INVENTORY',
    );
    const { receipt, saleId } = await issueReceiptAsA();

    const issueAttempt = await callApi(
      app,
      'POST',
      '/receipts',
      { saleId },
      inventoryToken,
    );
    expect(issueAttempt.status).toBe(403);

    const readAttempt = await callApi(
      app,
      'GET',
      `/receipts/${receipt.id}`,
      undefined,
      inventoryToken,
    );
    expect(readAttempt.status).toBe(403);

    const pdfAttempt = await callApi(
      app,
      'GET',
      `/receipts/${receipt.id}/pdf`,
      undefined,
      inventoryToken,
    );
    expect(pdfAttempt.status).toBe(403);

    const emailAttempt = await callApi(
      app,
      'POST',
      `/receipts/${receipt.id}/email`,
      {},
      inventoryToken,
    );
    expect(emailAttempt.status).toBe(403);

    const bySaleAttempt = await callApi(
      app,
      'GET',
      `/receipts/by-sale/${saleId}`,
      undefined,
      inventoryToken,
    );
    expect(bySaleAttempt.status).toBe(403);
  });

  it('un usuario con receipts.manage/receipts.read (rol CASHIER) sí puede emitir, ver y descargar', async () => {
    const cashierToken = await createUserWithRole(
      app,
      tenantA.organizationId,
      'CASHIER',
    );
    const createRes = await callApi<ApiSale>(
      app,
      'POST',
      '/sales',
      {
        posTerminalId: tenantA.posTerminalId,
        warehouseId: tenantA.warehouseId,
        items: [{ productId: productA, quantity: 1, unitPrice: 40 }],
      },
      cashierToken,
    );
    await callApi(
      app,
      'POST',
      `/sales/${createRes.body.id}/confirm`,
      {
        payments: [
          {
            method: 'CASH',
            amount: 40,
            idempotencyKey: `pago-cashier-${uniqueSuffix()}`,
          },
        ],
      },
      cashierToken,
    );
    const issued = await callApi<CommercialReceiptBody>(
      app,
      'POST',
      '/receipts',
      { saleId: createRes.body.id },
      cashierToken,
    );
    expect(issued.status).toBe(201);

    const read = await callApi(
      app,
      'GET',
      `/receipts/${issued.body.id}`,
      undefined,
      cashierToken,
    );
    expect(read.status).toBe(200);

    const pdf = await callApi(
      app,
      'GET',
      `/receipts/${issued.body.id}/pdf`,
      undefined,
      cashierToken,
    );
    expect(pdf.status).toBe(200);

    const email = await callApi(
      app,
      'POST',
      `/receipts/${issued.body.id}/email`,
      { email: 'cliente-cashier@example.test' },
      cashierToken,
    );
    expect(email.status).toBe(201);
  });

  it('sin token, todos los endpoints de recibos responden 401', async () => {
    const { receipt, saleId } = await issueReceiptAsA();
    expect((await callApi(app, 'GET', `/receipts/${receipt.id}`)).status).toBe(
      401,
    );
    expect(
      (await callApi(app, 'GET', `/receipts/by-sale/${saleId}`)).status,
    ).toBe(401);
    expect(
      (await callApi(app, 'GET', `/receipts/${receipt.id}/pdf`)).status,
    ).toBe(401);
    expect((await callApi(app, 'POST', '/receipts', { saleId })).status).toBe(
      401,
    );
    expect(
      (await callApi(app, 'POST', `/receipts/${receipt.id}/email`, {})).status,
    ).toBe(401);
  });
});
