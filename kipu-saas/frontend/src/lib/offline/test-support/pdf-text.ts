// Extrae el texto real de un PDF ya generado — usado SOLO por tests, para
// verificar contenido real (Offline 4.6B) en vez de solo "se generó algo".
// `pdfjs-dist` es devDependency (nunca se importa desde código de
// producción, no afecta el bundle que se sirve al navegador) — el mismo
// motor de renderizado de PDF que usa Firefox, elegido por ser la forma
// más confiable de confirmar que el PDF generado por `pdf-lib` es válido y
// que el texto (incluidos acentos/ñ) se puede leer de vuelta tal cual se
// escribió.
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";

export interface ExtractedPdf {
  pageCount: number;
  pageWidths: number[];
  pageHeights: number[];
  text: string;
}

export async function extractPdfText(bytes: Uint8Array): Promise<ExtractedPdf> {
  const doc = await getDocument({ data: bytes }).promise;
  const pageWidths: number[] = [];
  const pageHeights: number[] = [];
  const chunks: string[] = [];
  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p);
    const viewport = page.getViewport({ scale: 1 });
    pageWidths.push(viewport.width);
    pageHeights.push(viewport.height);
    const content = await page.getTextContent();
    chunks.push(content.items.map((i) => ("str" in i ? i.str : "")).join(" "));
  }
  return { pageCount: doc.numPages, pageWidths, pageHeights, text: chunks.join("\n") };
}
