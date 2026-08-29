import { INestApplication } from '@nestjs/common';
import {
  bootTestApp,
  callApi,
  createTestCustomer,
  forceUpdatedAt,
  registerTestOrg,
  TestTenant,
} from '../test-support/integration-app';

interface CustomerRow {
  id: string;
  name: string;
  active: boolean;
  updatedAt: string;
}

describe('GET /customers — sincronización incremental por updatedSince (Offline 4.3)', () => {
  let app: INestApplication;
  let tenantA: TestTenant;
  let tenantB: TestTenant;

  beforeAll(async () => {
    app = await bootTestApp();
    tenantA = await registerTestOrg(app, 'Customers-Incremental-A');
    tenantB = await registerTestOrg(app, 'Customers-Incremental-B');
  });

  afterAll(async () => {
    await app.close();
  });

  // 10
  it('sin updatedSince mantiene el comportamiento actual (incluye activos e inactivos, como siempre)', async () => {
    const { customerId } = await createTestCustomer(
      app,
      tenantA,
      'Sin-Cursor-Cliente',
    );
    const res = await callApi<CustomerRow[]>(
      app,
      'GET',
      '/customers',
      undefined,
      tenantA.accessToken,
    );
    expect(res.status).toBe(200);
    expect(res.body.some((c) => c.id === customerId)).toBe(true);
  });

  // 11, 13 — modificado posterior al cursor aparece
  it('updatedSince: devuelve los clientes modificados DESPUÉS del cursor', async () => {
    const { customerId: oldId } = await createTestCustomer(
      app,
      tenantA,
      'Viejo-Cliente-No-Cambia',
    );
    await forceUpdatedAt(
      app,
      tenantA.organizationId,
      'customers',
      oldId,
      new Date('2020-01-01T00:00:00.000Z'),
    );

    const cursor = '2020-06-01T00:00:00.000Z';

    const { customerId: newId } = await createTestCustomer(
      app,
      tenantA,
      'Nuevo-Cliente-Modificado',
    );
    await forceUpdatedAt(
      app,
      tenantA.organizationId,
      'customers',
      newId,
      new Date('2020-06-15T00:00:00.000Z'),
    );

    const res = await callApi<CustomerRow[]>(
      app,
      'GET',
      `/customers?updatedSince=${encodeURIComponent(cursor)}`,
      undefined,
      tenantA.accessToken,
    );
    expect(res.body.some((c) => c.id === newId)).toBe(true);
    expect(res.body.some((c) => c.id === oldId)).toBe(false);
  });

  // 12
  it('aislamiento: el updatedSince de A nunca trae clientes de B', async () => {
    const { customerId: customerB } = await createTestCustomer(
      app,
      tenantB,
      'Cliente-De-B',
    );
    const veryOldCursor = '2000-01-01T00:00:00.000Z';
    const res = await callApi<CustomerRow[]>(
      app,
      'GET',
      `/customers?updatedSince=${encodeURIComponent(veryOldCursor)}`,
      undefined,
      tenantA.accessToken,
    );
    expect(res.body.every((c) => c.id !== customerB)).toBe(true);
  });

  // 14 — CustomersService.list nunca filtró por `active`: confirmar que un
  // cliente desactivado ya aparecía siempre, con o sin updatedSince —
  // ningún bypass hace falta acá (a diferencia de productos).
  it('un cliente desactivado (PATCH active=false) aparece tanto sin como con updatedSince — nunca se filtró por active', async () => {
    const { customerId } = await createTestCustomer(
      app,
      tenantA,
      'Se-Va-A-Desactivar-Cliente',
    );
    const cursor = new Date().toISOString();

    const patch = await callApi(
      app,
      'PATCH',
      `/customers/${customerId}`,
      { active: false },
      tenantA.accessToken,
    );
    expect(patch.status).toBe(200);

    const sinCursor = await callApi<CustomerRow[]>(
      app,
      'GET',
      '/customers',
      undefined,
      tenantA.accessToken,
    );
    const foundSinCursor = sinCursor.body.find((c) => c.id === customerId);
    expect(foundSinCursor).toBeDefined();
    expect(foundSinCursor?.active).toBe(false);

    const conCursor = await callApi<CustomerRow[]>(
      app,
      'GET',
      `/customers?updatedSince=${encodeURIComponent(cursor)}`,
      undefined,
      tenantA.accessToken,
    );
    const foundConCursor = conCursor.body.find((c) => c.id === customerId);
    expect(foundConCursor).toBeDefined();
    expect(foundConCursor?.active).toBe(false);
  });

  it('orden ascendente por updatedAt con updatedSince', async () => {
    const { customerId: c1 } = await createTestCustomer(
      app,
      tenantA,
      'Orden-Cliente-1',
    );
    const { customerId: c2 } = await createTestCustomer(
      app,
      tenantA,
      'Orden-Cliente-2',
    );
    await forceUpdatedAt(
      app,
      tenantA.organizationId,
      'customers',
      c1,
      new Date('2021-02-01T00:00:00.000Z'),
    );
    await forceUpdatedAt(
      app,
      tenantA.organizationId,
      'customers',
      c2,
      new Date('2021-02-02T00:00:00.000Z'),
    );

    const res = await callApi<CustomerRow[]>(
      app,
      'GET',
      `/customers?updatedSince=${encodeURIComponent('2021-01-31T00:00:00.000Z')}`,
      undefined,
      tenantA.accessToken,
    );
    const ids = res.body.map((c) => c.id);
    expect(ids.indexOf(c1)).toBeLessThan(ids.indexOf(c2));
  });

  it('updatedSince inválido (no ISO 8601) se rechaza con 400', async () => {
    const res = await callApi(
      app,
      'GET',
      '/customers?updatedSince=fecha-invalida',
      undefined,
      tenantA.accessToken,
    );
    expect(res.status).toBe(400);
  });

  it('updatedSince en el futuro: responde 200 con lista vacía', async () => {
    const farFuture = '2099-01-01T00:00:00.000Z';
    const res = await callApi<CustomerRow[]>(
      app,
      'GET',
      `/customers?updatedSince=${encodeURIComponent(farFuture)}`,
      undefined,
      tenantA.accessToken,
    );
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });
});
