import { INestApplication } from '@nestjs/common';
import {
  ApiInventoryMovement,
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
import { TenantPrismaService } from '../prisma/tenant-prisma.service';

describe('Inventario avanzado — kardex, movimientos, ajustes y transferencias (integración, DB real)', () => {
  let app: INestApplication;
  let tenant: TestTenant;

  beforeAll(async () => {
    app = await bootTestApp();
    tenant = await registerTestOrg(app, 'Inventory-Core');
  }, 30000);

  afterAll(async () => {
    await app.close();
  }, 15000);

  async function move(
    body: Record<string, unknown>,
    token = tenant.accessToken,
  ) {
    return callApi<ApiMovementResult>(
      app,
      'POST',
      '/inventory/movements',
      body,
      token,
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
    const row = res.body.find(
      (r) => r.productId === productId && r.warehouseId === warehouseId,
    );
    return row ? Number(row.quantity) : 0;
  }

  it('1) entrada manual (IN) crea stock y un movimiento con stockBefore/stockAfter correctos', async () => {
    const { productId } = await createTestProduct(app, tenant, {
      name: 'Entrada Manual',
    });
    const res = await move({
      warehouseId: tenant.warehouseId,
      productId,
      type: 'IN',
      quantity: 15,
      reason: 'Compra directa sin orden',
      idempotencyKey: `in-manual-${uniqueSuffix()}`,
    });
    expect(res.status).toBe(201);
    expect(res.body.movement.type).toBe('IN');
    expect(Number(res.body.stockBefore)).toBe(0);
    expect(Number(res.body.stockAfter)).toBe(15);
    expect(await stockOf(productId, tenant.warehouseId)).toBe(15);
  });

  it('2) salida manual (OUT) descuenta stock existente', async () => {
    const { productId } = await createTestProduct(app, tenant, {
      name: 'Salida Manual',
    });
    await move({
      warehouseId: tenant.warehouseId,
      productId,
      type: 'IN',
      quantity: 20,
      idempotencyKey: `salida-carga-${uniqueSuffix()}`,
    });

    const res = await move({
      warehouseId: tenant.warehouseId,
      productId,
      type: 'OUT',
      quantity: 6,
      reason: 'Merma',
      idempotencyKey: `out-manual-${uniqueSuffix()}`,
    });
    expect(res.status).toBe(201);
    expect(res.body.movement.type).toBe('OUT');
    expect(Number(res.body.stockBefore)).toBe(20);
    expect(Number(res.body.stockAfter)).toBe(14);
    expect(await stockOf(productId, tenant.warehouseId)).toBe(14);
  });

  it('3) ajuste positivo (ADJUSTMENT, INCREASE) sube el stock y queda distinguible de un IN', async () => {
    const { productId } = await createTestProduct(app, tenant, {
      name: 'Ajuste Positivo',
    });
    await move({
      warehouseId: tenant.warehouseId,
      productId,
      type: 'IN',
      quantity: 5,
      idempotencyKey: `ajuste-pos-carga-${uniqueSuffix()}`,
    });

    const res = await move({
      warehouseId: tenant.warehouseId,
      productId,
      type: 'ADJUSTMENT',
      direction: 'INCREASE',
      quantity: 3,
      reason: 'Conteo físico encontró excedente',
      idempotencyKey: `ajuste-pos-${uniqueSuffix()}`,
    });
    expect(res.status).toBe(201);
    expect(res.body.movement.type).toBe('ADJUSTMENT');
    expect(Number(res.body.stockBefore)).toBe(5);
    expect(Number(res.body.stockAfter)).toBe(8);
    expect(await stockOf(productId, tenant.warehouseId)).toBe(8);
  });

  it('4) ajuste negativo (ADJUSTMENT, DECREASE) baja el stock', async () => {
    const { productId } = await createTestProduct(app, tenant, {
      name: 'Ajuste Negativo',
    });
    await move({
      warehouseId: tenant.warehouseId,
      productId,
      type: 'IN',
      quantity: 10,
      idempotencyKey: `ajuste-neg-carga-${uniqueSuffix()}`,
    });

    const res = await move({
      warehouseId: tenant.warehouseId,
      productId,
      type: 'ADJUSTMENT',
      direction: 'DECREASE',
      quantity: 4,
      reason: 'Conteo físico encontró faltante',
      idempotencyKey: `ajuste-neg-${uniqueSuffix()}`,
    });
    expect(res.status).toBe(201);
    expect(Number(res.body.stockBefore)).toBe(10);
    expect(Number(res.body.stockAfter)).toBe(6);
    expect(await stockOf(productId, tenant.warehouseId)).toBe(6);
  });

  it('un ajuste sin direction es rechazado (400) — no hay signo implícito para ADJUSTMENT', async () => {
    const { productId } = await createTestProduct(app, tenant, {
      name: 'Ajuste Sin Direccion',
    });
    const res = await move({
      warehouseId: tenant.warehouseId,
      productId,
      type: 'ADJUSTMENT',
      quantity: 1,
      idempotencyKey: `ajuste-sin-direccion-${uniqueSuffix()}`,
    });
    expect(res.status).toBe(400);
  });

  it('8) impide stock negativo: OUT y ajuste negativo mayores al stock disponible son rechazados (409) y no alteran el stock', async () => {
    const { productId } = await createTestProduct(app, tenant, {
      name: 'Sin Stock Negativo',
    });
    await move({
      warehouseId: tenant.warehouseId,
      productId,
      type: 'IN',
      quantity: 5,
      idempotencyKey: `neg-carga-${uniqueSuffix()}`,
    });

    const outTooMuch = await move({
      warehouseId: tenant.warehouseId,
      productId,
      type: 'OUT',
      quantity: 999,
      idempotencyKey: `neg-out-${uniqueSuffix()}`,
    });
    expect(outTooMuch.status).toBe(409);
    expect(await stockOf(productId, tenant.warehouseId)).toBe(5);

    const adjustTooMuch = await move({
      warehouseId: tenant.warehouseId,
      productId,
      type: 'ADJUSTMENT',
      direction: 'DECREASE',
      quantity: 999,
      idempotencyKey: `neg-ajuste-${uniqueSuffix()}`,
    });
    expect(adjustTooMuch.status).toBe(409);
    expect(await stockOf(productId, tenant.warehouseId)).toBe(5);
  });

  it('5) transferencia entre almacenes: descuenta en origen, suma en destino, deja las dos piernas ligadas por reference', async () => {
    const { productId } = await createTestProduct(app, tenant, {
      name: 'Transferencia Simple',
    });
    const { warehouseId: warehouseB } = await createTestWarehouse(
      app,
      tenant,
      `Almacén B ${uniqueSuffix()}`,
    );
    await move({
      warehouseId: tenant.warehouseId,
      productId,
      type: 'IN',
      quantity: 20,
      idempotencyKey: `transfer-carga-${uniqueSuffix()}`,
    });

    const res = await callApi<ApiInventoryTransfer>(
      app,
      'POST',
      '/inventory/transfers',
      {
        fromWarehouseId: tenant.warehouseId,
        toWarehouseId: warehouseB,
        productId,
        quantity: 8,
        reason: 'Reabastecimiento sucursal',
        idempotencyKey: `transfer-simple-${uniqueSuffix()}`,
      },
      tenant.accessToken,
    );
    expect(res.status).toBe(201);
    expect(await stockOf(productId, tenant.warehouseId)).toBe(12);
    expect(await stockOf(productId, warehouseB)).toBe(8);

    const movements = await callApi<ApiInventoryMovement[]>(
      app,
      'GET',
      `/inventory/movements?productId=${productId}&type=TRANSFER`,
      undefined,
      tenant.accessToken,
    );
    expect(movements.body).toHaveLength(2);
    const references = new Set(movements.body.map((m) => m.reference));
    expect(references.size).toBe(1);
    expect([...references][0]).toBe(res.body.id);
  });

  it('valida que origen y destino pertenezcan a la misma organización (almacén inexistente/ajeno → 400)', async () => {
    const { productId } = await createTestProduct(app, tenant, {
      name: 'Transferencia Almacén Inválido',
    });
    await move({
      warehouseId: tenant.warehouseId,
      productId,
      type: 'IN',
      quantity: 10,
      idempotencyKey: `transfer-invalido-carga-${uniqueSuffix()}`,
    });

    const res = await callApi<ApiInventoryTransfer>(
      app,
      'POST',
      '/inventory/transfers',
      {
        fromWarehouseId: tenant.warehouseId,
        toWarehouseId: 'almacen-inexistente',
        productId,
        quantity: 1,
        idempotencyKey: `transfer-invalido-${uniqueSuffix()}`,
      },
      tenant.accessToken,
    );
    expect(res.status).toBe(400);
  });

  it('6) transferencia atómica: si el stock es insuficiente, no queda ninguna pierna aplicada (todo o nada)', async () => {
    const { productId } = await createTestProduct(app, tenant, {
      name: 'Transferencia Atómica',
    });
    const { warehouseId: warehouseB } = await createTestWarehouse(
      app,
      tenant,
      `Almacén Atómico B ${uniqueSuffix()}`,
    );
    await move({
      warehouseId: tenant.warehouseId,
      productId,
      type: 'IN',
      quantity: 5,
      idempotencyKey: `transfer-atomica-carga-${uniqueSuffix()}`,
    });

    const res = await callApi<ApiInventoryTransfer>(
      app,
      'POST',
      '/inventory/transfers',
      {
        fromWarehouseId: tenant.warehouseId,
        toWarehouseId: warehouseB,
        productId,
        quantity: 999,
        idempotencyKey: `transfer-atomica-${uniqueSuffix()}`,
      },
      tenant.accessToken,
    );
    expect(res.status).toBe(409);
    // el origen no perdió stock (rollback) y el destino nunca lo ganó
    expect(await stockOf(productId, tenant.warehouseId)).toBe(5);
    expect(await stockOf(productId, warehouseB)).toBe(0);

    const transfers = await callApi<ApiInventoryTransfer[]>(
      app,
      'GET',
      `/inventory/movements?productId=${productId}&type=TRANSFER`,
      undefined,
      tenant.accessToken,
    );
    expect(transfers.body).toHaveLength(0); // ninguna pierna quedó registrada
  });

  it('9) kardex: historial cronológico ascendente de un producto en un almacén, con saldo corriente consistente', async () => {
    const { productId } = await createTestProduct(app, tenant, {
      name: 'Kardex',
    });
    const k1 = `kardex-1-${uniqueSuffix()}`;
    const k2 = `kardex-2-${uniqueSuffix()}`;
    const k3 = `kardex-3-${uniqueSuffix()}`;
    await move({
      warehouseId: tenant.warehouseId,
      productId,
      type: 'IN',
      quantity: 10,
      idempotencyKey: k1,
    });
    await move({
      warehouseId: tenant.warehouseId,
      productId,
      type: 'OUT',
      quantity: 3,
      idempotencyKey: k2,
    });
    await move({
      warehouseId: tenant.warehouseId,
      productId,
      type: 'ADJUSTMENT',
      direction: 'INCREASE',
      quantity: 2,
      idempotencyKey: k3,
    });

    const res = await callApi<ApiInventoryMovement[]>(
      app,
      'GET',
      `/inventory/kardex?productId=${productId}&warehouseId=${tenant.warehouseId}`,
      undefined,
      tenant.accessToken,
    );
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(3);
    expect(res.body.map((m) => m.type)).toEqual(['IN', 'OUT', 'ADJUSTMENT']);
    // orden ascendente: el stockAfter de una fila es el stockBefore de la siguiente
    expect(Number(res.body[0].stockBefore)).toBe(0);
    expect(Number(res.body[0].stockAfter)).toBe(10);
    expect(Number(res.body[1].stockBefore)).toBe(10);
    expect(Number(res.body[1].stockAfter)).toBe(7);
    expect(Number(res.body[2].stockBefore)).toBe(7);
    expect(Number(res.body[2].stockAfter)).toBe(9);
  });

  it('el kardex exige productId y warehouseId (400 si falta alguno)', async () => {
    const res = await callApi(
      app,
      'GET',
      '/inventory/kardex',
      undefined,
      tenant.accessToken,
    );
    expect(res.status).toBe(400);
  });

  it('10) stock por almacén: el mismo producto mantiene saldos independientes en dos almacenes distintos', async () => {
    const { productId } = await createTestProduct(app, tenant, {
      name: 'Stock Por Almacén',
    });
    const { warehouseId: warehouseB } = await createTestWarehouse(
      app,
      tenant,
      `Almacén Stock B ${uniqueSuffix()}`,
    );
    await move({
      warehouseId: tenant.warehouseId,
      productId,
      type: 'IN',
      quantity: 12,
      idempotencyKey: `stock-almacen-a-${uniqueSuffix()}`,
    });
    await move({
      warehouseId: warehouseB,
      productId,
      type: 'IN',
      quantity: 4,
      idempotencyKey: `stock-almacen-b-${uniqueSuffix()}`,
    });

    expect(await stockOf(productId, tenant.warehouseId)).toBe(12);
    expect(await stockOf(productId, warehouseB)).toBe(4);

    // Salida en un almacén nunca afecta al otro.
    await move({
      warehouseId: tenant.warehouseId,
      productId,
      type: 'OUT',
      quantity: 5,
      idempotencyKey: `stock-almacen-a-salida-${uniqueSuffix()}`,
    });
    expect(await stockOf(productId, tenant.warehouseId)).toBe(7);
    expect(await stockOf(productId, warehouseB)).toBe(4);
  });

  it('16) cada movimiento manual y cada transferencia genera auditoría', async () => {
    const { productId } = await createTestProduct(app, tenant, {
      name: 'Auditoría Inventario',
    });
    const { warehouseId: warehouseB } = await createTestWarehouse(
      app,
      tenant,
      `Almacén Auditoría B ${uniqueSuffix()}`,
    );
    const movement = await move({
      warehouseId: tenant.warehouseId,
      productId,
      type: 'IN',
      quantity: 10,
      idempotencyKey: `auditoria-in-${uniqueSuffix()}`,
    });
    const transfer = await callApi<ApiInventoryTransfer>(
      app,
      'POST',
      '/inventory/transfers',
      {
        fromWarehouseId: tenant.warehouseId,
        toWarehouseId: warehouseB,
        productId,
        quantity: 2,
        idempotencyKey: `auditoria-transfer-${uniqueSuffix()}`,
      },
      tenant.accessToken,
    );

    await new Promise((resolve) => setTimeout(resolve, 1500));

    const tenantPrisma = app.get(TenantPrismaService);
    const logs = await tenantPrisma.run(tenant.organizationId, (tx) =>
      tx.auditLog.findMany({
        where: {
          entityId: {
            in: [movement.body.movement.id, transfer.body.id],
          },
        },
      }),
    );
    const actions = logs.map((l) => l.action);
    expect(actions).toEqual(
      expect.arrayContaining([
        'inventory.movement.create',
        'inventory.transfer.create',
      ]),
    );
  }, 10000);
});
