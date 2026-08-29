/**
 * Contrato que CUALQUIER transporte de impresión debe cumplir —
 * `PrinterManager` y el POS nunca hablan con Bluetooth/USB/red/Tauri
 * directamente, solo con esta interfaz. Agregar un transporte nuevo
 * (Offline 4.6+) significa escribir una clase que la implemente y
 * registrar su fábrica en `PrinterManager` — cero cambios acá, cero
 * cambios en `PrinterManager`, cero cambios en el POS.
 */

/**
 * Familia de transporte de una impresora. `"native"` es el placeholder
 * para un puente nativo futuro (Tauri) que no encaje en las otras tres
 * categorías (ej. hablar directo con el spooler de impresión del sistema
 * operativo) — no se implementa nada detrás de ninguno de estos valores
 * en esta fase.
 */
export type TransportKind = "bluetooth" | "usb" | "network" | "native";

/**
 * Estados posibles de un transporte. Deliberadamente pocos — los
 * necesarios para que la UI (a futuro, Offline 4.9) pueda mostrar algo
 * significativo y para que `PrinterManager` pueda tomar decisiones
 * (nunca hace falta más granularidad que esta para lo que existe hoy).
 */
export type TransportStatus =
  | "disconnected"
  | "connecting"
  | "connected"
  | "printing"
  | "error";

export interface PrinterTransport {
  readonly kind: TransportKind;
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  /** Nunca reintenta sola ante un fallo — ver política de reintentos, docs/architecture.md sección 23. */
  write(bytes: Uint8Array): Promise<void>;
  getStatus(): TransportStatus;
  /** Mismo patrón que `connection-status.ts#onChange`: devuelve la función de desuscripción, nunca un id que haya que trackear aparte. */
  onStatusChange(listener: (status: TransportStatus) => void): () => void;
}
