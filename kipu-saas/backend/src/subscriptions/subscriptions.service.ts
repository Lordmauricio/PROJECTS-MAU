import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  HttpException,
  HttpStatus,
  Injectable,
} from '@nestjs/common';
import { Prisma } from '../../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { TenantPrismaService } from '../prisma/tenant-prisma.service';
import { AuditService } from '../audit/audit.service';
import {
  NotificationsService,
  NOTIFICATION_TYPES,
} from '../notifications/notifications.service';
import {
  LimitedResource,
  PLAN_DEFINITIONS,
  PlanKey,
  PlanLimits,
  RESOURCE_LABELS,
  RESOURCE_TO_LIMIT_KEY,
} from './plans.catalog';

type Tx = Prisma.TransactionClient;

const RENEWAL_PERIOD_MS = 30 * 24 * 60 * 60 * 1000; // 30 días — sin pasarela real todavía, ver punto 7/8 del pedido.

/**
 * Ciclo de vida de `Subscription` + enforcement real de los límites de
 * `Plan.limits`. Ver `docs/architecture.md` sección 16 para el detalle
 * completo de las decisiones (por qué `FOR UPDATE`, por qué expiración
 * perezosa, por qué 402 para límites y 403 para cancelada).
 */
@Injectable()
export class SubscriptionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantPrisma: TenantPrismaService,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
  ) {}

  /** `plans` es una tabla global sin RLS (mismo criterio que `permissions`) — se lee/escribe con `PrismaService`, nunca con `TenantPrismaService`. */
  async getOrCreatePlan(key: PlanKey) {
    const def = PLAN_DEFINITIONS[key];
    const existing = await this.prisma.plan.findUnique({ where: { key } });
    if (existing) return existing;
    return this.prisma.plan.create({
      data: {
        key: def.key,
        name: def.name,
        priceMonthly: def.priceMonthly,
        limits: def.limits as unknown as Prisma.InputJsonValue,
        features: def.features as unknown as Prisma.InputJsonValue,
      },
    });
  }

  /** Catálogo de planes disponibles (para la UI de "cambiar de plan") — siempre los 4, ordenados por precio. */
  async listPlans() {
    const plans = await this.prisma.plan.findMany({
      where: { active: true },
      orderBy: { priceMonthly: 'asc' },
    });
    return plans;
  }

  /**
   * Lectura para el frontend: estado efectivo (con la transición perezosa
   * de expiración ya aplicada) + uso actual vs. límites del plan.
   */
  async getSummary(organizationId: string) {
    const subscription = await this.getEffective(organizationId);
    const usage = await this.tenantPrisma.run(organizationId, (tx) =>
      this.countAllUsage(tx, organizationId),
    );
    const limits = subscription.plan.limits as unknown as PlanLimits;
    return {
      status: subscription.status,
      currentPeriodEnd: subscription.currentPeriodEnd,
      plan: subscription.plan,
      usage: {
        users: { used: usage.users, limit: limits.maxUsers },
        branches: { used: usage.branches, limit: limits.maxBranches },
        products: { used: usage.products, limit: limits.maxProducts },
      },
    };
  }

  /**
   * Expiración perezosa: no hay un cron/worker dedicado (no hace falta
   * todavía sin pasarela de pagos real) — cada vez que se lee o se usa la
   * suscripción, si está ACTIVE y su `currentPeriodEnd` ya pasó, se
   * transiciona a PAST_DUE acá mismo, se persiste, y se deja un
   * `SubscriptionEvent`. Barato porque el único lugar que de verdad
   * importa (enforcement) ya abre una transacción por cada creación.
   */
  async getEffective(organizationId: string) {
    return this.tenantPrisma.run(organizationId, async (tx) => {
      const subscription = await tx.subscription.findUniqueOrThrow({
        where: { organizationId },
        include: { plan: true },
      });
      if (
        subscription.status === 'ACTIVE' &&
        subscription.currentPeriodEnd &&
        subscription.currentPeriodEnd.getTime() < Date.now()
      ) {
        const updated = await tx.subscription.update({
          where: { id: subscription.id },
          data: { status: 'PAST_DUE' },
          include: { plan: true },
        });
        await tx.subscriptionEvent.create({
          data: {
            organizationId,
            subscriptionId: subscription.id,
            type: 'expired',
            payload: JSON.stringify({
              previousStatus: 'ACTIVE',
              currentPeriodEnd: subscription.currentPeriodEnd,
            }),
          },
        });
        return updated;
      }
      return subscription;
    });
  }

  /**
   * Cambia de plan. Bloquea el downgrade si el uso ACTUAL ya supera algún
   * límite del plan destino (409) — evita dejar la organización en un
   * estado "ya excedido" apenas cambia de plan. Elegir un plan pago activa
   * la suscripción (`ACTIVE`, período de 30 días desde hoy — sin pasarela
   * real, ver punto 7/8 del pedido); volver a `free` la deja `TRIALING`
   * sin vencimiento, igual que al registrarse.
   */
  async changePlan(
    organizationId: string,
    planKey: PlanKey,
    actorUserId: string,
  ) {
    const targetDef = PLAN_DEFINITIONS[planKey];
    const targetPlan = await this.getOrCreatePlan(planKey);

    const result = await this.tenantPrisma.run(organizationId, async (tx) => {
      const rows = await tx.$queryRaw<
        Array<{ id: string; status: string; planId: string }>
      >`
        SELECT id, status, "planId" FROM subscriptions WHERE "organizationId" = ${organizationId} FOR UPDATE
      `;
      const locked = rows[0];
      if (!locked)
        throw new BadRequestException('La organización no tiene suscripción');
      if (locked.status === 'CANCELLED') {
        throw new ConflictException(
          'La suscripción está cancelada. Reactivala (renovación) antes de cambiar de plan.',
        );
      }

      const subscription = await tx.subscription.findUniqueOrThrow({
        where: { id: locked.id },
        include: { plan: true },
      });
      if (subscription.plan.key === planKey) {
        return subscription; // idempotente: ya está en ese plan.
      }

      const usage = await this.countAllUsage(tx, organizationId);
      const overLimitResource = (
        Object.keys(RESOURCE_TO_LIMIT_KEY) as LimitedResource[]
      ).find((resource) => {
        const limit = targetDef.limits[RESOURCE_TO_LIMIT_KEY[resource]];
        return limit !== null && usage[resource] > limit;
      });
      if (overLimitResource) {
        const limit =
          targetDef.limits[RESOURCE_TO_LIMIT_KEY[overLimitResource]];
        throw new ConflictException(
          `No se puede cambiar al plan ${targetDef.name}: tenés ${usage[overLimitResource]} ${RESOURCE_LABELS[overLimitResource]} y el límite de ese plan es ${limit}.`,
        );
      }

      const isPaid = targetDef.priceMonthly > 0;
      const updated = await tx.subscription.update({
        where: { id: subscription.id },
        data: {
          planId: targetPlan.id,
          status: isPaid ? 'ACTIVE' : 'TRIALING',
          currentPeriodEnd: isPaid
            ? new Date(Date.now() + RENEWAL_PERIOD_MS)
            : null,
        },
        include: { plan: true },
      });
      await tx.subscriptionEvent.create({
        data: {
          organizationId,
          subscriptionId: subscription.id,
          type: 'plan_changed',
          payload: JSON.stringify({ from: subscription.plan.key, to: planKey }),
        },
      });
      return updated;
    });

    await this.audit.log({
      organizationId,
      userId: actorUserId,
      action: 'subscription.plan_changed',
      entityType: 'Subscription',
      entityId: result.id,
      metadata: { plan: planKey },
    });
    await this.notifications.create(
      organizationId,
      actorUserId,
      NOTIFICATION_TYPES.SUBSCRIPTION_PLAN_CHANGED,
      'Plan actualizado',
      `Tu plan ahora es ${targetDef.name}.`,
    );
    return result;
  }

  async cancel(organizationId: string, actorUserId: string) {
    const result = await this.tenantPrisma.run(organizationId, async (tx) => {
      const rows = await tx.$queryRaw<Array<{ id: string; status: string }>>`
        SELECT id, status FROM subscriptions WHERE "organizationId" = ${organizationId} FOR UPDATE
      `;
      const locked = rows[0];
      if (!locked)
        throw new BadRequestException('La organización no tiene suscripción');
      if (locked.status === 'CANCELLED') {
        return tx.subscription.findUniqueOrThrow({
          where: { id: locked.id },
          include: { plan: true },
        });
      }
      const updated = await tx.subscription.update({
        where: { id: locked.id },
        data: { status: 'CANCELLED' },
        include: { plan: true },
      });
      await tx.subscriptionEvent.create({
        data: {
          organizationId,
          subscriptionId: locked.id,
          type: 'cancelled',
          payload: null,
        },
      });
      return updated;
    });

    await this.audit.log({
      organizationId,
      userId: actorUserId,
      action: 'subscription.cancelled',
      entityType: 'Subscription',
      entityId: result.id,
    });
    await this.notifications.create(
      organizationId,
      actorUserId,
      NOTIFICATION_TYPES.SUBSCRIPTION_CANCELLED,
      'Suscripción cancelada',
      'Tu suscripción fue cancelada. No vas a poder agregar usuarios, sucursales ni productos nuevos hasta que renueves.',
    );
    return result;
  }

  /**
   * Renovación manual — no hay pasarela de pagos real todavía (punto 7/8
   * del pedido), así que esto simula el efecto de un cobro exitoso:
   * extiende el período 30 días desde el vencimiento actual (o desde hoy
   * si ya venció) y reactiva la suscripción si estaba PAST_DUE. El plan
   * gratuito no tiene período que renovar.
   */
  async renew(organizationId: string, actorUserId: string) {
    const result = await this.tenantPrisma.run(organizationId, async (tx) => {
      const rows = await tx.$queryRaw<
        Array<{ id: string; status: string; currentPeriodEnd: Date | null }>
      >`
        SELECT id, status, "currentPeriodEnd" FROM subscriptions WHERE "organizationId" = ${organizationId} FOR UPDATE
      `;
      const locked = rows[0];
      if (!locked)
        throw new BadRequestException('La organización no tiene suscripción');

      const subscription = await tx.subscription.findUniqueOrThrow({
        where: { id: locked.id },
        include: { plan: true },
      });
      if (subscription.plan.priceMonthly.isZero()) {
        throw new BadRequestException(
          'El plan gratuito no requiere renovación',
        );
      }

      const base =
        locked.currentPeriodEnd &&
        locked.currentPeriodEnd.getTime() > Date.now()
          ? locked.currentPeriodEnd
          : new Date();
      const updated = await tx.subscription.update({
        where: { id: locked.id },
        data: {
          status: 'ACTIVE',
          currentPeriodEnd: new Date(base.getTime() + RENEWAL_PERIOD_MS),
        },
        include: { plan: true },
      });
      await tx.subscriptionEvent.create({
        data: {
          organizationId,
          subscriptionId: locked.id,
          type: 'renewed',
          payload: JSON.stringify({ previousStatus: locked.status }),
        },
      });
      return updated;
    });

    await this.audit.log({
      organizationId,
      userId: actorUserId,
      action: 'subscription.renewed',
      entityType: 'Subscription',
      entityId: result.id,
      metadata: { currentPeriodEnd: result.currentPeriodEnd },
    });
    await this.notifications.create(
      organizationId,
      actorUserId,
      NOTIFICATION_TYPES.SUBSCRIPTION_RENEWED,
      'Suscripción renovada',
      `Tu plan ${result.plan.name} se renovó hasta ${result.currentPeriodEnd?.toLocaleDateString('es-BO')}.`,
    );
    return result;
  }

  /**
   * Enforcement real de un límite. SIEMPRE se llama DESDE DENTRO de la
   * misma transacción (`tx`) que va a hacer el `create` del recurso — el
   * `SELECT ... FOR UPDATE` sobre la fila de `subscriptions` de esta
   * organización serializa cualquier otra creación concurrente del MISMO
   * recurso en la MISMA organización (dos invitaciones simultáneas, dos
   * altas de sucursal simultáneas, etc.): la segunda transacción espera a
   * que la primera confirme (o revierta) antes de poder leer el conteo,
   * así que un conteo + un `create` nunca pueden "pisarse" bajo
   * concurrencia real y superar el límite — mismo patrón exacto que
   * `lockSale`/`lockPurchase`/`lockPayableByPurchase` ya usan en
   * Ventas/Compras/Pagos.
   *
   * 402 (Payment Required) para "llegaste al límite de tu plan" — status
   * HTTP reservado exactamente para este caso, distinto de un 403 genérico
   * de permisos, para que el frontend pueda distinguir "no podés" de
   * "no podés MÁS sin upgradear". 403 para suscripción cancelada (no es un
   * límite numérico, es que la cuenta no tiene plan activo).
   */
  async assertWithinLimit(
    tx: Tx,
    organizationId: string,
    resource: LimitedResource,
  ): Promise<void> {
    const rows = await tx.$queryRaw<Array<{ id: string; status: string }>>`
      SELECT id, status FROM subscriptions WHERE "organizationId" = ${organizationId} FOR UPDATE
    `;
    const locked = rows[0];
    if (!locked)
      throw new BadRequestException('La organización no tiene suscripción');

    if (locked.status === 'CANCELLED') {
      throw new ForbiddenException(
        'Tu suscripción está cancelada. Renová tu plan para poder agregar más ' +
          RESOURCE_LABELS[resource] +
          '.',
      );
    }

    const subscription = await tx.subscription.findUniqueOrThrow({
      where: { id: locked.id },
      include: { plan: true },
    });
    const limits = subscription.plan.limits as unknown as PlanLimits;
    const limit = limits[RESOURCE_TO_LIMIT_KEY[resource]];
    if (limit === null || limit === undefined) return; // ilimitado (ENTERPRISE)

    const used = await this.countUsage(tx, organizationId, resource);
    if (used >= limit) {
      throw new HttpException(
        {
          statusCode: HttpStatus.PAYMENT_REQUIRED,
          error: 'Payment Required',
          message: `Alcanzaste el límite de ${RESOURCE_LABELS[resource]} de tu plan ${subscription.plan.name} (${limit}). Actualizá tu plan para agregar más.`,
        },
        HttpStatus.PAYMENT_REQUIRED,
      );
    }
  }

  private async countUsage(
    tx: Tx,
    organizationId: string,
    resource: LimitedResource,
  ): Promise<number> {
    switch (resource) {
      case 'users':
        return tx.organizationUser.count({
          where: { organizationId, status: 'ACTIVE' },
        });
      case 'branches':
        return tx.branch.count({ where: { organizationId, active: true } });
      case 'products':
        return tx.product.count({ where: { organizationId, active: true } });
    }
  }

  private async countAllUsage(
    tx: Tx,
    organizationId: string,
  ): Promise<Record<LimitedResource, number>> {
    const [users, branches, products] = await Promise.all([
      this.countUsage(tx, organizationId, 'users'),
      this.countUsage(tx, organizationId, 'branches'),
      this.countUsage(tx, organizationId, 'products'),
    ]);
    return { users, branches, products };
  }
}
