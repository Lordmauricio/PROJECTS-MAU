import { INestApplication } from '@nestjs/common';
import {
  ApiInventoryRow,
  ApiInventoryTransfer,
  ApiMovementResult,
  bootTestApp,
  callApi,
  createTestProduct,
  createTestWarehouse,
  registerTestOrg,
  TestTenant,
  uniqueSuffix,
} from '../test-support/integration-app';

describe('Inventario avanzado — concurrencia e idempotencia (integración, DB real)', () => {
  let app: INestApplication;
  let tenant: TestTenant;

  beforeAll(async () => {
    app = await bootTestApp();
    tenant = await registerTestOrg(app, 'Inventory-Concurrency');
  }, 30000);

  afterAll(async () => {
    await app.close();
  }, 15000);

  async function move(body: Record<string, unknown>) {
    return callApi<ApiMovementResult>(
      app,
      'POST',
      '/inventory/movements',
      body,
      tenant.accessToken,
    );
  }

  async function transferReq(body: Record<string, unknown>) {
    return callApi<ApiInventoryTransfer>(
      app,
      'POST',
      '/inventory/transfers',
      body,
      tenant.accessToken,
    );
  }

  async function stockOf(
    productId: string,
    warehouseId: string,
  ): Promise<number> {
    const res = await callApi<ApiInventoryRow[]>(
      app,
      'GET',
      `/inventory?warehouseId=${warehouseId}&productId=${productId}`,
      undefined,
      tenant.accessToken,
    );
    const row = res.body.find((r) => r.productId === productId);
    return row ? Number(row.quantity) : 0;
  }

  it('11) doble click con la misma idempotencyKey en /inventory/movements no duplica el movimiento ni el stock (secuencial)', async () => {
    const { productId } = await createTestProduct(app, tenant, {
      name: 'Doble Click Movimiento',
    });
    const key = `doble-click-movimiento-${uniqueSuffix()}`;

    const first = await move({
      warehouseId: tenant.warehouseId,
      productId,
      type: 'IN',
      quantity: 10,
      idempotencyKey: key,
    });
    const second = await move({
      warehouseId: tenant.warehouseId,
      productId,
      type: 'IN',
      quantity: 10,
      idempotencyKey: key,
    });

    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
    expect(first.body.movement.id).toBe(second.body.movement.id);
    expect(await stockOf(productId, tenant.warehouseId)).toBe(10); // no 20
  });

  it('12) retry (mismo request repetido tras timeout simulado) con la misma idempotencyKey: efecto único', async () => {
    const { productId } = await createTestProduct(app, tenant, {
      name: 'Retry Movimiento',
    });
    const key = `retry-movimiento-${uniqueSuffix()}`;
    const body = {
      warehouseId: tenant.warehouseId,
      productId,
      type: 'OUT' as const,
      quantity: 3,
      idempotencyKey: key,
    };
    await move({
      warehouseId: tenant.warehouseId,
      productId,
      type: 'IN',
      quantity: 20,
      idempotencyKey: `retry-carga-${uniqueSuffix()}`,
    });

    const attempt1 = await move(body);
    // simula que el cliente no recibió la respuesta y reintenta el MISMO request
    const attempt2 = await move(body);
    const attempt3 = await move(body);

    expect([attempt1.status, attempt2.status, attempt3.status]).toEqual([
      201, 201, 201,
    ]);
    expect(await stockOf(productId, tenant.warehouseId)).toBe(17); // 20 - 3, una sola vez
  });

  it('dos requests concurrentes con la misma idempotencyKey producen un único movimiento (carrera real, no secuencial)', async () => {
    const { productId } = await createTestProduct(app, tenant, {
      name: 'Concurrente Misma Key',
    });
    await move({
      warehouseId: tenant.warehouseId,
      productId,
      type: 'IN',
      quantity: 20,
      idempotencyKey: `concurrente-key-carga-${uniqueSuffix()}`,
    });
    const key = `concurrente-key-${uniqueSuffix()}`;

    const [a, b] = await Promise.all([
      move({
        warehouseId: tenant.warehouseId,
        productId,
        type: 'OUT',
        quantity: 5,
        idempotencyKey: key,
      }),
      move({
        warehouseId: tenant.warehouseId,
        productId,
        type: 'OUT',
        quantity: 5,
        idempotencyKey: key,
      }),
    ]);

    expect(a.status).toBe(201);
    expect(b.status).toBe(201);
    expect(a.body.movement.id).toBe(b.body.movement.id);
    expect(await stockOf(productId, tenant.warehouseId)).toBe(15); // 20 - 5, no 20 - 10
  });

  it('ajustes simultáneos sobre el mismo producto se serializan sin perder ninguno (sin condición de carrera de "lost update")', async () => {
    const { productId } = await createTestProduct(app, tenant, {
      name: 'Ajustes Simultáneos',
    });
    await move({
      warehouseId: tenant.warehouseId,
      productId,
      type: 'IN',
      quantity: 100,
      idempotencyKey: `ajustes-sim-carga-${uniqueSuffix()}`,
    });

    const [a, b, c] = await Promise.all([
      move({
        warehouseId: tenant.warehouseId,
        productId,
        type: 'ADJUSTMENT',
        direction: 'DECREASE',
        quantity: 10,
        idempotencyKey: `ajustes-sim-a-${uniqueSuffix()}`,
      }),
      move({
        warehouseId: tenant.warehouseId,
        productId,
        type: 'ADJUSTMENT',
        direction: 'DECREASE',
        quantity: 10,
        idempotencyKey: `ajustes-sim-b-${uniqueSuffix()}`,
      }),
      move({
        warehouseId: tenant.warehouseId,
        productId,
        type: 'ADJUSTMENT',
        direction: 'INCREASE',
        quantity: 5,
        idempotencyKey: `ajustes-sim-c-${uniqueSuffix()}`,
      }),
    ]);
    expect([a.status, b.status, c.status]).toEqual([201, 201, 201]);
    expect(await stockOf(productId, tenant.warehouseId)).toBe(85); // 100 - 10 - 10 + 5, ninguno se pierde
  });

  it('7) transferencia concurrente: dos transferencias simultáneas sobre el mismo stock nunca dejan negativo ni duplican', async () => {
    const { productId } = await createTestProduct(app, tenant, {
      name: 'Transferencia Concurrente',
    });
    const { warehouseId: warehouseB } = await createTestWarehouse(
      app,
      tenant,
      `Transfer Concurrente B ${uniqueSuffix()}`,
    );
    // Solo 10 unidades disponibles: dos transferencias de 8 compitiendo por
    // ellas (16 pedidas en total) deben dejar exactamente una ganadora.
    await move({
      warehouseId: tenant.warehouseId,
      productId,
      type: 'IN',
      quantity: 10,
      idempotencyKey: `transfer-conc-carga-${uniqueSuffix()}`,
    });

    const [a, b] = await Promise.all([
      transferReq({
        fromWarehouseId: tenant.warehouseId,
        toWarehouseId: warehouseB,
        productId,
        quantity: 8,
        idempotencyKey: `transfer-conc-a-${uniqueSuffix()}`,
      }),
      transferReq({
        fromWarehouseId: tenant.warehouseId,
        toWarehouseId: warehouseB,
        productId,
        quantity: 8,
        idempotencyKey: `transfer-conc-b-${uniqueSuffix()}`,
      }),
    ]);

    const statuses = [a.status, b.status].sort();
    expect(statuses).toEqual([201, 409]); // exactamente una gana, la otra rechaza por stock insuficiente

    const originStock = await stockOf(productId, tenant.warehouseId);
    const destStock = await stockOf(productId, warehouseB);
    expect(originStock).toBeGreaterThanOrEqual(0); // nunca negativo
    expect(originStock + destStock).toBe(10); // ninguna unidad se creó ni se perdió
    expect(destStock).toBe(8); // exactamente una transferencia se aplicó, nunca duplicada
  }, 15000);

  it('reusar la misma idempotencyKey en DOS transferencias distintas (carrera real entre operaciones distintas) deja exactamente 1 aplicada', async () => {
    const { productId: productA } = await createTestProduct(app, tenant, {
      name: 'Carrera Cross Transfer A',
    });
    const { productId: productB } = await createTestProduct(app, tenant, {
      name: 'Carrera Cross Transfer B',
    });
    const { warehouseId: warehouseB } = await createTestWarehouse(
      app,
      tenant,
      `Carrera Cross B ${uniqueSuffix()}`,
    );
    await move({
      warehouseId: tenant.warehouseId,
      productId: productA,
      type: 'IN',
      quantity: 10,
      idempotencyKey: `carrera-cross-carga-a-${uniqueSuffix()}`,
    });
    await move({
      warehouseId: tenant.warehouseId,
      productId: productB,
      type: 'IN',
      quantity: 10,
      idempotencyKey: `carrera-cross-carga-b-${uniqueSuffix()}`,
    });
    const key = `carrera-cross-transfer-${uniqueSuffix()}`;

    const [a, b] = await Promise.all([
      transferReq({
        fromWarehouseId: tenant.warehouseId,
        toWarehouseId: warehouseB,
        productId: productA,
        quantity: 5,
        idempotencyKey: key,
      }),
      transferReq({
        fromWarehouseId: tenant.warehouseId,
        toWarehouseId: warehouseB,
        productId: productB,
        quantity: 5,
        idempotencyKey: key,
      }),
    ]);

    const statuses = [a.status, b.status].sort();
    expect(statuses).toEqual([201, 409]);
  });
});
