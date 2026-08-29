import { describe, expect, it } from "vitest";
import { EscPosEncoder } from "./esc-pos-encoder";
import { PrinterError, type PrinterCapability } from "./types";
import type { TicketData } from "./ticket-data";

const ESC = 0x1b;
const GS = 0x1d;
const LF = 0x0a;

const FULL_CAPABILITIES: PrinterCapability[] = ["text", "bold", "alignment", "textSize", "cut"];

function baseTicket(overrides: Partial<TicketData> = {}): TicketData {
  return {
    documentLabel: "RECIBO DE VENTA",
    documentType: "DOCUMENTO COMERCIAL NO FISCAL",
    business: { name: "Mi Negocio", legalName: null, nit: null, address: null, phone: null },
    branch: null,
    posTerminal: null,
    operation: {
      fullNumber: null,
      localId: "local-1",
      issuedAt: "2026-01-01T10:00:00.000Z",
      cashierName: null,
    },
    customer: null,
    items: [
      {
        productName: "Coca Cola 2L",
        sku: "COCA",
        quantity: "1",
        unitPrice: "15.00",
        discount: "0.00",
        subtotal: "15.00",
      },
    ],
    totals: { subtotal: "15.00", discount: "0.00", total: "15.00" },
    payments: { methods: [{ method: "CASH", amount: "15.00" }], paidTotal: "15.00", balance: "0.00" },
    observations: null,
    syncStatus: "synced",
    ...overrides,
  };
}

/** Decodifica los bytes a texto plano ASCII, ignorando cualquier byte de comando ESC/GS conocido — para poder hacer aserciones legibles de CONTENIDO sin acoplarse a la posición exacta de cada byte. */
function toReadableText(bytes: Uint8Array): string {
  let out = "";
  for (let i = 0; i < bytes.length; i++) {
    const b = bytes[i];
    if (b === ESC) {
      // ESC @ (2 bytes), ESC a n (3 bytes), ESC E n (3 bytes)
      if (bytes[i + 1] === 0x40) i += 1;
      else i += 2;
      continue;
    }
    if (b === GS) {
      i += 2; // GS ! n / GS V n (3 bytes cada uno)
      continue;
    }
    out += String.fromCharCode(b);
  }
  return out;
}

function countOccurrences(bytes: Uint8Array, seq: number[]): number {
  let count = 0;
  outer: for (let i = 0; i <= bytes.length - seq.length; i++) {
    for (let j = 0; j < seq.length; j++) {
      if (bytes[i + j] !== seq[j]) continue outer;
    }
    count++;
  }
  return count;
}

