import { PDFDocument, StandardFonts, rgb, type PDFFont } from "pdf-lib";
import type { TicketData } from "./ticket-data";

/**
 * Offline 4.6B — Ticket PDF térmico 80mm. Renderer INDEPENDIENTE de React,
 * del POS, de `PrinterManager` y de `EscPosEncoder`/ESC/POS/Bluetooth/USB
 * (instrucción explícita): recibe un `TicketData` puro (Offline 4.4/4.5) y
 * devuelve bytes de un PDF — nada más. Se puede probar con datos de mentira
 * sin ningún hardware ni servidor.
 *
 * `pdf-lib` (MIT, sin dependencias nativas, corre igual en Node y en el
 * navegador) en vez de `pdfkit` (lo que ya usa el backend en
 * `receipt-pdf.util.ts`): pdfkit es una librería de STREAMING pensada para
 * Node — su build para navegador existe pero es pesada y no encaja con
 * "sin React, testeable sin hardware, chica". `pdf-lib` en cambio expone un
 * modelo de documento en memoria: se arman las líneas del ticket PRIMERO
 * (calculando su ancho con las métricas reales de la fuente), se suma su
 * alto, y RECIÉN AHÍ se crea la página con la altura EXACTA que necesita el
 * contenido — a diferencia del PDF térmico del backend (altura fija
 * generosa de 1500pt con paginación si no alcanza), acá la página es
 * SIEMPRE una sola, con el alto real del ticket. Ningún acento español
 * necesita una fuente incrustada: las 14 fuentes estándar de PDF (acá
 * Helvetica/Helvetica-Bold) usan codificación WinAnsi por defecto, que YA
 * cubre á/é/í/ó/ú/ü/ñ/Ñ — nunca la transliteración ASCII que sí hace falta
 * para ESC/POS (`text-encoding.ts`), porque un PDF no depende del codepage
 * de una impresora física.
 */

const MM = 2.834645669; // 1mm en puntos PDF — misma constante que `receipt-pdf.util.ts`
const PAGE_WIDTH = 80 * MM; // ancho térmico real, nunca A4 reducido
const MARGIN_X = 8;
const MARGIN_TOP = 12;
const MARGIN_BOTTOM = 12;
const CONTENT_WIDTH = PAGE_WIDTH - MARGIN_X * 2;
const LINE_HEIGHT_FACTOR = 1.28;
const SEPARATOR_HEIGHT = 8;

type Align = "left" | "center" | "right";
type Color = { r: number; g: number; b: number };

const RED = { r: 0.69, g: 0, b: 0.13 };
const GRAY = { r: 0.4, g: 0.4, b: 0.4 };
const BLACK = { r: 0, g: 0, b: 0 };

interface TextLine {
  kind: "text";
  text: string;
  size: number;
  bold: boolean;
  align: Align;
  color: Color;
  gapAfter: number;
}
interface SeparatorLine {
  kind: "separator";
  gapAfter: number;
}
type Line = TextLine | SeparatorLine;

/**
 * Word-wrap greedy usando las métricas REALES de la fuente (no un límite de
 * caracteres a ojo) — necesario porque Helvetica es proporcional, no
 * monoespaciada. Una palabra sola más ancha que `maxWidth` (nombre de
 * producto sin espacios, poco común pero posible) se corta letra por letra
 * como salvaguarda — nunca se deja desbordar el ancho térmico.
 */
function wrapText(font: PDFFont, text: string, size: number, maxWidth: number): string[] {
  const words = text.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return [""];
  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (font.widthOfTextAtSize(candidate, size) <= maxWidth) {
      current = candidate;
      continue;
    }
    if (current) lines.push(current);
    if (font.widthOfTextAtSize(word, size) <= maxWidth) {
      current = word;
      continue;
    }
    let chunk = "";
    for (const ch of word) {
      const test = chunk + ch;
      if (chunk && font.widthOfTextAtSize(test, size) > maxWidth) {
        lines.push(chunk);
        chunk = ch;
      } else {
        chunk = test;
      }
    }
    current = chunk;
  }
  if (current) lines.push(current);
  return lines;
}

