import { button, RenderedEmail, wrapEmailLayout } from './layout';

export function renderEmailVerificationEmail(verifyUrl: string): RenderedEmail {
  const title = 'Confirmá tu correo electrónico';
  const body = `<p>Gracias por registrarte en KIPU SAAS. Confirmá tu correo para activar tu cuenta.</p>
${button(verifyUrl, 'Confirmar correo')}
<p>Este enlace vence en 48 horas.</p>`;
  return {
    subject: 'Confirmá tu correo — KIPU SAAS',
    html: wrapEmailLayout(title, body),
    text: `Confirmá tu correo para activar tu cuenta en KIPU SAAS (vence en 48 horas): ${verifyUrl}`,
  };
}
