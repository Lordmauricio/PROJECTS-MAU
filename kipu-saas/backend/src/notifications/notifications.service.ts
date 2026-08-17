import {
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { TenantPrismaService } from '../prisma/tenant-prisma.service';
import { ListNotificationsQueryDto } from './dto/list-notifications-query.dto';

/**
 * Catálogo cerrado de tipos de notificación que el sistema genera. No es
 * un enum de Prisma (la columna es `String` desde Foundation) para no
 * requerir una migración cada vez que se agrega un evento nuevo, pero
 * mantenerlo como constante evita strings mágicos dispersos por los
 * módulos que llaman a `NotificationsService.create`.
 */
export const NOTIFICATION_TYPES = {
  SALE_CONFIRMED: 'sale.confirmed',
  SALE_PAYMENT_RECEIVED: 'sale.payment_received',
  PURCHASE_RECEIVED: 'purchase.received',
  RECEIVABLE_PENDING: 'receivable.pending',
  PAYABLE_PENDING: 'payable.pending',
  CASH_OPENED: 'cash.opened',
  CASH_CLOSED: 'cash.closed',
  CASH_DISCREPANCY: 'cash.discrepancy',
} as const;

export type NotificationType =
  (typeof NOTIFICATION_TYPES)[keyof typeof NOTIFICATION_TYPES];

@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);

  constructor(private readonly tenantPrisma: TenantPrismaService) {}

  /**
   * Punto de entrada usado por Ventas/Compras/Caja/Cobros/Pagos para
   * avisarle a un usuario concreto de un evento de negocio. SIEMPRE un
   * `userId` concreto — nunca `null` (ver comentario en
   * `schema.prisma#Notification`): con `read` como único booleano por
   * fila, una notificación "para toda la organización" compartiría ese
   * booleano entre todos los usuarios. Nunca debe tumbar la operación de
   * negocio que la origina, mismo criterio que `AuditService.log`.
   */
  async create(
    organizationId: string,
    userId: string,
    type: NotificationType,
    title: string,
    message: string,
  ): Promise<void> {
    try {
      await this.tenantPrisma.run(organizationId, (tx) =>
        tx.notification.create({
          data: { organizationId, userId, type, title, message },
        }),
      );
    } catch (err) {
      this.logger.error(
        `No se pudo crear la notificación "${type}" para userId=${userId}`,
        err as Error,
      );
    }
  }

  async list(
    organizationId: string,
    userId: string,
    query: ListNotificationsQueryDto,
  ) {
    const page = query.page ?? 1;
    const pageSize = Math.min(query.pageSize ?? 20, 100);

    return this.tenantPrisma.run(organizationId, async (tx) => {
      const where = {
        organizationId,
        userId,
        ...(query.unreadOnly ? { read: false } : {}),
      };
      const [items, total] = await Promise.all([
        tx.notification.findMany({
          where,
          orderBy: { createdAt: 'desc' },
          skip: (page - 1) * pageSize,
          take: pageSize,
        }),
        tx.notification.count({ where }),
      ]);
      return { items, total, page, pageSize };
    });
  }

  async unreadCount(organizationId: string, userId: string): Promise<number> {
    return this.tenantPrisma.run(organizationId, (tx) =>
      tx.notification.count({ where: { organizationId, userId, read: false } }),
    );
  }

  async markRead(
    organizationId: string,
    userId: string,
    notificationId: string,
  ) {
    return this.tenantPrisma.run(organizationId, async (tx) => {
      const notification = await tx.notification.findFirst({
        where: { id: notificationId, organizationId },
      });
      if (!notification)
        throw new NotFoundException('Notificación no encontrada');
      // RLS ya aísla por organizationId; esta comprobación aísla además
      // por usuario DENTRO de la misma organización (un vendedor no debe
      // poder marcar como leída la notificación de otro usuario).
      if (notification.userId !== userId) {
        throw new ForbiddenException('Esta notificación no te pertenece');
      }
      if (notification.read) return notification;
      return tx.notification.update({
        where: { id: notificationId },
        data: { read: true, readAt: new Date() },
      });
    });
  }

  async markAllRead(
    organizationId: string,
    userId: string,
  ): Promise<{ updated: number }> {
    return this.tenantPrisma.run(organizationId, async (tx) => {
      const result = await tx.notification.updateMany({
        where: { organizationId, userId, read: false },
        data: { read: true, readAt: new Date() },
      });
      return { updated: result.count };
    });
  }
}
