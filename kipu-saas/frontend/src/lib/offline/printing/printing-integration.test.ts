import { describe, expect, it } from "vitest";
import { getLocalDb, resetLocalDbCache } from "../db";
import { uniqueOrgId } from "../test-support/unique";
import type { LocalSale } from "../types";
import { FakePrinterTransport } from "./fake-printer-transport";
import { PrinterManager } from "./printer-manager";
import { ticketFromLocalSale } from "./ticket-mapper";
import type { PrinterCapability } from "./types";

const ESC = 0x1b;
const GS = 0x1d;

function toReadableText(bytes: Uint8Array): string {
  let out = "";
  for (let i = 0; i < bytes.length; i++) {
    const b = bytes[i];
    if (b === ESC) {
      if (bytes[i + 1] === 0x40) i += 1;
      else i += 2;
      continue;
    }
    if (b === GS) {
      i += 2;
      continue;
    }
    out += String.fromCharCode(b);
  }
  return out;
}

/**
 * Flujo completo pedido explícitamente (Offline 4.4, sección 24):
 *
 *   TicketData → PrinterManager → EscPosEncoder → FakePrinterTransport → bytes
 *
 * Reutiliza `ticketFromLocalSale` (no arma un `TicketData` a mano) para
 * que el test ejercite TAMBIÉN la conversión real desde una venta local
 * — el mismo camino que usaría el POS el día que esta arquitectura se
 * conecte a la UI (Offline 4.9+, fuera de esta fase).
 */
