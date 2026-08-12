import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../../generated/prisma/client';

// Cliente Prisma de la aplicación en ejecución. Se conecta con el rol
// `app_user` (ver migración inicial), que NO tiene BYPASSRLS: las policies
// de Row Level Security definidas en la base de datos se aplican siempre a
// este cliente, sin excepción. Nunca apuntar RUNTIME_DATABASE_URL a un rol
// superusuario o con BYPASSRLS — Postgres ignora las policies para esos
// roles y el aislamiento de tenant deja de existir en la práctica.
@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PrismaService.name);

  constructor(config: ConfigService) {
    const connectionString = config.getOrThrow<string>('RUNTIME_DATABASE_URL');
    const adapter = new PrismaPg({ connectionString });
    super({ adapter });
  }

  async onModuleInit() {
    await this.$connect();
    await this.assertNoBypassRls();
    this.logger.log('Prisma conectado (rol app_user, RLS activo)');
  }

  /**
   * Falla rápido en el arranque si `RUNTIME_DATABASE_URL` apunta, por error
   * de configuración, a un rol con `BYPASSRLS` (ej. `app_superadmin`).
   * Postgres ignora silenciosamente las policies de RLS para esos roles —
   * sin esta verificación, un typo en las variables de entorno desactivaría
   * el aislamiento de tenant sin ningún error visible.
   */
  private async assertNoBypassRls(): Promise<void> {
    const rows = await this.$queryRaw<Array<{ rolbypassrls: boolean }>>`
      SELECT rolbypassrls FROM pg_roles WHERE rolname = current_user
    `;
    if (rows[0]?.rolbypassrls) {
      throw new Error(
        `El rol de Postgres conectado ("${await this.currentUser()}") tiene BYPASSRLS. ` +
          'RUNTIME_DATABASE_URL debe apuntar a un rol sin BYPASSRLS (ej. app_user) para que ' +
          'el aislamiento de tenant por Row Level Security se aplique. Abortando arranque.',
      );
    }
  }

  private async currentUser(): Promise<string> {
    const rows = await this.$queryRaw<Array<{ current_user: string }>>`SELECT current_user`;
    return rows[0]?.current_user ?? 'desconocido';
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }
}
