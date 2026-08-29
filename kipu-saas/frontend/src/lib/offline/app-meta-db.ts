import Dexie, { type EntityTable } from "dexie";

/**
 * Única base IndexedDB que NO está scoped a una organización — existe para
 * llevar el registro de "qué organizaciones tienen datos locales en este
 * dispositivo" y cuál está activa. Deliberadamente mínima: nunca contiene
 * catálogo, ventas, ni nada de negocio (eso vive siempre en la base
 * per-organización de `db.ts`) ni tokens (eso vive en `localStorage`).
 */
interface KnownOrganization {
  organizationId: string;
  organizationName: string;
  lastUsedAt: string;
}

class KipuAppMetaDB extends Dexie {
  knownOrganizations!: EntityTable<KnownOrganization, "organizationId">;

  constructor() {
    super("kipu_app_meta");
    this.version(1).stores({
      knownOrganizations: "organizationId, lastUsedAt",
    });
  }
}

let instance: KipuAppMetaDB | null = null;

export function getAppMetaDb(): KipuAppMetaDB {
  if (!instance) instance = new KipuAppMetaDB();
  return instance;
}

/** Registra (o refresca `lastUsedAt`) que esta organización tiene datos locales en este dispositivo — llamado al completar el full sync inicial. */
export async function markOrganizationKnown(
  organizationId: string,
  organizationName: string,
): Promise<void> {
  await getAppMetaDb().knownOrganizations.put({
    organizationId,
    organizationName,
    lastUsedAt: new Date().toISOString(),
  });
}

export async function listKnownOrganizations(): Promise<KnownOrganization[]> {
  return getAppMetaDb().knownOrganizations.orderBy("lastUsedAt").reverse().toArray();
}

/** Solo para tests. */
export function resetAppMetaDbCache(): void {
  instance = null;
}
