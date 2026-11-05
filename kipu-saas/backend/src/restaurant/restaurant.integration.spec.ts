import { INestApplication } from '@nestjs/common';
import {
  bootTestApp,
  callApi,
  createProductWithStock,
  createTestProduct,
  createUserWithRole,
  openCashRegister,
  registerTestOrg,
  TestTenant,
  uniqueSuffix,
} from '../test-support/integration-app';
import { TenantPrismaService } from '../prisma/tenant-prisma.service';
import { PrismaService } from '../prisma/prisma.service';
import type { CreateOrderDto, SaveMenuEntryDto } from './restaurant.dto';

interface Order {
  id: string;
  saleId: string;
  status: string;
  version: number;
  printCount: number;
  sale: { status: string; total: string; payments: { amount: string }[] };
  snapshot: {
    name: string;
    unitPrice: string;
    components: { productId: string; quantity: string }[];
  }[];
  events: { action: string }[];
}
describe('Restaurante — menú, combos, cobro y cocina con DB real', () => {
  let app: INestApplication;
  let tenant: TestTenant;
  let other: TestTenant;
  let chicken: string;
  let side: string;
  let extra: string;
  let anchor: string;
  let menuId: string;
  let menu: SaveMenuEntryDto;
  let lowPrivilege: string;
  beforeAll(async () => {
    app = await bootTestApp();
    tenant = await registerTestOrg(app, 'Pollería');
    other = await registerTestOrg(app, 'Otra pollería');
    chicken = (
      await createProductWithStock(app, tenant, {
        name: 'Pollo',
        price: 80,
        quantity: 100,
      })
    ).productId;
    side = (
      await createProductWithStock(app, tenant, {
        name: 'Papas',
        price: 5,
        quantity: 100,
      })
    ).productId;
    extra = (
      await createProductWithStock(app, tenant, {
        name: 'Arroz',
        price: 5,
        quantity: 100,
      })
    ).productId;
    anchor = (
      await createTestProduct(app, tenant, {
        name: 'Combo de pollo',
        price: 25,
      })
    ).productId;
    await openCashRegister(app, tenant, { openingAmount: 100 });
    lowPrivilege = await createUserWithRole(
      app,
      tenant.organizationId,
      'CASHIER',
    );
    menu = {
      productId: anchor,
      name: 'Cuarto de pollo',
      category: 'Combos',
      station: 'Parrilla',
      price: 25,
      active: true,
      components: [
        { productId: chicken, quantity: 0.25 },
        { productId: side, quantity: 1 },
      ],
      options: [
        {
          id: 'extra',
          name: 'Arroz extra',
          price: 3,
          components: [{ productId: extra, quantity: 1 }],
        },
        {
          id: 'swap',
          name: 'Arroz en lugar de papas',
          price: 0,
          replacesProductId: side,
          components: [{ productId: extra, quantity: 1 }],
        },
      ],
    };
    const res = await callApi<{ id: string }>(
      app,
      'POST',
      '/restaurant/menu',
      menu,
      tenant.accessToken,
    );
    expect(res.status).toBe(201);
    menuId = res.body.id;
  }, 60000);
  afterAll(async () => {
    await app?.close();
  });
  function body(options: string[] = [], quantity = 1): CreateOrderDto {
    return {
      posTerminalId: tenant.posTerminalId,
      warehouseId: tenant.warehouseId,
      requestKey: uniqueSuffix(),
      service: 'TAKEAWAY',
      items: [{ menuEntryId: menuId, quantity, optionIds: options }],
    };
  }
  async function create(dto = body()) {
    const res = await callApi<Order>(
      app,
      'POST',
      '/restaurant/orders',
      dto,
      tenant.accessToken,
    );
    expect(res.status).toBe(201);
    return res.body;
  }
  async function checkout(
    order: Order,
    payments = [
      {
        method: 'CASH',
        amount: Number(order.sale.total),
        idempotencyKey: uniqueSuffix(),
      },
    ],
  ) {
    return callApi<Order>(
      app,
      'POST',
      `/restaurant/orders/${order.id}/checkout`,
      { payments },
      tenant.accessToken,
    );
  }
  async function stock(productId: string) {
    const rows = await callApi<{ quantity: string }[]>(
      app,
      'GET',
      `/inventory?warehouseId=${tenant.warehouseId}&productId=${productId}`,
      undefined,
      tenant.accessToken,
    );
    return Number(rows.body[0]?.quantity ?? 0);
  }

  it('cobra el precio de servidor, consume componentes y conserva opciones históricas', async () => {
    const before = await stock(chicken);
    const beforeSide = await stock(side);
    const beforeExtra = await stock(extra);
    const order = await create(body(['extra'], 2));
    expect(order.sale.total).toBe('56');
    expect(order.snapshot[0].unitPrice).toBe('28.00');
    const confirmed = await checkout(order);
    expect(confirmed.status).toBe(201);
    expect(confirmed.body.status).toBe('QUEUED');
    expect(confirmed.body.sale.status).toBe('PAID');
    expect(await stock(chicken)).toBe(before - 0.5);
    expect(await stock(side)).toBe(beforeSide - 2);
    expect(await stock(extra)).toBe(beforeExtra - 2);
    expect(await stock(anchor)).toBe(0);
  });
  it('rechaza precios enviados por cliente y opciones ajenas al plato', async () => {
    expect(
      (
        await callApi(
          app,
          'POST',
          '/restaurant/orders',
          { ...body(), price: 1 },
          tenant.accessToken,
        )
      ).status,
    ).toBe(400);
    expect(
      (
        await callApi(
          app,
          'POST',
          '/restaurant/orders',
          body(['inventado']),
          tenant.accessToken,
        )
      ).status,
    ).toBe(400);
  });
  it('creación concurrente y reintentos producen un solo pedido y venta', async () => {
    const dto = body();
    const [a, b] = await Promise.all([create(dto), create(dto)]);
    expect(a.id).toBe(b.id);
    expect(a.saleId).toBe(b.saleId);
    const conflict = await callApi(
      app,
      'POST',
      '/restaurant/orders',
      { ...dto, service: 'DINE_IN' },
      tenant.accessToken,
    );
    expect(conflict.status).toBe(409);
  });
  it('reintentos de cobro no duplican pagos ni stock', async () => {
    const order = await create();
    const before = await stock(chicken);
    const payments = [
      { method: 'CASH', amount: 25, idempotencyKey: uniqueSuffix() },
    ];
    const [a, b] = await Promise.all([
      checkout(order, payments),
      checkout(order, payments),
    ]);
    expect(a.status).toBe(201);
    expect(b.status).toBe(201);
    expect(a.body.sale.payments).toHaveLength(1);
    expect(b.body.sale.payments).toHaveLength(1);
    expect(await stock(chicken)).toBe(before - 0.25);
  });
  it('admite pagos mixtos y rechaza pagos insuficientes o excesivos', async () => {
    const order = await create();
    expect(
      (
        await checkout(order, [
          { method: 'CASH', amount: 24, idempotencyKey: uniqueSuffix() },
        ])
      ).status,
    ).toBe(400);
    expect(
      (
        await checkout(order, [
          { method: 'CASH', amount: 30, idempotencyKey: uniqueSuffix() },
        ])
      ).status,
    ).toBe(400);
    const paid = await checkout(order, [
      { method: 'CASH', amount: 10, idempotencyKey: uniqueSuffix() },
      { method: 'QR', amount: 15, idempotencyKey: uniqueSuffix() },
    ]);
    expect(paid.body.sale.payments).toHaveLength(2);
  });
  it('rechaza claves duplicadas antes de cobrar o consumir stock', async () => {
    const order = await create();
    const before = await stock(chicken);
    const key = uniqueSuffix();
    const result = await checkout(order, [
      { method: 'CASH', amount: 10, idempotencyKey: key },
      { method: 'QR', amount: 15, idempotencyKey: key },
    ]);
    expect(result.status).toBe(400);
    expect(await stock(chicken)).toBe(before);
    const current = await callApi<Order>(
      app,
      'GET',
      `/restaurant/orders/${order.id}`,
      undefined,
      tenant.accessToken,
    );
    expect(current.body.sale.status).toBe('DRAFT');
    expect(current.body.sale.payments).toHaveLength(0);
  });
  it('solo un encargado puede aplicar descuentos y nunca sobre el subtotal', async () => {
    const dto = { ...body(), discount: 5 };
    const denied = await callApi(
      app,
      'POST',
      '/restaurant/orders',
      dto,
      lowPrivilege,
    );
    expect(denied.status).toBe(403);
    const accepted = await create(dto);
    expect(accepted.sale.total).toBe('20');
    expect(
      (
        await callApi(
          app,
          'POST',
          '/restaurant/orders',
          { ...body(), discount: 26 },
          tenant.accessToken,
        )
      ).status,
    ).toBe(400);
  });
  it('sustituye el componente sin consumir el original', async () => {
    const before = await stock(side);
    const beforeExtra = await stock(extra);
    const order = await create(body(['swap']));
    expect((await checkout(order)).status).toBe(201);
    expect(await stock(side)).toBe(before);
    expect(await stock(extra)).toBe(beforeExtra - 1);
  });
  it('cambios de menú no alteran pedidos guardados ni recibos', async () => {
    const order = await create();
    expect(
      (
        await callApi(
          app,
          'PATCH',
          `/restaurant/menu/${menuId}`,
          {
            ...menu,
            name: 'Nuevo nombre',
            price: 90,
            components: [
              { productId: chicken, quantity: 0.5 },
              { productId: side, quantity: 1 },
            ],
          },
          tenant.accessToken,
        )
      ).status,
    ).toBe(200);
    const paid = await checkout(order);
    expect(paid.body.sale.total).toBe('25');
    expect(paid.body.snapshot[0].name).toBe('Cuarto de pollo');
    const receipt = await callApi<{
      snapshot: { items: { productName: string }[] };
    }>(app, 'POST', '/receipts', { saleId: order.saleId }, tenant.accessToken);
    expect(receipt.status).toBe(201);
    expect(receipt.body.snapshot.items[0].productName).toBe('Cuarto de pollo');
    await callApi(
      app,
      'PATCH',
      `/restaurant/menu/${menuId}`,
      menu,
      tenant.accessToken,
    );
  });
  it('protege transiciones y conserva una sola transición ante doble clic', async () => {
    const paid = (await checkout(await create())).body;
    const invalid = await callApi(
      app,
      'POST',
      `/restaurant/orders/${paid.id}/status`,
      { status: 'READY', version: paid.version },
      tenant.accessToken,
    );
    expect(invalid.status).toBe(409);
    const transition = () =>
      callApi<Order>(
        app,
        'POST',
        `/restaurant/orders/${paid.id}/status`,
        { status: 'PREPARING', version: paid.version },
        tenant.accessToken,
      );
    const [a, b] = await Promise.all([transition(), transition()]);
    expect(a.status).toBe(201);
    expect(b.status).toBe(201);
    expect(b.body.events.filter((e) => e.action === 'PREPARING')).toHaveLength(
      1,
    );
    const ready = await callApi<Order>(
      app,
      'POST',
      `/restaurant/orders/${paid.id}/status`,
      { status: 'READY', version: a.body.version },
      tenant.accessToken,
    );
    expect(ready.status).toBe(201);
    const delivered = await callApi<Order>(
      app,
      'POST',
      `/restaurant/orders/${paid.id}/status`,
      { status: 'DELIVERED', version: ready.body.version },
      tenant.accessToken,
    );
    expect(delivered.body.status).toBe('DELIVERED');
  });
  it('deniega cocina y cambios de menú al cajero y otros tenants', async () => {
    const paid = (await checkout(await create())).body;
    expect(
      (
        await callApi(
          app,
          'POST',
          `/restaurant/orders/${paid.id}/status`,
          { status: 'PREPARING', version: paid.version },
          lowPrivilege,
        )
      ).status,
    ).toBe(403);
    expect(
      (await callApi(app, 'POST', '/restaurant/menu', menu, lowPrivilege))
        .status,
    ).toBe(403);
    expect(
      (
        await callApi(
          app,
          'GET',
          `/restaurant/orders/${paid.id}`,
          undefined,
          other.accessToken,
        )
      ).status,
    ).toBe(404);
    expect(
      (
        await callApi(
          app,
          'POST',
          '/restaurant/orders',
          body(),
          other.accessToken,
        )
      ).status,
    ).toBe(400);
    expect(
      (await callApi(app, 'POST', '/restaurant/menu', menu, other.accessToken))
        .status,
    ).toBe(400);
  });
  it('repone stock en devolución antes de cocinar y no después', async () => {
    const a = (await checkout(await create())).body;
    const before = await stock(chicken);
    expect(
      (
        await callApi(
          app,
          'POST',
          `/sales/${a.saleId}/return`,
          {},
          tenant.accessToken,
        )
      ).status,
    ).toBe(201);
    expect(await stock(chicken)).toBe(before + 0.25);
    const b = (await checkout(await create())).body;
    await callApi(
      app,
      'POST',
      `/restaurant/orders/${b.id}/status`,
      { status: 'PREPARING', version: b.version },
      tenant.accessToken,
    );
    const cooked = await stock(chicken);
    expect(
      (
        await callApi(
          app,
          'POST',
          `/sales/${b.saleId}/return`,
          {},
          tenant.accessToken,
        )
      ).status,
    ).toBe(201);
    expect(await stock(chicken)).toBe(cooked);
    expect(
      (
        await callApi<Order>(
          app,
          'GET',
          `/restaurant/orders/${b.id}`,
          undefined,
          tenant.accessToken,
        )
      ).body.status,
    ).toBe('CANCELLED');
  });
  it('falta de stock revierte todo el cobro', async () => {
    const order = await create(body([], 1000));
    const before = await stock(chicken);
    const result = await checkout(order);
    expect(result.status).toBe(409);
    expect(await stock(chicken)).toBe(before);
    const current = await callApi<Order>(
      app,
      'GET',
      `/restaurant/orders/${order.id}`,
      undefined,
      tenant.accessToken,
    );
    expect(current.body.sale.status).toBe('DRAFT');
    expect(current.body.sale.payments).toHaveLength(0);
  });
  it('cancela borradores sin stock y registra reimpresiones', async () => {
    const order = await create();
    const before = await stock(chicken);
    const cancelled = await callApi<Order>(
      app,
      'POST',
      `/restaurant/orders/${order.id}/cancel`,
      { reason: 'Cliente desistió' },
      tenant.accessToken,
    );
    expect(cancelled.body.status).toBe('CANCELLED');
    expect(await stock(chicken)).toBe(before);
    expect((await checkout(order)).status).toBe(409);
    const paid = (await checkout(await create())).body;
    const first = await callApi<Order>(
      app,
      'POST',
      `/restaurant/orders/${paid.id}/print`,
      {},
      tenant.accessToken,
    );
    const second = await callApi<Order>(
      app,
      'POST',
      `/restaurant/orders/${paid.id}/print`,
      {},
      tenant.accessToken,
    );
    expect(first.body.printCount).toBe(1);
    expect(second.body.printCount).toBe(2);
  });
  it('RLS filtra las tres tablas nuevas incluso sin WHERE', async () => {
    const tenantPrisma = app.get(TenantPrismaService);
    const rows = await tenantPrisma.run(
      other.organizationId,
      (tx) =>
        tx.$queryRaw<
          { organizationId: string }[]
        >`SELECT "organizationId" FROM menu_entries UNION ALL SELECT "organizationId" FROM restaurant_orders UNION ALL SELECT "organizationId" FROM restaurant_order_events`,
    );
    expect(rows.every((r) => r.organizationId === other.organizationId)).toBe(
      true,
    );
    const raw = await app.get(PrismaService).$queryRaw<
      unknown[]
    >`SELECT id FROM menu_entries`;
    expect(raw).toEqual([]);
  });
});
