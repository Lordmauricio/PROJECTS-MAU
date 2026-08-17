import { Injectable, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { ConfigService } from '@nestjs/config';
import { Queue } from 'bullmq';
import { EMAIL_JOB, EMAIL_QUEUE, EmailJobPayload } from './email.types';
import { EmailAttachment } from './email-sender.interface';
import {
  renderEmailVerificationEmail,
  renderInviteEmail,
  renderNotificationEmail,
  renderPasswordResetEmail,
  renderReceiptEmail,
  ReceiptEmailData,
  renderSaleConfirmationEmail,
  SaleConfirmationData,
  renderWelcomeEmail,
} from './templates';

/**
 * Único punto de entrada del dominio comercial hacia "mandar un email".
 * Nunca envía nada sincrónicamente: arma el mensaje (con el template
 * correspondiente) y lo encola en BullMQ — `EmailProcessor` es quien
 * invoca al `EmailSender` real. Igual que `AuditService`, nunca debe
 * tumbar la operación de negocio que la origina (ver `MembersService.invite`,
 * que llama `sendInvite` desde dentro de una transacción): todo error de
 * encolado se loguea y se traga acá.
 */
@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);
  private readonly frontendUrl: string;

  constructor(
    @InjectQueue(EMAIL_QUEUE) private readonly queue: Queue<EmailJobPayload>,
    private readonly config: ConfigService,
  ) {
    this.frontendUrl = (
      this.config.get<string>('FRONTEND_URL') ?? 'http://localhost:3000'
    ).replace(/\/$/, '');
  }

  async sendEmailVerification(email: string, token: string): Promise<void> {
    const url = `${this.frontendUrl}/verify-email?token=${encodeURIComponent(token)}`;
    const rendered = renderEmailVerificationEmail(url);
    await this.enqueue(email, rendered, 'email-verification');
  }

  async sendPasswordReset(email: string, token: string): Promise<void> {
    const url = `${this.frontendUrl}/reset-password?token=${encodeURIComponent(token)}`;
    const rendered = renderPasswordResetEmail(url);
    await this.enqueue(email, rendered, 'password-reset');
  }

  async sendInvite(
    email: string,
    organizationName: string,
    organizationId: string,
  ): Promise<void> {
    const rendered = renderInviteEmail(organizationName);
    await this.enqueue(email, rendered, 'invite', { organizationId });
  }

  async sendWelcome(
    email: string,
    userName: string,
    organizationName: string,
    organizationId: string,
  ): Promise<void> {
    const rendered = renderWelcomeEmail(userName, organizationName);
    await this.enqueue(email, rendered, 'welcome', { organizationId });
  }

  async sendSaleConfirmation(
    organizationId: string,
    email: string,
    data: SaleConfirmationData,
  ): Promise<void> {
    const rendered = renderSaleConfirmationEmail(data);
    await this.enqueue(email, rendered, 'sale-confirmation', {
      organizationId,
      idempotencyKey: `sale-confirmation:${data.saleId}`,
      relatedEntityType: 'Sale',
      relatedEntityId: data.saleId,
    });
  }

  /**
   * El PDF viene ya renderizado por el llamador (`receipt-pdf.util.ts`,
   * a partir de `CommercialReceipt.snapshot`) — este servicio nunca toca
   * `Sale`/`Customer`/`Organization` para reconstruir el recibo, solo
   * adjunta el buffer que se le pasa.
   */
  async sendReceiptEmail(
    organizationId: string,
    email: string,
    data: ReceiptEmailData,
    pdf: Buffer,
    receiptId: string,
  ): Promise<void> {
    const rendered = renderReceiptEmail(data);
    const attachments: EmailAttachment[] = [
      {
        filename: `recibo-${data.fullNumber}.pdf`,
        content: pdf,
        contentType: 'application/pdf',
      },
    ];
    await this.enqueue(email, rendered, 'receipt', {
      organizationId,
      idempotencyKey: `receipt-email:${receiptId}`,
      relatedEntityType: 'CommercialReceipt',
      relatedEntityId: receiptId,
      attachments,
    });
  }

  async sendNotificationEmail(
    organizationId: string,
    email: string,
    title: string,
    message: string,
  ): Promise<void> {
    const rendered = renderNotificationEmail(title, message);
    await this.enqueue(email, rendered, 'notification', { organizationId });
  }

  private async enqueue(
    to: string,
    rendered: { subject: string; html: string; text: string },
    template: string,
    options: {
      organizationId?: string;
      idempotencyKey?: string;
      relatedEntityType?: string;
      relatedEntityId?: string;
      attachments?: EmailAttachment[];
    } = {},
  ): Promise<void> {
    const payload: EmailJobPayload = {
      to,
      subject: rendered.subject,
      html: rendered.html,
      text: rendered.text,
      template,
      organizationId: options.organizationId,
      idempotencyKey: options.idempotencyKey,
      relatedEntityType: options.relatedEntityType,
      relatedEntityId: options.relatedEntityId,
      attachments: options.attachments?.map((a) => ({
        filename: a.filename,
        contentBase64: a.content.toString('base64'),
        contentType: a.contentType,
      })),
    };

    try {
      await this.queue.add(EMAIL_JOB, payload, {
        attempts: 3,
        backoff: { type: 'exponential', delay: 1000 },
        removeOnComplete: true,
        removeOnFail: 100,
      });
    } catch (err) {
      this.logger.error(
        `No se pudo encolar el email "${template}" para ${to}`,
        err as Error,
      );
    }
  }
}
