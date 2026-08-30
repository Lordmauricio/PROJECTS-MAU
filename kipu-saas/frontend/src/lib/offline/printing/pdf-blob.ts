/**
 * Utilidades DOM puras para abrir/descargar bytes de un PDF ya generado
 * localmente (`renderThermalPdf`) — mismo patrón que `apiBlobUrl`/
 * `apiDownload` (`lib/api.ts`), pero sin ningún `fetch()` de por medio: el
 * PDF ya está en memoria, generado 100% offline.
 */

export function pdfBlobUrl(bytes: Uint8Array): string {
  // `Uint8Array.from` devuelve un `Uint8Array<ArrayBuffer>` concreto — el
  // `Uint8Array<ArrayBufferLike>` que devuelve `pdf-lib` no es asignable
  // directo a `BlobPart` en las definiciones DOM de TypeScript recientes
  // (podría venir de un `SharedArrayBuffer`, que `Blob` no acepta).
  return URL.createObjectURL(new Blob([Uint8Array.from(bytes)], { type: "application/pdf" }));
}

export function downloadPdfBytes(bytes: Uint8Array, filename: string): void {
  const url = pdfBlobUrl(bytes);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}
