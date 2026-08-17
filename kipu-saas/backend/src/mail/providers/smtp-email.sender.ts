import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as nodemailer from 'nodemailer';
import {
  EmailMessage,
  EmailSendResult,
  EmailSender,
} from '../email-sender.interface';

/**
 * Proveedor SMTP real vía nodemailer. Todas las credenciales vienen de
 * variables de entorno (ver `.env.example`) — nunca hardcodeadas. El
 * transport de nodemailer es perezoso: `createTransport` no abre
 * conexión, solo se conecta al primer `sendMail`, así que instanciarlo
 * acá no falla aunque las credenciales estén vacías (falla recién al
 * intentar enviar, y ese error lo captura `EmailProcessor` como reintento).
 */
@Injectable()
export class SmtpEmailSender implements EmailSender {
  private readonly logger = new Logger(SmtpEmailSender.name);
  private readonly transporter: nodemailer.Transporter;
  private readonly from: string;

  constructor(private readonly config: ConfigService) {
    const host = this.config.get<string>('EMAIL_SMTP_HOST');
    const port = Number(this.config.get<string>('EMAIL_SMTP_PORT') ?? 587);
    const user = this.config.get<string>('EMAIL_SMTP_USER');
    const pass = this.config.get<string>('EMAIL_SMTP_PASSWORD');
    this.from =
      this.config.get<string>('EMAIL_FROM') ?? 'no-reply@kipu-saas.local';

    this.transporter = nodemailer.createTransport({
      host,
      port,
      secure: port === 465,
      auth: user && pass ? { user, pass } : undefined,
    });
  }

  async send(message: EmailMessage): Promise<EmailSendResult> {
    await this.transporter.sendMail({
      from: this.from,
      to: message.to,
      subject: message.subject,
      html: message.html,
      text: message.text,
      attachments: message.attachments?.map((a) => ({
        filename: a.filename,
        content: a.content,
        contentType: a.contentType,
      })),
    });
    this.logger.log(`[smtp] Email enviado a ${message.to}`);
    return { provider: 'smtp' };
  }
}
