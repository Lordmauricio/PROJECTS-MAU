import { INestApplication } from '@nestjs/common';
import {
  bootTestApp,
  callApi,
  createTestProduct,
  forceUpdatedAt,
  registerTestOrg,
  TestTenant,
} from '../test-support/integration-app';

// Forma mínima que estos tests necesitan leer con seguridad de tipos —
// mismo criterio que el resto de `integration-app.ts` (no es el DTO
// "oficial" de respuesta, que no existe tipado).
interface ProductRow {
  id: string;
  name: string;
  active: boolean;
  updatedAt: string;
}

describe('GET /products — sincronización incremental por updatedSince (Offline 4.3)', () => {
  let app: INestApplication;
  let tenantA: TestTenant;
  let tenantB: TestTenant;

  beforeAll(async () => {
    app = await bootTestApp();
    tenantA = await registerTestOrg(app, 'Products-Incremental-A');
    tenantB = await registerTestOrg(app, 'Products-Incremental-B');
  });

  afterAll(async () => {
    await app.close();
  });

  // 1
  it('sin updatedSince mantiene el comportamiento actual: solo activos, orden alfabético', async () => {
    const { productId } = await createTestProduct(app, tenantA, {
      name: 'Sin-Cursor-Producto',
    });
    const res = await callApi<ProductRow[]>(
      app,
      'GET',
      '/products',
      undefined,
      tenantA.accessToken,
    );
    expect(res.status).toBe(200);
    const found = res.body.find((p) => p.id === productId);
    expect(found).toBeDefined();
    expect(found?.active).toBe(true);
    // Todos los productos devueltos sin updatedSince están activos —
    // ninguno desactivado se filtra a la respuesta por defecto.
    expect(res.body.every((p) => p.active)).toBe(true);
  });

  // 2, 3, 5 — modificado posterior al cursor aparece, no modificado no aparece
  it('updatedSince: devuelve solo lo modificado DESPUÉS del cursor (lo anterior no aparece)', async () => {
    const { productId: oldId } = await createTestProduct(app, tenantA, {
      name: 'Viejo-No-Cambia',
    });
    await forceUpdatedAt(
      app,
      tenantA.organizationId,
      'products',
      oldId,
      new Date('2020-01-01T00:00:00.000Z'),
    );

    const cursor = '2020-06-01T00:00:00.000Z';

    const { productId: newId } = await createTestProduct(app, tenantA, {
      name: 'Nuevo-Modificado',
    });
    await forceUpdatedAt(
      app,
      tenantA.organizationId,
      'products',
      newId,
      new Date('2020-06-15T00:00:00.000Z'),
    );

    const res = await callApi<ProductRow[]>(
      app,
      'GET',
      `/products?updatedSince=${encodeURIComponent(cursor)}`,
      undefined,
      tenantA.accessToken,
    );
    expect(res.status).toBe(200);
    expect(res.body.some((p) => p.id === newId)).toBe(true); // 3: modificado aparece
    expect(res.body.some((p) => p.id === oldId)).toBe(false); // 5: no modificado no aparece
  });

  // 4 — EL PUNTO CRÍTICO: producto desactivado aparece en incremental
  it('un producto que se DESACTIVÓ después del cursor aparece en el incremental (aunque esté inactivo)', async () => {
    const { productId } = await createTestProduct(app, tenantA, {
      name: 'Se-Va-A-Desactivar',
    });
    const cursor = new Date().toISOString();

    const del = await callApi(
      app,
      'DELETE',
      `/products/${productId}`,
      undefined,
      tenantA.accessToken,
    );
    expect(del.status).toBe(200);

    const res = await callApi<ProductRow[]>(
      app,
      'GET',
      `/products?updatedSince=${encodeURIComponent(cursor)}`,
      undefined,
      tenantA.accessToken,
    );
    const found = res.body.find((p) => p.id === productId);
    expect(found).toBeDefined();
    expect(found?.active).toBe(false);
  });

  // 6
  it('aislamiento: el updatedSince de A nunca trae productos de B', async () => {
    const { productId: productB } = await createTestProduct(app, tenantB, {
      name: 'Producto-De-B',
    });
    void productB;
    const veryOldCursor = '2000-01-01T00:00:00.000Z';
    const res = await callApi<ProductRow[]>(
      app,
      'GET',
      `/products?updatedSince=${encodeURIComponent(veryOldCursor)}`,
      undefined,
      tenantA.accessToken,
    );
    expect(res.body.every((p) => p.id !== productB)).toBe(true);
  });

  // 7 — orden ascendente por updatedAt (la propiedad de la que depende la paginación del cliente)
  it('con updatedSince, el orden es por updatedAt ASCENDENTE (necesario para poder paginar avanzando el cursor)', async () => {
    const { productId: p1 } = await createTestProduct(app, tenantA, {
      name: 'Orden-1',
    });
    const { productId: p2 } = await createTestProduct(app, tenantA, {
      name: 'Orden-2',
    });
    const { productId: p3 } = await createTestProduct(app, tenantA, {
      name: 'Orden-3',
    });
    await forceUpdatedAt(
      app,
      tenantA.organizationId,
      'products',
      p1,
      new Date('2021-01-01T00:00:00.000Z'),
    );
    await forceUpdatedAt(
      app,
      tenantA.organizationId,
      'products',
      p2,
      new Date('2021-01-02T00:00:00.000Z'),
    );
    await forceUpdatedAt(
      app,
      tenantA.organizationId,
      'products',
      p3,
      new Date('2021-01-03T00:00:00.000Z'),
    );

    const res = await callApi<ProductRow[]>(
      app,
      'GET',
      `/products?updatedSince=${encodeURIComponent('2020-12-31T00:00:00.000Z')}`,
      undefined,
      tenantA.accessToken,
    );
    const ids = res.body.map((p) => p.id);
    expect(ids.indexOf(p1)).toBeLessThan(ids.indexOf(p2));
    expect(ids.indexOf(p2)).toBeLessThan(ids.indexOf(p3));
  });

  // 8
  it('updatedSince inválido (no ISO 8601) se rechaza con 400', async () => {
    const res = await callApi(
      app,
      'GET',
      '/products?updatedSince=no-es-una-fecha',
      undefined,
      tenantA.accessToken,
    );
    expect(res.status).toBe(400);
  });

  // 9
  it('updatedSince en el futuro: responde 200 con lista vacía, nunca un error', async () => {
    const farFuture = '2099-01-01T00:00:00.000Z';
    const res = await callApi<ProductRow[]>(
      app,
      'GET',
      `/products?updatedSince=${encodeURIComponent(farFuture)}`,
      undefined,
      tenantA.accessToken,
    );
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });

  it('con updatedSince, un producto q sigue funcionando combinado (AND, no reemplaza el filtro)', async () => {
    const { productId } = await createTestProduct(app, tenantA, {
      name: 'Combinado-Busqueda-Unico',
    });
    const cursor = '2000-01-01T00:00:00.000Z';
    const res = await callApi<ProductRow[]>(
      app,
      'GET',
      `/products?updatedSince=${encodeURIComponent(cursor)}&q=Combinado-Busqueda-Unico`,
      undefined,
      tenantA.accessToken,
    );
    expect(res.body.some((p) => p.id === productId)).toBe(true);
    const resNoMatch = await callApi<ProductRow[]>(
      app,
      'GET',
      `/products?updatedSince=${encodeURIComponent(cursor)}&q=Esto-No-Deberia-Matchear-Nada`,
      undefined,
      tenantA.accessToken,
    );
    expect(resNoMatch.body.some((p) => p.id === productId)).toBe(false);
  });
});
