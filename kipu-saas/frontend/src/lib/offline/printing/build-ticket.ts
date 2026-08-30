import type { KipuLocalDB } from "../db";
import { getSaleSyncState } from "../sale-sync-state";
import type { LocalOrgContext } from "../types";
import { ticketContextFromOrgContext } from "./ticket-context";
import type { TicketData, TicketSyncStatus } from "./ticket-data";
import { ticketFromLocalSale } from "./ticket-mapper";

/**
 * Arma el `TicketData` completo de una venta local — el paso que conecta
 * "una venta ya en IndexedDB" con "algo que `renderThermalPdf` puede
 * convertir en PDF", sin ninguna llamada de red (Offline 4.6B). Reutiliza
 * `getSaleSyncState` (Offline 3) para decidir `pending-sync` vs `synced`
 * en vez de reinventar esa lógica de estados: CUALQUIER estado que no sea
 * `"synced"` (offline-pending, syncing, conflict, error) se trata como
 * `pending-sync` para el ticket — nunca se muestra un folio como
 * definitivo si el servidor todavía no confirmó la venta de verdad.
 */
export async function buildTicketFromLocalSale(
  db: KipuLocalDB,
  orgContext: LocalOrgContext,
  localSaleId: string,
): Promise<TicketData> {
  const sale = await db.sales.get(localSaleId);
  if (!sale) throw new Error("Venta local no encontrada");

  const [customerLocal, productRows, state] = await Promise.all([
    sale.customerId ? db.customers.get(sale.customerId) : Promise.resolve(undefined),
    db.products.bulkGet(sale.items.map((i) => i.productId)),
    getSaleSyncState(db, localSaleId),
  ]);

  const customer = customerLocal
    ? {
        name: customerLocal.name,
        documentType: customerLocal.documentType ?? "",
        documentNumber: customerLocal.documentNumber ?? "",
      }
    : null;

  const products = new Map(
    productRows
      .filter((p): p is NonNullable<typeof p> => Boolean(p))
      .map((p) => [p.id, { name: p.name, sku: p.sku }] as const),
  );

  const syncStatus: TicketSyncStatus = state.kind === "synced" ? "synced" : "pending-sync";
  const ctx = ticketContextFromOrgContext(orgContext, customer, products);
  return ticketFromLocalSale(sale, ctx, syncStatus);
}
