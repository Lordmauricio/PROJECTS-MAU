import {
  Controller,
  Get,
  Inject,
  ServiceUnavailableException,
} from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import type Redis from 'ioredis';
import { PrismaService } from './prisma/prisma.service';
import { REDIS_CLIENT } from './redis/redis.module';

/**
 * Dos endpoints con propósitos distintos, que antes eran uno solo que
 * siempre devolvía `{ status: 'ok' }` sin comprobar nada:
 *
 * - `GET /health` (liveness): ¿el proceso está vivo? No toca dependencias.
 *   Es el que debe usar el orquestador para decidir si REINICIA el
 *   contenedor. Si acá se consultara la base, una caída de Postgres
 *   provocaría un reinicio en bucle del backend, que no arregla nada.
 *
 * - `GET /health/ready` (readiness): ¿puede atender tráfico real? Verifica
 *   Postgres y Redis. Es el que debe usar el balanceador para decidir si
 *   MANDA TRÁFICO. Devuelve 503 si alguna dependencia no responde, con el
 *   detalle de cuál falló.
 *
 * Ninguno expone versiones, hostnames ni cadenas de conexión: son públicos
 * (sin JWT) y no deben servir para mapear la infraestructura.
 */
// Sin rate limiting: las sondas del orquestador/balanceador llegan todas
// desde la misma IP y consumirían la cuota global compartida con el tráfico
// real que pasa por ese mismo proxy.
@SkipThrottle()
@Controller()
export class AppController {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
  ) {}

  @Get('health')
  health() {
    return { status: 'ok', uptime: Math.round(process.uptime()) };
  }

  @Get('health/ready')
  async ready() {
    const [database, cache] = await Promise.all([
      this.check(() => this.prisma.$queryRaw`SELECT 1`),
      this.check(() => this.redis.ping()),
    ]);

    const ok = database === 'ok' && cache === 'ok';
    const body = { status: ok ? 'ok' : 'degraded', database, cache };
    if (!ok) {
      // 503 y no 200: un readiness que responde 200 con "degraded" adentro
      // es un readiness que nadie lee.
      throw new ServiceUnavailableException(body);
    }
    return body;
  }

  private async check(probe: () => Promise<unknown>): Promise<'ok' | 'down'> {
    try {
      await probe();
      return 'ok';
    } catch {
      // El error real no se devuelve al cliente (puede incluir la cadena de
      // conexión); el filtro global ya lo registra si hace falta.
      return 'down';
    }
  }
}
