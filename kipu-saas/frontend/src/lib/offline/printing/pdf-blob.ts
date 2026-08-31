/**
 * Entrega del ticket PDF ya generado localmente (`renderThermalPdf`) al
 * sistema del dispositivo. Sin ningún `fetch()`: el PDF está en memoria,
 * generado 100% offline, y nunca se sube a ningún servidor.
 *
 * Offline 4.14.4 — Android. Hasta esta fase el único camino era
 * `window.open(blobUrl)`, que la auditoría de continuidad marcó como NO
 * VERIFICADO en Chrome Android por dos motivos reales: Chrome Android no
 * renderiza PDFs `blob:` en una pestaña (los descarga, o directamente ignora
 * la apertura), y `window.open` fuera de un gesto de usuario se bloquea como
 * popup. Un ticket que no se puede ver ni imprimir en el teléfono hace inútil
 * todo lo demás.
 *
 * La solución NO es reemplazar el camino de escritorio, sino elegir el mejor
 * disponible en cada dispositivo. El orden es deliberado:
 *
 *   1. `navigator.share` con archivos (Web Share API nivel 2). En Android
 *      abre la hoja del sistema: visor de PDF, "Imprimir" (que llega al
 *      servicio de impresión de Android y de ahí a cualquier impresora
 *      configurada), guardar en Drive, mandar por WhatsApp. Es la vía nativa
 *      y funciona sin conexión: el archivo ya está en memoria.
 *   2. `window.open` — el comportamiento de siempre en escritorio, donde el
 *      visor de PDF integrado del navegador sí muestra un `blob:` y ofrece
 *      imprimir con Ctrl+P.
 *   3. Descarga con `<a download>` — último recurso universal.
 *
 * Nada de esto introduce Bluetooth, USB ni ESC/POS: el usuario imprime con el
 * sistema de impresión de su propio dispositivo, que es la estrategia V1.
 */

/** Cómo terminó entregándose el ticket. Útil para el mensaje al cajero y para los tests. */
export type TicketDeliveryMethod = "share" | "window" | "download" | "cancelled";

/**
 * Cuánto se mantiene vivo el object URL antes de liberarlo. Revocar de
 * inmediato —como se hacía antes de esta fase— puede abortar la descarga en
 * Android antes de que el navegador llegue a empezarla: el `click()` solo la
 * PROGRAMA, no la completa de forma síncrona.
 */
const REVOKE_DELAY_MS = 1000;

export function pdfBlobUrl(bytes: Uint8Array): string {
  return URL.createObjectURL(pdfBlob(bytes));
}

function pdfBlob(bytes: Uint8Array): Blob {
  // `Uint8Array.from` devuelve un `Uint8Array<ArrayBuffer>` concreto — el
  // `Uint8Array<ArrayBufferLike>` que devuelve `pdf-lib` no es asignable
  // directo a `BlobPart` en las definiciones DOM recientes (podría venir de un
  // `SharedArrayBuffer`, que `Blob` no acepta).
  return new Blob([Uint8Array.from(bytes)], { type: "application/pdf" });
}

export function downloadPdfBytes(bytes: Uint8Array, filename: string): void {
  const url = pdfBlobUrl(bytes);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  // Ver REVOKE_DELAY_MS: liberar en el mismo tick cancelaba la descarga.
  setTimeout(() => URL.revokeObjectURL(url), REVOKE_DELAY_MS);
}

/**
 * ¿Puede este dispositivo compartir el PDF por la hoja del sistema? Se
 * consulta con el archivo REAL, no con una capacidad genérica:
 * `navigator.canShare` responde por tipo de archivo, y un navegador puede
 * soportar compartir texto pero no PDFs.
 */
function canSharePdf(file: File): boolean {
  if (typeof navigator === "undefined") return false;
  const nav = navigator as Navigator & { canShare?: (data?: ShareData) => boolean };
  if (typeof nav.share !== "function" || typeof nav.canShare !== "function") return false;
  try {
    return nav.canShare({ files: [file] });
  } catch {
    return false;
  }
}

/**
 * Entrega el ticket para VER/IMPRIMIR, eligiendo el mejor camino disponible.
 * Devuelve cuál se usó. Nunca lanza por una cancelación del usuario: cerrar la
 * hoja de compartir de Android no es un error, y no debe pintar un mensaje
 * rojo en el POS.
 */
export async function presentTicketPdf(
  bytes: Uint8Array,
  filename: string,
): Promise<TicketDeliveryMethod> {
  const file = new File([pdfBlob(bytes)], filename, { type: "application/pdf" });

  if (canSharePdf(file)) {
    try {
      await (navigator as Navigator & { share: (d: ShareData) => Promise<void> }).share({
        files: [file],
        title: filename,
      });
      return "share";
    } catch (error) {
      // El usuario cerró la hoja del sistema: no es un fallo, y reintentar por
      // otra vía sería abrirle algo que acaba de descartar.
      if (error instanceof Error && error.name === "AbortError") return "cancelled";
      // `NotAllowedError` = se perdió la activación por gesto de usuario
      // mientras se generaba el PDF (el `import()` dinámico de pdf-lib puede
      // tardar en un teléfono lento la primera vez). Cae al siguiente camino
      // en vez de dejar al cajero sin ticket.
    }
  }

  // Escritorio: exactamente el comportamiento previo a esta fase. El object URL
  // NO se revoca acá a propósito — la pestaña abierta lo sigue necesitando, y
  // muere sola cuando se cierra el documento que lo creó.
  const opened = typeof window !== "undefined" ? window.open(pdfBlobUrl(bytes), "_blank") : null;
  if (opened) return "window";

  // Bloqueado por el navegador o sin `window`: la descarga siempre funciona.
  downloadPdfBytes(bytes, filename);
  return "download";
}
