import { api } from "@/lib/api";
import type { KipuLocalDB } from "./db";
import { markOrganizationKnown } from "./app-meta-db";
import type {
  CatalogSyncState,
  LocalCustomer,
  LocalOrgContext,
  LocalProduct,
} from "./types";

interface ApiProduct {
  id: string;
  organizationId: string;
  name: string;
  sku: string | null;
  barcode: string | null;
  price: string;
  active: boolean;
  updatedAt: string;
}

interface ApiCustomer {
  id: string;
  organizationId: string;
  name: string;
  documentType: string | null;
  documentNumber: string | null;
  phone: string | null;
  email: string | null;
  active: boolean;
  updatedAt: string;
}

interface ApiBranch {
  id: string;
  name: string;
  address: string | null;
  warehouses: { id: string }[];
  posTerminals: { id: string; name: string; code: string }[];
}

/** Espejo mínimo de `GET /organizations/me` (backend `OrganizationsController#getMine`, `Organization` de `schema.prisma`) — solo los campos de identidad que necesita el ticket offline (Offline 4.5). */
interface ApiOrganization {
  name: string;
  legalName: string;
  nit: string;
  address: string | null;
  phone: string | null;
  logoUrl: string | null;
}

export interface CatalogSyncInput {
  organizationId: string;
  organizationName: string;
  userId: string;
  userName: string;
  roleKey: string | null;
}

/**
 * Arma el registro completo de `orgContext` (identidad de negocio +
 * sucursal + punto de venta) a partir de las respuestas YA descargadas de
 * `GET /organizations/me` y `GET /branches` — un solo lugar que usan tanto
 * `runFullInitialSync` como `runIncrementalSync` (Offline 4.5), para que
 * ninguno de los dos pueda divergir en cómo arma este registro. El caller
 * ya garantizó `branch.warehouses[0]`/`branch.posTerminals[0]` existen
 * (`hasBranchConfigured`).
 */
function buildOrgContext(
  input: CatalogSyncInput,
  organization: ApiOrganization,
  branch: ApiBranch,
  cachedAt: string,
): LocalOrgContext {
  const posTerminal = branch.posTerminals[0];
  return {
    organizationId: input.organizationId,
    organizationName: input.organizationName,
    businessLegalName: organization.legalName,
    businessNit: organization.nit,
    businessAddress: organization.address,
    businessPhone: organization.phone,
    businessLogoUrl: organization.logoUrl,
    branchId: branch.id,
    branchName: branch.name,
    branchAddress: branch.address,
    warehouseId: branch.warehouses[0].id,
    posTerminalId: posTerminal.id,
    posTerminalName: posTerminal.name,
    posTerminalCode: posTerminal.code,
    userId: input.userId,
    userName: input.userName,
    roleKey: input.roleKey,
    fetchedAt: cachedAt,
  };
}

export interface CatalogSyncResult {
  productsCount: number;
  customersCount: number;
  hasBranchConfigured: boolean;
}

function toLocalProduct(p: ApiProduct, cachedAt: string): LocalProduct {
  return {
    id: p.id,
    organizationId: p.organizationId,
    name: p.name,
    sku: p.sku,
    barcode: p.barcode,
    price: p.price,
    active: p.active,
    updatedAt: p.updatedAt,
    cachedAt,
  };
}

function toLocalCustomer(c: ApiCustomer, cachedAt: string): LocalCustomer {
  return {
    id: c.id,
    organizationId: c.organizationId,
    name: c.name,
    documentType: c.documentType,
    documentNumber: c.documentNumber,
    phone: c.phone,
    email: c.email,
    active: c.active,
    updatedAt: c.updatedAt,
    cachedAt,
  };
}

/** Mayor `updatedAt` entre `rows` — nunca `Date.now()` del dispositivo (ver docs/architecture.md sección 22): el cursor siempre se deriva de marcas que YA puso el servidor, inmune a un reloj local mal configurado. */
function maxUpdatedAt(rows: { updatedAt: string }[], fallback: string | null): string | null {
  if (rows.length === 0) return fallback;
  let max = rows[0].updatedAt;
  for (const r of rows) if (r.updatedAt > max) max = r.updatedAt;
  return max;
}

/**
 * FULL INITIAL SYNC — descarga TODO el catálogo (`GET /products`, `GET
 * /customers`, sin `updatedSince`) y reemplaza la copia local entera
 * (`clear()` + `bulkAdd`). Sigue existiendo tal cual desde Offline 2/3 —
 * Offline 4.3 NO la reemplaza, la complementa: es el mecanismo para la
 * primera instalación, para recuperarse de una base local corrupta/
 * inconsistente, o para un resync manual explícito a futuro. Lo único que
 * se le agregó es dejar guardado el cursor de sincronización incremental
 * (`syncState`) al final, para que la PRÓXIMA apertura del POS pueda usar
 * `runIncrementalSync` en vez de volver a descargar todo.
 */
