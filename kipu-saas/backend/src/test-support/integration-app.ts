/**
 * Infraestructura compartida para los tests de integración de Ventas/POS
 * (y de cualquier módulo comercial futuro): levanta la app NestJS real
 * contra Postgres/Redis reales (mismo patrón que
 * `scripts/verify-tenant-isolation.ts`) y expone helpers de alto nivel
 * (registrar organización, loguearse, crear producto con stock, pegarle a
 * la API vía HTTP real) para que los `.spec.ts` puedan enfocarse en el
 * escenario de negocio, no en el fetch plumbing.
 *
 * Por qué esto SÍ corre bajo Jest (a diferencia de lo que documenta
 * verify-tenant-isolation.ts): ese script data de antes de resolver el
 * problema. La construcción de PrismaClient 7 falla bajo ts-jest por dos
 * causas separadas, ambas resueltas en `package.json`:
 *   1. El cliente generado usa specifiers relativos con extensión `.js`
 *      (convención ESM) — se resuelve con `moduleNameMapper` en la config
 *      de Jest.
 *   2. Carga su compilador de queries WASM con `import()` dinámico — Jest
 *      necesita correr con `NODE_OPTIONS=--experimental-vm-modules` (ver
 *      script `test`/`test:e2e`).
 * Con ambos fixes, Jest + Prisma 7 + WASM funciona igual que en runtime
 * real. `verify-tenant-isolation.ts` se mantiene igual (sigue siendo
 * válido y se corre en CI/local con `npm run verify:tenant-isolation`)
 * porque cubre un ángulo distinto (RLS crudo sin pasar por Nest DI) y no
 * hace falta migrarlo.
 *
 * Por qué `supertest` y no `fetch()` real contra un puerto: bajo
 * `NODE_OPTIONS=--experimental-vm-modules`, el `fetch` nativo (undici) se
 * cuelga indefinidamente al hacer un request real dentro del entorno de
 * Jest — problema conocido de esa combinación, no de esta app. `supertest`
 * habla directo con el handler HTTP de Express sin abrir un socket real, y
 * es el approach estándar de NestJS para tests de integración/e2e (ya
 * estaba en `devDependencies`, pensado exactamente para esto).
 */
import 'dotenv/config';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import request from 'supertest';
import { AppModule } from '../app.module';
import { PrismaService } from '../prisma/prisma.service';
import { TenantPrismaService } from '../prisma/tenant-prisma.service';
import * as argon2 from 'argon2';

export async function bootTestApp(): Promise<INestApplication> {
  const app = await NestFactory.create(AppModule, { logger: false });
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );
  await app.init();
  return app;
}

