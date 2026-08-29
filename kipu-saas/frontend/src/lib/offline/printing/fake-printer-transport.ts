import { PrinterError } from "./types";
import type { PrinterTransport, TransportKind, TransportStatus } from "./printer-transport";

/**
 * Transporte 100% en memoria — permite probar TODA la arquitectura de
 * impresión (`PrinterManager`, `EscPosEncoder`, el flujo end-to-end) sin
 * ningún dispositivo físico ni API del navegador/nativa. Es también la
 * PRUEBA VIVA de que `PrinterTransport` es un contrato suficientemente
 * abstracto: cuando Offline 4.6+ agregue `BluetoothTransport`/
 * `UsbTransport`/`NetworkTransport` reales, serán clases que implementan
 * exactamente esta misma interfaz, intercambiables con esta sin tocar
 * `PrinterManager` ni el POS.
 */
export class FakePrinterTransport implements PrinterTransport {
  readonly kind: TransportKind;
  private status: TransportStatus = "disconnected";
  private readonly listeners = new Set<(status: TransportStatus) => void>();
  private readonly received: Uint8Array[] = [];
  private failNextConnect = false;
  private failNextWrite = false;

  constructor(kind: TransportKind = "bluetooth") {
    this.kind = kind;
  }

  async connect(): Promise<void> {
    this.setStatus("connecting");
    if (this.failNextConnect) {
      this.failNextConnect = false;
      this.setStatus("error");
      throw new PrinterError("connection-failed", "Fallo simulado de conexión (FakePrinterTransport)");
    }
    this.setStatus("connected");
  }

  async disconnect(): Promise<void> {
    this.setStatus("disconnected");
  }

  async write(bytes: Uint8Array): Promise<void> {
    if (this.status !== "connected") {
      throw new PrinterError("not-connected", "El transporte no está conectado");
    }
    if (this.failNextWrite) {
      this.failNextWrite = false;
      this.setStatus("error");
      throw new PrinterError("write-failed", "Fallo simulado de escritura (FakePrinterTransport)");
    }
    this.setStatus("printing");
    this.received.push(bytes);
    this.setStatus("connected");
  }

  getStatus(): TransportStatus {
    return this.status;
  }

  onStatusChange(listener: (status: TransportStatus) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private setStatus(status: TransportStatus): void {
    this.status = status;
    for (const listener of this.listeners) listener(status);
  }

  // ───────── Solo para tests: nunca usado por PrinterManager/el POS ─────────

  /** Todos los `write()` recibidos, en orden — para verificar los bytes reales que se hubieran mandado a la impresora. */
  getReceivedBytes(): Uint8Array[] {
    return this.received;
  }

  getLastReceivedBytes(): Uint8Array | undefined {
    return this.received[this.received.length - 1];
  }

  /** El PRÓXIMO `connect()` falla una vez (se resetea solo, para no dejar el mock "roto" para siempre). */
  simulateConnectFailure(): void {
    this.failNextConnect = true;
  }

  /** El PRÓXIMO `write()` falla una vez. */
  simulateWriteFailure(): void {
    this.failNextWrite = true;
  }

  /** Simula que la impresora se desconectó sola (se quedó sin batería, se apagó, perdió el enlace) sin pasar por `disconnect()`. */
  simulateDisconnect(): void {
    this.setStatus("disconnected");
  }
}