describe("Flujo de impresión end-to-end: LocalSale → TicketData → PrinterManager → EscPosEncoder → FakePrinterTransport", () => {
  function saleOfflinePending(): LocalSale {
    return {
      id: "local-sale-integ-1",
      organizationId: "org",
      serverId: null,
      status: "DRAFT_LOCAL",
      posTerminalId: "pos-1",
      warehouseId: "wh-1",
      customerId: "cust-1",
      discount: "0",
      items: [
        { productId: "prod-coca", quantity: "2", unitPrice: "15.00", discount: "0" },
        { productId: "prod-pan", quantity: "1", unitPrice: "8.50", discount: "0" },
      ],
      payments: [{ method: "CASH", amount: "38.50", idempotencyKey: "idem-1" }],
      createSyncOperationId: "op-1",
      confirmSyncOperationId: "op-2",
      createdAt: "2026-03-01T15:30:00.000Z",
      serverSummary: null,
    };
  }

  const capabilities: PrinterCapability[] = ["text", "bold", "alignment", "textSize", "cut"];

  it("venta OFFLINE pendiente: el ticket impreso muestra encabezado, ítems, total, pago, aviso NO FISCAL y el estado pendiente — nunca un folio inventado", async () => {
    const org = uniqueOrgId();
    resetLocalDbCache();
    const db = getLocalDb(org);
    const transport = new FakePrinterTransport("bluetooth");
    const manager = new PrinterManager({
      db,
      organizationId: org,
      transportFactories: { bluetooth: () => transport },
    });

    const printer = await manager.save({
      name: "Impresora de Caja 1",
      transportKind: "bluetooth",
      transportConfig: { address: "AA:BB:CC:DD:EE:FF" },
      capabilities,
      isDefault: true,
    });
    await manager.connect(printer.id);

    const ticket = ticketFromLocalSale(
      saleOfflinePending(),
      {
        organizationName: "Kiosco La Esquina",
        branchName: "Sucursal Centro",
        posTerminalName: "Caja 1",
        posTerminalCode: "POS-1",
        cashierName: "Ana Cajera",
        customer: { name: "Juan Pérez", documentType: "CI", documentNumber: "1234567" },
        products: new Map([
          ["prod-coca", { name: "Coca Cola 2L", sku: "COCA" }],
          ["prod-pan", { name: "Pan integral", sku: "PAN" }],
        ]),
      },
      "pending-sync",
    );

    await manager.printTicket(ticket); // sin deviceId — usa la predeterminada

    const bytes = transport.getLastReceivedBytes();
    expect(bytes).toBeDefined();

    // Comandos ESC/POS esperados: inicialización al principio, corte al final.
    expect(bytes![0]).toBe(ESC);
    expect(bytes![1]).toBe(0x40);
    expect(bytes![bytes!.length - 3]).toBe(GS);
    expect(bytes![bytes!.length - 2]).toBe(0x56);

    const text = toReadableText(bytes!);
    // Encabezado.
    expect(text).toContain("Kiosco La Esquina");
    expect(text).toContain("Sucursal Centro");
    expect(text).toContain("DOCUMENTO COMERCIAL NO FISCAL");
    // Productos y cantidades/precios.
    expect(text).toContain("Coca Cola 2L");
    expect(text).toContain("2 x 15.00 = 30.00");
    expect(text).toContain("Pan integral");
    expect(text).toContain("1 x 8.50 = 8.50");
    // Total.
    expect(text).toContain("TOTAL: 38.50");
    // Método de pago.
    expect(text).toContain("CASH: 38.50");
    // Aviso NO FISCAL.
    expect(text).toContain("Documento comercial NO fiscal");
    // Estado pendiente de sincronizar — nunca un folio de servidor inventado.
    expect(text).toContain("PENDIENTE DE SINCRONIZAR");
    expect(text).toContain("Venta local: local-sale-integ-1");
    expect(text).not.toContain("Recibo N.:");
  });

  it("venta ya SINCRONIZADA (con serverSummary): el ticket usa los totales reales del servidor, sin la marca de pendiente", async () => {
    const org = uniqueOrgId();
    resetLocalDbCache();
    const db = getLocalDb(org);
    const transport = new FakePrinterTransport("bluetooth");
    const manager = new PrinterManager({
      db,
      organizationId: org,
      transportFactories: { bluetooth: () => transport },
    });
    const printer = await manager.save({
      name: "Impresora",
      transportKind: "bluetooth",
      transportConfig: {},
      capabilities,
      isDefault: true,
    });
    await manager.connect(printer.id);

    const syncedSale: LocalSale = {
      ...saleOfflinePending(),
      status: "CONFIRM_SYNCED",
      serverId: "server-sale-real",
      serverSummary: { status: "PAID", total: "38.50", paidTotal: "38.50", balance: "0.00" },
    };
    const ticket = ticketFromLocalSale(
      syncedSale,
      {
        organizationName: "Kiosco La Esquina",
        cashierName: "Ana Cajera",
        customer: null,
        products: new Map([
          ["prod-coca", { name: "Coca Cola 2L", sku: "COCA" }],
          ["prod-pan", { name: "Pan integral", sku: "PAN" }],
        ]),
      },
      "synced",
    );

    await manager.printTicket(ticket);
    const text = toReadableText(transport.getLastReceivedBytes()!);
    expect(text).not.toContain("PENDIENTE DE SINCRONIZAR");
    expect(text).toContain("TOTAL: 38.50");
  });

  it("un fallo de escritura en pleno flujo no imprime dos veces al reintentar manualmente (cada intento es UN write() explícito)", async () => {
    const org = uniqueOrgId();
    resetLocalDbCache();
    const db = getLocalDb(org);
    const transport = new FakePrinterTransport("bluetooth");
    const manager = new PrinterManager({
      db,
      organizationId: org,
      transportFactories: { bluetooth: () => transport },
    });
    const printer = await manager.save({
      name: "Impresora",
      transportKind: "bluetooth",
      transportConfig: {},
      capabilities,
      isDefault: true,
    });
    await manager.connect(printer.id);

    const ticket = ticketFromLocalSale(
      saleOfflinePending(),
      { organizationName: "N", cashierName: null, customer: null, products: new Map() },
      "pending-sync",
    );

    transport.simulateWriteFailure();
    await expect(manager.printTicket(ticket)).rejects.toMatchObject({ code: "write-failed" });
    expect(transport.getReceivedBytes()).toHaveLength(0); // el fallo no dejó nada "recibido"

    // Un fallo de escritura deja el transporte en "error" — ni
    // PrinterManager ni el transporte asumen SOLOS que la conexión sigue
    // siendo confiable después de un write() fallido (podría haber
    // perdido el enlace a mitad de camino). Un reintento real requiere
    // reconectar explícitamente primero — nunca un auto-retry oculto que
    // reintente sobre una conexión de estado incierto.
    expect(manager.getStatus(printer.id)).toBe("error");
    await expect(manager.printTicket(ticket)).rejects.toMatchObject({ code: "not-connected" });

    // Reintento EXPLÍCITO real: reconectar y volver a intentar — una
    // acción nueva del usuario, nunca un retry automático oculto.
    await manager.connect(printer.id);
    await manager.printTicket(ticket);
    expect(transport.getReceivedBytes()).toHaveLength(1); // exactamente una impresión real, nunca duplicada
  });
});
