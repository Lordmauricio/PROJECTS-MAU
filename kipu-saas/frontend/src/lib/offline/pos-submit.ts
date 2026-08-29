import type { KipuLocalDB } from "./db";
import { triggerSync } from "./auto-sync";
import { getSaleSyncState } from "./sale-sync-state";
import { confirmSaleOffline, createSaleOffline } from "./sales-repo";
import { retryManually } from "./sync-queue";
import type { LocalSalePayment } from "./types";

export interface SubmitSaleInput {
  organizationId: string;
  posTerminalId: string;
  warehouseId: string;
  customerId?: string | null;
  discount: number;
  items: { productId: string; quantity: number; unitPrice: number; discount: number }[];
  payments: { method: LocalSalePayment["method"]; amount: number; idempotencyKey: string }[];
}

export interface SubmitSaleResult {
  localSaleId: string;
  outcome: "synced" | "offline-pending" | "conflict" | "error";
  summary?: { status: string; total: string; paidTotal: string; balance: string };
  message?: string;
}

/**
 * ÚNICO camino para registrar una venta desde el POS, con o sin conexión
 * — no hay dos flujos paralelos "online"/"offline" que puedan divergir.
 * Siempre escribe primero en la base local (rápido, nunca depende de la
 * red) y encola la sincronización; el intento de sincronizar de inmediato
 * (`triggerSync`) es lo que hace que, CUANDO hay conexión, el resultado se
 * vea (y se sienta) igual de rápido que el flujo directo que tenía el POS
 * antes — la diferencia solo es visible cuando de verdad no hay red: ahí
 * la venta queda en cola en vez de fallar. Ver `docs/architecture.md`
 * sección 19 para la justificación completa de esta decisión de diseño.
 */
export async function submitSaleOffline(
  db: KipuLocalDB,
  input: SubmitSaleInput,
): Promise<SubmitSaleResult> {
  const sale = await createSaleOffline(db, {
    organizationId: input.organizationId,
    posTerminalId: input.posTerminalId,
    warehouseId: input.warehouseId,
    customerId: input.customerId,
    discount: String(input.discount),
    items: input.items.map((i) => ({
      productId: i.productId,
      quantity: String(i.quantity),
      unitPrice: String(i.unitPrice),
      discount: String(i.discount),
    })),
  });

  await confirmSaleOffline(db, {
    localSaleId: sale.id,
    payments: input.payments.map((p) => ({
      method: p.method,
      amount: String(p.amount),
      idempotencyKey: p.idempotencyKey,
    })),
  });

  await triggerSync(db, input.organizationId);

  return summarize(db, sale.id);
}

async function summarize(db: KipuLocalDB, localSaleId: string): Promise<SubmitSaleResult> {
  const state = await getSaleSyncState(db, localSaleId);
  switch (state.kind) {
    case "synced":
      return { localSaleId, outcome: "synced", summary: state.summary };
    case "conflict":
      return { localSaleId, outcome: "conflict", message: state.message };
    case "error":
      return { localSaleId, outcome: "error", message: state.message };
    default:
      return { localSaleId, outcome: "offline-pending" };
  }
}

/**
 * Reintento MANUAL explícito de una venta en CONFLICT/error (nunca
 * automático — ver `sync-queue.ts#retryManually`). Reintenta las dos
 * operaciones asociadas (crear/confirmar) que estén en ese estado y
 * vuelve a intentar sincronizar de inmediato.
 */
export async function retrySale(
  db: KipuLocalDB,
  organizationId: string,
  localSaleId: string,
): Promise<SubmitSaleResult> {
  const sale = await db.sales.get(localSaleId);
  if (!sale) throw new Error("Venta local no encontrada");

  for (const opId of [sale.createSyncOperationId, sale.confirmSyncOperationId]) {
    if (!opId) continue;
    const op = await db.syncQueue.get(opId);
    if (op && (op.status === "FAILED" || op.status === "CONFLICT")) {
      await retryManually(db, opId);
    }
  }

  await triggerSync(db, organizationId);
  return summarize(db, localSaleId);
}
