import { INestApplication } from '@nestjs/common';
import {
  bootTestApp,
  callApi,
  registerTestOrg,
  createProductWithStock,
  createUserWithRole,
  openCashRegister,
  TestTenant,
  uniqueSuffix,
} from '../test-support/integration-app';
import { TenantPrismaService } from '../prisma/tenant-prisma.service';
import { PrismaService } from '../prisma/prisma.service';
interface Lot {
  id: string;
  productId: string;
  code: string;
  quantity: string;
  expiresOn: string | null;
  blocked: boolean;
}
interface Control {
  lots: Lot[];
  stocks: {
    productId: string;
    quantity: string;
    availableQuantity: string;
    untrackedQuantity: string;
  }[];
}
interface Recipe {
  id: string;
  revision: number;
  versions: {
    id: string;
    revision: number;
    theoreticalCost: string;
    ingredients: { baseQuantity: string }[];
  }[];
}
interface Run {
  id: string;
  status: string;
  version: number;
  theoreticalCost: string;
  actualCost: string;
  producedQuantity: string;
  costPerUnit: string;
  versionId: string;
}
interface Order {
  id: string;
  saleId: string;
  status: string;
  version: number;
}
const past = '2020-01-01',
  future = '2099-01-01',
  sooner = '2098-01-01';