class TicketLayout {
  private readonly lines: Line[] = [];
  constructor(private readonly regular: PDFFont, private readonly bold: PDFFont) {}

  text(
    content: string,
    opts: { size?: number; bold?: boolean; align?: Align; color?: Color; gapAfter?: number } = {},
  ): void {
    const size = opts.size ?? 8;
    const font = opts.bold ? this.bold : this.regular;
    const wrapped = wrapText(font, content, size, CONTENT_WIDTH);
    wrapped.forEach((text, i) => {
      this.lines.push({
        kind: "text",
        text,
        size,
        bold: opts.bold ?? false,
        align: opts.align ?? "left",
        color: opts.color ?? BLACK,
        gapAfter: i === wrapped.length - 1 ? (opts.gapAfter ?? 0) : 0,
      });
    });
  }

  separator(gapAfter = 4): void {
    this.lines.push({ kind: "separator", gapAfter });
  }

  spacer(height: number): void {
    if (this.lines.length === 0) return;
    this.lines[this.lines.length - 1].gapAfter += height;
  }

  get all(): readonly Line[] {
    return this.lines;
  }

  contentHeight(): number {
    return this.lines.reduce((acc, l) => {
      const own = l.kind === "text" ? l.size * LINE_HEIGHT_FACTOR : SEPARATOR_HEIGHT;
      return acc + own + l.gapAfter;
    }, 0);
  }
}

function xFor(align: Align, textWidth: number): number {
  if (align === "center") return MARGIN_X + (CONTENT_WIDTH - textWidth) / 2;
  if (align === "right") return MARGIN_X + CONTENT_WIDTH - textWidth;
  return MARGIN_X;
}

function money(value: string): string {
  const n = Number(value);
  return Number.isFinite(n) ? n.toFixed(2) : value;
}

