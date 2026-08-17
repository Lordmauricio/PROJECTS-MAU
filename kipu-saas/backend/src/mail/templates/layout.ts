export interface RenderedEmail {
  subject: string;
  html: string;
  text: string;
}

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Layout HTML compartido por todos los templates — estilos inline (los
 * clientes de correo ignoran <style> con frecuencia) y sin dependencias
 * externas (nada de imágenes remotas ni fuentes externas).
 */
export function wrapEmailLayout(title: string, bodyHtml: string): string {
  return `<!doctype html>
<html lang="es">
<body style="margin:0;padding:0;background-color:#f4f4f7;font-family:Arial,Helvetica,sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#f4f4f7;padding:24px 0;">
    <tr>
      <td align="center">
        <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="background-color:#ffffff;border-radius:8px;overflow:hidden;max-width:600px;width:100%;">
          <tr>
            <td style="background-color:#1a56db;padding:20px 32px;">
              <span style="color:#ffffff;font-size:18px;font-weight:bold;">KIPU SAAS</span>
            </td>
          </tr>
          <tr>
            <td style="padding:32px;color:#1f2937;font-size:14px;line-height:1.6;">
              <h1 style="font-size:20px;margin:0 0 16px 0;color:#111827;">${escapeHtml(title)}</h1>
              ${bodyHtml}
            </td>
          </tr>
          <tr>
            <td style="padding:16px 32px;background-color:#f9fafb;color:#9ca3af;font-size:12px;">
              Este es un mensaje automático de KIPU SAAS. Si no esperabas este correo, puedes ignorarlo.
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

export function button(url: string, label: string): string {
  return `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:24px 0;">
  <tr>
    <td style="border-radius:6px;background-color:#1a56db;">
      <a href="${escapeHtml(url)}" style="display:inline-block;padding:12px 24px;color:#ffffff;text-decoration:none;font-weight:bold;font-size:14px;">${escapeHtml(label)}</a>
    </td>
  </tr>
</table>`;
}
