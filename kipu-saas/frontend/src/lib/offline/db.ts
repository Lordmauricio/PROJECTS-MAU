import Dexie, { type EntityTable } from "dexie";
import type {
  CatalogSyncState,
  LocalCustomer,
  LocalOrgContext,
  LocalProduct,
  LocalSale,
  SyncQueueItem,
} from "./types";

/**
 * Aislamiento multi-tenant en el cliente: UNA base de datos IndexedDB física
 * distinta por organización (`kipu_local_<organizationId>`), no una tabla
 * compartida filtrada por `organizationId`. Es la misma filosofía que ya
 * aplica RLS del lado del servidor — "no confíes únicamente en un WHERE/
 * filtro": acá, un bug que olvide filtrar por organización simplemente no
 * puede filtrar datos ajenos, porque no hay ninguna fila ajena en la misma
 * base con la que chocar. Ver `docs/architecture.md` sección 18.
 *
 * Los tokens de sesión (access/refresh) NUNCA se guardan acá — siguen
 * viviendo exactamente donde ya viven hoy (`localStorage`, vía
 * `auth-context.tsx`/`lib/api.ts`, sin tocar). Esta base solo guarda datos
 * de catálogo (no sensibles) y operaciones de negocio ya visibles para el
 * usuario en pantalla — nunca contraseñas, nunca tokens.
 */
export class KipuLocalDB extends Dexie {
  products!: EntityTable<LocalProduct, "id">;
  customers!: EntityTable<LocalCustomer, "id">;
  orgContext!: EntityTable<LocalOrgContext, "organizationId">;
  sales!: EntityTable<LocalSale, "id">;
  syncQueue!: EntityTable<SyncQueueItem, "id">;
  syncState!: EntityTable<CatalogSyncState, "organizationId">;

  constructor(organizationId: string) {
    super(`kipu_local_${organizationId}`);
    this.version(1).stores({
      products: "id, sku, barcode, active",
      customers: "id, documentNumber, active",
      orgContext: "organizationId",
      sales: "id, serverId, status, createdAt",
      // `status` indexado para que el Sync Engine pueda listar PENDING/
      // FAILED sin recorrer toda la tabla; `createdAt` para procesar en
      // orden; `[status+nextRetryAt]` compuesto para la consulta real de
      // "elegibles ahora" (ver `sync-queue.ts`).
      syncQueue: "id, status, entityId, createdAt, [status+nextRetryAt]",
    });
    // Versión 2 (Offline 4.3): agrega el cursor de sincronización
    // incremental de catálogo. Cambio puramente ADITIVO — Dexie conserva
    // intactas todas las tablas de la versión 1 (nada se migra, nada se
    // pierde) para cualquier base que ya existía en el dispositivo; la
    // tabla nueva simplemente empieza vacía.
    this.version(2).stores({
      syncState: "organizationId",
    });
  }
}

// Memoiza una instancia de Dexie por organización — abrir una base ya
// abierta es barato en Dexie, pero mantener un único objeto por org evita
// conexiones redundantes y hace explícito que "cambiar de organización" es
// simplemente pedir OTRA instancia, nunca reutilizar ni mezclar la actual.
const instances = new Map<string, KipuLocalDB>();

export function getLocalDb(organizationId: string): KipuLocalDB {
  if (!organizationId) {
    throw new Error("getLocalDb requiere un organizationId");
  }
  let db = instances.get(organizationId);
  if (!db) {
    db = new KipuLocalDB(organizationId);
    instances.set(organizationId, db);
  }
  return db;
}

/** Solo para tests: fuerza a que la próxima `getLocalDb` abra una instancia nueva. */
export function resetLocalDbCache(): void {
  instances.clear();
}