export async function runFullInitialSync(
  db: KipuLocalDB,
  input: CatalogSyncInput,
): Promise<CatalogSyncResult> {
  // `organization` viaja en el MISMO `Promise.all` que products/customers/
  // branches (Offline 4.5) — si `GET /organizations/me` falla, todo el
  // `Promise.all` rechaza ANTES de que la transacción Dexie empiece: ningún
  // dato queda a medio escribir, mismo criterio de atomicidad que ya
  // aplicaba a products/customers/branches desde Offline 2/3.
  const [products, customers, branches, organization] = await Promise.all([
    api<ApiProduct[]>("/products"),
    api<ApiCustomer[]>("/customers"),
    api<ApiBranch[]>("/branches"),
    api<ApiOrganization>("/organizations/me"),
  ]);

  const cachedAt = new Date().toISOString();
  const localProducts = products.map((p) => toLocalProduct(p, cachedAt));
  const localCustomers = customers.map((c) => toLocalCustomer(c, cachedAt));

  const branch = branches[0];
  const hasBranchConfigured = Boolean(
    branch && branch.warehouses[0] && branch.posTerminals[0],
  );

  await db.transaction(
    "rw",
    db.products,
    db.customers,
    db.orgContext,
    db.syncState,
    async () => {
      await db.products.clear();
      await db.products.bulkAdd(localProducts);
      await db.customers.clear();
      await db.customers.bulkAdd(localCustomers);

      if (hasBranchConfigured && branch) {
        await db.orgContext.put(buildOrgContext(input, organization, branch, cachedAt));
      }

      const state: CatalogSyncState = {
        organizationId: input.organizationId,
        productsUpdatedAt: maxUpdatedAt(products, null),
        customersUpdatedAt: maxUpdatedAt(customers, null),
        lastFullSyncAt: cachedAt,
        lastIncrementalSyncAt: null,
      };
      await db.syncState.put(state);
    },
  );

  await markOrganizationKnown(input.organizationId, input.organizationName);

  return {
    productsCount: localProducts.length,
    customersCount: localCustomers.length,
    hasBranchConfigured,
  };
}

// Debe coincidir con el `take` real de `ProductsService.list`/
// `CustomersService.list` (backend) — es lo que permite reconocer "esta
// página vino completa, puede haber más" sin que el backend necesite
// devolver ningún token de continuación propio: si la página trae MENOS
// que este límite, no hay nada más que pedir.
const PRODUCTS_PAGE_SIZE = 200;
const CUSTOMERS_PAGE_SIZE = 100;
// Salvaguarda contra un bucle sin fin (ver docs/architecture.md sección
// 22): 50 páginas cubre hasta 10.000/5.000 filas cambiadas de una sola
// vez, muy por encima de cualquier volumen real esperado para un
// comercio chico/mediano — si algún día no alcanza, es una señal de que
// hace falta repensar la estrategia, no de subir el número a ciegas.
const MAX_INCREMENTAL_PAGES = 50;

/**
 * Trae TODOS los cambios desde `since`, paginando con el propio
 * `updatedSince` como token de continuación (sin inventar un mecanismo de
 * paginación nuevo del lado del backend): cada página pide "desde el
 * `updatedAt` máximo visto en la página anterior". Se corta en cuanto una
 * página viene MÁS CHICA que `pageSize` (ninguna fila más elegible) o si
 * el cursor deja de avanzar (todas las filas de una página comparten
 * exactamente el mismo instante — evita repetir la misma página para
 * siempre).
 */
async function fetchAllChanges<T extends { updatedAt: string }>(
  path: string,
  since: string,
  pageSize: number,
): Promise<T[]> {
  const all: T[] = [];
  let cursor = since;
  for (let page = 0; page < MAX_INCREMENTAL_PAGES; page++) {
    const batch = await api<T[]>(`${path}?updatedSince=${encodeURIComponent(cursor)}`);
    all.push(...batch);
    if (batch.length < pageSize) break;
    const next = maxUpdatedAt(batch, cursor);
    if (!next || next === cursor) break;
    cursor = next;
  }
  return all;
}

export interface IncrementalSyncResult {
  mode: "full" | "incremental";
  productsChanged: number;
  customersChanged: number;
}

