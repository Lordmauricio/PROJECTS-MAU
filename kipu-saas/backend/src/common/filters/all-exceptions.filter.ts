import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { randomUUID } from 'crypto';

/**
 * Único punto de salida para los errores de la API.
 *
 * Qué resuelve: sin un filtro propio, cualquier excepción no controlada
 * (un `P2002` de Prisma, un error de conexión de Postgres, un `TypeError`)
 * termina en la respuesta HTTP con su mensaje original. Esos mensajes
 * filtran nombres de tablas, constraints, fragmentos de SQL y hasta la
 * cadena de conexión — información que le sirve a alguien que esté
 * mapeando el sistema desde afuera, y que al usuario no le dice nada.
 *
 * Cómo lo resuelve: las `HttpException` que la aplicación lanza a propósito
 * (404 "Venta no encontrada", 402 de límite de plan, 409 de idempotencia)
 * se dejan pasar tal cual — son mensajes escritos para el usuario y los
 * tests dependen de ellos. Todo lo demás se convierte en un 500 genérico
 * con un `errorId`, y el detalle real va al log del servidor asociado a ese
 * mismo id: quien opera puede encontrar la causa exacta sin que el cliente
 * la vea.
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger('HttpException');

  constructor(private readonly isProduction: boolean) {}

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const body = exception.getResponse();
      // Los 5xx intencionales igual se loguean: son fallos del servidor.
      // (`getStatus()` devuelve `number`, no el enum, así que se compara
      // contra el literal para no mezclar tipos.)
      if (status >= 500) {
        this.logger.error(
          `${request.method} ${request.url} -> ${status}: ${exception.message}`,
          exception.stack,
        );
      }
      response
        .status(status)
        .json(
          typeof body === 'string'
            ? { statusCode: status, message: body }
            : body,
        );
      return;
    }

    // A partir de acá: error no previsto. El cliente recibe un id, el log
    // recibe la causa.
    const errorId = randomUUID();
    const message =
      exception instanceof Error ? exception.message : String(exception);
    const stack = exception instanceof Error ? exception.stack : undefined;

    this.logger.error(
      `[${errorId}] ${request.method} ${request.url} -> 500: ${message}`,
      stack,
    );

    response.status(HttpStatus.INTERNAL_SERVER_ERROR).json({
      statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
      message: 'Error interno del servidor',
      errorId,
      // Fuera de producción sí se devuelve el detalle: en desarrollo el
      // costo de ocultarlo es depurar a ciegas.
      ...(this.isProduction ? {} : { detail: message }),
    });
  }
}
