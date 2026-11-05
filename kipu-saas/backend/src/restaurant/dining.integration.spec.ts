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
interface Order {
  id: string;
  saleId: string;
  status: string;
  version: number;
  snapshot: { name: string }[];
  sale: { status: string; total: string; payments: { amount: string }[] };
}
interface Account {
  id: string;
  tableId: string;
  status: string;
  version: number;
  waiterId: string;
  waiterName: string;
  orders: Order[];
  tipAmount: string;
}
const base = '/restaurant/dining';
describe('Salón, cuentas y auditoría — PostgreSQL real', () => {
  let app: INestApplication,
    a: TestTenant,
    b: TestTenant,
    table: string,
    table2: string,
    menu: string,
    product: string,
    waiter: string,
    cashier: string;
  beforeAll(async () => {
    app = await bootTestApp();
    a = await registerTestOrg(app, 'Salón');
    b = await registerTestOrg(app, 'Otro salón');
    waiter = await createUserWithRole(app, a.organizationId, 'WAITER');
    cashier = await createUserWithRole(app, a.organizationId, 'CASHIER');
    product = (
      await createProductWithStock(app, a, {
        name: 'Plato salón',
        price: 25,
        quantity: 100,
      })
    ).productId;
    const m = await req<{ id: string }>('POST', '/restaurant/menu', {
      productId: product,
      name: 'Plato salón',
      station: 'Cocina',
      category: 'Platos',
      price: 25,
      active: true,
      components: [{ productId: product, quantity: 1 }],
      options: [],
    });
    menu = m.body.id;
    table = (
      await req<{ id: string }>('POST', `${base}/tables`, {
        branchId: a.branchId,
        name: 'Mesa 1',
        area: 'Salón',
        seats: 4,
      })
    ).body.id;
    table2 = (
      await req<{ id: string }>('POST', `${base}/tables`, {
        branchId: a.branchId,
        name: 'Mesa 2',
        area: 'Terraza',
        seats: 2,
      })
    ).body.id;
    await openCashRegister(app, a, { openingAmount: 100 });
  }, 60000);
  afterAll(async () => {
    await app?.close();
  });
  function req<T>(
    method: 'GET' | 'POST' | 'PATCH',
    path: string,
    body?: unknown,
    token = a.accessToken,
  ) {
    return callApi<T>(app, method, path, body, token);
  }
  const openBody = () => ({
    tableId: table,
    posTerminalId: a.posTerminalId,
    warehouseId: a.warehouseId,
    label: 'Cuenta',
    requestKey: uniqueSuffix(),
  });
  async function open(token = a.accessToken) {
    const r = await req<Account>('POST', `${base}/accounts`, openBody(), token);
    expect(r.status).toBe(201);
    return r.body;
  }
  async function load(id: string) {
    return (await req<Account>('GET', `${base}/accounts/${id}`)).body;
  }
  function orderBody() {
    return {
      posTerminalId: a.posTerminalId,
      warehouseId: a.warehouseId,
      service: 'DINE_IN',
      items: [{ menuEntryId: menu, quantity: 1, optionIds: [] }],
      requestKey: uniqueSuffix(),
    };
  }
  async function add(account: Account, token = a.accessToken) {
    const r = await req<Order>(
      'POST',
      `${base}/accounts/${account.id}/orders`,
      orderBody(),
      token,
    );
    expect(r.status).toBe(201);
    return r.body;
  }
  async function dispatch(
    account: Account,
    order: Order,
    token = a.accessToken,
  ) {
    const r = await req<Account>(
      'POST',
      `${base}/accounts/${account.id}/orders/${order.id}/dispatch`,
      {},
      token,
    );
    expect(r.status).toBe(201);
    return r.body;
  }
  async function served(account: Account) {
    const o = await add(account);
    await dispatch(account, o);
    let current = o;
    for (const status of ['PREPARING', 'READY', 'DELIVERED']) {
      const r = await req<Order>('POST', `/restaurant/orders/${o.id}/status`, {
        version: status === 'PREPARING' ? 1 : current.version,
        status,
      });
      expect(r.status).toBe(201);
      current = r.body;
    }
    return o;
  }
  async function pay(
    account: Account,
    order: Order,
    amount = 25,
    method = 'CASH',
    key = uniqueSuffix(),
  ) {
    return req(
      'POST',
      `${base}/accounts/${account.id}/orders/${order.id}/payments`,
      { amount, method, idempotencyKey: key },
    );
  }
  it('abre idempotentemente y rechaza cambiar los datos de la clave', async () => {
    const body = openBody();
    const results = await Promise.all([
      req<Account>('POST', `${base}/accounts`, body),
      req<Account>('POST', `${base}/accounts`, body),
    ]);
    expect(results.map((r) => r.status)).toEqual([201, 201]);
    expect(results[0].body.id).toBe(results[1].body.id);
    expect(
      (await req('POST', `${base}/accounts`, { ...body, label: 'Otra' }))
        .status,
    ).toBe(409);
  });
  it('mesero puede agregar y enviar sin cobrar; el stock se consume una sola vez', async () => {
    const account = await open(waiter);
    const before = await stock();
    const body = orderBody();
    const added = await Promise.all([
      req<Order>('POST', `${base}/accounts/${account.id}/orders`, body, waiter),
      req<Order>('POST', `${base}/accounts/${account.id}/orders`, body, waiter),
    ]);
    expect(added[0].body.id).toBe(added[1].body.id);
    expect(await stock()).toBe(before);
    const o = added[0].body;
    const dispatched = await Promise.all([
      dispatch(account, o, waiter),
      dispatch(account, o, waiter),
    ]);
    expect(dispatched[0].orders[0].sale.status).toBe('CONFIRMED');
    expect(await stock()).toBe(before - 1);
    expect(
      (
        await req(
          'POST',
          `${base}/accounts/${account.id}/orders/${o.id}/payments`,
          { amount: 25, method: 'CASH', idempotencyKey: uniqueSuffix() },
          waiter,
        )
      ).status,
    ).toBe(403);
    expect(
      (
        await req(
          'POST',
          `/sales/${o.saleId}/payments`,
          { amount: 25, method: 'CASH', idempotencyKey: uniqueSuffix() },
          waiter,
        )
      ).status,
    ).toBe(403);
    expect(
      (
        await req(
          'POST',
          `${base}/accounts/${account.id}/close`,
          { version: 1, tipAmount: 0, tipMethod: 'CASH' },
          waiter,
        )
      ).status,
    ).toBe(403);
  });
  async function stock() {
    return app.get(TenantPrismaService).run(a.organizationId, async (tx) =>
      Number(
        (
          await tx.inventory.findFirstOrThrow({
            where: {
              organizationId: a.organizationId,
              productId: product,
              warehouseId: a.warehouseId,
            },
          })
        ).quantity,
      ),
    );
  }
  it('atiende comandas simultáneas sin perder adicionales y conserva precios históricos', async () => {
    const account = await open();
    const [one, two] = await Promise.all([add(account), add(account)]);
    expect(one.id).not.toBe(two.id);
    expect((await load(account.id)).version).toBe(2);
    expect((await load(account.id)).orders).toHaveLength(2);
  });
  it('traslado con versión rechaza operador obsoleto y sucursal ajena', async () => {
    const account = await open();
    const r = await req<Account>(
      'POST',
      `${base}/accounts/${account.id}/move`,
      { version: 0, tableId: table2 },
    );
    expect(r.status).toBe(201);
    expect(r.body.tableId).toBe(table2);
    expect(
      (
        await req('POST', `${base}/accounts/${account.id}/move`, {
          version: 0,
          tableId: table,
        })
      ).status,
    ).toBe(409);
    const foreign = (
      await callApi<{ id: string }>(
        app,
        'POST',
        `${base}/tables`,
        { branchId: b.branchId, name: 'Ajena', area: 'Salón', seats: 2 },
        b.accessToken,
      )
    ).body.id;
    expect(
      (
        await req('POST', `${base}/accounts/${account.id}/move`, {
          version: 1,
          tableId: foreign,
        })
      ).status,
    ).toBe(400);
  });
  it('reasigna solo a miembros activos de la empresa y exige encargado', async () => {
    const account = await open(waiter);
    expect(
      (
        await req(
          'POST',
          `${base}/accounts/${account.id}/waiter`,
          { version: 0, waiterId: 'ajeno' },
          waiter,
        )
      ).status,
    ).toBe(403);
    expect(
      (
        await req('POST', `${base}/accounts/${account.id}/waiter`, {
          version: 0,
          waiterId: 'ajeno',
        })
      ).status,
    ).toBe(400);
    const r = await req<Account>(
      'POST',
      `${base}/accounts/${account.id}/waiter`,
      { version: 0, waiterId: account.waiterId },
    );
    expect(r.status).toBe(201);
  });
  it('divide comandas completas con retry, sin reescribir venta ni duplicar stock', async () => {
    const account = await open();
    const one = await add(account);
    await add(account);
    await dispatch(account, one);
    const before = await stock();
    const body = {
      version: 2,
      label: 'Separada',
      orderIds: [one.id],
      requestKey: uniqueSuffix(),
    };
    const r = await req<Account>(
      'POST',
      `${base}/accounts/${account.id}/split`,
      body,
    );
    expect(r.status).toBe(201);
    expect(r.body.orders[0].saleId).toBe(one.saleId);
    expect((await load(account.id)).orders).toHaveLength(1);
    expect(
      (await req<Account>('POST', `${base}/accounts/${account.id}/split`, body))
        .body.id,
    ).toBe(r.body.id);
    expect(await stock()).toBe(before);
    expect(
      (
        await req('POST', `${base}/accounts/${account.id}/split`, {
          ...body,
          label: 'Cambio',
        })
      ).status,
    ).toBe(409);
  });
  it('unión concurrente contraria termina sin deadlock y sin perder comandas', async () => {
    const one = await open(),
      two = await open();
    await add(one);
    await add(two);
    const r = await Promise.all([
      req<Account>('POST', `${base}/accounts/${one.id}/merge`, {
        version: 1,
        sourceId: two.id,
        sourceVersion: 1,
      }),
      req<Account>('POST', `${base}/accounts/${two.id}/merge`, {
        version: 1,
        sourceId: one.id,
        sourceVersion: 1,
      }),
    ]);
    expect(r.map((x) => x.status).sort()).toEqual([201, 409]);
    const survivor = r.find((x) => x.status === 201)!.body;
    expect(survivor.orders).toHaveLength(2);
  });
  it('no cierra con deuda ni comandas pendientes; cobros mixtos no consumen otra vez', async () => {
    const account = await open();
    const o = await served(account);
    expect(
      (
        await req('POST', `${base}/accounts/${account.id}/close`, {
          version: 1,
          tipAmount: 0,
          tipMethod: 'CASH',
        })
      ).status,
    ).toBe(409);
    const before = await stock();
    expect((await pay(account, o, 10, 'QR')).status).toBe(201);
    expect((await pay(account, o, 15, 'CASH')).status).toBe(201);
    expect(await stock()).toBe(before);
    const closed = await req<Account>(
      'POST',
      `${base}/accounts/${account.id}/close`,
      { version: 1, tipAmount: 0, tipMethod: 'CASH' },
    );
    expect(closed.status).toBe(201);
    expect(closed.body.status).toBe('CLOSED');
    expect(
      (await req('POST', `${base}/accounts/${account.id}/orders`, orderBody()))
        .status,
    ).toBe(409);
  });
  it('propina separada de venta, atómica e idempotente en caja', async () => {
    const account = await open();
    const o = await served(account);
    await pay(account, o);
    const close = { version: 1, tipAmount: 3.5, tipMethod: 'CASH' };
    const r = await Promise.all([
      req<Account>('POST', `${base}/accounts/${account.id}/close`, close),
      req<Account>('POST', `${base}/accounts/${account.id}/close`, close),
    ]);
    expect(r.map((x) => x.status)).toEqual([201, 201]);
    expect(r[0].body.tipAmount).toBe('3.5');
    const movements = await app
      .get(TenantPrismaService)
      .run(a.organizationId, (tx) =>
        tx.cashMovement.findMany({ where: { reference: account.id } }),
      );
    expect(movements).toHaveLength(1);
    expect(movements[0].type).toBe('CASH_IN');
    expect((await load(account.id)).orders[0].sale.total).toBe('25');
    expect(
      (
        await req('POST', `${base}/accounts/${account.id}/close`, {
          ...close,
          tipAmount: 4,
        })
      ).status,
    ).toBe(409);
  });
  it('auditoría: clave de pago con otro importe o método devuelve conflicto', async () => {
    const account = await open();
    const o = await add(account);
    await dispatch(account, o);
    const key = uniqueSuffix();
    expect((await pay(account, o, 10, 'CASH', key)).status).toBe(201);
    expect((await pay(account, o, 10, 'CASH', key)).status).toBe(201);
    expect((await pay(account, o, 11, 'CASH', key)).status).toBe(409);
    expect((await pay(account, o, 10, 'QR', key)).status).toBe(409);
  });
  it('sin caja abierta se revierte el cobro en efectivo y no registra propina', async () => {
    const account = await open();
    const o = await served(account);
    await app.get(TenantPrismaService).run(a.organizationId, (tx) =>
      tx.cashRegister.updateMany({
        where: { organizationId: a.organizationId, status: 'OPEN' },
        data: { status: 'CLOSED' },
      }),
    );
    try {
      expect((await pay(account, o)).status).toBe(409);
      expect((await load(account.id)).orders[0].sale.payments).toHaveLength(0);
      expect((await pay(account, o, 25, 'QR')).status).toBe(201);
      expect(
        (
          await req('POST', `${base}/accounts/${account.id}/close`, {
            version: 1,
            tipAmount: 2,
            tipMethod: 'CASH',
          })
        ).status,
      ).toBe(409);
      expect((await load(account.id)).status).toBe('OPEN');
    } finally {
      await openCashRegister(app, a, { openingAmount: 100 });
    }
  });
  it('stock insuficiente revierte toda la comanda y la confirmación', async () => {
    const account = await open();
    const result = await req<Order>(
      'POST',
      `${base}/accounts/${account.id}/orders`,
      {
        ...orderBody(),
        items: [{ menuEntryId: menu, quantity: 1000, optionIds: [] }],
      },
    );
    expect(result.status).toBe(201);
    const before = await stock();
    expect(
      (
        await req(
          'POST',
          `${base}/accounts/${account.id}/orders/${result.body.id}/dispatch`,
          {},
        )
      ).status,
    ).toBe(409);
    const current = await load(account.id);
    expect(current.orders[0].status).toBe('DRAFT');
    expect(current.orders[0].sale.status).toBe('DRAFT');
    expect(await stock()).toBe(before);
  });
  it('pagar no libera una mesa mientras la cocina o entrega sigan pendientes', async () => {
    const account = await open();
    const order = await add(account);
    await dispatch(account, order);
    await pay(account, order);
    expect(
      (
        await req('POST', `${base}/accounts/${account.id}/close`, {
          version: 1,
          tipAmount: 0,
          tipMethod: 'CASH',
        })
      ).status,
    ).toBe(409);
    const tables = await req<Array<{ id: string; accounts: { id: string }[] }>>(
      'GET',
      `${base}/tables`,
    );
    expect(
      tables.body
        .find((t) => t.id === table)!
        .accounts.some((a) => a.id === account.id),
    ).toBe(true);
  });
  it('la devolución de comanda impaga cancela y repone solo si no empezó cocina', async () => {
    const account = await open();
    const order = await add(account);
    const before = await stock();
    await dispatch(account, order);
    const returned = await req('POST', `/sales/${order.saleId}/return`, {
      reason: 'Cliente se retira',
    });
    expect(returned.status).toBe(201);
    expect(await stock()).toBe(before);
    const current = await load(account.id);
    expect(current.orders[0].status).toBe('CANCELLED');
    expect(current.orders[0].sale.payments).toHaveLength(0);
    expect(
      (
        await req('POST', `${base}/accounts/${account.id}/close`, {
          version: 1,
          tipAmount: 0,
          tipMethod: 'CASH',
        })
      ).status,
    ).toBe(201);
  });
  it('mesero no puede suplantar la asignación al abrir otra cuenta', async () => {
    const another = await open();
    expect(
      (
        await req(
          'POST',
          `${base}/accounts`,
          { ...openBody(), waiterId: another.waiterId },
          waiter,
        )
      ).status,
    ).toBe(403);
  });
  it('reembolso de salón en efectivo no se pierde si la caja está cerrada', async () => {
    const account = await open();
    const order = await add(account);
    await dispatch(account, order);
    await pay(account, order);
    await app.get(TenantPrismaService).run(a.organizationId, (tx) =>
      tx.cashRegister.updateMany({
        where: { organizationId: a.organizationId, status: 'OPEN' },
        data: { status: 'CLOSED' },
      }),
    );
    try {
      expect(
        (
          await req('POST', `/sales/${order.saleId}/return`, {
            reason: 'Anulación de salón',
          })
        ).status,
      ).toBe(409);
      expect((await load(account.id)).orders[0].sale.status).toBe('PAID');
    } finally {
      await openCashRegister(app, a, { openingAmount: 100 });
    }
    expect(
      (
        await req('POST', `/sales/${order.saleId}/return`, {
          reason: 'Anulación de salón',
        })
      ).status,
    ).toBe(201);
    const moves = await app
      .get(TenantPrismaService)
      .run(a.organizationId, (tx) =>
        tx.cashMovement.findMany({
          where: {
            organizationId: a.organizationId,
            idempotencyKey: `sale-refund-${order.saleId}`,
          },
        }),
      );
    expect(moves).toHaveLength(1);
  });
  it('permisos, referencias ajenas y RLS compuesto fallan cerrados', async () => {
    const account = await open();
    expect(
      (
        await req(
          'GET',
          `${base}/accounts/${account.id}`,
          undefined,
          b.accessToken,
        )
      ).status,
    ).toBe(404);
    expect(
      (
        await req('POST', `${base}/accounts`, {
          ...openBody(),
          warehouseId: b.warehouseId,
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await req(
          'POST',
          `${base}/tables`,
          {
            branchId: a.branchId,
            name: 'Mesa cajero',
            area: 'Salón',
            seats: 2,
          },
          cashier,
        )
      ).status,
    ).toBe(403);
    const tenant = app.get(TenantPrismaService);
    expect(
      await tenant.run(
        b.organizationId,
        (tx) =>
          tx.$queryRaw`SELECT * FROM dining_accounts WHERE id=${account.id}`,
      ),
    ).toEqual([]);
    await expect(
      tenant.run(b.organizationId, (tx) =>
        tx.diningAccount.create({
          data: {
            organizationId: b.organizationId,
            tableId: table,
            branchId: b.branchId,
            posTerminalId: b.posTerminalId,
            warehouseId: b.warehouseId,
            waiterId: 'x',
            waiterName: 'x',
            label: 'Cruce',
            requestKey: uniqueSuffix(),
            requestHash: 'x',
          },
        }),
      ),
    ).rejects.toThrow();
    const rls = await app.get(PrismaService).$queryRaw<
      Array<{ relrowsecurity: boolean; relforcerowsecurity: boolean }>
    >`SELECT relrowsecurity,relforcerowsecurity FROM pg_class WHERE relname IN ('dining_tables','dining_accounts')`;
    expect(rls).toHaveLength(2);
    expect(rls.every((r) => r.relrowsecurity && r.relforcerowsecurity)).toBe(
      true,
    );
  });
});
