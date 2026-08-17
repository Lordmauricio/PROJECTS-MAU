import { escapeHtml, RenderedEmail, wrapEmailLayout } from './layout';

export interface SaleConfirmationData {
  saleId: string;
  customerName: string;
  total: string;
  itemCount: number;
  confirmedAt: string;
}

export function renderSaleConfirmationEmail(
  data: SaleConfirmationData,
): RenderedEmail {
  const title = 'Venta confirmada';
  const body = `<p>Se confirmó una venta a <strong>${escapeHtml(data.customerName)}</strong>.</p>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:16px 0;">
  <tr><td style="padding:4px 0;color:#6b7280;">Ítems</td><td style="padding:4px 0;text-align:right;">${data.itemCount}</td></tr>
  <tr><td style="padding:4px 0;color:#6b7280;">Total</td><td style="padding:4px 0;text-align:right;font-weight:bold;">Bs ${escapeHtml(data.total)}</td></tr>
  <tr><td style="padding:4px 0;color:#6b7280;">Fecha</td><td style="padding:4px 0;text-align:right;">${escapeHtml(data.confirmedAt)}</td></tr>
</table>
<p style="color:#6b7280;font-size:12px;">Documento comercial no fiscal — ver el recibo asociado para el detalle completo.</p>`;
  return {
    subject: `Venta confirmada — Bs ${data.total}`,
    html: wrapEmailLayout(title, body),
    text: `Venta confirmada a ${data.customerName}. Ítems: ${data.itemCount}. Total: Bs ${data.total}. Fecha: ${data.confirmedAt}.`,
  };
}