describe("EscPosEncoder — comandos mínimos V1", () => {
  const encoder = new EscPosEncoder();

  // 1
  it("inicialización: el ticket siempre empieza con ESC @", () => {
    const bytes = encoder.encode(baseTicket(), FULL_CAPABILITIES, { cut: false });
    expect(bytes[0]).toBe(ESC);
    expect(bytes[1]).toBe(0x40);
  });

  // 2
  it("texto: el nombre del negocio y los ítems aparecen como texto legible", () => {
    const bytes = encoder.encode(baseTicket(), FULL_CAPABILITIES, { cut: false });
    const text = toReadableText(bytes);
    expect(text).toContain("Mi Negocio");
    expect(text).toContain("Coca Cola 2L");
  });

  // 3
  it("saltos de línea: cada línea termina en LF (0x0A)", () => {
    const bytes = encoder.encode(baseTicket(), FULL_CAPABILITIES, { cut: false });
    expect(countOccurrences(bytes, [LF])).toBeGreaterThan(5);
  });

  // 4, 5, 6 — alineación izquierda/centro/derecha
  it("alineación: emite ESC a 1 (centro) para el encabezado del negocio", () => {
    const bytes = encoder.encode(baseTicket(), FULL_CAPABILITIES, { cut: false });
    expect(countOccurrences(bytes, [ESC, 0x61, 1])).toBeGreaterThanOrEqual(1);
  });

  it("alineación: emite ESC a 0 (izquierda) para el detalle de ítems", () => {
    const bytes = encoder.encode(baseTicket(), FULL_CAPABILITIES, { cut: false });
    expect(countOccurrences(bytes, [ESC, 0x61, 0])).toBeGreaterThanOrEqual(1);
  });

  it("alineación: emite ESC a 2 (derecha) para el total", () => {
    const bytes = encoder.encode(baseTicket(), FULL_CAPABILITIES, { cut: false });
    expect(countOccurrences(bytes, [ESC, 0x61, 2])).toBeGreaterThanOrEqual(1);
  });

  it("sin la capability 'alignment', NUNCA emite ESC a — ninguna impresora sin esa capacidad recibe un comando que no declaró soportar", () => {
    const caps = FULL_CAPABILITIES.filter((c) => c !== "alignment");
    const bytes = encoder.encode(baseTicket(), caps, { cut: false });
    expect(countOccurrences(bytes, [ESC, 0x61, 0])).toBe(0);
    expect(countOccurrences(bytes, [ESC, 0x61, 1])).toBe(0);
    expect(countOccurrences(bytes, [ESC, 0x61, 2])).toBe(0);
  });

  // 7
  it("negrita: activa (ESC E 1) y desactiva (ESC E 0) alrededor del nombre del negocio", () => {
    const bytes = encoder.encode(baseTicket(), FULL_CAPABILITIES, { cut: false });
    expect(countOccurrences(bytes, [ESC, 0x45, 1])).toBeGreaterThanOrEqual(1);
    expect(countOccurrences(bytes, [ESC, 0x45, 0])).toBeGreaterThanOrEqual(1);
  });

  it("sin la capability 'bold', nunca emite ESC E", () => {
    const caps = FULL_CAPABILITIES.filter((c) => c !== "bold");
    const bytes = encoder.encode(baseTicket(), caps, { cut: false });
    expect(countOccurrences(bytes, [ESC, 0x45, 1])).toBe(0);
    expect(countOccurrences(bytes, [ESC, 0x45, 0])).toBe(0);
  });

  // 8
  it("tamaño: el TOTAL se imprime en tamaño doble (GS ! 0x11) cuando la impresora lo soporta", () => {
    const bytes = encoder.encode(baseTicket(), FULL_CAPABILITIES, { cut: false });
    expect(countOccurrences(bytes, [GS, 0x21, 0x11])).toBeGreaterThanOrEqual(1);
    expect(countOccurrences(bytes, [GS, 0x21, 0x00])).toBeGreaterThanOrEqual(1); // vuelve a tamaño normal después
  });

  it("sin la capability 'textSize', nunca emite GS !", () => {
    const caps = FULL_CAPABILITIES.filter((c) => c !== "textSize");
    const bytes = encoder.encode(baseTicket(), caps, { cut: false });
    expect(countOccurrences(bytes, [GS, 0x21, 0x11])).toBe(0);
  });

  // 9
  it("corte: con capability 'cut' y options.cut=true, emite GS V 0 al final", () => {
    const bytes = encoder.encode(baseTicket(), FULL_CAPABILITIES, { cut: true });
    expect(countOccurrences(bytes, [GS, 0x56, 0x00])).toBe(1);
    // El corte va al final del ticket, no en medio.
    const idx = bytes.length - 3;
    expect(bytes[idx]).toBe(GS);
    expect(bytes[idx + 1]).toBe(0x56);
  });

  // 10
  it("corte DESACTIVADO explícitamente (options.cut=false): nunca emite GS V, aunque la impresora declare soportarlo", () => {
    const bytes = encoder.encode(baseTicket(), FULL_CAPABILITIES, { cut: false });
    expect(countOccurrences(bytes, [GS, 0x56, 0x00])).toBe(0);
  });

  it("corte: sin la capability 'cut', nunca emite GS V aunque options.cut=true (nunca asume soporte)", () => {
    const caps = FULL_CAPABILITIES.filter((c) => c !== "cut");
    const bytes = encoder.encode(baseTicket(), caps, { cut: true });
    expect(countOccurrences(bytes, [GS, 0x56, 0x00])).toBe(0);
  });

  // 11
  it("ticket sin ítems: lanza PrinterError('invalid-ticket'), nunca imprime nada a medias", () => {
    expect(() => encoder.encode(baseTicket({ items: [] }), FULL_CAPABILITIES, { cut: false })).toThrow(
      PrinterError,
    );
    try {
      encoder.encode(baseTicket({ items: [] }), FULL_CAPABILITIES, { cut: false });
    } catch (err) {
      expect(err).toBeInstanceOf(PrinterError);
      expect((err as PrinterError).code).toBe("invalid-ticket");
    }
  });

  it("ticket sin nombre de negocio: lanza PrinterError('invalid-ticket')", () => {
    const ticket = baseTicket({ business: { name: "", legalName: null, nit: null, address: null, phone: null } });
    expect(() => encoder.encode(ticket, FULL_CAPABILITIES, { cut: false })).toThrow(PrinterError);
  });

  it("sin la capability 'text' (ni siquiera texto plano): lanza PrinterError('unsupported-capability')", () => {
    try {
      encoder.encode(baseTicket(), [], { cut: false });
      throw new Error("no debería llegar acá");
    } catch (err) {
      expect(err).toBeInstanceOf(PrinterError);
      expect((err as PrinterError).code).toBe("unsupported-capability");
    }
  });

  // 12
  it("caracteres especiales (á é í ó ú ñ): se transcriben a ASCII legible, nunca bytes fuera de rango", () => {
    const ticket = baseTicket({
      business: { name: "Panadería Ñañez", legalName: null, nit: null, address: null, phone: null },
    });
    const bytes = encoder.encode(ticket, FULL_CAPABILITIES, { cut: false });
    expect(bytes.every((b) => b <= 127)).toBe(true); // nunca un byte "crudo" > 127 (evita basura en la impresora real)
    const text = toReadableText(bytes);
    expect(text).toContain("Panaderia Nanez"); // tildes/ñ transliteradas, texto legible
  });

  // 13
  it("total: aparece formateado en el ticket", () => {
    const bytes = encoder.encode(baseTicket({ totals: { subtotal: "100.00", discount: "10.00", total: "90.00" } }), FULL_CAPABILITIES, { cut: false });
    const text = toReadableText(bytes);
    expect(text).toContain("TOTAL: 90.00");
    expect(text).toContain("Descuento: 10.00");
  });

  // 14
  it("métodos de pago: cada método/monto aparece, además del total pagado", () => {
    const ticket = baseTicket({
      payments: {
        methods: [
          { method: "CASH", amount: "10.00" },
          { method: "CARD", amount: "5.00" },
        ],
        paidTotal: "15.00",
        balance: "0.00",
      },
    });
    const bytes = encoder.encode(ticket, FULL_CAPABILITIES, { cut: false });
    const text = toReadableText(bytes);
    expect(text).toContain("CASH: 10.00");
    expect(text).toContain("CARD: 5.00");
    expect(text).toContain("Pagado: 15.00");
  });

  // 15
  it("venta pendiente de sincronización: el ticket lo deja explícito, sin folio de servidor", () => {
    const ticket = baseTicket({ syncStatus: "pending-sync", operation: { fullNumber: null, localId: "local-abc", issuedAt: "2026-01-01T10:00:00.000Z", cashierName: null } });
    const bytes = encoder.encode(ticket, FULL_CAPABILITIES, { cut: false });
    const text = toReadableText(bytes);
    expect(text).toContain("PENDIENTE DE SINCRONIZAR");
    expect(text).toContain("Venta local: local-abc");
    expect(text).not.toContain("Recibo N.:");
  });

  it("venta ya sincronizada CON folio real: muestra el número de recibo, no el id local", () => {
    const ticket = baseTicket({ syncStatus: "synced", operation: { fullNumber: "A-000123", localId: "local-abc", issuedAt: "2026-01-01T10:00:00.000Z", cashierName: "Ana" } });
    const bytes = encoder.encode(ticket, FULL_CAPABILITIES, { cut: false });
    const text = toReadableText(bytes);
    expect(text).toContain("Recibo N.: A-000123");
    expect(text).not.toContain("PENDIENTE DE SINCRONIZAR");
    expect(text).toContain("Cajero: Ana");
  });

  it("siempre incluye el aviso NO FISCAL, sin importar el estado de sincronización", () => {
    const bytes = encoder.encode(baseTicket(), FULL_CAPABILITIES, { cut: false });
    const text = toReadableText(bytes);
    expect(text).toContain("DOCUMENTO COMERCIAL NO FISCAL");
    expect(text).toContain("Documento comercial NO fiscal");
  });
});
