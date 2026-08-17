import { button, RenderedEmail, wrapEmailLayout } from './layout';

export function renderPasswordResetEmail(resetUrl: string): RenderedEmail {
  const title = 'Recuperación de contraseña';
  const body = `<p>Recibimos una solicitud para restablecer tu contraseña.</p>
${button(resetUrl, 'Restablecer contraseña')}
<p>Si no fuiste vos quien solicitó esto, podés ignorar este correo — tu contraseña actual sigue siendo válida.</p>
<p>Este enlace vence en 30 minutos.</p>`;
  return {
    subject: 'Recuperación de contraseña — KIPU SAAS',
    html: wrapEmailLayout(title, body),
    text: `Recibimos una solicitud para restablecer tu contraseña. Abrí este enlace (vence en 30 minutos): ${resetUrl}`,
  };
}
