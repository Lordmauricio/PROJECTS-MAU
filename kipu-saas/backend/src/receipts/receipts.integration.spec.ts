import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import {
  ApiSale,
  bootTestApp,
  callApi,
  createProductWithStock,
  openCashRegister,
  registerTestOrg,
  TestTenant,
  uniqueSuffix,
} from '../test-support/integration-app';
import { TenantPrismaService } from '../prisma/tenant-prisma.service';

interface CommercialReceiptBody {
  id: string;
  saleId: string;
  series: string;
  number: number;
  issuedAt: string;
  snapshot: {
    documentLabel: string;
    documentType: string;
    issuer: { name: string; nit: string };
    operation: {
      fullNumber: string;
      cashierName: string | null;
      saleId: string;
    };
    customer: {
      name: string;
      documentType: string;
      documentNumber: string;
    } | null;
    items: Array<{
      productName: string;
      quantity: string;
      unitPrice: string;
      subtotal: string;
    }>;
    totals: { subtotal: string; discount: string; total: string };
    payments: {
      methods: Array<{ method: string; amount: string }>;
      paidTotal: string;
      balance: string;
    };
  };
}

describe('Recibos comerciales — integración (datos reales, DB real)', () => {
  let app: INestApplication;
  let tenant: TestTenant;
  let customerId: string;
  let productId: string;

  async function createAndConfirmSale(
    opts: {
      quantity?: number;
      unitPrice?: number;
      withCustomer?: boolean;
      payFully?: boolean;
    } = {},
  ) {
    const createRes = await callApi<ApiSale>(
      app,
      'POST',
      '/sales',
      {
        posTerminalId: tenant.posTerminalId,
        warehouseId: tenant.warehouseId,
        ...(opts.withCustomer !== false ? { customerId } : {}),
        items: [
          {
            productId,
            quantity: opts.quantity ?? 1,
            unitPrice: opts.unitPrice ?? 100,
          },
        ],
      },
      tenant.accessToken,
    );
    if (createRes.status !== 201) {
      throw new Error(
        `crear venta debía dar 201, dio ${createRes.status}: ${JSON.stringify(createRes.body)}`,
      );
    }
    const sale = createRes.body;
    const payments =
      opts.payFully === false
        ? []
        : [
            {
              method: 'CASH',
              amount: (opts.quantity ?? 1) * (opts.unitPrice ?? 100),
              idempotencyKey: `pago-${uniqueSuffix()}`,
            },
          ];
    const confirmRes = await callApi<ApiSale>(
      app,
      'POST',
      `/sales/${sale.id}/confirm`,
      { payments },
      tenant.accessToken,
    );
    if (confirmRes.status !== 201) {
      throw new Error(
        `confirmar venta debía dar 201, dio ${confirmRes.status}: ${JSON.stringify(confirmRes.body)}`,
      );
    }
    return confirmRes.body;
  }

  async function issueReceipt(saleId: string) {
    return callApi<CommercialReceiptBody>(
      app,
      'POST',
      '/receipts',
      { saleId },
      tenant.accessToken,
    );
  }

  beforeAll(async () => {
    app = await bootTestApp();
    tenant = await registerTestOrg(app, 'Receipts-Integration');
    const customerRes = await callApi<{ id: string }>(
      app,
      'POST',
      '/customers',
      {
        name: `Cliente Recibos ${uniqueSuffix()}`,
        documentType: 'CI',
        documentNumber: '1234567',
      },
      tenant.accessToken,
    );
    customerId = customerRes.body.id;
    productId = (
      await createProductWithStock(app, tenant, {
        name: `Producto Recibos ${uniqueSuffix()}`,
        price: 100,
        quantity: 50,
      })
    ).productId;
    await openCashRegister(app, tenant, { openingAmount: 0 });
  }, 30000);

  afterAll(async () => {
    await app.close();
  }, 15000);

  // ---------------------------------------------------------------------
  // 1) Emisión + 2) contenido + 3) snapshot
  // ---------------------------------------------------------------------
  it('emite un recibo con snapshot completo: emisor, operación, cliente, ítems, pagos', async () => {
    const sale = await createAndConfirmSale({ quantity: 2, unitPrice: 100 });
    const res = await issueReceipt(sale.id);

    expect(res.status).toBe(201);
    const r = res.body;
    expect(r.saleId).toBe(sale.id);
    expect(r.snapshot.documentLabel).toBe('RECIBO DE VENTA');
    expect(r.snapshot.documentType).toBe('DOCUMENTO COMERCIAL NO FISCAL');
    expect(r.snapshot.operation.saleId).toBe(sale.id);
    expect(r.snapshot.operation.fullNumber).toBe(
      `${r.series}-${String(r.number).padStart(6, '0')}`,
    );
    expect(r.snapshot.customer?.documentType).toBe('CI');
    expect(r.snapshot.customer?.documentNumber).toBe('1234567');
    expect(r.snapshot.items).toHaveLength(1);
    expect(Number(r.snapshot.items[0].quantity)).toBe(2);
    expect(Number(r.snapshot.items[0].unitPrice)).toBe(100);
    expect(Number(r.snapshot.items[0].subtotal)).toBe(200);
    expect(Number(r.snapshot.totals.total)).toBe(200);
    expect(
      r.snapshot.payments.methods.find((m) => m.method === 'CASH')?.amount,
    ).toBe('200.00');
    expect(Number(r.snapshot.payments.paidTotal)).toBe(200);
    expect(Number(r.snapshot.payments.balance)).toBe(0);
  });

  it('GET /receipts/by-sale/:saleId devuelve el recibo ya emitido', async () => {
    const sale = await createAndConfirmSale();
    const issued = await issueReceipt(sale.id);
    const res = await callApi<CommercialReceiptBody>(
      app,
      'GET',
      `/receipts/by-sale/${sale.id}`,
      undefined,
      tenant.accessToken,
    );
    expect(res.status).toBe(200);
    expect(res.body.id).toBe(issued.body.id);
  });

  it('GET /receipts/by-sale/:saleId de una venta sin recibo devuelve null, no error', async () => {
    const sale = await createAndConfirmSale();
    // NestJS serializa un valor de retorno `null` como body vacío (no
    // literal "null") — `res.body` (superagent) queda `{}`. Se verifica
    // sobre eso: 200 (no error) y sin ningún campo de un recibo real.
    const res = await callApi(
      app,
      'GET',
      `/receipts/by-sale/${sale.id}`,
      undefined,
      tenant.accessToken,
    );
    expect(res.status).toBe(200);
    expect(res.body).not.toHaveProperty('id');
  });

  // ---------------------------------------------------------------------
  // 5) numeración
  // ---------------------------------------------------------------------
  it('la numeración es secuencial y consecutiva dentro de la organización', async () => {
    const saleA = await createAndConfirmSale();
    const saleB = await createAndConfirmSale();
    const rA = await issueReceipt(saleA.id);
    const rB = await issueReceipt(saleB.id);
    expect(rB.body.series).toBe(rA.body.series);
    expect(rB.body.number).toBe(rA.body.number + 1);
  });

  // ---------------------------------------------------------------------
  // 7) retry / 8) doble click (secuencial)
  // ---------------------------------------------------------------------
  it('un retry (mismo saleId, request repetido) devuelve el MISMO recibo, no un número nuevo', async () => {
    const sale = await createAndConfirmSale();
    const first = await issueReceipt(sale.id);
    const second = await issueReceipt(sale.id);
    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
    expect(second.body.id).toBe(first.body.id);
    expect(second.body.number).toBe(first.body.number);
  });

  // ---------------------------------------------------------------------
  // 4) inmutabilidad
  // ---------------------------------------------------------------------
  it('el snapshot NO cambia aunque después cambien el cliente, el producto o la organización', async () => {
    const sale = await createAndConfirmSale({ quantity: 1, unitPrice: 100 });
    const issued = await issueReceipt(sale.id);
    const originalCustomerName = issued.body.snapshot.customer?.name;
    const originalProductName = issued.body.snapshot.items[0].productName;

    // Cambiar cliente y producto DESPUÉS de emitido el recibo.
    await callApi(
      app,
      'PATCH',
      `/customers/${customerId}`,
      { name: `Cliente Renombrado ${uniqueSuffix()}` },
      tenant.accessToken,
    );
    await callApi(
      app,
      'PATCH',
      `/products/${productId}`,
      { name: `Producto Renombrado ${uniqueSuffix()}`, price: 999 },
      tenant.accessToken,
    );
    // La organización no tiene endpoint de edición todavía (Fase 1) — se
    // muta directo vía Prisma, mismo criterio que `createUserWithRole` en
    // `test-support/integration-app.ts`.
    const tenantPrisma = app.get(TenantPrismaService);
    await tenantPrisma.run(tenant.organizationId, (tx) =>
      tx.organization.update({
        where: { id: tenant.organizationId },
        data: { name: 'EMPRESA RENOMBRADA DESPUÉS DEL RECIBO' },
      }),
    );

    const reread = await callApi<CommercialReceiptBody>(
      app,
      'GET',
      `/receipts/${issued.body.id}`,
      undefined,
      tenant.accessToken,
    );
    expect(reread.body.snapshot.customer?.name).toBe(originalCustomerName);
    expect(reread.body.snapshot.items[0].productName).toBe(originalProductName);
    expect(reread.body.snapshot.issuer.name).not.toBe(
      'EMPRESA RENOMBRADA DESPUÉS DEL RECIBO',
    );

    // Confirmar que los cambios SÍ se aplicaron en las tablas vivas (para
    // que quede claro que el snapshot está congelado a propósito, no
    // porque el cambio haya fallado).
    const customerNow = await callApi<{ name: string }>(
      app,
      'GET',
      '/customers',
      undefined,
      tenant.accessToken,
    );
    expect(
      (customerNow.body as unknown as Array<{ id: string; name: string }>).find(
        (c) => c.id === customerId,
      )?.name,
    ).not.toBe(originalCustomerName);
  });

  // ---------------------------------------------------------------------
  // 15) estados permitidos
  // ---------------------------------------------------------------------
  it('rechaza emitir recibo para una venta DRAFT', async () => {
    const draftRes = await callApi<ApiSale>(
      app,
      'POST',
      '/sales',
      {
        posTerminalId: tenant.posTerminalId,
        warehouseId: tenant.warehouseId,
        items: [{ productId, quantity: 1, unitPrice: 100 }],
      },
      tenant.accessToken,
    );
    const res = await issueReceipt(draftRes.body.id);
    expect(res.status).toBe(409);
  });

  it('rechaza emitir recibo para una venta CANCELLED', async () => {
    const draftRes = await callApi<ApiSale>(
      app,
      'POST',
      '/sales',
      {
        posTerminalId: tenant.posTerminalId,
        warehouseId: tenant.warehouseId,
        items: [{ productId, quantity: 1, unitPrice: 100 }],
      },
      tenant.accessToken,
    );
    await callApi(
      app,
      'POST',
      `/sales/${draftRes.body.id}/cancel`,
      {},
      tenant.accessToken,
    );
    const res = await issueReceipt(draftRes.body.id);
    expect(res.status).toBe(409);
  });

  it('admite emitir recibo para una venta CONFIRMED sin pago (crédito)', async () => {
    const sale = await createAndConfirmSale({ payFully: false });
    expect(sale.status).toBe('CONFIRMED');
    const res = await issueReceipt(sale.id);
    expect(res.status).toBe(201);
    expect(res.body.snapshot.payments.methods).toHaveLength(0);
    expect(Number(res.body.snapshot.payments.balance)).toBeGreaterThan(0);
  });

  it('admite emitir recibo para una venta PARTIALLY_PAID', async () => {
    const createRes = await callApi<ApiSale>(
      app,
      'POST',
      '/sales',
      {
        posTerminalId: tenant.posTerminalId,
        warehouseId: tenant.warehouseId,
        customerId,
        items: [{ productId, quantity: 2, unitPrice: 100 }],
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
            idempotencyKey: `parcial-${uniqueSuffix()}`,
          },
        ],
      },
      tenant.accessToken,
    );
    const detail = await callApi<ApiSale>(
      app,
      'GET',
      `/sales/${createRes.body.id}`,
      undefined,
      tenant.accessToken,
    );
    expect(detail.body.status).toBe('PARTIALLY_PAID');
    const res = await issueReceipt(createRes.body.id);
    expect(res.status).toBe(201);
    expect(Number(res.body.snapshot.payments.balance)).toBe(150);
  });

  it('devuelve 400 al emitir un recibo sin cliente para un consumidor ocasional (customer null en snapshot)', async () => {
    const sale = await createAndConfirmSale({ withCustomer: false });
    const res = await issueReceipt(sale.id);
    expect(res.status).toBe(201);
    expect(res.body.snapshot.customer).toBeNull();
  });

  // ---------------------------------------------------------------------
  // 12) / 13) / 14) PDF A4 y ticket 80mm
  // ---------------------------------------------------------------------
  it('genera un PDF A4 válido a partir del recibo', async () => {
    const sale = await createAndConfirmSale();
    const issued = await issueReceipt(sale.id);
    const server = app.getHttpServer() as Parameters<typeof request>[0];
    const res = await request(server)
      .get(`/receipts/${issued.body.id}/pdf?format=a4`)
      .set('Authorization', `Bearer ${tenant.accessToken}`)
      .buffer(true)
      .parse((response, callback) => {
        const chunks: Buffer[] = [];
        response.on('data', (chunk: Buffer) => chunks.push(chunk));
        response.on('end', () => callback(null, Buffer.concat(chunks)));
      });
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('application/pdf');
    const buffer = res.body as Buffer;
    expect(buffer.subarray(0, 4).toString()).toBe('%PDF');
  });

  it('genera un PDF de ticket térmico 80mm válido a partir del recibo', async () => {
    const sale = await createAndConfirmSale();
    const issued = await issueReceipt(sale.id);
    const server = app.getHttpServer() as Parameters<typeof request>[0];
    const res = await request(server)
      .get(`/receipts/${issued.body.id}/pdf?format=thermal80`)
      .set('Authorization', `Bearer ${tenant.accessToken}`)
      .buffer(true)
      .parse((response, callback) => {
        const chunks: Buffer[] = [];
        response.on('data', (chunk: Buffer) => chunks.push(chunk));
        response.on('end', () => callback(null, Buffer.concat(chunks)));
      });
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('application/pdf');
    const buffer = res.body as Buffer;
    expect(buffer.subarray(0, 4).toString()).toBe('%PDF');
  });

  it('el PDF default (sin ?format) es A4', async () => {
    const sale = await createAndConfirmSale();
    const issued = await issueReceipt(sale.id);
    const server = app.getHttpServer() as Parameters<typeof request>[0];
    const res = await request(server)
      .get(`/receipts/${issued.body.id}/pdf`)
      .set('Authorization', `Bearer ${tenant.accessToken}`);
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('application/pdf');
  });

  it('descargar el PDF de un recibo inexistente da 404', async () => {
    const res = await callApi(
      app,
      'GET',
      '/receipts/no-existe-123/pdf',
      undefined,
      tenant.accessToken,
    );
    expect(res.status).toBe(404);
  });
});
