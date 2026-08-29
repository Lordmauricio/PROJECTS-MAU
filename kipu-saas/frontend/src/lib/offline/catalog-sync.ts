import { api } from "@/lib/api";
import type { KipuLocalDB } from "./db";
import { markOrganizationKnown } from "./app-meta-db";
import type { LocalCustomer, LocalOrgContext, LocalProduct } from "./types";

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
  warehouses: { id: string }[];
  posTerminals: { id: string }[];
}

export interface CatalogSyncInput {
  organizationId: string;
  organizationName: string;
  userId: string;
  userName: string;
  roleKey: string | null;
}

export interface CatalogSyncResult {
  productsCount: number;
  customersCount: number;
  hasBranchConfigured: boolean;
}

/**
 * FULL INITIAL SYNC (V1) — descarga TODO lo necesario para vender offline
 * reutilizando exactamente los mismos endpoints que ya usa el POS online
 * (`GET /products`, `GET /customers`, `GET /branches`): sin backend nuevo,
 * sin paginación propia inventada (el backend ya limita `/products` a 200
 * filas activas — mismo límite que ya rige hoy en modo online, no es una
 * regresión de esta fase).
 *
 * SINCRONIZACIÓN INCREMENTAL — deliberadamente NO implementada en V1: hoy
 * `GET /products`/`GET /customers` no aceptan un filtro `updatedSince` (se
 * verificó contra el código real, `products.service.ts#list` no tiene ese
 * parámetro), así que no hay forma segura de pedir "solo lo que cambió"
 * sin modificar el backend. Si una fase futura la necesita, el mecanismo
 * mínimo sería: un query param `updatedSince` (ISO) en ambos endpoints,
 * agregado al `where` existente (`updatedAt: { gt: updatedSince }`) — NO
 * un endpoint de sincronización genérico. Documentado también en
 * `docs/architecture.md` sección 18.
 */
export async function runFullInitialSync(
  db: KipuLocalDB,
  input: CatalogSyncInput,
): Promise<CatalogSyncResult> {
  const [products, customers, branches] = await Promise.all([
    api<ApiProduct[]>("/products"),
    api<ApiCustomer[]>("/customers"),
    api<ApiBranch[]>("/branches"),
  ]);

  const cachedAt = new Date().toISOString();

  const localProducts: LocalProduct[] = products.map((p) => ({
    id: p.id,
    organizationId: p.organizationId,
    name: p.name,
    sku: p.sku,
    barcode: p.barcode,
    price: p.price,
    active: p.active,
    updatedAt: p.updatedAt,
    cachedAt,
  }));

  const localCustomers: LocalCustomer[] = customers.map((c) => ({
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
  }));

  const branch = branches[0];
  const hasBranchConfigured = Boolean(
    branch && branch.warehouses[0] && branch.posTerminals[0],
  );

  await db.transaction("rw", db.products, db.customers, db.orgContext, async () => {
    await db.products.clear();
    await db.products.bulkAdd(localProducts);
    await db.customers.clear();
    await db.customers.bulkAdd(localCustomers);

    if (hasBranchConfigured && branch) {
      const context: LocalOrgContext = {
        organizationId: input.organizationId,
        organizationName: input.organizationName,
        branchId: branch.id,
        warehouseId: branch.warehouses[0].id,
        posTerminalId: branch.posTerminals[0].id,
        userId: input.userId,
        userName: input.userName,
        roleKey: input.roleKey,
        fetchedAt: cachedAt,
      };
      await db.orgContext.put(context);
    }
  });

  await markOrganizationKnown(input.organizationId, input.organizationName);

  return {
    productsCount: localProducts.length,
    customersCount: localCustomers.length,
    hasBranchConfigured,
  };
}
