import { escapeHtml, RenderedEmail, wrapEmailLayout } from './layout';

export function renderWelcomeEmail(
  userName: string,
  organizationName: string,
): RenderedEmail {
  const title = `¡Bienvenido a KIPU SAAS, ${userName}!`;
  const body = `<p>Tu cuenta y tu empresa <strong>${escapeHtml(organizationName)}</strong> ya están listas.</p>
<p>Desde acá vas a poder gestionar ventas, compras, inventario, caja y reportes de tu negocio.</p>`;
  return {
    subject: `Bienvenido a KIPU SAAS — ${organizationName}`,
    html: wrapEmailLayout(title, body),
    text: `Bienvenido a KIPU SAAS, ${userName}. Tu cuenta y tu empresa ${organizationName} ya están listas.`,
  };
}
