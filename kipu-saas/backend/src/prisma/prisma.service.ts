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
    this.logger.log('Prisma conectado (rol app_user, RLS activo)');
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }
}
