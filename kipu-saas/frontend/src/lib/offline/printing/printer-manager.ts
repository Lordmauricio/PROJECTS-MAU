import type { KipuLocalDB } from "../db";
import { newLocalId } from "../ids";
import { EscPosEncoder } from "./esc-pos-encoder";
import type { PrinterTransport, TransportKind, TransportStatus } from "./printer-transport";
import type { TicketData } from "./ticket-data";
import {
  PrinterError,
  type DiscoveredPrinter,
  type PrinterCapability,
  type PrinterDevice,
  type PrinterTransportConfig,
} from "./types";

/** Construye una instancia de transporte LISTA PARA CONECTAR a partir de la config guardada de un `PrinterDevice`. Ninguna se registra por defecto en esta fase — sin fábrica registrada para un `kind`, `connect()` falla con un error claro en vez de intentar tocar hardware que no existe todavía. */
export type TransportFactory = (config: PrinterTransportConfig) => PrinterTransport;

/** Busca impresoras reales de un `kind` — tampoco hay ninguno registrado por defecto en esta fase (`discover()` nunca toca hardware sola). */
export type DiscoverFn = () => Promise<DiscoveredPrinter[]>;

export interface PrinterManagerDeps {
  db: KipuLocalDB;
  organizationId: string;
  transportFactories?: Partial<Record<TransportKind, TransportFactory>>;
  discoverers?: Partial<Record<TransportKind, DiscoverFn>>;
  encoder?: EscPosEncoder;
}

export type SavePrinterInput = Pick<
  PrinterDevice,
  "name" | "transportKind" | "transportConfig" | "capabilities"
> & { isDefault?: boolean };

function buildTestTicket(): TicketData {
  return {
    documentLabel: "PRUEBA DE IMPRESIÓN",
    documentType: "DOCUMENTO COMERCIAL NO FISCAL",
    business: { name: "KIPU", legalName: null, nit: null, address: null, phone: null },
    branch: null,
    posTerminal: null,
    operation: {
      fullNumber: null,
      localId: "test-print",
      issuedAt: new Date().toISOString(),
      cashierName: null,
    },
    customer: null,
    items: [
      {
        productName: "Impresora conectada correctamente",
        sku: null,
        quantity: "1",
        unitPrice: "0.00",
        discount: "0.00",
        subtotal: "0.00",
      },
    ],
    totals: { subtotal: "0.00", discount: "0.00", total: "0.00" },
    payments: { methods: [], paidTotal: "0.00", balance: "0.00" },
    observations: null,
    syncStatus: "synced",
  };
}

/**
 * ÚNICA abstracción que el POS (y, a futuro, la UI de Offline 4.9) necesita
 * para trabajar con impresoras — nunca `navigator.bluetooth`/
 * `navigator.usb`/Tauri directamente. Agregar un transporte real
 * (Offline 4.6+) significa registrar su fábrica acá afuera (en el punto de
 * construcción de `PrinterManager`, ej. en `AppShell`), nunca modificar
 * esta clase.
 *
 * Mantiene las conexiones VIVAS en memoria (`Map<deviceId, PrinterTransport>`)
 * — `PrinterDevice` en Dexie es solo un descriptor persistido, nunca una
 * conexión real. Reiniciar la app siempre empieza desconectado: no hay
 * reconexión automática oculta (ver política de reintentos,
 * docs/architecture.md sección 23).
 */
export class PrinterManager {
  private readonly liveTransports = new Map<string, PrinterTransport>();
  private readonly encoder: EscPosEncoder;

  constructor(private readonly deps: PrinterManagerDeps) {
    this.encoder = deps.encoder ?? new EscPosEncoder();
  }

  async listKnownDevices(): Promise<PrinterDevice[]> {
    return this.deps.db.printers.where("organizationId").equals(this.deps.organizationId).toArray();
  }

  /**
   * V1: nunca toca hardware. Sin un `discoverer` registrado para `kind`
   * (el caso por defecto en esta fase — ninguno lo está), devuelve `[]`
   * sin lanzar. Los tests inyectan un `discoverer` falso para ejercitar
   * el flujo completo sin dispositivo físico.
   */
  async discover(kind: TransportKind): Promise<DiscoveredPrinter[]> {
    const discoverFn = this.deps.discoverers?.[kind];
    if (!discoverFn) return [];
    return discoverFn();
  }

