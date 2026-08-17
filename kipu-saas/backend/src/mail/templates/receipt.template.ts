import { escapeHtml, RenderedEmail, wrapEmailLayout } from './layout';

export interface ReceiptEmailData {
  fullNumber: string;
  issuerName: string;
  total: string;
  issuedAt: string;
}

/**
 * El cuerpo del correo es solo un aviso — el documento en sí (con su
 * rótulo "DOCUMENTO COMERCIAL NO FISCAL") vive únicamente en el PDF
 * adjunto, generado por `renderReceiptPdf` a partir del snapshot
 * inmutable del recibo (ver `mail.service.ts#sendReceiptEmail`). Acá se
 * repite la aclaración en texto plano para que quede explícita incluso
 * si el destinatario no abre el adjunto.
 */
export function renderReceiptEmail(data: ReceiptEmailData): RenderedEmail {
  const title = 'Tu recibo comercial';
  const body = `<p>Adjuntamos el recibo <strong>${escapeHtml(data.fullNumber)}</strong> de <strong>${escapeHtml(data.issuerName)}</strong> por un total de <strong>Bs ${escapeHtml(data.total)}</strong>, emitido el ${escapeHtml(data.issuedAt)}.</p>
<p style="color:#b00020;font-weight:bold;">DOCUMENTO COMERCIAL NO FISCAL — no es una factura ni un documento tributario válido ante el SIN.</p>`;
  return {
    subject: `Tu recibo ${data.fullNumber} — ${data.issuerName}`,
    html: wrapEmailLayout(title, body),
    text: `Adjuntamos el recibo ${data.fullNumber} de ${data.issuerName} por Bs ${data.total}, emitido el ${data.issuedAt}. DOCUMENTO COMERCIAL NO FISCAL.`,
  };
}
