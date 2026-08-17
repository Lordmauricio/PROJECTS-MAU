import { Injectable, Logger } from '@nestjs/common';
import {
  EmailMessage,
  EmailSendResult,
  EmailSender,
} from '../email-sender.interface';

/**
 * Proveedor por defecto — no requiere credenciales, así que el sistema
 * funciona out-of-the-box en desarrollo/CI sin configurar SMTP. Nunca
 * usar en producción: `EMAIL_PROVIDER=smtp` es lo que activa el envío
 * real (ver `mail.module.ts`).
 */
@Injectable()
export class ConsoleEmailSender implements EmailSender {
  private readonly logger = new Logger(ConsoleEmailSender.name);

  send(message: EmailMessage): Promise<EmailSendResult> {
    this.logger.log(
      `[console] Email a ${message.to} — asunto: "${message.subject}"` +
        (message.attachments?.length
          ? ` (${message.attachments.length} adjunto(s))`
          : ''),
    );
    return Promise.resolve({ provider: 'console' });
  }
}
