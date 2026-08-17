import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { ConfigService } from '@nestjs/config';
import { MailService } from './mail.service';
import { EmailProcessor } from './email.processor';
import { EMAIL_QUEUE } from './email.types';
import { EMAIL_SENDER } from './email-sender.interface';
import { ConsoleEmailSender } from './providers/console-email.sender';
import { SmtpEmailSender } from './providers/smtp-email.sender';

/**
 * Selección de proveedor 100% por configuración (`EMAIL_PROVIDER`), nunca
 * por código: el dominio comercial solo conoce `MailService` y jamás un
 * proveedor concreto. `console` (default) no requiere credenciales y es
 * seguro para desarrollo/CI; `smtp` usa nodemailer con credenciales desde
 * variables de entorno (ver `.env.example`) — ninguna hardcodeada acá.
 */
@Module({
  imports: [BullModule.registerQueue({ name: EMAIL_QUEUE })],
  providers: [
    MailService,
    EmailProcessor,
    ConsoleEmailSender,
    SmtpEmailSender,
    {
      provide: EMAIL_SENDER,
      inject: [ConfigService, ConsoleEmailSender, SmtpEmailSender],
      useFactory: (
        config: ConfigService,
        consoleSender: ConsoleEmailSender,
        smtpSender: SmtpEmailSender,
      ) => {
        const provider = config.get<string>('EMAIL_PROVIDER') ?? 'console';
        return provider === 'smtp' ? smtpSender : consoleSender;
      },
    },
  ],
  exports: [MailService],
})
export class MailModule {}
