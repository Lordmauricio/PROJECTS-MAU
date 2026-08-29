/**
 * Tipos de la capa offline (Fase Offline 2). Reflejan un SUBCONJUNTO
 * mínimo de las entidades reales del backend (ver `docs/architecture.md`
 * sección 18 para el detalle de qué se descarga y por qué) — nunca una
 * copia completa del esquema de Postgres. Los campos de dinero se guardan
 * como `string` (igual que ya hace `lib/api.ts` con las respuestas del
 * backend, que serializa `Prisma.Decimal` a texto) — nunca `number` — y se
 * convierten a `Prisma.Decimal`-equivalente solo del lado del servidor al
 * sincronizar. La capa offline no hace aritmética financiera propia; solo
 * transporta los mismos strings que ya circulan hoy entre frontend y
 * backend.
 */

export type ConnectionState =
  | "ONLINE"
  | "OFFLINE"
  | "SYNCING"
  | "PENDING"
  | "ERROR";

/** Catálogo de producto cacheado localmente — solo lo que el POS necesita para vender, no el modelo completo de `products`. */
export interface LocalProduct {
  id: string; // id real del servidor (cuid) — el catálogo siempre se lee, nunca se crea offline en V1
  organizationId: string;
  name: string;
  sku: string | null;
  barcode: string | null;
  price: string; // Decimal-como-string, igual que ya sirve `GET /products`
  active: boolean;
  updatedAt: string; // `Product.updatedAt` del servidor, para una futura sincronización incremental
  cachedAt: string; // cuándo se guardó localmente esta copia
}

/** Cliente cacheado localmente. */
export interface LocalCustomer {
  id: string;
  organizationId: string;
  name: string;
  documentType: string | null;
  documentNumber: string | null;
  phone: string | null;
  email: string | null;
  active: boolean;
  updatedAt: string;
  cachedAt: string;
}

/**
 * Contexto de organización/sucursal necesario para poder crear una venta
 * offline Y construir un ticket comercial NO fiscal completo sin red
 * (Offline 4.5) — un solo registro por base local (una base local = una
 * organización, ver `db.ts`).
 *
 * Los campos `business*`/`branch*`/`posTerminal*` reflejan 1:1 los nombres
 * reales del backend (`Organization.legalName/nit/address/phone/logoUrl`,
 * `Branch.name/address`, `POSTerminal.name/code` — ver `GET /organizations
 * /me` y `GET /branches`) — nunca un nombre de propiedad inventado. No hay
 * versión nueva de Dexie para agregarlos: son propiedades del objeto
 * guardado en `orgContext`, no un índice nuevo (`db.ts` solo declara
 * `organizationId` como índice de esta tabla), así que Dexie no necesita
 * ninguna migración de esquema para persistirlos.
 */
export interface LocalOrgContext {
  organizationId: string;
  organizationName: string; // `Organization.name` (nombre comercial)
  businessLegalName: string; // `Organization.legalName` (razón social)
  businessNit: string; // `Organization.nit`
  businessAddress: string | null; // `Organization.address`
  businessPhone: string | null; // `Organization.phone`
  /** `Organization.logoUrl` — solo la URL, nunca se descarga/cachea la imagen (ver docs/architecture.md sección 24: sin sistema de imágenes en esta fase, el ticket ESC/POS es texto puro). */
  businessLogoUrl: string | null;
  branchId: string;
  branchName: string; // `Branch.name`
  branchAddress: string | null; // `Branch.address`
  warehouseId: string;
  posTerminalId: string;
  posTerminalName: string; // `POSTerminal.name`
  posTerminalCode: string; // `POSTerminal.code`
  userId: string;
  userName: string;
  roleKey: string | null;
  fetchedAt: string;
}

/**
 * Cursor de sincronización incremental de catálogo (Offline 4.3) — un solo
 * registro por base local, igual que `LocalOrgContext` (una base física ya
 * es una sola organización, así que el aislamiento multi-tenant viene
 * gratis por construcción, sin necesitar lógica propia). `productsUpdatedAt`
 * / `customersUpdatedAt` son el `updatedAt` MÁXIMO del servidor ya
 * aplicado localmente — nunca `Date.now()` del dispositivo (ver
 * `catalog-sync.ts`): el reloj del dispositivo puede estar mal, la marca
 * del servidor no.
 */