export function uniqueSuffix(): string {
  return `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
}

export interface HttpResult<T> {
  status: number;
  body: T;
}

// Forma de las respuestas de /sales* usadas por los tests — evita `any` al
// leer `res.body` en los `.spec.ts`. No es el DTO de respuesta "oficial"
// del backend (no existe uno tipado todavía), es lo mínimo que los tests
// necesitan poder leer con seguridad de tipos.
export interface ApiSaleItem {
  id: string;
  productId: string;
  quantity: string;
  unitPrice: string;
  discount: string;
  subtotal: string;
}

export interface ApiPayment {
  id: string;
  saleId: string;
  method: string;
  amount: string;
  idempotencyKey?: string | null;
}

export interface ApiSale {
  id: string;
  status: string;
  subtotal: string;
  discount: string;
  total: string;
  paidTotal: string;
  balance: string;
  items: ApiSaleItem[];
  payments: ApiPayment[];
}

export interface ApiInventoryRow {
  productId: string;
  warehouseId: string;
  quantity: string;
}

export interface ApiInventoryMovement {
  id: string;
  productId: string;
  warehouseId: string;
  type: string;
  quantity: string;
  stockBefore: string;
  stockAfter: string;
  reference?: string | null;
  idempotencyKey?: string | null;
}

export interface ApiInventoryTransfer {
  id: string;
  productId: string;
  fromWarehouseId: string;
  toWarehouseId: string;
  quantity: string;
  idempotencyKey?: string | null;
}

// POST /inventory/movements responde el resultado de `applyMovement`
// (el movimiento creado + el saldo antes/después), no el movimiento "plano"
// — a diferencia de GET /inventory/movements y GET /inventory/kardex, que sí
// devuelven filas planas y usan `ApiInventoryMovement` directamente.
export interface ApiMovementResult {
  movement: ApiInventoryMovement;
  stockBefore: string;
  stockAfter: string;
}

export interface ApiCashMovement {
  id: string;
  cashRegisterId: string;
  type: string;
  amount: string;
  reason?: string | null;
  reference?: string | null;
  idempotencyKey?: string | null;
  createdAt: string;
}

export interface ApiExpense {
  id: string;
  cashRegisterId: string;
  amount: string;
  category?: string | null;
  description?: string | null;
  observation?: string | null;
  idempotencyKey?: string | null;
  createdAt: string;
}

export interface ApiCashRegister {
  id: string;
  posTerminalId: string;
  status: string;
  openingAmount: string;
  closingAmount?: string | null;
  expectedAmount?: string | null;
  difference?: string | null;
  closingObservation?: string | null;
  openedAt: string;
  closedAt?: string | null;
  movements?: ApiCashMovement[];
  expenses?: ApiExpense[];
}

/**
 * Abre una caja. Por defecto usa el punto de venta principal del tenant,
 * pero como a lo sumo puede haber UNA caja OPEN por terminal, los tests que
 * abren más de una caja en la misma organización deben pasar
 * `posTerminalId` explícito (ver `createTestPosTerminal`) para no chocar
 * entre sí.
 */
export async function openCashRegister(
  app: INestApplication,
  tenant: TestTenant,
  opts: {
    openingAmount?: number;
    idempotencyKey?: string;
    posTerminalId?: string;
    token?: string;
  } = {},
): Promise<ApiCashRegister> {
  const posTerminalId = opts.posTerminalId ?? tenant.posTerminalId;
  const res = await callApi<ApiCashRegister>(
    app,
    'POST',
    '/cash-registers',
    {
      posTerminalId,
      openingAmount: opts.openingAmount ?? 0,
      idempotencyKey:
        opts.idempotencyKey ?? `open-${posTerminalId}-${uniqueSuffix()}`,
    },
    opts.token ?? tenant.accessToken,
  );
  if (res.status !== 201) {
    throw new Error(
      `abrir caja debía dar 201, dio ${res.status}: ${JSON.stringify(res.body)}`,
    );
  }
  return res.body;
}

export interface ApiAuditLog {
  id: string;
  action: string;
  entityId: string | null;
}

// Forma de las respuestas de /purchases* y /payables* — mismo criterio que
// las de /sales* de arriba.
export interface ApiPurchaseItem {
  id: string;
  productId: string;
  quantity: string;
  receivedQuantity: string;
  returnedQuantity: string;
  unitCost: string;
  discount: string;
  subtotal: string;
}

export interface ApiPurchase {
  id: string;
  status: string;
  subtotal: string;
  discount: string;
  total: string;
  items: ApiPurchaseItem[];
  payables: ApiPayable[];
  receipts: Array<{
    id: string;
    idempotencyKey?: string | null;
    items: Array<{ purchaseItemId: string; quantity: string }>;
  }>;
  returns: Array<{
    id: string;
    idempotencyKey?: string | null;
    items: Array<{ purchaseItemId: string; quantity: string }>;
  }>;
}

export interface ApiPayable {
  id: string;
  supplierId: string;
  purchaseId: string | null;
  amount: string;
  status: string;
  paidTotal?: string;
  balance?: string;
  payments?: ApiPayment[];
}

type HttpMethod = 'get' | 'post' | 'patch' | 'delete' | 'put';

export async function callApi<T = unknown>(
  app: INestApplication,
  method: string,
  path: string,
  body?: unknown,
  token?: string,
): Promise<HttpResult<T>> {
  const server = app.getHttpServer() as Parameters<typeof request>[0];
  const verb = method.toLowerCase() as HttpMethod;
  let req = request(server)[verb](path);
  if (token) req = req.set('Authorization', `Bearer ${token}`);
  if (body !== undefined) req = req.send(body as Record<string, unknown>);
  const res = await req;
  return { status: res.status, body: res.body as T };
}

export interface TestTenant {
  accessToken: string;
  organizationId: string;
  branchId: string;
  warehouseId: string;
  posTerminalId: string;
}

interface RegisterResponse {
  accessToken: string;
  organization: { id: string };
}

interface BranchResponse {
  id: string;
  warehouses: { id: string }[];
  posTerminals: { id: string }[];
}

/** Registra una organización nueva y devuelve, ya resueltos, los ids de su sucursal/almacén/POS principales (creados automáticamente en el bootstrap). */
export async function registerTestOrg(
  app: INestApplication,
  label: string,
): Promise<TestTenant> {
  const suffix = uniqueSuffix();
  const res = await callApi<RegisterResponse>(app, 'POST', '/auth/register', {
    organizationName: `${label} ${suffix}`,
    legalName: `${label} SRL ${suffix}`,
    nit: `TEST-${suffix}`,
    branchName: `Sucursal ${label}`,
    ownerName: `Owner ${label}`,
    email: `owner-${suffix}@example.test`,
    password: 'Password123!',
  });
  if (res.status !== 201) {
    throw new Error(
      `registro de ${label} debía dar 201, dio ${res.status}: ${JSON.stringify(res.body)}`,
    );
  }
  const accessToken = res.body.accessToken;
  const organizationId = res.body.organization.id;

  const branches = await callApi<BranchResponse[]>(
    app,
    'GET',
    '/branches',
    undefined,
    accessToken,
  );
  const branch = branches.body[0];

  return {
    accessToken,
    organizationId,
    branchId: branch.id,
    warehouseId: branch.warehouses[0].id,
    posTerminalId: branch.posTerminals[0].id,
  };
}

/** Crea un usuario con un rol de bajo privilegio específico (bypassa el flujo de invitación, que requiere aceptarla por email) y devuelve su accessToken. */
export async function createUserWithRole(
  app: INestApplication,
  organizationId: string,
  roleKey: string,
): Promise<string> {
  const tenantPrisma = app.get(TenantPrismaService);
  const prisma = app.get(PrismaService);
  const suffix = uniqueSuffix();
  const email = `${roleKey.toLowerCase()}-${suffix}@example.test`;
  const password = 'Password123!';

  await tenantPrisma.run(organizationId, async (tx) => {
    const role = await tx.role.findFirstOrThrow({
      where: { organizationId, key: roleKey },
    });
    const passwordHash = await argon2.hash(password);
    const user = await prisma.user.create({
      data: {
        email,
        name: `Test ${roleKey}`,
        passwordHash,
        emailVerifiedAt: new Date(),
      },
    });
    await tx.organizationUser.create({
      data: {
        organizationId,
        userId: user.id,
        roleId: role.id,
        status: 'ACTIVE',
        joinedAt: new Date(),
      },
    });
  });

  const login = await callApi<{ accessToken: string }>(
    app,
    'POST',
    '/auth/login',
    { email, password },
  );
  if (login.status !== 201 && login.status !== 200) {
    throw new Error(
      `login de usuario ${roleKey} debía dar 200/201, dio ${login.status}: ${JSON.stringify(login.body)}`,
    );
  }
  return login.body.accessToken;
}

/** Crea un punto de venta adicional en la misma sucursal — usado por los tests de Caja, donde cada caso necesita su PROPIO terminal (a lo sumo una caja OPEN por terminal). */
export async function createTestPosTerminal(
  app: INestApplication,
  tenant: TestTenant,
  name: string,
): Promise<{ posTerminalId: string }> {
  const res = await callApi<{ id: string }>(
    app,
    'POST',
    '/pos-terminals',
    { branchId: tenant.branchId, name, code: `POS-${uniqueSuffix()}` },
    tenant.accessToken,
  );
  if (res.status !== 201) {
    throw new Error(
      `crear punto de venta debía dar 201, dio ${res.status}: ${JSON.stringify(res.body)}`,
    );
  }
  return { posTerminalId: res.body.id };
}

/** Crea un almacén adicional (módulo de Foundation) en la misma sucursal — usado por los tests de transferencias. */
export async function createTestWarehouse(
  app: INestApplication,
  tenant: TestTenant,
  name: string,
): Promise<{ warehouseId: string }> {
  const res = await callApi<{ id: string }>(
    app,
    'POST',
    '/warehouses',
    { branchId: tenant.branchId, name },
    tenant.accessToken,
  );
  if (res.status !== 201) {
    throw new Error(
      `crear almacén debía dar 201, dio ${res.status}: ${JSON.stringify(res.body)}`,
    );
  }
  return { warehouseId: res.body.id };
}

/** Crea un proveedor real (módulo de Foundation) para usar en tests de Compras. */
export async function createTestSupplier(
  app: INestApplication,
  tenant: TestTenant,
  name: string,
): Promise<{ supplierId: string }> {
  const res = await callApi<{ id: string }>(
    app,
    'POST',
    '/suppliers',
    { name },
    tenant.accessToken,
  );
  if (res.status !== 201) {
    throw new Error(
      `crear proveedor debía dar 201, dio ${res.status}: ${JSON.stringify(res.body)}`,
    );
  }
  return { supplierId: res.body.id };
}

/** Crea un producto sin stock (para tests de Compras, donde el stock lo genera la recepción, no una carga manual). */
export async function createTestProduct(
  app: INestApplication,
  tenant: TestTenant,
  opts: { name: string; price?: number; cost?: number },
): Promise<{ productId: string }> {
  const res = await callApi<{ id: string }>(
    app,
    'POST',
    '/products',
    { name: opts.name, price: opts.price ?? 10, cost: opts.cost },
    tenant.accessToken,
  );
  if (res.status !== 201) {
    throw new Error(
      `crear producto debía dar 201, dio ${res.status}: ${JSON.stringify(res.body)}`,
    );
  }
  return { productId: res.body.id };
}

/** Crea un producto y le carga stock inicial vía el movimiento manual IN (usado por los tests de Ventas). */
export async function createProductWithStock(
  app: INestApplication,
  tenant: TestTenant,
  opts: { name: string; price: number; quantity: number },
): Promise<{ productId: string }> {
  const productRes = await callApi<{ id: string }>(
    app,
    'POST',
    '/products',
    { name: opts.name, price: opts.price },
    tenant.accessToken,
  );
  if (productRes.status !== 201) {
    throw new Error(
      `crear producto debía dar 201, dio ${productRes.status}: ${JSON.stringify(productRes.body)}`,
    );
  }
  const productId = productRes.body.id;

  const stockRes = await callApi(
    app,
    'POST',
    '/inventory/movements',
    {
      warehouseId: tenant.warehouseId,
      productId,
      type: 'IN',
      quantity: opts.quantity,
      reason: 'Carga inicial (test)',
      idempotencyKey: `stock-inicial-${productId}-${uniqueSuffix()}`,
    },
    tenant.accessToken,
  );
  if (stockRes.status !== 201) {
    throw new Error(
      `cargar stock debía dar 201, dio ${stockRes.status}: ${JSON.stringify(stockRes.body)}`,
    );
  }
  return { productId };
}
