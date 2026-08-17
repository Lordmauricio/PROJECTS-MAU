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
import { InviteMemberDto } from './dto/invite-member.dto';

@Injectable()
export class MembersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantPrisma: TenantPrismaService,
    private readonly mail: MailService,
    private readonly audit: AuditService,
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
    const membership = await this.tenantPrisma.run(
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

        if (isNewUser) {
          const organization = await tx.organization.findUniqueOrThrow({
            where: { id: organizationId },
          });
          await this.mail.sendInvite(
            user.email,
            organization.name,
            organizationId,
          );
        }

        return created;
      },
    );

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
      return tx.organizationUser.update({
        where: { id: membershipId },
        data: { status },
      });
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
}