/**
 * SIGUIENTES SINCRONIZACIONES — pide solo lo que cambió desde el cursor
 * guardado (`GET /products?updatedSince=...`, `GET /customers?updatedSince
 * =...`), nunca vuelve a descargar el catálogo entero. Aplica los cambios
 * con `bulkPut` (upsert por id) — nunca `clear()`: un producto/cliente que
 * no vino en la respuesta simplemente no se toca, sigue exactamente como
 * estaba (nunca se borra localmente solo porque "no llegó").
 *
 * Atomicidad del cursor (docs/architecture.md sección 22, requisito
 * explícito): aplicar los cambios Y avanzar el cursor ocurre DENTRO de la
 * misma transacción Dexie — si algo falla a mitad de camino (la propia
 * escritura local, no la red), Dexie aborta TODA la transacción y el
 * cursor queda exactamente donde estaba antes, listo para reintentar sin
 * duplicar ni perder nada. Si lo que falla es la descarga (fetch, antes de
 * la transacción), directamente nunca se llega a tocar la base local — el
 * cursor tampoco avanza.
 *
 * Sin cursor previo (dispositivo nuevo, o un full sync anterior que nunca
 * llegó a completarse): no hay desde dónde partir de forma segura, así
 * que se cae a `runFullInitialSync` — el incremental nunca reemplaza al
 * full sync, es su complemento. Ojo: "sin cursor" se decide por
 * `lastFullSyncAt` (¿llegó a completarse ALGUNA vez un full sync?), nunca
 * por `productsUpdatedAt`/`customersUpdatedAt` en sí mismos — una
 * organización nueva puede legítimamente tener CERO productos o CERO
 * clientes en su primer full sync, y ese `null` no significa "nunca
 * sincronizó", significa "sincronizó y no había nada". Para esa entidad
 * puntual, `lastFullSyncAt` hace de piso seguro: cualquier fila creada
 * DESPUÉS de ese instante es, por definición, un cambio real a traer.
 */
export async function runIncrementalSync(
  db: KipuLocalDB,
  input: CatalogSyncInput,
): Promise<IncrementalSyncResult> {
  const state = await db.syncState.get(input.organizationId);
  if (!state || !state.lastFullSyncAt) {
    const full = await runFullInitialSync(db, input);
    return {
      mode: "full",
      productsChanged: full.productsCount,
      customersChanged: full.customersCount,
    };
  }

  const productsSince = state.productsUpdatedAt ?? state.lastFullSyncAt;
  const customersSince = state.customersUpdatedAt ?? state.lastFullSyncAt;
  // Identidad de negocio/sucursal/POS (Offline 4.5) NO tiene un cursor
  // `updatedSince` propio — son un puñado de campos de un solo registro,
  // nunca una colección paginada — así que cada incremental simplemente
  // vuelve a pedir el estado ACTUAL completo (`GET /organizations/me`, `GET
  // /branches`), igual que el full sync. Es información de tamaño fijo y
  // acotado (nunca crece con el catálogo), así que no viola "nunca una
  // descarga sin límite": son siempre las mismas 2 llamadas, sin paginar.
  // Viajan en el MISMO `Promise.all` que products/customers por la misma
  // razón de atomicidad que en `runFullInitialSync`: si cualquiera falla,
  // nada de este incremental se aplica (ni el catálogo ni el contexto ni el
  // cursor avanzan).
  const [changedProducts, changedCustomers, branches, organization] = await Promise.all([
    fetchAllChanges<ApiProduct>("/products", productsSince, PRODUCTS_PAGE_SIZE),
    fetchAllChanges<ApiCustomer>("/customers", customersSince, CUSTOMERS_PAGE_SIZE),
    api<ApiBranch[]>("/branches"),
    api<ApiOrganization>("/organizations/me"),
  ]);

  const cachedAt = new Date().toISOString();
  const localProducts = changedProducts.map((p) => toLocalProduct(p, cachedAt));
  const localCustomers = changedCustomers.map((c) => toLocalCustomer(c, cachedAt));
  const branch = branches[0];
  const hasBranchConfigured = Boolean(branch && branch.warehouses[0] && branch.posTerminals[0]);

  await db.transaction("rw", db.products, db.customers, db.orgContext, db.syncState, async () => {
    if (localProducts.length > 0) await db.products.bulkPut(localProducts);
    if (localCustomers.length > 0) await db.customers.bulkPut(localCustomers);

    // Refresca el contexto en CADA incremental (no solo en el full sync
    // inicial) — esto es lo que permite que un dispositivo con un
    // `orgContext` cacheado ANTES de Offline 4.5 (sin los campos de
    // identidad de negocio) se autorepare en su próxima sincronización en
    // línea, sin necesitar un resync manual ni una migración de datos.
    if (hasBranchConfigured && branch) {
      await db.orgContext.put(buildOrgContext(input, organization, branch, cachedAt));
    }

    const nextState: CatalogSyncState = {
      organizationId: input.organizationId,
      productsUpdatedAt: maxUpdatedAt(changedProducts, productsSince),
      customersUpdatedAt: maxUpdatedAt(changedCustomers, customersSince),
      lastFullSyncAt: state.lastFullSyncAt,
      lastIncrementalSyncAt: cachedAt,
    };
    await db.syncState.put(nextState);
  });

  return {
    mode: "incremental",
    productsChanged: localProducts.length,
    customersChanged: localCustomers.length,
  };
}
