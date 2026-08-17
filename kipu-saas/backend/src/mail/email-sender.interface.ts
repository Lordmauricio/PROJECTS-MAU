/**
 * Abstracción de "cómo se manda un correo" — el dominio comercial
 * (auth, members, sales, receipts, notifications) nunca conoce SMTP,
 * nodemailer, ni ningún proveedor concreto: solo conoce `MailService`
 * (ver `mail.service.ts`), que a su vez encola un job y delega el envío
 * real en la implementación de `EmailSender` inyectada bajo el token
 * `EMAIL_SENDER` (ver `mail.module.ts`). Agregar un proveedor nuevo
 * (p.ej. un API HTTP de terceros) es implementar esta interfaz y
 * registrarla en la factory de `mail.module.ts` — no toca nada más.
 */
export interface EmailAttachment {
  filename: string;
  content: Buffer;
  contentType: string;
}

export interface EmailMessage {
  to: string;
  subject: string;
  html: string;
  text: string;
  attachments?: EmailAttachment[];
}

export interface EmailSendResult {
  provider: string;
}

export interface EmailSender {
  send(message: EmailMessage): Promise<EmailSendResult>;
}

export const EMAIL_SENDER = 'EMAIL_SENDER';
