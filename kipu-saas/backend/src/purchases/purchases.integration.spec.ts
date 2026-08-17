import { INestApplication } from '@nestjs/common';
import {
  ApiAuditLog,
  ApiInventoryRow,
  ApiPayable,
  ApiPurchase,
  bootTestApp,
  callApi,
  createTestProduct,
  createTestSupplier,
  registerTestOrg,
  TestTenant,
} from '../test-support/integration-app';
import { TenantPrismaService } from '../prisma/tenant-prisma.service';

describe('Compras — ciclo de vida (integración, DB real)', () => {
  let app: INestApplication;
  let tenant: TestTenant;
  let supplierId: string;

  beforeAll(async () => {
    app = await bootTestApp();
    tenant = await registerTestOrg(app, 'Purchases-Core');
    supplierId = (await createTestSupplier(app, tenant, 'Proveedor Core'))
      .supplierId;
  }, 30000);

  afterAll(async () => {
    await app.close();
  }, 15000);

  async function makePurchase(
    items: Array<{
      productId: string;
      quantity: number;
      unitCost?: number;
      discount?: number;
    }>,
    discount = 0,
  ) {
    return callApi<ApiPurchase>(
      app,
      'POST',
      '/purchases',
      { supplierId, warehouseId: tenant.warehouseId, items, discount },
      tenant.accessToken,
    );
  }

  async function confirmPurchase(purchaseId: string) {
    return callApi<ApiPurchase>(
      app,
      'POST',
      `/purchases/${purchaseId}/confirm`,
      {},
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

  it('1) crea una orden de compra en DRAFT con subtotal/descuento/total correctos', async () => {
    const { productId } = await createTestProduct(app, tenant, {
      name: 'Producto A',
    });
    // 10 x 5 = 50, descuento de ítem 5 -> línea 45. Descuento de orden 5 -> total 40.
    const res = await makePurchase(
      [{ productId, quantity: 10, unitCost: 5, discount: 5 }],
      5,
    );
    expect(res.status).toBe(201);
    expect(res.body.status).toBe('DRAFT');
    expect(Number(res.body.subtotal)).toBe(45);
    expect(Number(res.body.discount)).toBe(5);
    expect(Number(res.body.total)).toBe(40);
  });

  it('2) edita una orden mientras está en DRAFT', async () => {
    const { productId } = await createTestProduct(app, tenant, {
      name: 'Producto Editable',
    });
    const purchase = await makePurchase([
      { productId, quantity: 5, unitCost: 10 },
    ]);
    expect(Number(purchase.body.total)).toBe(50);

    const updated = await callApi<ApiPurchase>(
      app,
      'PATCH',
      `/purchases/${purchase.body.id}`,
      {
        supplierId,
        warehouseId: tenant.warehouseId,
        items: [{ productId, quantity: 8, unitCost: 10 }],
      },
      tenant.accessToken,
    );
    expect(updated.status).toBe(200);
    expect(Number(updated.body.total)).toBe(80);
  });

  it('no permite editar una orden ya confirmada', async () => {
    const { productId } = await createTestProduct(app, tenant, {
      name: 'Producto No Editable',
    });
    const purchase = await makePurchase([
      { productId, quantity: 5, unitCost: 10 },
    ]);
    await confirmPurchase(purchase.body.id);

    const attempt = await callApi<ApiPurchase>(
      app,
      'PATCH',
      `/purchases/${purchase.body.id}`,
      {
        supplierId,
        warehouseId: tenant.warehouseId,
        items: [{ productId, quantity: 1, unitCost: 10 }],
      },
      tenant.accessToken,
    );
    expect(attempt.status).toBe(409);
  });

  it('3) confirma una orden (sin efecto en inventario todavía)', async () => {
    const { productId } = await createTestProduct(app, tenant, {
      name: 'Producto Confirmar',
    });
    const purchase = await makePurchase([
      { productId, quantity: 5, unitCost: 10 },
    ]);
    const confirm = await confirmPurchase(purchase.body.id);
    expect(confirm.status).toBe(201);
    expect(confirm.body.status).toBe('CONFIRMED');
  });

  it('4)+7) recepción completa: descuenta... suma stock, genera Payable por el total', async () => {
    const { productId } = await createTestProduct(app, tenant, {
      name: 'Producto Recepción Full',
    });
    const purchase = await makePurchase([
      { productId, quantity: 10, unitCost: 5 },
    ]); // total 50
    await confirmPurchase(purchase.body.id);
    const itemId = purchase.body.items[0].id;

    const receive = await callApi<ApiPurchase>(
      app,
      'POST',
      `/purchases/${purchase.body.id}/receive`,
      {
        items: [{ purchaseItemId: itemId, quantity: 10 }],
        idempotencyKey: `recv-full-${purchase.body.id}`,
      },
      tenant.accessToken,
    );
    expect(receive.status).toBe(201);
    expect(receive.body.status).toBe('RECEIVED');
    expect(Number(receive.body.items[0].receivedQuantity)).toBe(10);
    expect(Number((await stockFor(productId)).quantity)).toBe(10);

    expect(receive.body.payables).toHaveLength(1);
    expect(Number(receive.body.payables[0].amount)).toBe(50);
    expect(receive.body.payables[0].status).toBe('PENDING');
    // La Payable embebida en el detalle de la compra debe traer el saldo YA
    // calculado (no solo el monto original) — si no, el frontend no puede
    // saber cuánto falta pagar.
    expect(Number(receive.body.payables[0].paidTotal)).toBe(0);
    expect(Number(receive.body.payables[0].balance)).toBe(50);
  });

  it('5)+6) recepción parcial dos veces: PARTIALLY_RECEIVED y luego RECEIVED, Payable crece con cada una', async () => {
    const { productId } = await createTestProduct(app, tenant, {
      name: 'Producto Recepción Parcial',
    });
    const purchase = await makePurchase([
      { productId, quantity: 10, unitCost: 5 },
    ]); // total 50
    await confirmPurchase(purchase.body.id);
    const itemId = purchase.body.items[0].id;

    const first = await callApi<ApiPurchase>(
      app,
      'POST',
      `/purchases/${purchase.body.id}/receive`,
      {
        items: [{ purchaseItemId: itemId, quantity: 4 }],
        idempotencyKey: `recv-partial-1-${purchase.body.id}`,
      },
      tenant.accessToken,
    );
    expect(first.status).toBe(201);
    expect(first.body.status).toBe('PARTIALLY_RECEIVED');
    expect(Number(first.body.payables[0].amount)).toBe(20); // 4 x 5
    expect(Number((await stockFor(productId)).quantity)).toBe(4);

    const second = await callApi<ApiPurchase>(
      app,
      'POST',
      `/purchases/${purchase.body.id}/receive`,
      {
        items: [{ purchaseItemId: itemId, quantity: 6 }],
        idempotencyKey: `recv-partial-2-${purchase.body.id}`,
      },
      tenant.accessToken,
    );
    expect(second.status).toBe(201);
    expect(second.body.status).toBe('RECEIVED');
    expect(Number(second.body.payables[0].amount)).toBe(50);
    expect(Number((await stockFor(productId)).quantity)).toBe(10);
  });

  it('rechaza recibir más de lo pedido', async () => {
    const { productId } = await createTestProduct(app, tenant, {
      name: 'Producto Sobre Recepción',
    });
    const purchase = await makePurchase([
      { productId, quantity: 5, unitCost: 10 },
    ]);
    await confirmPurchase(purchase.body.id);
    const itemId = purchase.body.items[0].id;

    const attempt = await callApi<ApiPurchase>(
      app,
      'POST',
      `/purchases/${purchase.body.id}/receive`,
      {
        items: [{ purchaseItemId: itemId, quantity: 999 }],
        idempotencyKey: `recv-over-${purchase.body.id}`,
      },
      tenant.accessToken,
    );
    expect(attempt.status).toBe(400);
  });

  it('8)+9)+10) pago parcial, pago completo, y rechazo de sobrepago sobre la Payable', async () => {
    const { productId } = await createTestProduct(app, tenant, {
      name: 'Producto Pago Payable',
    });
    const purchase = await makePurchase([
      { productId, quantity: 10, unitCost: 5 },
    ]); // total 50
    await confirmPurchase(purchase.body.id);
    const itemId = purchase.body.items[0].id;
    const received = await callApi<ApiPurchase>(
      app,
      'POST',
      `/purchases/${purchase.body.id}/receive`,
      {
        items: [{ purchaseItemId: itemId, quantity: 10 }],
        idempotencyKey: `recv-pay-${purchase.body.id}`,
      },
      tenant.accessToken,
    );
    const payableId = received.body.payables[0].id;

    const partial = await callApi<ApiPayable>(
      app,
      'POST',
      `/payables/${payableId}/payments`,
      {
        method: 'CASH',
        amount: 20,
        idempotencyKey: `pay-payable-partial-${payableId}`,
      },
      tenant.accessToken,
    );
    expect(partial.status).toBe(201);
    expect(partial.body.status).toBe('PENDING');
    expect(Number(partial.body.balance)).toBe(30);

    const overpay = await callApi<ApiPayable>(
      app,
      'POST',
      `/payables/${payableId}/payments`,
      {
        method: 'CASH',
        amount: 999,
        idempotencyKey: `pay-payable-overpay-${payableId}`,
      },
      tenant.accessToken,
    );
    expect(overpay.status).toBe(400);

    const complete = await callApi<ApiPayable>(
      app,
      'POST',
      `/payables/${payableId}/payments`,
      {
        method: 'TRANSFER',
        amount: 30,
        idempotencyKey: `pay-payable-complete-${payableId}`,
      },
      tenant.accessToken,
    );
    expect(complete.status).toBe(201);
    expect(complete.body.status).toBe('PAID');
    expect(Number(complete.body.balance)).toBe(0);
  });

  it('11)+12) devolución al proveedor: reduce stock y Payable, rechaza devolver más de lo recibido', async () => {
    const { productId } = await createTestProduct(app, tenant, {
      name: 'Producto Devolución',
    });
    const purchase = await makePurchase([
      { productId, quantity: 10, unitCost: 5 },
    ]); // total 50
    await confirmPurchase(purchase.body.id);
    const itemId = purchase.body.items[0].id;
    await callApi<ApiPurchase>(
      app,
      'POST',
      `/purchases/${purchase.body.id}/receive`,
      {
        items: [{ purchaseItemId: itemId, quantity: 10 }],
        idempotencyKey: `recv-ret-${purchase.body.id}`,
      },
      tenant.accessToken,
    );
    expect(Number((await stockFor(productId)).quantity)).toBe(10);

    const overReturn = await callApi<ApiPurchase>(
      app,
      'POST',
      `/purchases/${purchase.body.id}/return`,
      {
        items: [{ purchaseItemId: itemId, quantity: 999 }],
        idempotencyKey: `ret-over-${purchase.body.id}`,
      },
      tenant.accessToken,
    );
    expect(overReturn.status).toBe(400);

    const ret = await callApi<ApiPurchase>(
      app,
      'POST',
      `/purchases/${purchase.body.id}/return`,
      {
        items: [{ purchaseItemId: itemId, quantity: 3 }],
        idempotencyKey: `ret-ok-${purchase.body.id}`,
      },
      tenant.accessToken,
    );
    expect(ret.status).toBe(201);
    expect(Number(ret.body.items[0].returnedQuantity)).toBe(3);
    expect(Number((await stockFor(productId)).quantity)).toBe(7); // 10 - 3
    expect(Number(ret.body.payables[0].amount)).toBe(35); // 50 - 3*5
  });

  it('rechaza una devolución que dejaría la Payable por debajo de lo ya pagado (dependencia de Caja documentada)', async () => {
    const { productId } = await createTestProduct(app, tenant, {
      name: 'Producto Devolución Post-Pago',
    });
    const purchase = await makePurchase([
      { productId, quantity: 10, unitCost: 5 },
    ]); // total 50
    await confirmPurchase(purchase.body.id);
    const itemId = purchase.body.items[0].id;
    const received = await callApi<ApiPurchase>(
      app,
      'POST',
      `/purchases/${purchase.body.id}/receive`,
      {
        items: [{ purchaseItemId: itemId, quantity: 10 }],
        idempotencyKey: `recv-prepay-${purchase.body.id}`,
      },
      tenant.accessToken,
    );
    const payableId = received.body.payables[0].id;
    await callApi<ApiPayable>(
      app,
      'POST',
      `/payables/${payableId}/payments`,
      {
        method: 'CASH',
        amount: 50,
        idempotencyKey: `pay-full-before-return-${payableId}`,
      },
      tenant.accessToken,
    );

    const ret = await callApi<ApiPurchase>(
      app,
      'POST',
      `/purchases/${purchase.body.id}/return`,
      {
        items: [{ purchaseItemId: itemId, quantity: 3 }],
        idempotencyKey: `ret-blocked-${purchase.body.id}`,
      },
      tenant.accessToken,
    );
    expect(ret.status).toBe(409);
  });

  it('cancela una orden en DRAFT; confirmarla después falla', async () => {
    const { productId } = await createTestProduct(app, tenant, {
      name: 'Producto Cancelar',
    });
    const purchase = await makePurchase([
      { productId, quantity: 5, unitCost: 10 },
    ]);
    const cancel = await callApi<ApiPurchase>(
      app,
      'POST',
      `/purchases/${purchase.body.id}/cancel`,
      {},
      tenant.accessToken,
    );
    expect(cancel.status).toBe(201);
    expect(cancel.body.status).toBe('CANCELLED');

    const confirmAfter = await confirmPurchase(purchase.body.id);
    expect(confirmAfter.status).toBe(409);
  });

  it('no permite cancelar una orden con recepciones (debe usarse devolución)', async () => {
    const { productId } = await createTestProduct(app, tenant, {
      name: 'Producto No Cancelar Recibida',
    });
    const purchase = await makePurchase([
      { productId, quantity: 5, unitCost: 10 },
    ]);
    await confirmPurchase(purchase.body.id);
    const itemId = purchase.body.items[0].id;
    await callApi<ApiPurchase>(
      app,
      'POST',
      `/purchases/${purchase.body.id}/receive`,
      {
        items: [{ purchaseItemId: itemId, quantity: 1 }],
        idempotencyKey: `recv-nocancel-${purchase.body.id}`,
      },
      tenant.accessToken,
    );

    const cancel = await callApi<ApiPurchase>(
      app,
      'POST',
      `/purchases/${purchase.body.id}/cancel`,
      {},
      tenant.accessToken,
    );
    expect(cancel.status).toBe(409);
  });

  it('20) cada operación relevante genera auditoría', async () => {
    const { productId } = await createTestProduct(app, tenant, {
      name: 'Producto Auditoria Compras',
    });
    const purchase = await makePurchase([
      { productId, quantity: 5, unitCost: 10 },
    ]);
    await confirmPurchase(purchase.body.id);
    const itemId = purchase.body.items[0].id;
    await callApi<ApiPurchase>(
      app,
      'POST',
      `/purchases/${purchase.body.id}/receive`,
      {
        items: [{ purchaseItemId: itemId, quantity: 5 }],
        idempotencyKey: `recv-audit-${purchase.body.id}`,
      },
      tenant.accessToken,
    );
    await callApi<ApiPurchase>(
      app,
      'POST',
      `/purchases/${purchase.body.id}/return`,
      {
        items: [{ purchaseItemId: itemId, quantity: 1 }],
        idempotencyKey: `ret-audit-${purchase.body.id}`,
      },
      tenant.accessToken,
    );

    await new Promise((resolve) => setTimeout(resolve, 1500));

    const tenantPrisma = app.get(TenantPrismaService);
    const logs = await tenantPrisma.run(tenant.organizationId, (tx) =>
      tx.auditLog.findMany({
        where: { entityId: purchase.body.id },
        orderBy: { createdAt: 'asc' },
      }),
    );
    const actions = (logs as ApiAuditLog[]).map((l) => l.action);
    expect(actions).toEqual(
      expect.arrayContaining([
        'purchases.create',
        'purchases.confirm',
        'purchases.receive',
        'purchases.return',
      ]),
    );
  }, 10000);
});
