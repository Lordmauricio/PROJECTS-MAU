import { INestApplication } from '@nestjs/common';
import {
  ApiCashMovement,
  ApiCashRegister,
  ApiExpense,
  bootTestApp,
  callApi,
  createTestPosTerminal,
  createUserWithRole,
  openCashRegister,
  registerTestOrg,
  TestTenant,
  uniqueSuffix,
} from '../test-support/integration-app';
import { PrismaService } from '../prisma/prisma.service';

describe('Caja y Gastos — tenant isolation, RLS y RBAC (integración, DB real)', () => {
  let app: INestApplication;
  let tenantA: TestTenant;
  let tenantB: TestTenant;

  beforeAll(async () => {
    app = await bootTestApp();
    tenantA = await registerTestOrg(app, 'Cash-Security-A');
    tenantB = await registerTestOrg(app, 'Cash-Security-B');
  }, 30000);

  afterAll(async () => {
    await app.close();
  }, 15000);

  async function freshTerminal(tenant: TestTenant, label: string) {
    return (
      await createTestPosTerminal(app, tenant, `${label} ${uniqueSuffix()}`)
    ).posTerminalId;
  }

  it('13) Tenant B nunca puede leer, cerrar, ni registrar movimientos/gastos sobre una caja de Tenant A (404, no filtra existencia)', async () => {
    const posTerminalId = await freshTerminal(tenantA, 'Aislada');
    const register = await openCashRegister(app, tenantA, {
      openingAmount: 50,
      posTerminalId,
    });

    const readAsB = await callApi<ApiCashRegister>(
      app,
      'GET',
      `/cash-registers/${register.id}`,
      undefined,
      tenantB.accessToken,
    );
    expect(readAsB.status).toBe(404);

    const closeAsB = await callApi<ApiCashRegister>(
      app,
      'POST',
      `/cash-registers/${register.id}/close`,
      {
        countedAmount: 50,
        idempotencyKey: `cross-tenant-close-${uniqueSuffix()}`,
      },
      tenantB.accessToken,
    );
    expect(closeAsB.status).toBe(404);

    const movementAsB = await callApi<ApiCashMovement>(
      app,
      'POST',
      `/cash-registers/${register.id}/movements`,
      {
        type: 'CASH_IN',
        amount: 10,
        idempotencyKey: `cross-tenant-mov-${uniqueSuffix()}`,
      },
      tenantB.accessToken,
    );
    expect(movementAsB.status).toBe(404);

    const expenseAsB = await callApi<ApiExpense>(
      app,
      'POST',
      '/expenses',
      {
        cashRegisterId: register.id,
        amount: 10,
        idempotencyKey: `cross-tenant-expense-${uniqueSuffix()}`,
      },
      tenantB.accessToken,
    );
    expect(expenseAsB.status).toBe(404);

    // A sigue viendo su propia caja sin problema.
    const readAsA = await callApi<ApiCashRegister>(
      app,
      'GET',
      `/cash-registers/${register.id}`,
      undefined,
      tenantA.accessToken,
    );
    expect(readAsA.status).toBe(200);
  });

  it('el listado de cajas de B nunca incluye cajas de A, y viceversa', async () => {
    const listA = await callApi<ApiCashRegister[]>(
      app,
      'GET',
      '/cash-registers',
      undefined,
      tenantA.accessToken,
    );
    const listB = await callApi<ApiCashRegister[]>(
      app,
      'GET',
      '/cash-registers',
      undefined,
      tenantB.accessToken,
    );
    const idsA = listA.body.map((r) => r.id);
    const idsB = listB.body.map((r) => r.id);
    expect(idsA.some((id) => idsB.includes(id))).toBe(false);
  });

  it('Tenant B no puede abrir una caja reusando un posTerminalId de Tenant A', async () => {
    const posTerminalId = await freshTerminal(tenantA, 'Terminal Ajeno');
    const attempt = await callApi<ApiCashRegister>(
      app,
      'POST',
      '/cash-registers',
      {
        posTerminalId,
        openingAmount: 0,
        idempotencyKey: `cross-tenant-open-${uniqueSuffix()}`,
      },
      tenantB.accessToken,
    );
    expect(attempt.status).toBe(400); // el terminal de A no existe para B
  });

  it('14) RLS crudo: con contexto de tenant inexistente, cash_registers/cash_movements/expenses no devuelven nada (fail-closed)', async () => {
    const prisma = app.get(PrismaService);
    const posTerminalId = await freshTerminal(tenantA, 'RLS Crudo');
    const register = await openCashRegister(app, tenantA, {
      openingAmount: 30,
      posTerminalId,
    });
    await callApi<ApiExpense>(
      app,
      'POST',
      '/expenses',
      {
        cashRegisterId: register.id,
        amount: 5,
        idempotencyKey: `rls-crudo-expense-${uniqueSuffix()}`,
      },
      tenantA.accessToken,
    );

    const [registersForA, movementsForA, expensesForA] =
      await prisma.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT set_config('app.current_tenant', ${tenantA.organizationId}, true)`;
        return Promise.all([
          tx.cashRegister.findMany({ where: { id: register.id } }),
          tx.cashMovement.findMany({ where: { cashRegisterId: register.id } }),
          tx.expense.findMany({ where: { cashRegisterId: register.id } }),
        ]);
      });
    expect(registersForA.length).toBeGreaterThan(0);
    expect(movementsForA.length).toBeGreaterThan(0);
    expect(expensesForA.length).toBeGreaterThan(0);
    expect(
      registersForA.every((r) => r.organizationId === tenantA.organizationId),
    ).toBe(true);

    const [registersNone, movementsNone, expensesNone] =
      await prisma.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT set_config('app.current_tenant', ${'org-inexistente-caja'}, true)`;
        return Promise.all([
          tx.cashRegister.findMany({ where: { id: register.id } }),
          tx.cashMovement.findMany({ where: { cashRegisterId: register.id } }),
          tx.expense.findMany({ where: { cashRegisterId: register.id } }),
        ]);
      });
    expect(registersNone).toHaveLength(0);
    expect(movementsNone).toHaveLength(0);
    expect(expensesNone).toHaveLength(0);
  });

  it('15) un usuario con cash.read pero SIN cash.manage puede consultar cajas, pero no abrir/cerrar/mover (403)', async () => {
    const accountantToken = await createUserWithRole(
      app,
      tenantA.organizationId,
      'ACCOUNTANT',
    ); // ACCOUNTANT: cash.read, sin cash.manage

    const readList = await callApi<ApiCashRegister[]>(
      app,
      'GET',
      '/cash-registers',
      undefined,
      accountantToken,
    );
    expect(readList.status).toBe(200);

    const posTerminalId = await freshTerminal(tenantA, 'RBAC Solo Lectura');
    const attemptOpen = await callApi<ApiCashRegister>(
      app,
      'POST',
      '/cash-registers',
      {
        posTerminalId,
        openingAmount: 0,
        idempotencyKey: `rbac-solo-lectura-${uniqueSuffix()}`,
      },
      accountantToken,
    );
    expect(attemptOpen.status).toBe(403);
  });

  it('un usuario con cash.manage pero SIN expenses.manage/expenses.read no puede leer ni crear gastos (403)', async () => {
    const cashierToken = await createUserWithRole(
      app,
      tenantA.organizationId,
      'CASHIER',
    ); // CASHIER: cash.manage/cash.read, sin expenses.*
    const posTerminalId = await freshTerminal(tenantA, 'RBAC Cashier');
    const register = await openCashRegister(app, tenantA, {
      openingAmount: 20,
      posTerminalId,
      token: cashierToken,
    });
    expect(register.status).toBe('OPEN'); // cash.manage sí lo tiene

    const readExpenses = await callApi<ApiExpense[]>(
      app,
      'GET',
      '/expenses',
      undefined,
      cashierToken,
    );
    expect(readExpenses.status).toBe(403);

    const createExpense = await callApi<ApiExpense>(
      app,
      'POST',
      '/expenses',
      {
        cashRegisterId: register.id,
        amount: 5,
        idempotencyKey: `rbac-cashier-gasto-${uniqueSuffix()}`,
      },
      cashierToken,
    );
    expect(createExpense.status).toBe(403);
  });

  it('un usuario sin ningún token no puede acceder a /cash-registers ni /expenses (401)', async () => {
    const registersRes = await callApi<ApiCashRegister[]>(
      app,
      'GET',
      '/cash-registers',
    );
    expect(registersRes.status).toBe(401);
    const expensesRes = await callApi<ApiExpense[]>(app, 'GET', '/expenses');
    expect(expensesRes.status).toBe(401);
  });
});
