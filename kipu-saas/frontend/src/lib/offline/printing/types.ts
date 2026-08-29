/**
 * Tipos base de la arquitectura de impresión (Offline 4.4) — agnósticos de
 * plataforma a propósito. Nada acá conoce Bluetooth/USB/red/Tauri/React ni
 * el navegador: esta fase construye únicamente el contrato y la lógica
 * pura; los transportes reales (Offline 4.6+) implementan `PrinterTransport`
 * sin necesitar tocar nada de este archivo.
 */
import type { TransportKind } from "./printer-transport";

/**
 * Capacidades que una impresora puede declarar soportar. V1 solo IMPLEMENTA
 * (en `EscPosEncoder`) `text`/`bold`/`alignment`/`textSize`/`cut` — `qr`,
 * `barcode` y `cashDrawer` existen en el tipo para que `PrinterDevice` ya
 * pueda declararlas a futuro sin otro cambio de esquema, pero el encoder
 * las ignora por completo en esta fase (nunca asume que existen solo
 * porque ESC/POS en general las soporta).
 */
export type PrinterCapability =
  | "text"
  | "bold"
  | "alignment"
  | "textSize"
  | "cut"
  | "cashDrawer"
  | "qr"
  | "barcode";

/**
 * Configuración de direccionamiento de un transporte — deliberadamente
 * mínima y genérica: cada transporte REAL (todavía no implementado) define
 * qué campos usa (`address` sirve de MAC Bluetooth, IP:puerto de red, o un
 * identificador de dispositivo USB, según corresponda). Nunca un secreto:
 * ni PIN de emparejamiento, ni credenciales, ni tokens — ver
 * `docs/architecture.md` sección 23 para la justificación completa.
 */
export interface PrinterTransportConfig {
  address?: string;
}

export type PrinterErrorCode =
  | "printer-not-found"
  | "not-connected"
  | "connection-failed"
  | "write-failed"
  | "unsupported-capability"
  | "invalid-ticket";

/** Mismo patrón que `ApiError` (`lib/api.ts`): un `code` discriminante en vez de parsear el mensaje — nunca un error genérico cuando existe un tipo específico (instrucción explícita de esta fase). */
export class PrinterError extends Error {
  constructor(
    public code: PrinterErrorCode,
    message: string,
    public details?: unknown,
  ) {
    super(message);
  }
}

/** Impresora conocida, persistida en `db.printers` — un registro, nunca una conexión viva (eso lo mantiene `PrinterManager` en memoria). */
export interface PrinterDevice {
  id: string;
  organizationId: string;
  name: string;
  transportKind: TransportKind;
  transportConfig: PrinterTransportConfig;
  capabilities: PrinterCapability[];
  isDefault: boolean;
  lastConnectedAt: string | null;
  createdAt: string;
}

/** Resultado de `PrinterManager#discover` — todavía no persistido, el usuario decide si lo guarda (`PrinterManager#save`). */
export interface DiscoveredPrinter {
  name: string;
  transportKind: TransportKind;
  transportConfig: PrinterTransportConfig;
  capabilities: PrinterCapability[];
}
