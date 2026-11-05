import { INestApplication } from '@nestjs/common';
import {
  bootTestApp,
  callApi,
  createProductWithStock,
  createUserWithRole,
  openCashRegister,
  registerTestOrg,
  TestTenant,
  uniqueSuffix,
} from '../test-support/integration-app';
import { TenantPrismaService } from '../prisma/tenant-prisma.service';
import { PrismaService } from '../prisma/prisma.service';
import type { CreateBatchDto } from './restaurant.dto';

interface Task {
  id: string;
  station: string;
  status: string;
  version: number;
  printCount: number;
}
interface Order {
  id: string;
  saleId: string;
  status: string;
  version: number;
  printCount: number;
  printCopy: number;
  printStation: string | null;
  tasks: Task[];
}
interface Batch {
  id: string;
  status: string;
  version: number;
  producedQuantity: string;
  cancelReason: string;
}

describe('Cocina por estación y producción por tandas — DB real', () => {
  let app: INestApplication;
  let a: TestTenant;
  let b: TestTenant;
  let raw: string;
  let cooked: string;
  let drink: string;
  let foodMenu: string;
  let drinkMenu: string;
  let cashier: string;
  beforeAll(async () => {
    app = await bootTestApp();
    a = await registerTestOrg(app, 'Cocina');
    b = await registerTestOrg(app, 'Otra cocina');
    raw = (
      await createProductWithStock(app, a, {
        name: 'Pollo crudo',
        price: 60,
        quantity: 20,
      })
    ).productId;
    cooked = (
      await createProductWithStock(app, a, {
        name: 'Pollo preparado',
        price: 80,
        quantity: 10,
      })
    ).productId;
    drink = (
      await createProductWithStock(app, a, {
        name: 'Refresco',
        price: 5,
        quantity: 30,
      })
    ).productId;
    await openCashRegister(app, a, { openingAmount: 100 });
    for (const [productId, name, station, price, quantity] of [
      [cooked, 'Cuarto de pollo', 'Parrilla', 25, 0.25],
      [drink, 'Refresco', 'Bebidas', 5, 1],
    ] as const) {
      const menu = await callApi<{ id: string }>(
        app,
        'POST',
        '/restaurant/menu',
        {
          productId,
          name,
          station,
          price,
          category: 'Menú',
          active: true,
          components: [{ productId, quantity }],
          options: [],
        },
        a.accessToken,
      );
      expect(menu.status).toBe(201);
      if (station === 'Parrilla') foodMenu = menu.body.id;
      else drinkMenu = menu.body.id;
    }
    cashier = await createUserWithRole(app, a.organizationId, 'CASHIER');
  }, 60000);
  afterAll(async () => {
    await app?.close();
  });
  function batchBody(): CreateBatchDto {
    return {
      warehouseId: a.warehouseId,
      name: 'Tanda de pollo',
      station: 'Parrilla',
      sourceProductId: raw,
      outputProductId: cooked,
      sourceQuantity: 2,
      plannedQuantity: 2,
      requestKey: uniqueSuffix(),
    };
  }
  async function batch(dto = batchBody()) {
    const res = await callApi<Batch>(
      app,
      'POST',
      '/restaurant/batches',
      dto,
      a.accessToken,
    );
    expect(res.status).toBe(201);
    return res.body;
  }
  function batchAction(
    id: string,
    status: string,
    version: number,
    extra = {},
  ) {
    return callApi<Batch>(
      app,
      'POST',
      `/restaurant/batches/${id}/status`,
      { status, version, ...extra },
      a.accessToken,
    );
  }
  async function stock(productId: string) {
    const res = await callApi<{ quantity: string }[]>(
      app,
      'GET',
      `/inventory?warehouseId=${a.warehouseId}&productId=${productId}`,
      undefined,
      a.accessToken,
    );
    return Number(res.body[0]?.quantity ?? 0);
  }
  async function order() {
    const created = await callApi<Order>(
      app,
      'POST',
      '/restaurant/orders',
      {
        posTerminalId: a.posTerminalId,
        warehouseId: a.warehouseId,
        service: 'TAKEAWAY',
        requestKey: uniqueSuffix(),
        items: [
          { menuEntryId: foodMenu, quantity: 1, optionIds: [] },
          { menuEntryId: drinkMenu, quantity: 1, optionIds: [] },
        ],
      },
      a.accessToken,
    );
    expect(created.status).toBe(201);
    const paid = await callApi<Order>(
      app,
      'POST',
      `/restaurant/orders/${created.body.id}/checkout`,
      {
        payments: [
          { method: 'CASH', amount: 30, idempotencyKey: uniqueSuffix() },
        ],
      },
      a.accessToken,
    );
    expect(paid.status).toBe(201);
    return paid.body;
  }
  function stationAction(
    order: Order,
    station: string,
    status: string,
    version?: number,
  ) {
    return callApi<Order>(
      app,
      'POST',
      `/restaurant/orders/${order.id}/status`,
      {
        station,
        status,
        version:
          version ??
          order.tasks.find((task) => task.station === station)?.version ??
          0,
      },
      a.accessToken,
    );
  }

  it('cada estación avanza con su propia versión y el pedido espera a todas', async () => {
    const paid = await order();
    expect(paid.tasks.map((task) => task.station)).toEqual([
      'Bebidas',
      'Parrilla',
    ]);
    const started = await Promise.all([
      stationAction(paid, 'Parrilla', 'PREPARING'),
      stationAction(paid, 'Bebidas', 'PREPARING'),
    ]);
    expect(started.map((s) => s.status)).toEqual([201, 201]);
    const food = await stationAction(paid, 'Parrilla', 'READY', 1);
    expect(food.status).toBe(201);
    expect(food.body.status).toBe('PREPARING');
    expect(food.body.tasks.find((t) => t.station === 'Bebidas')?.status).toBe(
      'PREPARING',
    );
    const premature = await callApi(
      app,
      'POST',
      `/restaurant/orders/${paid.id}/status`,
      { status: 'DELIVERED', version: food.body.version },
      a.accessToken,
    );
    expect(premature.status).toBe(409);
    const ready = await stationAction(paid, 'Bebidas', 'READY', 1);
    expect(ready.body.status).toBe('READY');
    const delivered = await callApi<Order>(
      app,
      'POST',
      `/restaurant/orders/${paid.id}/status`,
      { status: 'DELIVERED', version: ready.body.version },
      a.accessToken,
    );
    expect(delivered.body.status).toBe('DELIVERED');
  });
  it('reintentos de estación no duplican transiciones y rechaza saltos', async () => {
    const paid = await order();
    expect((await stationAction(paid, 'Parrilla', 'READY')).status).toBe(409);
    const started = await Promise.all([
      stationAction(paid, 'Parrilla', 'PREPARING'),
      stationAction(paid, 'Parrilla', 'PREPARING'),
    ]);
    expect(started.map((r) => r.status)).toEqual([201, 201]);
    expect((await stationAction(paid, 'Inexistente', 'PREPARING')).status).toBe(
      404,
    );
    const bulkReady = await callApi(
      app,
      'POST',
      `/restaurant/orders/${paid.id}/status`,
      { status: 'READY', version: started[0].body.version },
      a.accessToken,
    );
    expect(bulkReady.status).toBe(409);
    const events = await app
      .get(TenantPrismaService)
      .run(a.organizationId, (tx) =>
        tx.restaurantOrderEvent.count({
          where: { orderId: paid.id, action: 'STATION_PREPARING' },
        }),
      );
    expect(events).toBe(1);
  });
  it('las comandas tienen contador de copias independiente por estación', async () => {
    const paid = await order();
    const print = (station: string) =>
      callApi<Order>(
        app,
        'POST',
        `/restaurant/orders/${paid.id}/print`,
        { station },
        a.accessToken,
      );
    expect((await print('Parrilla')).body.printCopy).toBe(1);
    expect((await print('Parrilla')).body.printCopy).toBe(2);
    const beverage = await print('Bebidas');
    expect(beverage.body.printCopy).toBe(1);
    expect(beverage.body.printStation).toBe('Bebidas');
    expect(beverage.body.printCount).toBe(0);
    expect((await print('Otra')).status).toBe(404);
  });
  it('una devolución cancela comandas y no repone comida cuya preparación empezó', async () => {
    const paid = await order();
    const before = await stock(cooked);
    const drinkBefore = await stock(drink);
    expect((await stationAction(paid, 'Parrilla', 'PREPARING')).status).toBe(
      201,
    );
    expect(
      (
        await callApi(
          app,
          'POST',
          `/sales/${paid.saleId}/return`,
          {},
          a.accessToken,
        )
      ).status,
    ).toBe(201);
    expect(await stock(cooked)).toBe(before);
    expect(await stock(drink)).toBe(drinkBefore + 1);
    const current = await callApi<Order>(
      app,
      'GET',
      `/restaurant/orders/${paid.id}`,
      undefined,
      a.accessToken,
    );
    expect(
      current.body.tasks.every((task) => task.status === 'CANCELLED'),
    ).toBe(true);
    expect(
      (await stationAction(current.body, 'Bebidas', 'PREPARING')).status,
    ).toBe(409);
  });
  it('la creación de tanda es idempotente y rechaza otro contenido con la misma clave', async () => {
    const dto = batchBody();
    const [first, replay] = await Promise.all([batch(dto), batch(dto)]);
    expect(first.id).toBe(replay.id);
    expect(
      (
        await callApi(
          app,
          'POST',
          '/restaurant/batches',
          { ...dto, plannedQuantity: 3 },
          a.accessToken,
        )
      ).status,
    ).toBe(409);
  });
  it('consume crudo al iniciar y agrega solo la producción real al completar, una sola vez', async () => {
    const created = await batch();
    const rawBefore = await stock(raw);
    const cookedBefore = await stock(cooked);
    const started = await Promise.all([
      batchAction(created.id, 'PREPARING', 0),
      batchAction(created.id, 'PREPARING', 0),
    ]);
    expect(started.map((r) => r.status)).toEqual([201, 201]);
    expect(await stock(raw)).toBe(rawBefore - 2);
    expect(await stock(cooked)).toBe(cookedBefore);
    const completed = await Promise.all([
      batchAction(created.id, 'READY', 1, { producedQuantity: 1.5 }),
      batchAction(created.id, 'READY', 1, { producedQuantity: 1.5 }),
    ]);
    expect(completed.map((r) => r.status)).toEqual([201, 201]);
    expect(await stock(cooked)).toBe(cookedBefore + 1.5);
    expect(completed[0].body.producedQuantity).toBe('1.5');
    expect(
      (await batchAction(created.id, 'READY', 1, { producedQuantity: 2 }))
        .status,
    ).toBe(409);
  });
  it('stock insuficiente y estados inválidos revierten el inicio', async () => {
    const created = await batch({ ...batchBody(), sourceQuantity: 1000 });
    const before = await stock(raw);
    expect((await batchAction(created.id, 'READY', 0)).status).toBe(409);
    expect((await batchAction(created.id, 'PREPARING', 0)).status).toBe(409);
    expect(await stock(raw)).toBe(before);
    const rows = await callApi<Batch[]>(
      app,
      'GET',
      '/restaurant/batches',
      undefined,
      a.accessToken,
    );
    expect(rows.body.find((row) => row.id === created.id)?.status).toBe(
      'DRAFT',
    );
  });
  it('cancelar exige motivo y nunca repone automáticamente crudo ya consumido', async () => {
    const created = await batch();
    const before = await stock(raw);
    expect((await batchAction(created.id, 'CANCELLED', 0)).status).toBe(400);
    expect((await batchAction(created.id, 'PREPARING', 0)).status).toBe(201);
    const cancelled = await batchAction(created.id, 'CANCELLED', 1, {
      reason: 'Tanda quemada',
    });
    expect(cancelled.status).toBe(201);
    expect(cancelled.body.cancelReason).toBe('Tanda quemada');
    expect(await stock(raw)).toBe(before - 2);
    expect((await batchAction(created.id, 'READY', 2)).status).toBe(409);
  });
  it('permisos y referencias de otros tenants se rechazan', async () => {
    expect(
      (await callApi(app, 'POST', '/restaurant/batches', batchBody(), cashier))
        .status,
    ).toBe(403);
    expect(
      (
        await callApi(
          app,
          'POST',
          '/restaurant/batches',
          batchBody(),
          b.accessToken,
        )
      ).status,
    ).toBe(400);
    const created = await batch();
    expect(
      (
        await callApi(
          app,
          'POST',
          `/restaurant/batches/${created.id}/status`,
          { status: 'PREPARING', version: 0 },
          b.accessToken,
        )
      ).status,
    ).toBe(404);
    expect(
      (
        await callApi(
          app,
          'POST',
          '/restaurant/batches',
          { ...batchBody(), outputProductId: raw },
          a.accessToken,
        )
      ).status,
    ).toBe(400);
    const paid = await order();
    expect(
      (
        await callApi(
          app,
          'POST',
          `/restaurant/orders/${paid.id}/status`,
          { station: 'Parrilla', status: 'PREPARING', version: 0 },
          cashier,
        )
      ).status,
    ).toBe(403);
  });
  it('RLS y la FK compuesta impiden mezclar comandas de empresas distintas', async () => {
    const paid = await order();
    const tenant = app.get(TenantPrismaService);
    const visible = await tenant.run(
      b.organizationId,
      (tx) =>
        tx.$queryRaw<
          unknown[]
        >`SELECT id FROM kitchen_tasks UNION ALL SELECT id FROM production_batches`,
    );
    expect(visible).toEqual([]);
    expect(
      await app.get(PrismaService).$queryRaw<
        unknown[]
      >`SELECT id FROM production_batches`,
    ).toEqual([]);
    await expect(
      tenant.run(b.organizationId, (tx) =>
        tx.kitchenTask.create({
          data: {
            organizationId: b.organizationId,
            orderId: paid.id,
            station: 'Ajena',
          },
        }),
      ),
    ).rejects.toThrow();
  });
});
