import { Injectable, Logger } from '@nestjs/common';

// Stub: el proveedor real de correo (notificaciones multicanal) es una fase
// posterior (ver docs/PROJECT_PLAN.md). Por ahora esto solo loguea y encola
// un job de auditoría, para que el flujo completo de auth sea probable de
// punta a punta sin depender de un proveedor SMTP real.
@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);

  async sendEmailVerification(email: string, token: string) {
    this.logger.log(`[STUB] Verificación de email para ${email}: token=${token}`);
  }

  async sendPasswordReset(email: string, token: string) {
    this.logger.log(`[STUB] Reset de contraseña para ${email}: token=${token}`);
  }

  async sendInvite(email: string, organizationName: string) {
    this.logger.log(`[STUB] Invitación a ${email} para unirse a ${organizationName}`);
  }
}