/** Fecha/hora del ticket: SIEMPRE `ticket.operation.issuedAt` tal cual lo trae `TicketData` — nunca `new Date()` del dispositivo al momento de generar el PDF (ver `ticket-mapper.ts`: para una venta offline es `LocalSale.createdAt`, nunca la hora del servidor). */
function formatIssuedAt(isoDate: string): string {
  const d = new Date(isoDate);
  if (Number.isNaN(d.getTime())) return isoDate;
  return d.toLocaleString("es-BO", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function buildLayout(layout: TicketLayout, ticket: TicketData): void {
  // Encabezado — negocio.
  layout.text(ticket.business.name, { size: 12, bold: true, align: "center" });
  if (ticket.business.legalName) {
    layout.text(ticket.business.legalName, { size: 7.5, align: "center" });
  }
  if (ticket.business.nit) {
    layout.text(`NIT: ${ticket.business.nit}`, { size: 7.5, align: "center" });
  }
  if (ticket.business.address) {
    layout.text(ticket.business.address, { size: 7.5, align: "center" });
  }
  if (ticket.business.phone) {
    layout.text(`Tel: ${ticket.business.phone}`, { size: 7.5, align: "center", gapAfter: 2 });
  }
  layout.separator();

  if (ticket.branch) layout.text(`Sucursal: ${ticket.branch.name}`, { size: 7.5 });
  if (ticket.posTerminal) {
    layout.text(`Punto de venta: ${ticket.posTerminal.name}`, { size: 7.5, gapAfter: 2 });
  }

  // Operación — folio real solo si existe; nunca inventado.
  if (ticket.operation.fullNumber) {
    layout.text(`Venta: ${ticket.operation.fullNumber}`, { size: 8, bold: true });
  } else {
    layout.text(`Venta: ${ticket.operation.localId}`, { size: 8 });
  }
  layout.text(`Fecha: ${formatIssuedAt(ticket.operation.issuedAt)}`, { size: 7.5 });
  if (ticket.operation.cashierName) {
    layout.text(`Cajero: ${ticket.operation.cashierName}`, { size: 7.5 });
  }
  if (ticket.syncStatus === "pending-sync") {
    layout.text("PENDIENTE DE SINCRONIZAR", { size: 7.5, bold: true, color: RED, gapAfter: 2 });
  }
  layout.separator();

  // Cliente.
  if (ticket.customer) {
    layout.text(`Cliente: ${ticket.customer.name}`, { size: 7.5 });
    if (ticket.customer.documentType || ticket.customer.documentNumber) {
      layout.text(`${ticket.customer.documentType}: ${ticket.customer.documentNumber}`, { size: 7.5 });
    }
  } else {
    layout.text("Cliente ocasional", { size: 7.5 });
  }
  layout.separator();

  // Productos — nombre en su propia línea (envuelto si hace falta) +
  // "cant x precio = subtotal" debajo, igual que `EscPosEncoder` — más
  // robusto que una tabla de columnas fijas frente a nombres largos.
  for (const item of ticket.items) {
    const label = item.sku ? `${item.productName} (${item.sku})` : item.productName;
    layout.text(label, { size: 7.5, bold: true });
    layout.text(`  ${item.quantity} x ${money(item.unitPrice)} = ${money(item.subtotal)}`, { size: 7.5 });
    if (Number(item.discount) > 0) {
      layout.text(`  Descuento: ${money(item.discount)}`, { size: 7, color: GRAY });
    }
  }
  layout.separator();

  // Totales.
  layout.text(`Subtotal: ${money(ticket.totals.subtotal)}`, { size: 7.5, align: "right" });
  if (Number(ticket.totals.discount) > 0) {
    layout.text(`Descuento: ${money(ticket.totals.discount)}`, { size: 7.5, align: "right" });
  }
  layout.text(`TOTAL: ${money(ticket.totals.total)}`, { size: 11, bold: true, align: "right", gapAfter: 3 });

  // Pagos.
  for (const p of ticket.payments.methods) {
    layout.text(`${p.method}: ${money(p.amount)}`, { size: 7.5 });
  }
  layout.text(`Pagado: ${money(ticket.payments.paidTotal)}`, { size: 7.5 });
  if (Number(ticket.payments.balance) > 0) {
    layout.text(`Saldo pendiente: ${money(ticket.payments.balance)}`, { size: 7.5, bold: true });
  }

  if (ticket.observations) {
    layout.separator();
    layout.text(ticket.observations, { size: 7 });
  }

  layout.separator(6);
  layout.text(ticket.documentType || "DOCUMENTO COMERCIAL NO FISCAL", {
    size: 7,
    bold: true,
    align: "center",
    color: RED,
  });
  layout.text("No sustituye la factura exigida por ley.", { size: 6.5, align: "center", color: GRAY });
}

/**
 * `TicketData → PDF` — la única entrada pública de este módulo. No lanza
 * excepciones de negocio propias: si `ticket.items` está vacío o faltan
 * datos mínimos, igual genera un PDF válido (aunque corto) — a diferencia
 * de `EscPosEncoder`, que SÍ valida estrictamente porque escribe a hardware
 * real, acá "nunca bloquear una venta por el PDF" (instrucción explícita)
 * pesa más que una validación estricta.
 */
export async function renderThermalPdf(ticket: TicketData): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const regular = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);

  const layout = new TicketLayout(regular, bold);
  buildLayout(layout, ticket);

  const pageHeight = MARGIN_TOP + layout.contentHeight() + MARGIN_BOTTOM;
  const page = doc.addPage([PAGE_WIDTH, pageHeight]);

  let cursorY = pageHeight - MARGIN_TOP;
  for (const line of layout.all) {
    if (line.kind === "separator") {
      const y = cursorY - SEPARATOR_HEIGHT / 2;
      page.drawLine({
        start: { x: MARGIN_X, y },
        end: { x: MARGIN_X + CONTENT_WIDTH, y },
        thickness: 0.5,
        color: rgb(GRAY.r, GRAY.g, GRAY.b),
      });
      cursorY -= SEPARATOR_HEIGHT + line.gapAfter;
      continue;
    }
    const font = line.bold ? bold : regular;
    const width = font.widthOfTextAtSize(line.text, line.size);
    const x = xFor(line.align, width);
    const baselineY = cursorY - line.size;
    page.drawText(line.text, {
      x,
      y: baselineY,
      size: line.size,
      font,
      color: rgb(line.color.r, line.color.g, line.color.b),
    });
    cursorY -= line.size * LINE_HEIGHT_FACTOR + line.gapAfter;
  }

  return doc.save();
}
