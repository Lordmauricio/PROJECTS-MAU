import { INestApplication, ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import helmet from 'helmet';
import request from 'supertest';
import { AppModule } from './app.module';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';

/**
 * Verifica el endurecimiento HTTP contra la app REAL levantada con la misma
 * configuración que `main.ts`. No alcanza con revisar que el código llame a
 * `helmet()`: lo que importa es que las cabeceras lleguen efectivamente en
 * la respuesta y que CORS no acepte un origen ajeno.
 */
describe('Endurecimiento HTTP (helmet, CORS, health, errores)', () => {
  let app: INestApplication;
  const ALLOWED = 'https://app.kipu.test';

  beforeAll(async () => {
    const created = await NestFactory.create<NestExpressApplication>(
      AppModule,
      {
        logger: false,
      },
    );
    created.use(
      helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }),
    );
    created.enableCors({ origin: [ALLOWED], credentials: true });
    created.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );
    created.useGlobalFilters(new AllExceptionsFilter(true));
    await created.init();
    app = created;
  }, 30000);

  afterAll(async () => {
    await app.close();
  }, 15000);

  const server = () => app.getHttpServer() as Parameters<typeof request>[0];

  it('helmet envía las cabeceras de seguridad en una respuesta real', async () => {
    const res = await request(server()).get('/health');
    expect(res.status).toBe(200);
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['x-frame-options']).toBe('SAMEORIGIN');
    expect(res.headers['strict-transport-security']).toContain('max-age=');
    expect(res.headers['content-security-policy']).toBeDefined();
    // helmet oculta la huella del framework.
    expect(res.headers['x-powered-by']).toBeUndefined();
  });

  it('el PDF de recibos sigue siendo incrustable desde el frontend (CORP cross-origin)', async () => {
    const res = await request(server()).get('/health');
    expect(res.headers['cross-origin-resource-policy']).toBe('cross-origin');
  });

  it('CORS: refleja el origen permitido y NO refleja uno ajeno', async () => {
    const allowed = await request(server())
      .get('/health')
      .set('Origin', ALLOWED);
    expect(allowed.headers['access-control-allow-origin']).toBe(ALLOWED);

    const foreign = await request(server())
      .get('/health')
      .set('Origin', 'https://sitio-malicioso.test');
    // Sin cabecera = el navegador bloquea la respuesta.
    expect(foreign.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('liveness responde sin tocar dependencias; readiness comprueba Postgres y Redis', async () => {
    const live = await request(server()).get('/health');
    expect(live.status).toBe(200);
    expect(live.body).toMatchObject({ status: 'ok' });

    const ready = await request(server()).get('/health/ready');
    expect(ready.status).toBe(200);
    expect(ready.body).toMatchObject({
      status: 'ok',
      database: 'ok',
      cache: 'ok',
    });
  });

  it('los health checks no exponen datos de infraestructura', async () => {
    const ready = await request(server()).get('/health/ready');
    const body = JSON.stringify(ready.body);
    expect(body).not.toMatch(/postgresql:\/\/|redis:\/\/|password/i);
  });

  it('una ruta inexistente devuelve 404 sin stack trace', async () => {
    const res = await request(server()).get('/no-existe-esta-ruta');
    expect(res.status).toBe(404);
    expect(JSON.stringify(res.body)).not.toMatch(/at .*\.ts:|node_modules/);
  });

  it('los endpoints de auth siguen siendo públicos y validando el body', async () => {
    const res = await request(server()).post('/auth/login').send({});
    // 400 (validación) — nunca 500 ni un error con detalle interno.
    expect(res.status).toBe(400);
  });
});
