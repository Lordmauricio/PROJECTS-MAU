import { PrinterError, type PrinterCapability } from "./types";
import { AsciiFallbackEncoding, type TextEncodingStrategy } from "./text-encoding";
import type { TicketData } from "./ticket-data";

// Comandos ESC/POS mínimos (V1) — subconjunto necesario para un ticket
// comercial sencillo, instrucción explícita del pedido. Nada de códigos de
// barras/QR/imágenes/apertura de cajón todavía (Offline 4.4 sección 11).
const ESC = 0x1b;
const GS = 0x1d;
const LF = 0x0a;

const ALIGN_CODE = { left: 0, center: 1, right: 2 } as const;
type TicketAlignment = keyof typeof ALIGN_CODE;

export interface EncodeOptions {
  /** El caller (`PrinterManager`) decide esto según `PrinterDevice.capabilities` — el encoder nunca asume que la impresora corta sola. */
  cut: boolean;
}

/**
 * Traduce `TicketData` → `Uint8Array` de comandos ESC/POS. Función pura:
 * no conoce impresoras, transportes, Bluetooth/USB/Tauri, React ni el
 * navegador — recibe datos, devuelve bytes. Las capacidades declaradas de
 * la impresora (`capabilities`) gatean qué comandos se emiten: sin
 * `"bold"` nunca manda `ESC E`, sin `"alignment"` nunca manda `ESC a`, sin
 * `"textSize"` nunca manda `GS !`, sin `"cut"` (o `options.cut === false`)
 * nunca manda el corte — nunca se asume que una impresora soporta algo
 * solo porque el protocolo ESC/POS en general lo define.
 */
export class EscPosEncoder {
  constructor(private readonly textEncoding: TextEncodingStrategy = new AsciiFallbackEncoding()) {}

  encode(ticket: TicketData, capabilities: PrinterCapability[], options: EncodeOptions): Uint8Array {
    if (!capabilities.includes("text")) {
      throw new PrinterError(
        "unsupported-capability",
        "La impresora no declara soporte de texto (capability 'text' ausente) — no se puede imprimir nada",
      );
    }
    if (!ticket.items || ticket.items.length === 0) {
      throw new PrinterError("invalid-ticket", "El ticket no tiene ningún ítem");
    }
    if (!ticket.business.name.trim() || !ticket.totals.total.trim()) {
      throw new PrinterError("invalid-ticket", "El ticket no tiene los datos mínimos (nombre del negocio/total)");
    }

    const canBold = capabilities.includes("bold");
    const canAlign = capabilities.includes("alignment");
    const canSize = capabilities.includes("textSize");
    const canCut = capabilities.includes("cut") && options.cut;

    const bytes: number[] = [];
    const push = (...values: number[]) => bytes.push(...values);
    const text = (s: string) => push(...this.textEncoding.encode(s));
    const line = (s = "") => {
      text(s);
      push(LF);
    };
    const align = (a: TicketAlignment) => {
      if (canAlign) push(ESC, 0x61, ALIGN_CODE[a]);
    };
    const bold = (on: boolean) => {
      if (canBold) push(ESC, 0x45, on ? 1 : 0);
    };
    const doubleSize = (on: boolean) => {
      if (canSize) push(GS, 0x21, on ? 0x11 : 0x00);
    };

    push(ESC, 0x40); // ESC @ — inicialización

    align("center");
    bold(true);
    line(ticket.business.name);
    bold(false);
    if (ticket.business.legalName) line(ticket.business.legalName);
    if (ticket.business.nit) line(`NIT: ${ticket.business.nit}`);
    if (ticket.business.address) line(ticket.business.address);
    if (ticket.branch) line(ticket.branch.name);
    if (ticket.posTerminal) line(`POS: ${ticket.posTerminal.name}`);
    line();
    line(ticket.documentLabel);
    bold(true);
    line(ticket.documentType);
    bold(false);
    line("--------------------------------");

    align("left");
    line(`Fecha: ${ticket.operation.issuedAt}`);
    if (ticket.operation.fullNumber) {
      line(`Recibo N.: ${ticket.operation.fullNumber}`);
    } else {
      line(`Venta local: ${ticket.operation.localId}`);
    }
    if (ticket.operation.cashierName) line(`Cajero: ${ticket.operation.cashierName}`);
    if (ticket.syncStatus === "pending-sync") {
      bold(true);
      line("** PENDIENTE DE SINCRONIZAR **");
      bold(false);
    }
    line("--------------------------------");

    if (ticket.customer) {
      line(`Cliente: ${ticket.customer.name}`);
      line(`${ticket.customer.documentType}: ${ticket.customer.documentNumber}`);
      line("--------------------------------");
    }

    for (const item of ticket.items) {
      line(item.productName + (item.sku ? ` (${item.sku})` : ""));
      line(`  ${item.quantity} x ${item.unitPrice} = ${item.subtotal}`);
      if (Number(item.discount) > 0) line(`  Desc: ${item.discount}`);
    }
    line("--------------------------------");

    align("right");
    line(`Subtotal: ${ticket.totals.subtotal}`);
    if (Number(ticket.totals.discount) > 0) line(`Descuento: ${ticket.totals.discount}`);
    bold(true);
    doubleSize(true);
    line(`TOTAL: ${ticket.totals.total}`);
    doubleSize(false);
    bold(false);
    align("left");

    for (const p of ticket.payments.methods) {
      line(`${p.method}: ${p.amount}`);
    }
    line(`Pagado: ${ticket.payments.paidTotal}`);
    if (Number(ticket.payments.balance) > 0) line(`Saldo: ${ticket.payments.balance}`);

    if (ticket.observations) {
      line();
      line(ticket.observations);
    }

    line();
    align("center");
    line("Documento comercial NO fiscal.");
    line("No sustituye la factura exigida por ley.");

    push(LF, LF, LF);
    if (canCut) push(GS, 0x56, 0x00); // GS V 0 — corte total

    return Uint8Array.from(bytes);
  }
}
