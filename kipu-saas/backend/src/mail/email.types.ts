export interface EmailAttachmentPayload {
  filename: string;
  /** Buffer serializado en base64 — un job de BullMQ se persiste como JSON en Redis. */
  contentBase64: string;
  contentType: string;
}

export interface EmailJobPayload {
  to: string;
  subject: string;
  html: string;
  text: string;
  attachments?: EmailAttachmentPayload[];
  /** Nombre del template usado (para el log y para `EmailLog.template`). */
  template: string;
  /**
   * Presente solo en emails con contexto de tenant ya resuelto (bienvenida,
   * invitación, venta, recibo, notificación). Los emails de identidad
   * pre-tenant (verificación, reset de password) no lo llevan y por lo
   * tanto no generan fila en `EmailLog` — ver `mail.service.ts`.
   */
  organizationId?: string;
  /**
   * Si se provee, `EmailProcessor` la usa para no reenviar el mismo email
   * dos veces (p.ej. reintentar "enviar recibo por email" en la misma
   * venta). El registro `EmailLog` con esta key lo crea el processor —no
   * `MailService`— para no persistir dentro de una transacción de negocio
   * que podría hacer rollback después de encolar el job (ver comentario
   * en `mail.service.ts`).
   */
  idempotencyKey?: string;
  relatedEntityType?: string;
  relatedEntityId?: string;
}

export const EMAIL_QUEUE = 'email';
export const EMAIL_JOB = 'send';
