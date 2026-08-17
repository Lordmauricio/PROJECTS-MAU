import { INestApplication } from '@nestjs/common';
import {
  ApiAuditLog,
  ApiInventoryMovement,
  ApiInventoryRow,
  ApiSale,
  bootTestApp,
  callApi,
  createProductWithStock,
  registerTestOrg,
  TestTenant,
} from '../test-support/integration-app';
import { TenantPrismaService } from '../prisma/tenant-prisma.service';

describe('Ventas/POS — ciclo de vida (integración, DB real)', () => {
  let app: INestApplication;
  let tenant: TestTenant;

  beforeAll(async () => {
    app = await bootTestApp();
    tenant = await registerTestOrg(app, 'Sales-Core');
  }, 30000);

  afterAll(async () => {
    await app.close();
  });

  async function makeSale(
    items: Array<{
      productId: string;
      quantity: number;
      unitPrice?: number;
      discount?: number;
    }>,
    discount = 0,
  ) {
    return callApi<ApiSale>(
      app,
      'POST',
      '/sales',
      {
        posTerminalId: tenant.posTerminalId,
        warehouseId: tenant.warehouseId,
        items,
        discount,
      },
      tenant.accessToken,
    );
  }

  async function confirmSale(saleId: string, body: unknown = {}) {
    return callApi<ApiSale>(
      app,
      'POST',
      `/sales/${saleId}/confirm`,
      body,
      tenant.accessToken,
    );
  }

  async function stockFor(productId: string): Promise<ApiInventoryRow> {
    const stock = await callApi<ApiInventoryRow[]>(
      app,
      'GET',
      `/inventory?warehouseId=${tenant.warehouseId}`,
      undefined,
      tenant.accessToken,
    );
    const row = stock.body.find((r) => r.productId === productId);
    if (!row) throw new Error(`sin fila de inventario para ${productId}`);
    return row;
  }

  it('1) crea una venta en DRAFT sin afectar inventario', async () => {
    const { productId } = await createProductWithStock(app, tenant, {
      name: 'Producto A',
      price: 10,
      quantity: 50,
    });
    const res = await makeSale([{ productId, quantity: 2 }]);
    expect(res.status).toBe(201);
    expect(res.body.status).toBe('DRAFT');
    expect(Number((await stockFor(productId)).quantity)).toBe(50); // sin cambios: DRAFT no toca stock
  });

  it('2)+3)+4) calcula subtotal/descuento/total (por ítem y por venta) correctamente', async () => {
    const { productId } = await createProductWithStock(app, tenant, {
      name: 'Producto B',
      price: 10,
      quantity: 50,
    });
    // 3 unidades x 10 = 30, descuento de ítem 5 -> línea 25. Descuento de venta 5 -> total 20.
    const res = await makeSale(
      [{ productId, quantity: 3, unitPrice: 10, discount: 5 }],
      5,
    );
    expect(res.status).toBe(201);
    expect(Number(res.body.subtotal)).toBe(25);
    expect(Number(res.body.discount)).toBe(5);
    expect(Number(res.body.total)).toBe(20);
    expect(Number(res.body.items[0].subtotal)).toBe(25);
  });

  it('confirmar descuenta stock atómicamente y deja la venta CONFIRMED (crédito, sin pago)', async () => {
    const { productId } = await createProductWithStock(app, tenant, {
      name: 'Producto Crédito',
      price: 15,
      quantity: 20,
    });
    const sale = await makeSale([{ productId, quantity: 4 }]); // total = 60
    const confirm = await confirmSale(sale.body.id);
    expect(confirm.status).toBe(201);
    expect(confirm.body.status).toBe('CONFIRMED'); // 8) venta a crédito: confirmada, saldo pendiente completo
    expect(Number(confirm.body.balance)).toBe(60);
    expect(Number((await stockFor(productId)).quantity)).toBe(16); // 20 - 4

    const movements = await callApi<ApiInventoryMovement[]>(
      app,
      'GET',
      `/inventory/movements?productId=${productId}`,
      undefined,
      tenant.accessToken,
    );
    const outMovement = movements.body.find((m) => m.type === 'OUT');
    expect(outMovement).toBeDefined();
    expect(Number(outMovement?.quantity)).toBe(4);
  });

  it('5) pago completo al confirmar deja la venta PAID', async () => {
    const { productId } = await createProductWithStock(app, tenant, {
      name: 'Producto Pago Full',
      price: 20,
      quantity: 10,
    });
    const sale = await makeSale([{ productId, quantity: 2 }]); // total 40
    const confirm = await confirmSale(sale.body.id, {
      payments: [
        {
          method: 'CASH',
          amount: 40,
          idempotencyKey: `pay-full-${sale.body.id}`,
        },
      ],
    });
    expect(confirm.status).toBe(201);
    expect(confirm.body.status).toBe('PAID');
    expect(Number(confirm.body.balance)).toBe(0);
  });

  it('6) pago parcial deja PARTIALLY_PAID, y un segundo pago completa a PAID', async () => {
    const { productId } = await createProductWithStock(app, tenant, {
      name: 'Producto Pago Parcial',
      price: 25,
      quantity: 10,
    });
    const sale = await makeSale([{ productId, quantity: 2 }]); // total 50
    const confirm = await confirmSale(sale.body.id, {
      payments: [
        {
          method: 'CASH',
          amount: 20,
          idempotencyKey: `pay-partial-${sale.body.id}`,
        },
      ],
    });
    expect(confirm.body.status).toBe('PARTIALLY_PAID');
    expect(Number(confirm.body.balance)).toBe(30);

    const secondPayment = await callApi<ApiSale>(
      app,
      'POST',
      `/sales/${sale.body.id}/payments`,
      {
        method: 'TRANSFER',
        amount: 30,
        idempotencyKey: `pay-partial-2-${sale.body.id}`,
      },
      tenant.accessToken,
    );
    expect(secondPayment.status).toBe(201);
    expect(secondPayment.body.status).toBe('PAID');
    expect(Number(secondPayment.body.balance)).toBe(0);
  });

  it('7) pago mixto (CASH + CARD en el mismo confirm) suma ambos métodos', async () => {
    const { productId } = await createProductWithStock(app, tenant, {
      name: 'Producto Mixto',
      price: 50,
      quantity: 10,
    });
    const sale = await makeSale([{ productId, quantity: 2 }]); // total 100
    const confirm = await confirmSale(sale.body.id, {
      payments: [
        {
          method: 'CASH',
          amount: 60,
          idempotencyKey: `mix-cash-${sale.body.id}`,
        },
        {
          method: 'CARD',
          amount: 40,
          idempotencyKey: `mix-card-${sale.body.id}`,
        },
      ],
    });
    expect(confirm.body.status).toBe('PAID');
    expect(confirm.body.payments).toHaveLength(2);
    expect(Number(confirm.body.paidTotal)).toBe(100);
  });

  it('9) rechaza un pago que supera el saldo pendiente', async () => {
    const { productId } = await createProductWithStock(app, tenant, {
      name: 'Producto Rechazo',
      price: 30,
      quantity: 10,
    });
    const sale = await makeSale([{ productId, quantity: 1 }]); // total 30
    await confirmSale(sale.body.id);

    const overpay = await callApi<ApiSale>(
      app,
      'POST',
      `/sales/${sale.body.id}/payments`,
      {
        method: 'CASH',
        amount: 999,
        idempotencyKey: `overpay-${sale.body.id}`,
      },
      tenant.accessToken,
    );
    expect(overpay.status).toBe(400);
  });

  it('10) cancela una venta en DRAFT (sin efecto en inventario); confirmarla después falla', async () => {
    const { productId } = await createProductWithStock(app, tenant, {
      name: 'Producto Cancelar',
      price: 5,
      quantity: 10,
    });
    const sale = await makeSale([{ productId, quantity: 1 }]);
    const cancel = await callApi<ApiSale>(
      app,
      'POST',
      `/sales/${sale.body.id}/cancel`,
      {},
      tenant.accessToken,
    );
    expect(cancel.status).toBe(201);
    expect(cancel.body.status).toBe('CANCELLED');

    const confirmAfterCancel = await confirmSale(sale.body.id);
    expect(confirmAfterCancel.status).toBe(409);
    expect(Number((await stockFor(productId)).quantity)).toBe(10); // intacto
  });

  it('no permite cancelar una venta ya confirmada (debe usarse devolución)', async () => {
    const { productId } = await createProductWithStock(app, tenant, {
      name: 'Producto NoCancelConfirmada',
      price: 5,
      quantity: 10,
    });
    const sale = await makeSale([{ productId, quantity: 1 }]);
    await confirmSale(sale.body.id);
    const cancel = await callApi<ApiSale>(
      app,
      'POST',
      `/sales/${sale.body.id}/cancel`,
      {},
      tenant.accessToken,
    );
    expect(cancel.status).toBe(409);
  });

  it('11) devuelve una venta confirmada: restaura stock, nunca borra la venta original', async () => {
    const { productId } = await createProductWithStock(app, tenant, {
      name: 'Producto Devolucion',
      price: 12,
      quantity: 20,
    });
    const sale = await makeSale([{ productId, quantity: 5 }]);
    await confirmSale(sale.body.id);
    expect(Number((await stockFor(productId)).quantity)).toBe(15);

    const ret = await callApi<ApiSale>(
      app,
      'POST',
      `/sales/${sale.body.id}/return`,
      {},
      tenant.accessToken,
    );
    expect(ret.status).toBe(201);
    expect(ret.body.status).toBe('REFUNDED');
    expect(ret.body.items).toHaveLength(1); // la venta original sigue completa, no se borró nada
    expect(Number((await stockFor(productId)).quantity)).toBe(20); // restaurado

    const movements = await callApi<ApiInventoryMovement[]>(
      app,
      'GET',
      `/inventory/movements?productId=${productId}`,
      undefined,
      tenant.accessToken,
    );
    expect(movements.body.some((m) => m.type === 'RETURN')).toBe(true);
  });

  it('rechaza confirmar una venta sin stock suficiente', async () => {
    const { productId } = await createProductWithStock(app, tenant, {
      name: 'Producto Sin Stock',
      price: 5,
      quantity: 2,
    });
    const sale = await makeSale([{ productId, quantity: 5 }]); // pide más de lo que hay
    const confirm = await confirmSale(sale.body.id);
    expect(confirm.status).toBe(409);
    expect(Number((await stockFor(productId)).quantity)).toBe(2); // sin cambios
  });

  it('18) cada operación relevante genera auditoría', async () => {
    const { productId } = await createProductWithStock(app, tenant, {
      name: 'Producto Auditoria',
      price: 5,
      quantity: 10,
    });
    const sale = await makeSale([{ productId, quantity: 1 }]);
    await confirmSale(sale.body.id);
    await callApi<ApiSale>(
      app,
      'POST',
      `/sales/${sale.body.id}/return`,
      {},
      tenant.accessToken,
    );

    // La auditoría pasa por BullMQ (proceso async) — se espera a que llegue.
    await new Promise((resolve) => setTimeout(resolve, 1500));

    const tenantPrisma = app.get(TenantPrismaService);
    const logs = await tenantPrisma.run(tenant.organizationId, (tx) =>
      tx.auditLog.findMany({
        where: { entityId: sale.body.id },
        orderBy: { createdAt: 'asc' },
      }),
    );
    const actions = (logs as ApiAuditLog[]).map((l) => l.action);
    expect(actions).toEqual(
      expect.arrayContaining(['sales.create', 'sales.confirm', 'sales.return']),
    );
  }, 10000);
});
