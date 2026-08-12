import { Injectable, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { AUDIT_JOB, AUDIT_QUEUE, AuditJobPayload } from './audit.types';

/**
 * Punto de entrada para registrar eventos de auditoría desde cualquier
 * módulo (login, cambios de permisos, creación de empresa, etc. — ver
 * Parte 1 sección 15). No escribe directamente en la base: encola un job en
 * BullMQ/Redis y `AuditProcessor` es quien efectivamente inserta la fila en
 * `audit_logs`. Esto demuestra la infraestructura de colas funcionando de
 * verdad (no solo declarada) y evita que un pico de escritura de auditoría
 * compita por la misma transacción que la acción de negocio que la originó.
 */
@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);

  constructor(@InjectQueue(AUDIT_QUEUE) private readonly queue: Queue<AuditJobPayload>) {}

  async log(payload: AuditJobPayload): Promise<void> {
    try {
      await this.queue.add(AUDIT_JOB, payload, {
        attempts: 3,
        backoff: { type: 'exponential', delay: 1000 },
        removeOnComplete: true,
        removeOnFail: 100,
      });
    } catch (err) {
      // La auditoría nunca debe tumbar la operación de negocio que la
      // origina: si Redis está caído, se loguea y se sigue.
      this.logger.error(`No se pudo encolar el evento de auditoría "${payload.action}"`, err as Error);
    }
  }
}
