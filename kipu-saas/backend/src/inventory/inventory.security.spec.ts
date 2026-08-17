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
  createUserWithRole,
  registerTestOrg,
  TestTenant,
  uniqueSuffix,
} from '../test-support/integration-app';
import { PrismaService } from '../prisma/prisma.service';
import { TenantPrismaService } from '../prisma/tenant-prisma.service';

describe('Inventario avanzado — tenant isolation, RLS y RBAC (integración, DB real)', () => {
  let app: INestApplication;
  let tenantA: TestTenant;
  let tenantB: TestTenant;

  beforeAll(async () => {
    app = await bootTestApp();
    tenantA = await registerTestOrg(app, 'Inventory-Security-A');
    tenantB = await registerTestOrg(app, 'Inventory-Security-B');
  }, 30000);

  afterAll(async () => {
    await app.close();
  }, 15000);

  async function moveAs(
    tenant: TestTenant,
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

  it('13) Tenant B nunca ve el stock, el kardex ni los movimientos de Tenant A, aunque conozca los ids', async () => {
    const { productId } = await createTestProduct(app, tenantA, {
      name: 'Aislado A',
    });
    const created = await moveAs(tenantA, {
      warehouseId: tenantA.warehouseId,
      productId,
      type: 'IN',
      quantity: 10,
      idempotencyKey: `aislado-carga-${uniqueSuffix()}`,
    });
    expect(created.status).toBe(201);

    const stockAsB = await callApi<ApiInventoryRow[]>(
      app,
      'GET',
      `/inventory?warehouseId=${tenantA.warehouseId}&productId=${productId}`,
      undefined,
      tenantB.accessToken,
    );
    expect(stockAsB.status).toBe(200);
    expect(stockAsB.body).toHaveLength(0); // RLS: B no ve NADA de A, ni con el id exacto

    const movementsAsB = await callApi<ApiInventoryMovement[]>(
      app,
      'GET',
      `/inventory/movements?productId=${productId}&warehouseId=${tenantA.warehouseId}`,
      undefined,
      tenantB.accessToken,
    );
    expect(movementsAsB.body).toHaveLength(0);

    const kardexAsB = await callApi<ApiInventoryMovement[]>(
      app,
      'GET',
      `/inventory/kardex?productId=${productId}&warehouseId=${tenantA.warehouseId}`,
      undefined,
      tenantB.accessToken,
    );
    expect(kardexAsB.body).toHaveLength(0);

    // A sigue viendo su propio stock sin problema.
    const stockAsA = await callApi<ApiInventoryRow[]>(
      app,
      'GET',
      `/inventory?warehouseId=${tenantA.warehouseId}&productId=${productId}`,
      undefined,
      tenantA.accessToken,
    );
    expect(stockAsA.body).toHaveLength(1);
  });

  it('Tenant B no puede registrar movimientos ni transferencias contra un almacén/producto de Tenant A', async () => {
    const { productId } = await createTestProduct(app, tenantA, {
      name: 'Cross Tenant Movimiento',
    });

    const movementAsB = await moveAs(
      tenantA,
      {
        warehouseId: tenantA.warehouseId,
        productId,
        type: 'IN',
        quantity: 5,
        idempotencyKey: `cross-tenant-mov-${uniqueSuffix()}`,
      },
      tenantB.accessToken,
    );
    // el almacén/producto de A no existe para B → 400 (no se filtra info de existencia via 404/500)
    expect(movementAsB.status).toBe(400);

    const { warehouseId: warehouseAB } = await createTestWarehouse(
      app,
      tenantB,
      `Almacén B ${uniqueSuffix()}`,
    );
    const transferAsB = await callApi<ApiInventoryTransfer>(
      app,
      'POST',
      '/inventory/transfers',
      {
        fromWarehouseId: tenantA.warehouseId,
        toWarehouseId: warehouseAB,
        productId,
        quantity: 1,
        idempotencyKey: `cross-tenant-transfer-${uniqueSuffix()}`,
      },
      tenantB.accessToken,
    );
    expect(transferAsB.status).toBe(400);
  });

  it('Tenant B nunca puede transferir un producto de A hacia un almacén de A usando SU PROPIO token (no hay fuga de stock entre tenants)', async () => {
    const { productId } = await createTestProduct(app, tenantA, {
      name: 'Transferencia Cross Tenant',
    });
    await moveAs(tenantA, {
      warehouseId: tenantA.warehouseId,
      productId,
      type: 'IN',
      quantity: 20,
      idempotencyKey: `transfer-cross-carga-${uniqueSuffix()}`,
    });
    const { warehouseId: warehouseB2 } = await createTestWarehouse(
      app,
      tenantA,
      `Almacén A2 ${uniqueSuffix()}`,
    );

    const transferAsB = await callApi<ApiInventoryTransfer>(
      app,
      'POST',
      '/inventory/transfers',
      {
        fromWarehouseId: tenantA.warehouseId,
        toWarehouseId: warehouseB2,
        productId,
        quantity: 5,
        idempotencyKey: `transfer-cross-b-${uniqueSuffix()}`,
      },
      tenantB.accessToken,
    );
    expect(transferAsB.status).toBe(400); // ni el almacén de origen ni el producto existen para B
  });

  it('14) RLS crudo: con contexto de tenant inexistente, las consultas a inventories/inventory_movements/inventory_transfers no devuelven nada (fail-closed)', async () => {
    const prisma = app.get(PrismaService);
    const tenantPrisma = app.get(TenantPrismaService);

    const { productId } = await createTestProduct(app, tenantA, {
      name: 'RLS Crudo',
    });
    await moveAs(tenantA, {
      warehouseId: tenantA.warehouseId,
      productId,
      type: 'IN',
      quantity: 7,
      idempotencyKey: `rls-crudo-carga-${uniqueSuffix()}`,
    });
    const { warehouseId: whB } = await createTestWarehouse(
      app,
      tenantA,
      `RLS Crudo B ${uniqueSuffix()}`,
    );
    const transfer = await callApi<ApiInventoryTransfer>(
      app,
      'POST',
      '/inventory/transfers',
      {
        fromWarehouseId: tenantA.warehouseId,
        toWarehouseId: whB,
        productId,
        quantity: 2,
        idempotencyKey: `rls-crudo-transfer-${uniqueSuffix()}`,
      },
      tenantA.accessToken,
    );
    expect(transfer.status).toBe(201);

    // Con contexto = A, la consulta cruda ve sus propias filas.
    const [inventoryForA, movementsForA, transfersForA] =
      await prisma.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT set_config('app.current_tenant', ${tenantA.organizationId}, true)`;
        return Promise.all([
          tx.inventory.findMany({ where: { productId } }),
          tx.inventoryMovement.findMany({ where: { productId } }),
          tx.inventoryTransfer.findMany({ where: { productId } }),
        ]);
      });
    expect(inventoryForA.length).toBeGreaterThan(0);
    expect(movementsForA.length).toBeGreaterThan(0);
    expect(transfersForA.length).toBeGreaterThan(0);
    expect(
      inventoryForA.every((r) => r.organizationId === tenantA.organizationId),
    ).toBe(true);

    // Con contexto de un tenant inexistente, NADA (fail-closed real, no
    // solo "vacío porque no coincide el WHERE").
    const [inventoryNone, movementsNone, transfersNone] =
      await prisma.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT set_config('app.current_tenant', ${'org-inexistente-inventario'}, true)`;
        return Promise.all([
          tx.inventory.findMany({ where: { productId } }),
          tx.inventoryMovement.findMany({ where: { productId } }),
          tx.inventoryTransfer.findMany({ where: { productId } }),
        ]);
      });
    expect(inventoryNone).toHaveLength(0);
    expect(movementsNone).toHaveLength(0);
    expect(transfersNone).toHaveLength(0);

    // Con contexto = B (tenant real, pero ajeno a estos datos), tampoco ve nada.
    const [inventoryForB] = await tenantPrisma.run(
      tenantB.organizationId,
      (tx) => Promise.all([tx.inventory.findMany({ where: { productId } })]),
    );
    expect(inventoryForB).toHaveLength(0);
  });

  it('15) un usuario con inventory.read pero SIN inventory.manage puede consultar stock/kardex, pero no registrar movimientos ni transferencias (403)', async () => {
    const auditorToken = await createUserWithRole(
      app,
      tenantA.organizationId,
      'AUDITOR',
    ); // AUDITOR: solo permisos *.read, incluye inventory.read
    const { productId } = await createTestProduct(app, tenantA, {
      name: 'RBAC Solo Lectura',
    });
    await moveAs(tenantA, {
      warehouseId: tenantA.warehouseId,
      productId,
      type: 'IN',
      quantity: 6,
      idempotencyKey: `rbac-solo-lectura-carga-${uniqueSuffix()}`,
    });

    const readStock = await callApi<ApiInventoryRow[]>(
      app,
      'GET',
      `/inventory?warehouseId=${tenantA.warehouseId}&productId=${productId}`,
      undefined,
      auditorToken,
    );
    expect(readStock.status).toBe(200); // inventory.read sí lo tiene

    const readKardex = await callApi<ApiInventoryMovement[]>(
      app,
      'GET',
      `/inventory/kardex?productId=${productId}&warehouseId=${tenantA.warehouseId}`,
      undefined,
      auditorToken,
    );
    expect(readKardex.status).toBe(200);

    const attemptMovement = await moveAs(
      tenantA,
      {
        warehouseId: tenantA.warehouseId,
        productId,
        type: 'IN',
        quantity: 1,
        idempotencyKey: `rbac-solo-lectura-intento-${uniqueSuffix()}`,
      },
      auditorToken,
    );
    expect(attemptMovement.status).toBe(403); // inventory.manage NO lo tiene

    const { warehouseId: whB } = await createTestWarehouse(
      app,
      tenantA,
      `RBAC Lectura B ${uniqueSuffix()}`,
    );
    const attemptTransfer = await callApi<ApiInventoryTransfer>(
      app,
      'POST',
      '/inventory/transfers',
      {
        fromWarehouseId: tenantA.warehouseId,
        toWarehouseId: whB,
        productId,
        quantity: 1,
        idempotencyKey: `rbac-solo-lectura-transfer-${uniqueSuffix()}`,
      },
      auditorToken,
    );
    expect(attemptTransfer.status).toBe(403);
  });

  it('un usuario con inventory.manage (rol INVENTORY) sí puede registrar movimientos y transferencias', async () => {
    const inventoryToken = await createUserWithRole(
      app,
      tenantA.organizationId,
      'INVENTORY',
    );
    const { productId } = await createTestProduct(app, tenantA, {
      name: 'RBAC Con Permiso',
    });
    const move = await moveAs(
      tenantA,
      {
        warehouseId: tenantA.warehouseId,
        productId,
        type: 'IN',
        quantity: 5,
        idempotencyKey: `rbac-con-permiso-${uniqueSuffix()}`,
      },
      inventoryToken,
    );
    expect(move.status).toBe(201);
  });

  it('un usuario sin ningún token no puede acceder a /inventory ni /inventory/movements ni /inventory/transfers (401)', async () => {
    const stockRes = await callApi<ApiInventoryRow[]>(app, 'GET', '/inventory');
    expect(stockRes.status).toBe(401);
    const movementsRes = await callApi<ApiInventoryMovement[]>(
      app,
      'GET',
      '/inventory/movements',
    );
    expect(movementsRes.status).toBe(401);
    const transferRes = await callApi<ApiInventoryTransfer>(
      app,
      'POST',
      '/inventory/transfers',
      {},
    );
    expect(transferRes.status).toBe(401);
  });
});
