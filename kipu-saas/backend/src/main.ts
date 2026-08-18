import { NestFactory } from '@nestjs/core';
import { Logger, ValidationPipe } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import helmet from 'helmet';
import { AppModule } from './app.module';
import { loadKipuEnv } from './config/env.validation';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';

async function bootstrap() {
  // `loadKipuEnv` lee variables ya validadas: `ConfigModule.forRoot({ validate })`
  // corre durante `NestFactory.create`, así que si algo falta el proceso ya
  // habría fallado con un mensaje explícito antes de llegar acá.
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    // El body de un request no debería poder crecer sin límite; 1 MB alcanza
    // de sobra para cualquier operación comercial (la venta más grande son
    // unos pocos KB de JSON) y corta de raíz el consumo de memoria por
    // payloads gigantes.
    bodyParser: true,
  });
  const env = loadKipuEnv(process.env);
  const logger = new Logger('Bootstrap');

  // Detrás de un reverse proxy (nginx, ALB, Cloud Run), `req.ip` devuelve la
  // IP del proxy salvo que se confíe en X-Forwarded-For. Sin esto, el rate
  // limiting mete a todos los usuarios en el mismo bucket y los logs de
  // auditoría registran siempre la misma IP. Es opt-in con TRUST_PROXY
  // porque creerle a esa cabecera SIN un proxy delante permitiría a
  // cualquiera falsear su IP y esquivar el throttling.
  if (env.trustProxy) {
    app.set('trust proxy', 1);
    logger.log('trust proxy activado (se lee X-Forwarded-For)');
  }

  // Cabeceras de seguridad. `contentSecurityPolicy` se deja en su default
  // restrictivo: esta API devuelve JSON y PDFs, nunca HTML propio, así que
  // no hay nada que romper. `crossOriginResourcePolicy: cross-origin` es
  // necesario para que el frontend (otro origen) pueda incrustar el PDF del
  // recibo, que se sirve con Content-Disposition: inline.
  app.use(
    helmet({
      crossOriginResourcePolicy: { policy: 'cross-origin' },
    }),
  );

  // CORS explícito. `env.corsOrigins` vacío significa "ningún origen de
  // navegador" — fail-closed, en vez del `enableCors()` sin argumentos que
  // habilitaba cualquier origen.
  if (env.corsOrigins.length > 0) {
    app.enableCors({
      origin: env.corsOrigins,
      credentials: true,
      methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
    });
    logger.log(`CORS habilitado para: ${env.corsOrigins.join(', ')}`);
  } else {
    logger.log(
      'CORS deshabilitado (CORS_ORIGINS vacío): ningún origen de navegador puede llamar a esta API.',
    );
  }

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      // En producción no se devuelve el detalle de qué validador falló para
      // cada campo: es información útil para mapear la API desde afuera.
      disableErrorMessages: env.isProduction,
    }),
  );

  // Traduce cualquier excepción no controlada a una respuesta JSON estable,
  // sin filtrar stack traces ni mensajes internos de Postgres/Prisma.
  app.useGlobalFilters(new AllExceptionsFilter(env.isProduction));

  // Que SIGTERM cierre las conexiones (Postgres, Redis, colas) en vez de
  // matar el proceso a la mitad de una transacción: `onModuleDestroy` de
  // PrismaService/RedisService solo corre si los hooks están habilitados.
  app.enableShutdownHooks();

  await app.listen(env.port);
  logger.log(
    `KIPU SAAS backend escuchando en el puerto ${env.port} (${env.nodeEnv})`,
  );
}

void bootstrap();
