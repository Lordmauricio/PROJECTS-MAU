import { escapeHtml, RenderedEmail, wrapEmailLayout } from './layout';

export function renderNotificationEmail(
  title: string,
  message: string,
): RenderedEmail {
  const body = `<p>${escapeHtml(message)}</p>`;
  return {
    subject: title,
    html: wrapEmailLayout(title, body),
    text: message,
  };
}
