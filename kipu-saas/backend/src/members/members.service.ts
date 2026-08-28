import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { randomBytes } from 'crypto';
import * as argon2 from 'argon2';
import { PrismaService } from '../prisma/prisma.service';
import { TenantPrismaService } from '../prisma/tenant-prisma.service';
import { MailService } from '../mail/mail.service';
import { AuditService } from '../audit/audit.service';
import { SubscriptionsService } from '../subscriptions/subscriptions.service';
import { InviteMemberDto } from './dto/invite-member.dto';

@Injectable()
export class MembersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantPrisma: TenantPrismaService,
    private readonly mail: MailService,
    private readonly audit: AuditService,
    private readonly subscriptions: SubscriptionsService,
  ) {}

  list(organizationId: string) {
    return this.tenantPrisma.run(organizationId, (tx) =>
      tx.organizationUser.findMany({
        where: { organizationId },
        include: {
          user: { select: { id: true, name: true, email: true } },
          role: true,
        },
        orderBy: { createdAt: 'asc' },
      }),
    );
  }

  /**
   * Invita a un usuario a la organización. Si el email no existe todavía
   * como User global, se crea una cuenta con password aleatoria e
   * inutilizable y se le manda a establecer la suya vía el flujo de
   * "reset de password". Nota de alcance: un flujo de "aceptar invitación"
   * explícito queda para una iteración futura; por ahora la membresía queda
   * ACTIVE de inmediato.
   */
  async invite(
    organizationId: string,
    dto: InviteMemberDto,
    actorUserId: string,
  ) {
    const { membership, pendingInvite } = await this.tenantPrisma.run(
      organizationId,
      async (tx) => {
        const role = await tx.role.findFirst({
          where: { id: dto.roleId, organizationId },
        });
        if (!role) throw new NotFoundException('Rol no encontrado');

        let user = await this.prisma.user.findUnique({
          where: { email: dto.email },
        });
        let isNewUser = false;
        if (!user) {
          isNewUser = true;
          const unusablePassword = await argon2.hash(
            randomBytes(32).toString('hex'),
          );
          user = await this.prisma.user.create({
            data: {
              email: dto.email,
              name: dto.name ?? dto.email,
              passwordHash: unusablePassword,
            },
          });
        }

        const existingMembership = await tx.organizationUser.findFirst({
          where: { organizationId, userId: user.id },
        });
        if (existingMembership) {
          throw new ConflictException(
            'Ese usuario ya pertenece a la organización',
          );
        }

        // Enforcement real del límite de usuarios del plan (Fase Comercial
        // 10) — DENTRO de esta misma transacción, ver
        // `SubscriptionsService.assertWithinLimit`.
        await this.subscriptions.assertWithinLimit(tx, organizationId, 'users');

        const created = await tx.organizationUser.create({
          data: {
            organizationId,
            userId: user.id,
            roleId: role.id,
            status: 'ACTIVE',
            joinedAt: new Date(),
          },
          include: { user: true, role: true },
        });

        // El email NO se encola acá: encolar es un efecto externo
        // (Redis/BullMQ) que no participa de esta transacción de Postgres.
        // Si el COMMIT fallara después de encolar, se enviaría igual y el
        // destinatario recibiría una invitación para una membresía que nunca
        // quedó persistida. Por eso el dato se DEVUELVE y el envío se difiere
        // hasta después del commit (ver abajo).
        const invite = isNewUser
          ? {
              email: user.email,
              organizationName: (
                await tx.organization.findUniqueOrThrow({
                  where: { id: organizationId },
                })
              ).name,
            }
          : null;

        return { membership: created, pendingInvite: invite };
      },
    );

    // A partir de acá la membresía está committeada: recién ahora tiene
    // sentido avisarle a la persona. `sendInvite` traga sus propios errores
    // de encolado, así que un Redis caído no revierte una invitación válida.
    if (pendingInvite) {
      await this.mail.sendInvite(
        pendingInvite.email,
        pendingInvite.organizationName,
        organizationId,
      );
    }

    await this.audit.log({
      organizationId,
      userId: actorUserId,
      action: 'members.invite',
      entityType: 'OrganizationUser',
      entityId: membership.id,
      metadata: { invitedEmail: dto.email, roleId: dto.roleId },
    });

    return membership;
  }

  async changeRole(
    organizationId: string,
    membershipId: string,
    roleId: string,
    actorUserId: string,
  ) {
    const updated = await this.tenantPrisma.run(organizationId, async (tx) => {
      const membership = await tx.organizationUser.findFirst({
        where: { id: membershipId, organizationId },
        include: { role: true },
      });
      if (!membership) throw new NotFoundException('Membresía no encontrada');

      const role = await tx.role.findFirst({
        where: { id: roleId, organizationId },
      });
      if (!role) throw new NotFoundException('Rol no encontrado');

      if (membership.role.key === 'OWNER') {
        const ownerCount = await tx.organizationUser.count({
          where: { organizationId, roleId: membership.roleId },
        });
        if (ownerCount <= 1) {
          throw new BadRequestException(
            'La organización debe tener al menos un propietario',
          );
        }
      }

      return tx.organizationUser.update({
        where: { id: membershipId },
        data: { roleId },
      });
    });

    await this.audit.log({
      organizationId,
      userId: actorUserId,
      action: 'members.role.update',
      entityType: 'OrganizationUser',
      entityId: membershipId,
      metadata: { newRoleId: roleId },
    });

    return updated;
  }

  async setStatus(
    organizationId: string,
    membershipId: string,
    status: 'ACTIVE' | 'SUSPENDED',
    actorUserId: string,
  ) {
    const updated = await this.tenantPrisma.run(organizationId, async (tx) => {
      const membership = await tx.organizationUser.findFirst({
        where: { id: membershipId, organizationId },
      });
      if (!membership) throw new NotFoundException('Membresía no encontrada');
      // Reactivar un usuario suspendido también consume un cupo del plan
      // — se chequea el límite igual que al invitar uno nuevo (no aplica
      // al camino ACTIVE -> ACTIVE, que no cambia el conteo).
      if (status === 'ACTIVE' && membership.status !== 'ACTIVE') {
        await this.subscriptions.assertWithinLimit(tx, organizationId, 'users');
      }
      const result = await tx.organizationUser.update({
        where: { id: membershipId },
        data: { status },
      });

      // Suspender a un usuario también revoca sus sesiones activas EN ESTA
      // organización, dentro de la MISMA transacción (todo-o-nada: si el
      // update de arriba se revierte, la revocación tampoco queda
      // aplicada). `refresh_tokens` no tiene RLS (no es tenant-scoped en el
      // esquema — ver docs/database.md, un usuario puede pertenecer a
      // varias organizaciones), así que el filtro explícito por
      // `organizationId` acá es la única barrera que evita alcanzar
      // sesiones de ESTE usuario en OTRA organización donde también sea
      // miembro. Ver `revokeSessions` para el mismo mecanismo expuesto
      // como acción explícita (dispositivo perdido, sin necesidad de
      // suspender la cuenta).
      if (status === 'SUSPENDED') {
        await tx.refreshToken.updateMany({
          where: { userId: membership.userId, organizationId, revokedAt: null },
          data: { revokedAt: new Date() },
        });
      }

      return result;
    });

    await this.audit.log({
      organizationId,
      userId: actorUserId,
      action: status === 'SUSPENDED' ? 'members.suspend' : 'members.reactivate',
      entityType: 'OrganizationUser',
      entityId: membershipId,
    });

    return updated;
  }

  /**
   * Revoca (marca `revokedAt`) todas las sesiones activas de un miembro EN
   * ESTA organización — infraestructura mínima para "usuario pierde
   * teléfono/computadora → el propietario/admin revoca el dispositivo".
   * No exige suspender la cuenta (a diferencia de `setStatus`, que además
   * revoca como efecto colateral): un empleado activo puede perder un
   * dispositivo sin perder su acceso.
   *
   * Alcance deliberado (infraestructura, no UI de "administrador de
   * dispositivos" todavía): revoca TODAS las sesiones del usuario en esta
   * organización de una vez, no una sesión/dispositivo puntual — no existe
   * hoy ninguna superficie que liste sesiones activas por separado
   * (userAgent/ip/createdAt ya se guardan en `RefreshToken` desde Fase 1,
   * listos para esa UI futura). Revocar solo detiene la emisión de NUEVOS
   * access tokens (refresh/login silencioso): un access token ya emitido
   * sigue siendo válido hasta que expira por su cuenta (máximo 15 minutos,
   * stateless — el sistema no valida el access token contra una lista de
   * revocación en cada request, igual que hoy). Documentado como
   * limitación aceptada, no un descuido — ver docs/security.md.
   */
  async revokeSessions(
    organizationId: string,
    membershipId: string,
    actorUserId: string,
  ) {
    const membership = await this.tenantPrisma.run(organizationId, (tx) =>
      tx.organizationUser.findFirst({
        where: { id: membershipId, organizationId },
      }),
    );
    if (!membership) throw new NotFoundException('Membresía no encontrada');

    const { count } = await this.prisma.refreshToken.updateMany({
      where: { userId: membership.userId, organizationId, revokedAt: null },
      data: { revokedAt: new Date() },
    });

    await this.audit.log({
      organizationId,
      userId: actorUserId,
      action: 'members.sessions.revoke',
      entityType: 'OrganizationUser',
      entityId: membershipId,
      metadata: { targetUserId: membership.userId, revokedCount: count },
    });

    return { revokedCount: count };
  }
}
