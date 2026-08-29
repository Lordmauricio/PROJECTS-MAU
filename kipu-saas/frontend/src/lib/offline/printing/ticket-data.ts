/**
 * Modelo de datos de un ticket — independiente del backend específico
 * (nunca importa `ReceiptSnapshot` del backend, ver `ticket-mapper.ts` para
 * las conversiones) e independiente de ESC/POS (`EscPosEncoder` es quien
 * sabe traducir esto a bytes; este archivo no sabe nada de comandos ni de
 * impresoras).
 *
 * SIEMPRE "DOCUMENTO COMERCIAL NO FISCAL" — este ticket nunca representa
 * una factura fiscal. Cero campos de CUF/CUIS/CUFD/impuestos/firma
 * digital: ese alcance sigue completamente fuera de esta iniciativa.
 */

export interface TicketLineItem {
  productName: string;
  sku: string | null;
  quantity: string;
  unitPrice: string;
  discount: string;
  subtotal: string;
}

export interface TicketPaymentLine {
  method: string;
  amount: string;
}

/**
 * `"pending-sync"`: la venta todavía no confirmó con el servidor — el
 * ticket debe dejarlo explícito (nunca mostrar un folio o unos totales
 * como si fueran definitivos) y `operation.fullNumber` debe ser `null`
 * (nunca un folio inventado localmente, instrucción explícita del
 * pedido). `"synced"`: ya confirmó — los totales/folio (si existe recibo
 * emitido) son los reales del servidor.
 */
export type TicketSyncStatus = "synced" | "pending-sync";

export interface TicketData {
  documentLabel: string;
  documentType: string;
  business: {
    name: string;
    legalName: string | null;
    nit: string | null;
    address: string | null;
    phone: string | null;
  };
  branch: { name: string; address: string | null } | null;
  posTerminal: { name: string; code: string } | null;
  operation: {
    /** Folio real del SERVIDOR (`series-000123`) — solo si existe un recibo comercial ya emitido. Nunca un valor inventado localmente. */
    fullNumber: string | null;
    /** Identificador local — SIEMPRE disponible, sincronizada o no (`LocalSale.id`, o el id real una vez que se conoce). */
    localId: string;
    issuedAt: string;
    cashierName: string | null;
  };
  customer: { name: string; documentType: string; documentNumber: string } | null;
  items: TicketLineItem[];
  totals: { subtotal: string; discount: string; total: string };
  payments: { methods: TicketPaymentLine[]; paidTotal: string; balance: string };
  observations: string | null;
  syncStatus: TicketSyncStatus;
}