export interface CatalogSyncState {
  organizationId: string;
  productsUpdatedAt: string | null;
  customersUpdatedAt: string | null;
  lastFullSyncAt: string | null;
  lastIncrementalSyncAt: string | null;
}

export type LocalSaleStatus = "DRAFT_LOCAL" | "CREATE_SYNCED" | "CONFIRM_SYNCED";

export interface LocalSaleItem {
  productId: string;
  quantity: string;
  unitPrice: string;
  discount: string;
}

export interface LocalSalePayment {
  method: "CASH" | "CARD" | "TRANSFER" | "QR";
  amount: string;
  idempotencyKey: string;
}

/**
 * Venta creada offline. `id` es un `localId` (ver `ids.ts`) hasta que la
 * operación `sales.create` sincroniza — en ese momento `serverId` se
 * completa con el id real que asignó Postgres (`cuid()`), pero `id` (la
 * clave local) NUNCA cambia: es la referencia estable que usa el resto de
 * la app mientras la venta todavía no tiene contraparte en el servidor.
 */
export interface LocalSale {
  id: string; // localId — clave primaria de esta tabla
  organizationId: string;
  serverId: string | null; // se completa cuando `sales.create` sincroniza
  status: LocalSaleStatus;
  posTerminalId: string;
  warehouseId: string;
  customerId: string | null;
  discount: string;
  items: LocalSaleItem[];
  payments: LocalSalePayment[];
  createSyncOperationId: string; // qué fila de sync_queue creó esta venta
  confirmSyncOperationId: string | null; // qué fila de sync_queue la confirmó (si ya se encoló)
  createdAt: string;
  // Capturado desde la respuesta real del servidor al reconciliar
  // `sales.confirm` (ver `sync-engine.ts#reconcileEntity`) — nunca
  // calculado localmente. Permite que el POS muestre el mismo feedback
  // rico ("Venta confirmada (PAID). Total Bs X") tanto si la sincronización
  // ocurrió al instante (online) como más tarde (offline reconectado),
  // sin tener que volver a pedirle el detalle al servidor.
  serverSummary: {
    status: string;
    total: string;
    paidTotal: string;
    balance: string;
  } | null;
}

export type SyncOperationName =
  | "sales.create"
  | "sales.confirm";

export type SyncStatus = "PENDING" | "SYNCING" | "SYNCED" | "FAILED" | "CONFLICT";

/**
 * Una fila de la cola de sincronización. Representa UN request HTTP en
 * espera — no la entidad de negocio (`entityId` la referencia, no la
 * contiene) ni la garantía de idempotencia (`idempotencyKey` es un campo
 * propio, ver `ids.ts`).
 */
export interface SyncQueueItem {
  id: string; // syncOperationId
  organizationId: string;
  operation: SyncOperationName;
  entity: "Sale";
  entityId: string; // localId de la entidad afectada (`LocalSale.id`)
  idempotencyKey: string;
  method: "POST";
  // Plantilla de path: puede contener el marcador literal `{serverId}`,
  // reemplazado en el momento de enviar por el `serverId` ya resuelto de
  // `entityId` (ver `sync-engine.ts`) — nunca se arma con el id local.
  path: string;
  payload: unknown;
  // Debe estar SYNCED antes de que esta operación sea elegible — nunca se
  // procesan en paralelo dos operaciones con una dependencia entre sí.
  dependsOn: string[] | null;
  createdAt: string;
  attempts: number;
  lastAttemptAt: string | null;
  status: SyncStatus;
  error: string | null;
  nextRetryAt: string | null;
  // Bloqueo optimista contra dos Sync Engines procesando la misma fila a
  // la vez (ver `sync-queue.ts#claimNext`) — dos pestañas del mismo
  // origen comparten la misma base IndexedDB.
  lockedBy: string | null;
  lockedAt: string | null;
  // Se completa cuando la respuesta del servidor trae un id propio (ej. el
  // `id` de la `Sale` creada) — la pieza que permite que una operación
  // posterior sobre la MISMA entidad (`sales.confirm`) resuelva el
  // `{serverId}` de su propio `path`.
  resultServerId: string | null;
}
