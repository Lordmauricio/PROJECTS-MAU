import { escapeHtml, RenderedEmail, wrapEmailLayout } from './layout';

export function renderInviteEmail(organizationName: string): RenderedEmail {
  const title = 'Te invitaron a una empresa en KIPU SAAS';
  const body = `<p>Te agregaron como miembro de <strong>${escapeHtml(organizationName)}</strong> en KIPU SAAS.</p>
<p>Iniciá sesión con tu correo para acceder.</p>`;
  return {
    subject: `Invitación a ${organizationName} — KIPU SAAS`,
    html: wrapEmailLayout(title, body),
    text: `Te agregaron como miembro de ${organizationName} en KIPU SAAS. Iniciá sesión con tu correo para acceder.`,
  };
}