describe('Recetas, lotes y control de stock — DB real', () => {
  let app: INestApplication,
    a: TestTenant,
    b: TestTenant,
    cashier: string,
    raw: string,
    output: string,
    second: string,
    menu: string;
  beforeAll(async () => {
    app = await bootTestApp();
    a = await registerTestOrg(app, 'Recetas');
    b = await registerTestOrg(app, 'Ajena');
    cashier = await createUserWithRole(app, a.organizationId, 'CASHIER');
    await openCashRegister(app, a, { openingAmount: 100 });
    raw = (
      await createProductWithStock(app, a, {
        name: 'Ingrediente',
        price: 20,
        cost: 10,
        quantity: 100,
      })
    ).productId;
    second = (
      await createProductWithStock(app, a, {
        name: 'Segundo ingrediente',
        price: 5,
        cost: 2,
        quantity: 100,
      })
    ).productId;
    await req('PATCH', `/products/${raw}`, { cost: 10 });
    await req('PATCH', `/products/${second}`, { cost: 2 });
    output = await isolated('Preparado');
    menu = (
      await req<{ id: string }>('POST', '/restaurant/menu', {
        productId: output,
        name: 'Plato preparado',
        category: 'Platos',
        station: 'Cocina',
        price: 25,
        active: true,
        components: [{ productId: output, quantity: 1 }],
        options: [],
      })
    ).body.id;
  }, 60000);
  afterAll(async () => {
    await app?.close();
  });
  function req<T>(
    method: 'POST' | 'PATCH' | 'GET',
    path: string,
    data?: unknown,
    token = a.accessToken,
  ) {
    return callApi<T>(app, method, path, data, token);
  }
  async function control() {
    return (
      await req<Control>(
        'GET',
        `/inventory/control?warehouseId=${a.warehouseId}`,
      )
    ).body;
  }
  async function operation(
    productId: string,
    kind: string,
    quantity: number,
    extra: Record<string, unknown> = {},
  ) {
    return req<{ id: string }>('POST', '/inventory/control', {
      warehouseId: a.warehouseId,
      productId,
      kind,
      quantity,
      reason: 'Validación etapa 6',
      requestKey: uniqueSuffix(),
      ...extra,
    });
  }
  const recipeBody = () => ({
    name: 'Receta piloto',
    station: 'Cocina',
    outputProductId: output,
    yieldQuantity: 4,
    ingredients: [
      { productId: raw, quantity: 1000, inputUnit: 'g', toBaseFactor: 0.001 },
      { productId: second, quantity: 1, inputUnit: 'u', toBaseFactor: 1 },
    ],
    requestKey: uniqueSuffix(),
  });
  async function recipe() {
    const r = await req<Recipe>('POST', '/restaurant/recipes', recipeBody());
    expect(r.status).toBe(201);
    return r.body;
  }
  async function plan(versionId: string, plannedQuantity = 4) {
    const r = await req<Run>('POST', '/restaurant/recipes/runs', {
      versionId,
      plannedQuantity,
      warehouseId: a.warehouseId,
      requestKey: uniqueSuffix(),
    });
    expect(r.status).toBe(201);
    return r.body;
  }
  async function action(
    run: Run,
    status: string,
    extra: Record<string, unknown> = {},
  ) {
    return req<Run>('POST', `/restaurant/recipes/runs/${run.id}/status`, {
      status,
      version: run.version,
      ...extra,
    });
  }
  async function isolated(name: string, quantity = 0) {
    if (quantity > 0)
      return (
        await createProductWithStock(app, a, { name, price: 5, quantity })
      ).productId;
    const r = await req<{ id: string }>('POST', '/products', {
      name,
      price: 25,
      cost: 10,
    });
    expect(r.status).toBe(201);
    return r.body.id;
  }
  async function draft() {
    const r = await req<Order>('POST', '/restaurant/orders', {
      posTerminalId: a.posTerminalId,
      warehouseId: a.warehouseId,
      service: 'TAKEAWAY',
      requestKey: uniqueSuffix(),
      items: [{ menuEntryId: menu, quantity: 1, optionIds: [] }],
    });
    expect(r.status).toBe(201);
    return r.body;
  }
  async function paid(o: Order) {
    return req<Order>('POST', `/restaurant/orders/${o.id}/checkout`, {
      payments: [
        { method: 'CASH', amount: 25, idempotencyKey: uniqueSuffix() },
      ],
    });
  }
  it('conversión explícita y publicación idempotente mantienen una versión', async () => {
    const body = recipeBody();
    const [one, two] = await Promise.all([
      req<Recipe>('POST', '/restaurant/recipes', body),
      req<Recipe>('POST', '/restaurant/recipes', body),
    ]);
    expect(one.status).toBe(201);
    expect(two.body.id).toBe(one.body.id);
    expect(one.body.versions[0].ingredients[0].baseQuantity).toBe('1.00');
    expect(Number(one.body.versions[0].theoreticalCost)).toBe(12);
    expect(
      (await req('POST', '/restaurant/recipes', { ...body, yieldQuantity: 5 }))
        .status,
    ).toBe(409);
  });
  it('versiones nuevas no reescriben una producción ya planificada', async () => {
    const r = await recipe();
    const run = await plan(r.versions[0].id);
    const changed = await req<Recipe>('PATCH', `/restaurant/recipes/${r.id}`, {
      ...recipeBody(),
      expectedRevision: 1,
      yieldQuantity: 5,
    });
    expect(changed.status).toBe(200);
    expect(changed.body.revision).toBe(2);
    expect(
      (
        await req('POST', '/restaurant/recipes/runs', {
          versionId: r.versions[0].id,
          plannedQuantity: 4,
          warehouseId: a.warehouseId,
          requestKey: uniqueSuffix(),
        })
      ).status,
    ).toBe(409);
    expect((await action(run, 'PREPARING')).status).toBe(201);
    expect(
      (
        await req('PATCH', `/restaurant/recipes/${r.id}`, {
          ...recipeBody(),
          expectedRevision: 1,
        })
      ).status,
    ).toBe(409);
  });
  it('rechaza conversión con pérdida de precisión, ingrediente repetido y autorreferencia', async () => {
    const body = recipeBody();
    expect(
      (
        await req('POST', '/restaurant/recipes', {
          ...body,
          ingredients: [
            {
              productId: raw,
              quantity: 1,
              inputUnit: 'g',
              toBaseFactor: 0.001,
            },
          ],
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await req('POST', '/restaurant/recipes', {
          ...body,
          ingredients: [body.ingredients[0], body.ingredients[0]],
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await req('POST', '/restaurant/recipes', {
          ...body,
          outputProductId: raw,
        })
      ).status,
    ).toBe(400);
  });
  it('no reserva al planificar, consume una vez al iniciar y produce el rendimiento real', async () => {
    const r = await recipe();
    const before = await control();
    const run = await plan(r.versions[0].id);
    expect(
      (await control()).stocks.find((s) => s.productId === raw)?.quantity,
    ).toBe(before.stocks.find((s) => s.productId === raw)?.quantity);
    const start = {
      actualInputs: [
        { productId: raw, quantity: 1.2 },
        { productId: second, quantity: 1 },
      ],
    };
    const started = await Promise.all([
      action(run, 'PREPARING', start),
      action(run, 'PREPARING', start),
    ]);
    expect(started.map((r) => r.status)).toEqual([201, 201]);
    expect(Number(started[0].body.actualCost)).toBe(14);
    expect(
      (
        await action(run, 'PREPARING', {
          actualInputs: [
            { productId: raw, quantity: 1.3 },
            { productId: second, quantity: 1 },
          ],
        })
      ).status,
    ).toBe(409);
    const complete = {
      producedQuantity: 3.5,
      lotCode: 'RECETA-' + uniqueSuffix(),
      expiresOn: future,
    };
    const ready = await Promise.all([
      action(started[0].body, 'READY', complete),
      action(started[0].body, 'READY', complete),
    ]);
    expect(ready.map((r) => r.status)).toEqual([201, 201]);
    expect(Number(ready[0].body.costPerUnit)).toBe(4);
    expect(
      (
        await action(started[0].body, 'READY', {
          ...complete,
          lotCode: 'DIFERENTE',
        })
      ).status,
    ).toBe(409);
  });
  it('falta de un ingrediente revierte todos los consumos y el estado', async () => {
    const r = await recipe();
    const run = await plan(r.versions[0].id);
    const before = await control();
    expect(
      (
        await action(run, 'PREPARING', {
          actualInputs: [
            { productId: raw, quantity: 1 },
            { productId: second, quantity: 10000 },
          ],
        })
      ).status,
    ).toBe(409);
    const after = await control();
    expect(after.stocks.find((s) => s.productId === raw)?.quantity).toBe(
      before.stocks.find((s) => s.productId === raw)?.quantity,
    );
    const runs = await req<Run[]>('GET', '/restaurant/recipes/runs');
    expect(runs.body.find((x) => x.id === run.id)?.status).toBe('DRAFT');
  });
  it('cancelación iniciada conserva consumo y exige motivo; preparada no se cancela', async () => {
    const r = await recipe();
    const run = await plan(r.versions[0].id);
    const started = await action(run, 'PREPARING');
    const before = await control();
    expect((await action(started.body, 'CANCELLED')).status).toBe(400);
    expect(
      (
        await action(started.body, 'CANCELLED', {
          reason: 'Accidente en cocina',
        })
      ).status,
    ).toBe(201);
    expect(
      (await control()).stocks.find((s) => s.productId === raw)?.quantity,
    ).toBe(before.stocks.find((s) => s.productId === raw)?.quantity);
  });
  it('clasifica existencia sin aumentar saldo y exige cubrirla antes de activar lotes', async () => {
    const p = await isolated('Clasificar', 5);
    expect(
      (
        await req('POST', `/inventory/control/products/${p}/tracking`, {
          required: true,
        })
      ).status,
    ).toBe(409);
    expect(
      (await operation(p, 'CLASSIFY', 6, { lotCode: 'MAYOR' })).status,
    ).toBe(409);
    expect(
      (
        await operation(p, 'CLASSIFY', 5, {
          lotCode: 'INICIAL',
          expiresOn: future,
        })
      ).status,
    ).toBe(201);
    expect(
      (await control()).stocks.find((s) => s.productId === p)?.quantity,
    ).toBe('5');
    expect(
      (
        await req('POST', `/inventory/control/products/${p}/tracking`, {
          required: true,
        })
      ).status,
    ).toBe(201);
    expect(
      (
        await req('POST', '/inventory/movements', {
          productId: p,
          warehouseId: a.warehouseId,
          type: 'IN',
          quantity: 1,
          idempotencyKey: uniqueSuffix(),
        })
      ).status,
    ).toBe(400);
  });
  it('FEFO excluye vencidos y bloqueados y consume el lote de vencimiento más próximo', async () => {
    const p = await isolated('FEFO');
    for (const [code, expiresOn] of [
      ['VENCIDO', past],
      ['TARDE', future],
      ['PRONTO', sooner],
    ])
      expect(
        (await operation(p, 'RECEIPT', 2, { lotCode: code, expiresOn })).status,
      ).toBe(201);
    const out = await req('POST', '/inventory/movements', {
      warehouseId: a.warehouseId,
      productId: p,
      type: 'OUT',
      quantity: 1,
      idempotencyKey: uniqueSuffix(),
    });
    expect(out.status).toBe(201);
    const d = await control();
    expect(
      d.lots.find((l) => l.productId === p && l.code === 'PRONTO')?.quantity,
    ).toBe('1');
    expect(d.stocks.find((s) => s.productId === p)?.availableQuantity).toBe(
      '3',
    );
    expect(
      (
        await req('POST', '/inventory/movements', {
          warehouseId: a.warehouseId,
          productId: p,
          type: 'OUT',
          quantity: 4,
          idempotencyKey: uniqueSuffix(),
        })
      ).status,
    ).toBe(409);
  });
  it('menú y revisión previa muestran existencia utilizable, no la vencida', async () => {
    await operation(output, 'RECEIPT', 10, {
      lotCode: 'VENCIDO-SALIDA',
      expiresOn: past,
    });
    const menuResponse = await req<{ id: string; available: number }[]>(
      'GET',
      `/restaurant/menu?warehouseId=${a.warehouseId}`,
    );
    const usable = (await control()).stocks.find(
      (s) => s.productId === output,
    )!;
    expect(menuResponse.body.find((m) => m.id === menu)?.available).toBe(
      Math.floor(Number(usable.availableQuantity)),
    );
    const quote = await req<{ canFulfill: boolean }>(
      'POST',
      '/restaurant/quote',
      {
        posTerminalId: a.posTerminalId,
        warehouseId: a.warehouseId,
        service: 'TAKEAWAY',
        items: [{ menuEntryId: menu, quantity: 100, optionIds: [] }],
      },
    );
    expect(quote.body.canFulfill).toBe(false);
  });
  it('devolución sin preparar restaura el lote original y preserva vencimiento', async () => {
    const before = await control();
    const o = await draft();
    expect((await paid(o)).status).toBe(201);
    expect(
      (
        await req('POST', `/sales/${o.saleId}/return`, {
          reason: 'No preparado',
        })
      ).status,
    ).toBe(201);
    const after = await control();
    expect(
      after.lots
        .filter((l) => l.productId === output)
        .map((l) => [l.id, l.quantity, l.expiresOn]),
    ).toEqual(
      before.lots
        .filter((l) => l.productId === output)
        .map((l) => [l.id, l.quantity, l.expiresOn]),
    );
  });
  it('devolución de preparación iniciada no restaura lote preparado', async () => {
    const o = await draft();
    const p = await paid(o);
    expect(p.status).toBe(201);
    expect(
      (
        await req('POST', `/restaurant/orders/${o.id}/status`, {
          version: p.body.version,
          status: 'PREPARING',
        })
      ).status,
    ).toBe(201);
    const before = await control();
    await req('POST', `/sales/${o.saleId}/return`, { reason: 'Ya preparado' });
    expect(
      (await control()).stocks.find((s) => s.productId === output)?.quantity,
    ).toBe(before.stocks.find((s) => s.productId === output)?.quantity);
  });
  it('consumo de personal rechaza vencido; merma retira con motivo y reintento único', async () => {
    const p = await isolated('Merma');
    await operation(p, 'RECEIPT', 3, { lotCode: 'CADUCO', expiresOn: past });
    const lot = (await control()).lots.find((l) => l.productId === p)!;
    expect((await operation(p, 'STAFF', 1, { lotId: lot.id })).status).toBe(
      409,
    );
    const body = {
      warehouseId: a.warehouseId,
      productId: p,
      kind: 'WASTE',
      quantity: 1,
      lotId: lot.id,
      reason: 'Vencimiento',
      requestKey: uniqueSuffix(),
    };
    const [one, two] = await Promise.all([
      req('POST', '/inventory/control', body),
      req('POST', '/inventory/control', body),
    ]);
    expect([one.status, two.status]).toEqual([201, 201]);
    expect((await control()).lots.find((l) => l.id === lot.id)?.quantity).toBe(
      '2',
    );
    const history = await req<{
      operations: { snapshot: { productName: string; delta: string } }[];
    }>('GET', `/inventory/control?warehouseId=${a.warehouseId}`);
    expect(
      history.body.operations.find((o) => o.snapshot.productName === 'Merma')!
        .snapshot.delta,
    ).toBe('-1.00');
    expect(
      (await req('POST', '/inventory/control', { ...body, quantity: 2 }))
        .status,
    ).toBe(409);
  });
  it('conteo requiere saldo esperado y conserva conciliación entre lote y almacén', async () => {
    const p = await isolated('Conteo');
    await operation(p, 'RECEIPT', 5, { lotCode: 'CONTEO', expiresOn: future });
    const lot = (await control()).lots.find((l) => l.productId === p)!;
    expect(
      (await operation(p, 'COUNT', 4, { lotId: lot.id, expectedQuantity: 3 }))
        .status,
    ).toBe(409);
    expect(
      (await operation(p, 'COUNT', 4, { lotId: lot.id, expectedQuantity: 5 }))
        .status,
    ).toBe(201);
    expect(
      (await control()).stocks.find((s) => s.productId === p)?.quantity,
    ).toBe('4');
    expect(
      (await operation(p, 'COUNT', 0, { expectedQuantity: 4 })).status,
    ).toBe(400);
    expect(
      (await operation(p, 'COUNT', 0, { lotId: lot.id, expectedQuantity: 4 }))
        .status,
    ).toBe(201);
  });
  it('dos conteos concurrentes sobre el mismo saldo no se pisan', async () => {
    const p = await isolated('Cuenta concurrente', 5);
    const r = await Promise.all([
      operation(p, 'COUNT', 4, { expectedQuantity: 5 }),
      operation(p, 'COUNT', 3, { expectedQuantity: 5 }),
    ]);
    expect(r.map((x) => x.status).sort()).toEqual([201, 409]);
  });
  it('transferencia conserva códigos, cantidades y fechas, incluso vencidos', async () => {
    const p = await isolated('Traslado lotes');
    await operation(p, 'RECEIPT', 3, { lotCode: 'TRASLADO', expiresOn: past });
    const w = await req<{ id: string }>('POST', '/warehouses', {
      branchId: a.branchId,
      name: 'Destino ' + uniqueSuffix(),
    });
    expect(w.status).toBe(201);
    const res = await req('POST', '/inventory/transfers', {
      productId: p,
      fromWarehouseId: a.warehouseId,
      toWarehouseId: w.body.id,
      quantity: 2,
      idempotencyKey: uniqueSuffix(),
    });
    expect(res.status).toBe(201);
    const dest = await req<Control>(
      'GET',
      `/inventory/control?warehouseId=${w.body.id}`,
    );
    expect(dest.body.lots[0].code).toBe('TRASLADO');
    expect(dest.body.lots[0].expiresOn?.slice(0, 10)).toBe(past);
    expect(dest.body.stocks[0].availableQuantity).toBe('0');
  });
  it('recepción de compra conserva lote y rechaza cambio de datos al reintentar', async () => {
    const p = await isolated('Compra lote');
    const supplier = await req<{ id: string }>('POST', '/suppliers', {
      name: 'Proveedor lotes',
    });
    const purchase = await req<{ id: string; items: { id: string }[] }>(
      'POST',
      '/purchases',
      {
        supplierId: supplier.body.id,
        warehouseId: a.warehouseId,
        items: [{ productId: p, quantity: 3, unitCost: 2 }],
      },
    );
    expect(purchase.status).toBe(201);
    await req('POST', `/purchases/${purchase.body.id}/confirm`, {});
    const body = {
      idempotencyKey: uniqueSuffix(),
      items: [
        {
          purchaseItemId: purchase.body.items[0].id,
          quantity: 3,
          lotCode: 'PROVEEDOR',
          expiresOn: future,
        },
      ],
    };
    const [one, two] = await Promise.all([
      req('POST', `/purchases/${purchase.body.id}/receive`, body),
      req('POST', `/purchases/${purchase.body.id}/receive`, body),
    ]);
    expect([one.status, two.status]).toEqual([201, 201]);
    expect(
      (
        await req('POST', `/purchases/${purchase.body.id}/receive`, {
          ...body,
          items: [{ ...body.items[0], lotCode: 'OTRO' }],
        })
      ).status,
    ).toBe(409);
    expect(
      (await control()).lots.find((l) => l.productId === p)?.quantity,
    ).toBe('3');
  });
  it('vencimiento inválido y cambio de fecha de lote fallan sin aumentar stock', async () => {
    const p = await isolated('Fechas');
    expect(
      (
        await operation(p, 'RECEIPT', 1, {
          lotCode: 'MAL',
          expiresOn: '2026-99-99',
        })
      ).status,
    ).toBe(400);
    expect(
      (await operation(p, 'RECEIPT', 1, { lotCode: 'FIJO', expiresOn: future }))
        .status,
    ).toBe(201);
    expect(
      (await operation(p, 'RECEIPT', 1, { lotCode: 'FIJO', expiresOn: past }))
        .status,
    ).toBe(409);
  });
  it('roles de caja no gestionan recetas ni lotes y referencias ajenas se rechazan', async () => {
    expect(
      (await req('POST', '/restaurant/recipes', recipeBody(), cashier)).status,
    ).toBe(403);
    expect(
      (
        await req(
          'POST',
          '/inventory/control',
          {
            warehouseId: a.warehouseId,
            productId: raw,
            kind: 'STAFF',
            quantity: 1,
            reason: 'Sin permiso',
            requestKey: uniqueSuffix(),
          },
          cashier,
        )
      ).status,
    ).toBe(403);
    expect(
      (await operation(raw, 'RECEIPT', 1, { warehouseId: b.warehouseId }))
        .status,
    ).toBe(400);
    const r = await recipe();
    expect(
      (
        await req(
          'POST',
          '/restaurant/recipes/runs',
          {
            versionId: r.versions[0].id,
            warehouseId: b.warehouseId,
            plannedQuantity: 1,
            requestKey: uniqueSuffix(),
          },
          b.accessToken,
        )
      ).status,
    ).toBe(400);
  });
  it('una devolución posterior al vencimiento no vuelve a habilitar el lote', async () => {
    const p = await isolated('Devolución vencida');
    await operation(p, 'RECEIPT', 1, { lotCode: 'ANTES', expiresOn: future });
    const m = await req<{ id: string }>('POST', '/restaurant/menu', {
      productId: p,
      name: 'Plato fecha',
      category: 'Platos',
      station: 'Cocina',
      price: 25,
      active: true,
      components: [{ productId: p, quantity: 1 }],
      options: [],
    });
    const o = await req<Order>('POST', '/restaurant/orders', {
      posTerminalId: a.posTerminalId,
      warehouseId: a.warehouseId,
      service: 'TAKEAWAY',
      requestKey: uniqueSuffix(),
      items: [{ menuEntryId: m.body.id, quantity: 1, optionIds: [] }],
    });
    expect((await paid(o.body)).status).toBe(201);
    // Simulates the date becoming expired after consumption; no public API changes dates.
    await app.get(TenantPrismaService).run(a.organizationId, (tx) =>
      tx.stockLot.updateMany({
        where: { organizationId: a.organizationId, productId: p },
        data: { expiresOn: new Date(past) },
      }),
    );
    expect(
      (
        await req('POST', `/sales/${o.body.saleId}/return`, {
          reason: 'Fecha posterior',
        })
      ).status,
    ).toBe(201);
    const balance = (await control()).stocks.find((s) => s.productId === p)!;
    expect(balance.quantity).toBe('1');
    expect(balance.availableQuantity).toBe('0');
  });
  it('la última porción con lote solo se cobra y consume una vez bajo carrera', async () => {
    const p = await isolated('Última porción con lote');
    await operation(p, 'RECEIPT', 1, { lotCode: 'ULTIMA', expiresOn: future });
    const m = await req<{ id: string }>('POST', '/restaurant/menu', {
      productId: p,
      name: 'Última con lote',
      category: 'Platos',
      station: 'Cocina',
      price: 25,
      active: true,
      components: [{ productId: p, quantity: 1 }],
      options: [],
    });
    const orders = await Promise.all(
      [1, 2].map(() =>
        req<Order>('POST', '/restaurant/orders', {
          posTerminalId: a.posTerminalId,
          warehouseId: a.warehouseId,
          service: 'TAKEAWAY',
          requestKey: uniqueSuffix(),
          items: [{ menuEntryId: m.body.id, quantity: 1, optionIds: [] }],
        }),
      ),
    );
    const results = await Promise.all(orders.map((o) => paid(o.body)));
    expect(results.map((r) => r.status).sort()).toEqual([201, 409]);
    expect(
      (await control()).lots.find((l) => l.productId === p)!.quantity,
    ).toBe('0');
  });
  it('la unidad base no se cambia con stock ni se reutiliza una unidad ajena', async () => {
    const unit = await req<{ id: string }>('POST', '/product-units', {
      name: 'Kilogramo',
      symbol: 'kg',
    });
    expect(
      (await req('PATCH', `/products/${raw}`, { unitId: unit.body.id })).status,
    ).toBe(409);
    expect(
      (await req('PATCH', `/product-units/${unit.body.id}`, { symbol: 'g' }))
        .status,
    ).toBe(409);
    expect(
      (
        await req(
          'POST',
          '/products',
          { name: 'Unidad ajena', price: 1, unitId: unit.body.id },
          b.accessToken,
        )
      ).status,
    ).toBe(400);
  });
  it('RLS forzado y claves compuestas impiden cruce por SQL sin WHERE', async () => {
    const lot = (await control()).lots[0];
    expect(
      (await req('GET', `/inventory/control/lots/${lot.id}/movements`)).status,
    ).toBe(200);
    expect(
      (
        await req(
          'GET',
          `/inventory/control/lots/${lot.id}/movements`,
          undefined,
          b.accessToken,
        )
      ).status,
    ).toBe(404);
    const r = await recipe();
    const tenant = app.get(TenantPrismaService);
    expect(
      await tenant.run(
        b.organizationId,
        (tx) =>
          tx.$queryRaw`SELECT * FROM recipe_versions WHERE id=${r.versions[0].id}`,
      ),
    ).toEqual([]);
    await expect(
      tenant.run(b.organizationId, (tx) =>
        tx.stockLot.create({
          data: {
            organizationId: b.organizationId,
            warehouseId: b.warehouseId,
            productId: raw,
            code: 'CRUCE',
            quantity: 1,
          },
        }),
      ),
    ).rejects.toThrow();
    const rows = await app.get(PrismaService).$queryRaw<
      Array<{ relrowsecurity: boolean; relforcerowsecurity: boolean }>
    >`SELECT relrowsecurity,relforcerowsecurity FROM pg_class WHERE relname IN ('stock_lots','lot_allocations','stock_operations','recipes','recipe_versions','recipe_runs')`;
    expect(rows).toHaveLength(6);
    expect(rows.every((r) => r.relrowsecurity && r.relforcerowsecurity)).toBe(
      true,
    );
  });
});
