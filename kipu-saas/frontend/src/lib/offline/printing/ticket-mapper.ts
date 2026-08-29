import type { LocalSale } from "../types";
import type { TicketData, TicketLineItem, TicketSyncStatus } from "./ticket-data";

/**
 * Espejo mínimo de `ReceiptSnapshot` (backend, `receipts/receipt-snapshot
 * .ts`) — mismo criterio que `ApiProduct`/`ApiCustomer` en
 * `catalog-sync.ts`: nunca se importa el tipo real del backend (proyectos
 * TS separados, sin paquete de tipos compartido), se define acá un
 * espejo con SOLO los campos que este mapper necesita leer. NO se
 * reescribe `ReceiptSnapshot` — se reutiliza su forma tal cual.
 */
export interface ReceiptSnapshotLike {
  documentLabel: string;
  documentType: string;
  issuer: {
    name: string;
    legalName: string;
    nit: string;
    address: string | null;
    phone: string | null;
    branch: { name: string; address: string | null } | null;
    posTerminal: { name: string; code: string } | null;
  };
  operation: {
    fullNumber: string;
    issuedAt: string;
    cashierName: string | null;
    saleId: string;
  };
  customer: { name: string; documentType: string; documentNumber: string } | null;
  items: Array<{
    productName: string;
    sku: string | null;
    quantity: string;
    unitPrice: string;
    discount: string;
    subtotal: string;
  }>;
  totals: { subtotal: string; discount: string; total: string };
  payments: {
    methods: Array<{ method: string; amount: string }>;
    paidTotal: string;
    balance: string;
  };
  observations: string | null;
}

/**
 * Un `ReceiptSnapshot` solo existe para una venta con recibo YA EMITIDO
 * del lado del servidor (`POST /receipts`, Fase Comercial 8) — siempre
 * `"synced"`, con folio real. Conversión directa, sin recalcular nada:
 * el snapshot ya es la fuente de verdad inmutable.
 */
export function ticketFromReceiptSnapshot(snapshot: ReceiptSnapshotLike): TicketData {
  return {
    documentLabel: snapshot.documentLabel,
    documentType: snapshot.documentType,
    business: {
      name: snapshot.issuer.name,
      legalName: snapshot.issuer.legalName,
      nit: snapshot.issuer.nit,
      address: snapshot.issuer.address,
      phone: snapshot.issuer.phone,
    },
    branch: snapshot.issuer.branch,
    posTerminal: snapshot.issuer.posTerminal,
    operation: {
      fullNumber: snapshot.operation.fullNumber,
      localId: snapshot.operation.saleId,
      issuedAt: snapshot.operation.issuedAt,
      cashierName: snapshot.operation.cashierName,
    },
    customer: snapshot.customer,
    items: snapshot.items,
    totals: snapshot.totals,
    payments: snapshot.payments,
    observations: snapshot.observations,
    syncStatus: "synced",
  };
}

/** Datos que el mapper NECESITA pero que `LocalSale` no trae directo — el caller ya los tiene resueltos (de `LocalOrgContext`/`db.products`/`db.customers`), este mapper se mantiene puro y nunca toca Dexie. */
export interface TicketMapperContext {
  organizationName: string;
  /** `LocalOrgContext` no cachea hoy NIT/razón social/dirección/teléfono de la organización (ver docs/architecture.md sección 23) — quedan `null` hasta que una fase futura los agregue al catálogo offline. */
  businessLegalName?: string | null;
  businessNit?: string | null;
  businessAddress?: string | null;
  businessPhone?: string | null;
  branchName?: string | null;
  posTerminalName?: string | null;
  posTerminalCode?: string | null;
  cashierName: string | null;
  customer: { name: string; documentType: string; documentNumber: string } | null;
  /** `productId` → nombre/sku ya resueltos desde `db.products` — `LocalSaleItem` solo guarda el id. */
  products: Map<string, { name: string; sku: string | null }>;
}

/**
 * Convierte una venta LOCAL (offline o recién confirmada) a `TicketData`.
 * `syncStatus` lo decide el CALLER (ya lo tiene vía
 * `sale-sync-state.ts#getSaleSyncState`, función async que consulta
 * Dexie) — este mapper se mantiene síncrono y puro a propósito.
 *
 * Totales: si la venta ya sincronizó (`sale.serverSummary` no nulo), se
 * usan tal cual los del servidor — nunca recalculados localmente, mismo
 * principio que ya aplica el feedback del POS (Offline 3). Si todavía no
 * sincronizó, se calculan a partir del carrito local — es lo mejor
 * disponible offline, y el ticket lo deja explícito con
 * `syncStatus: "pending-sync"`.
 *
 * `operation.fullNumber` SIEMPRE `null` acá — una `LocalSale` nunca tiene
 * un recibo comercial emitido (eso es un flujo separado, `POST
 * /receipts`); inventar un folio a partir de `sale.serverId` sería
 * exactamente lo que la instrucción prohíbe explícitamente. Para un
 * folio real, usar `ticketFromReceiptSnapshot`.
 */
export function ticketFromLocalSale(
  sale: LocalSale,
  ctx: TicketMapperContext,
  syncStatus: TicketSyncStatus,
): TicketData {
  const items: TicketLineItem[] = sale.items.map((item) => {
    const product = ctx.products.get(item.productId);
    const subtotal = (
      Number(item.quantity) * Number(item.unitPrice) - Number(item.discount)
    ).toFixed(2);
    return {
      productName: product?.name ?? `Producto ${item.productId}`,
      sku: product?.sku ?? null,
      quantity: item.quantity,
      unitPrice: item.unitPrice,
      discount: item.discount,
      subtotal,
    };
  });

  const localSubtotal = items.reduce((acc, i) => acc + Number(i.subtotal), 0);
  const localTotal = Math.max(0, localSubtotal - Number(sale.discount));
  const localPaidTotal = sale.payments.reduce((acc, p) => acc + Number(p.amount), 0);
  const localBalance = Math.max(0, localTotal - localPaidTotal);

  const methodTotals = new Map<string, number>();
  for (const p of sale.payments) {
    methodTotals.set(p.method, (methodTotals.get(p.method) ?? 0) + Number(p.amount));
  }

  const server = sale.serverSummary;

  return {
    documentLabel: "RECIBO DE VENTA",
    documentType: "DOCUMENTO COMERCIAL NO FISCAL",
    business: {
      name: ctx.organizationName,
      legalName: ctx.businessLegalName ?? null,
      nit: ctx.businessNit ?? null,
      address: ctx.businessAddress ?? null,
      phone: ctx.businessPhone ?? null,
    },
    branch: ctx.branchName ? { name: ctx.branchName, address: null } : null,
    posTerminal: ctx.posTerminalName
      ? { name: ctx.posTerminalName, code: ctx.posTerminalCode ?? "" }
      : null,
    operation: {
      fullNumber: null,
      localId: sale.id,
      issuedAt: sale.createdAt,
      cashierName: ctx.cashierName,
    },
    customer: ctx.customer,
    items,
    totals: {
      subtotal: localSubtotal.toFixed(2),
      discount: Number(sale.discount).toFixed(2),
      total: server ? server.total : localTotal.toFixed(2),
    },
    payments: {
      methods: [...methodTotals.entries()].map(([method, amount]) => ({
        method,
        amount: amount.toFixed(2),
      })),
      paidTotal: server ? server.paidTotal : localPaidTotal.toFixed(2),
      balance: server ? server.balance : localBalance.toFixed(2),
    },
    observations: null,
    syncStatus,
  };
}