  async save(input: SavePrinterInput): Promise<PrinterDevice> {
    const device: PrinterDevice = {
      id: newLocalId(),
      organizationId: this.deps.organizationId,
      name: input.name,
      transportKind: input.transportKind,
      transportConfig: input.transportConfig,
      capabilities: input.capabilities,
      isDefault: false,
      lastConnectedAt: null,
      createdAt: new Date().toISOString(),
    };
    await this.deps.db.printers.add(device);
    if (input.isDefault) await this.setDefault(device.id);
    return device;
  }

  async getDevice(deviceId: string): Promise<PrinterDevice> {
    const device = await this.deps.db.printers.get(deviceId);
    if (!device || device.organizationId !== this.deps.organizationId) {
      throw new PrinterError("printer-not-found", `Impresora no encontrada: ${deviceId}`);
    }
    return device;
  }

  async connect(deviceId: string): Promise<void> {
    const device = await this.getDevice(deviceId);
    const factory = this.deps.transportFactories?.[device.transportKind];
    if (!factory) {
      throw new PrinterError(
        "connection-failed",
        `El transporte '${device.transportKind}' todavía no está disponible en este build`,
      );
    }
    const transport = factory(device.transportConfig);
    try {
      await transport.connect();
    } catch (err) {
      throw err instanceof PrinterError
        ? err
        : new PrinterError("connection-failed", "No se pudo conectar con la impresora", err);
    }
    this.liveTransports.set(deviceId, transport);
    await this.deps.db.printers.update(deviceId, { lastConnectedAt: new Date().toISOString() });
  }

  async disconnect(deviceId: string): Promise<void> {
    const transport = this.liveTransports.get(deviceId);
    if (!transport) return;
    await transport.disconnect();
    this.liveTransports.delete(deviceId);
  }

  /** `"disconnected"` para cualquier impresora sin conexión viva en esta pestaña — nunca inventa un estado optimista. */
  getStatus(deviceId: string): TransportStatus {
    return this.liveTransports.get(deviceId)?.getStatus() ?? "disconnected";
  }

  async getDefault(): Promise<PrinterDevice | null> {
    const all = await this.listKnownDevices();
    return all.find((d) => d.isDefault) ?? null;
  }

  /** Garantiza, dentro de una transacción Dexie, que a lo sumo UNA impresora quede `isDefault: true` por organización — nunca dos. */
  async setDefault(deviceId: string): Promise<void> {
    const device = await this.getDevice(deviceId);
    await this.deps.db.transaction("rw", this.deps.db.printers, async () => {
      const all = await this.deps.db.printers
        .where("organizationId")
        .equals(this.deps.organizationId)
        .toArray();
      for (const d of all) {
        if (d.isDefault && d.id !== device.id) {
          await this.deps.db.printers.update(d.id, { isDefault: false });
        }
      }
      await this.deps.db.printers.update(device.id, { isDefault: true });
    });
  }

  /** "Olvidar" una impresora — la desconecta primero si estaba conectada, después la elimina del registro local. */
  async forget(deviceId: string): Promise<void> {
    const device = await this.getDevice(deviceId);
    await this.disconnect(device.id);
    await this.deps.db.printers.delete(device.id);
  }

  private async resolveTargetDevice(deviceId?: string): Promise<PrinterDevice> {
    if (deviceId) return this.getDevice(deviceId);
    const def = await this.getDefault();
    if (!def) {
      throw new PrinterError("printer-not-found", "No hay ninguna impresora predeterminada configurada");
    }
    return def;
  }

  private getCapabilities(device: PrinterDevice): PrinterCapability[] {
    return device.capabilities;
  }

  /**
   * Codifica el ticket y lo manda al transporte. NUNCA reintenta sola
   * ante un fallo (ver "política de reintentos de impresión",
   * docs/architecture.md sección 23) — un reintento automático después de
   * un timeout podría duplicar el ticket físico si la impresora ya había
   * recibido parte de los bytes. Cualquier reintento es una acción
   * explícita del usuario, en una fase futura de UI.
   */
  async printTicket(ticket: TicketData, deviceId?: string): Promise<void> {
    const device = await this.resolveTargetDevice(deviceId);
    const transport = this.liveTransports.get(device.id);
    if (!transport) {
      throw new PrinterError(
        "not-connected",
        `La impresora '${device.name}' no está conectada — conectala antes de imprimir`,
      );
    }
    const bytes = this.encoder.encode(ticket, this.getCapabilities(device), {
      cut: device.capabilities.includes("cut"),
    });
    await transport.write(bytes);
  }

  /** Reutiliza el mismo pipeline real (`encode` + `transport.write`) que un ticket de venta — probar que "funciona" significa probar el camino real, no uno separado de mentira. */
  async testPrint(deviceId: string): Promise<void> {
    await this.printTicket(buildTestTicket(), deviceId);
  }
}
