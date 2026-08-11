import { Injectable, Logger } from '@nestjs/common';

// Stub: el módulo de notificaciones multicanal (sección 33 del spec) es de
// una fase posterior (ver docs/ROADMAP.md). Por ahora esto solo loguea, para
// que el flujo de auth completo (verificación de email, reset de password)
// sea probable de punta a punta sin depender de un proveedor SMTP real.
@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);

  async sendEmailVerification(email: string, token: string) {
    this.logger.log(`[STUB] Verificación de email para ${email}: token=${token}`);
  }

  async sendPasswordReset(email: string, token: string) {
    this.logger.log(`[STUB] Reset de contraseña para ${email}: token=${token}`);
  }
}
