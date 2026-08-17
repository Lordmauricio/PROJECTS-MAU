import { INestApplication } from '@nestjs/common';
import { Job } from 'bullmq';
import {
  bootTestApp,
  registerTestOrg,
  TestTenant,
} from '../test-support/integration-app';
import { TenantPrismaService } from '../prisma/tenant-prisma.service';
import { EmailProcessor } from './email.processor';
import { EmailJobPayload } from './email.types';
import { EmailSendResult, EmailSender } from './email-sender.interface';

/**
 * Prueba el camino de fallo/reintento de `EmailProcessor` de forma
 * determinística, SIN pasar por la cola BullMQ real: en un test run
 * completo, cualquier `.spec.ts` que levanta la app (vía `bootTestApp`)
 * registra un `EmailProcessor` que escucha la MISMA cola `email` sobre el
 * MISMO Redis compartido — así que un job encolado desde este archivo
 * puede terminar siendo procesado por el worker de OTRO archivo de test
 * corriendo en paralelo (con SU proveedor, no el que configuramos acá),
 * haciendo que un test end-to-end contra un SMTP inalcanzable sea
 * inherentemente carrera contra los demás workers de la suite. Se
 * instancia `EmailProcessor` directamente (con el `TenantPrismaService`
 * real de una app real, pero un `EmailSender` falso controlado a mano) y
 * se lo invoca fuera de BullMQ, para verificar la lógica real del
 * processor (reintentos no agotados no escriben `EmailLog`; agotados sí,
 * con `status = FAILED`) sin depender de la cola compartida.
 */
class AlwaysFailingSender implements EmailSender {
  public calls = 0;
  send(): Promise<EmailSendResult> {
    this.calls += 1;
    return Promise.reject(new Error('SMTP inalcanzable (simulado)'));
  }
}

function fakeJob(
  data: EmailJobPayload,
  attemptsMade: number,
  attempts: number,
): Job<EmailJobPayload> {
  return {
    data,
    attemptsMade,
    opts: { attempts },
  } as unknown as Job<EmailJobPayload>;
}

describe('EmailProcessor — reintentos y fallo del proveedor (lógica real, Postgres real)', () => {
  let app: INestApplication;
  let tenant: TestTenant;
  let tenantPrisma: TenantPrismaService;

  beforeAll(async () => {
    app = await bootTestApp();
    tenant = await registerTestOrg(app, 'Mail-Retry');
    tenantPrisma = app.get(TenantPrismaService);
  }, 30000);

  afterAll(async () => {
    await app.close();
  }, 15000);

  it('process() propaga el error del proveedor (así BullMQ sabe que debe reintentar)', async () => {
    const sender = new AlwaysFailingSender();
    const processor = new EmailProcessor(sender, tenantPrisma);
    const payload: EmailJobPayload = {
      to: 'destino-inalcanzable@example.test',
      subject: 'Asunto',
      html: '<p>hola</p>',
      text: 'hola',
      template: 'notification',
      organizationId: tenant.organizationId,
    };
    await expect(processor.process(fakeJob(payload, 1, 3))).rejects.toThrow(
      'SMTP inalcanzable',
    );
    expect(sender.calls).toBe(1);
  });

  it('onFailed() en intentos NO agotados no escribe EmailLog (todavía puede reintentar)', async () => {
    const sender = new AlwaysFailingSender();
    const processor = new EmailProcessor(sender, tenantPrisma);
    const to = 'no-agotado@example.test';
    const payload: EmailJobPayload = {
      to,
      subject: 'Asunto',
      html: '<p>hola</p>',
      text: 'hola',
      template: 'notification',
      organizationId: tenant.organizationId,
    };

    await processor.onFailed(
      fakeJob(payload, 1, 3),
      new Error('falla intento 1'),
    );
    await processor.onFailed(
      fakeJob(payload, 2, 3),
      new Error('falla intento 2'),
    );

    const logs = await tenantPrisma.run(tenant.organizationId, (tx) =>
      tx.emailLog.findMany({ where: { to } }),
    );
    expect(logs).toHaveLength(0);
  });

  it('onFailed() en el intento que agota los reintentos SÍ escribe EmailLog con status FAILED', async () => {
    const sender = new AlwaysFailingSender();
    const processor = new EmailProcessor(sender, tenantPrisma);
    const to = 'agotado@example.test';
    const payload: EmailJobPayload = {
      to,
      subject: 'Asunto',
      html: '<p>hola</p>',
      text: 'hola',
      template: 'notification',
      organizationId: tenant.organizationId,
    };

    await processor.onFailed(
      fakeJob(payload, 1, 3),
      new Error('falla intento 1'),
    );
    await processor.onFailed(
      fakeJob(payload, 2, 3),
      new Error('falla intento 2'),
    );
    await processor.onFailed(
      fakeJob(payload, 3, 3),
      new Error('falla intento 3 (agotado)'),
    );

    const logs = await tenantPrisma.run(tenant.organizationId, (tx) =>
      tx.emailLog.findMany({ where: { to } }),
    );
    expect(logs).toHaveLength(1);
    expect(logs[0].status).toBe('FAILED');
    expect(logs[0].attempts).toBe(3);
    expect(logs[0].error).toContain('agotado');
  });

  it('un éxito posterior a fallos previos actualiza la MISMA fila (idempotencyKey) a SENT, no crea una segunda', async () => {
    const failingSender = new AlwaysFailingSender();
    const failingProcessor = new EmailProcessor(failingSender, tenantPrisma);
    const to = 'reintenta-y-sana@example.test';
    const idempotencyKey = `retry-recovery-${tenant.organizationId}`;
    const payload: EmailJobPayload = {
      to,
      subject: 'Asunto',
      html: '<p>hola</p>',
      text: 'hola',
      template: 'notification',
      organizationId: tenant.organizationId,
      idempotencyKey,
    };

    await failingProcessor.onFailed(
      fakeJob(payload, 1, 3),
      new Error('falla intento 1'),
    );
    await failingProcessor.onFailed(
      fakeJob(payload, 2, 3),
      new Error('falla intento 2'),
    );

    const afterFailures = await tenantPrisma.run(tenant.organizationId, (tx) =>
      tx.emailLog.findMany({ where: { idempotencyKey } }),
    );
    expect(afterFailures).toHaveLength(0); // todavía no agotó reintentos

    class AlwaysSucceedsSender implements EmailSender {
      send(): Promise<EmailSendResult> {
        return Promise.resolve({ provider: 'console' });
      }
    }
    const succeedingProcessor = new EmailProcessor(
      new AlwaysSucceedsSender(),
      tenantPrisma,
    );
    await succeedingProcessor.process(fakeJob(payload, 3, 3));

    const afterSuccess = await tenantPrisma.run(tenant.organizationId, (tx) =>
      tx.emailLog.findMany({ where: { idempotencyKey } }),
    );
    expect(afterSuccess).toHaveLength(1);
    expect(afterSuccess[0].status).toBe('SENT');
  });
});
