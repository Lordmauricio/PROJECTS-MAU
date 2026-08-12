import {
  BadRequestException,
  ConflictException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import * as argon2 from 'argon2';
import { PrismaService } from '../prisma/prisma.service';
import { UserPrismaService } from '../prisma/user-prisma.service';
import { TenantPrismaService } from '../prisma/tenant-prisma.service';
import { OrganizationsService } from '../organizations/organizations.service';
import { MailService } from '../mail/mail.service';
import { AuditService } from '../audit/audit.service';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import { generateOpaqueToken, hashOpaqueToken } from './token.util';

export interface AccessTokenPayload {
  sub: string; // userId
  organizationId: string;
  roleId: string;
  roleKey: string;
}

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
}

interface IssueTokensOptions {
  userId: string;
  organizationId: string;
  roleId: string;
  roleKey: string;
  userAgent?: string;
  ip?: string;
}

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly userPrisma: UserPrismaService,
    private readonly tenantPrisma: TenantPrismaService,
    private readonly organizations: OrganizationsService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
    private readonly mail: MailService,
    private readonly audit: AuditService,
  ) {}

  async register(dto: RegisterDto, meta: { userAgent?: string; ip?: string } = {}) {
    const existingUser = await this.prisma.user.findUnique({ where: { email: dto.email } });
    if (existingUser) {
      throw new ConflictException('Ya existe una cuenta con ese email');
    }

    const passwordHash = await argon2.hash(dto.password);

    const { organization, roles, user } = await this.organizations.bootstrapOrganization({
      organizationName: dto.organizationName,
      legalName: dto.legalName,
      nit: dto.nit,
      branchName: dto.branchName,
      ownerEmail: dto.email,
      ownerName: dto.ownerName,
      ownerPasswordHash: passwordHash,
    });

    await this.issueEmailVerification(user.id, user.email);

    const ownerRole = roles.find((r) => r.key === 'OWNER')!;
    const tokens = await this.issueTokens({
      userId: user.id,
      organizationId: organization.id,
      roleId: ownerRole.id,
      roleKey: ownerRole.key,
      userAgent: meta.userAgent,
      ip: meta.ip,
    });

    await this.audit.log({
      organizationId: organization.id,
      userId: user.id,
      action: 'organization.create',
      entityType: 'Organization',
      entityId: organization.id,
      metadata: { nit: organization.nit, name: organization.name },
      ip: meta.ip,
      userAgent: meta.userAgent,
    });
    await this.audit.log({
      organizationId: organization.id,
      userId: user.id,
      action: 'auth.login',
      metadata: { via: 'register' },
      ip: meta.ip,
      userAgent: meta.userAgent,
    });

    return {
      ...tokens,
      user: { id: user.id, name: user.name, email: user.email },
      organization: { id: organization.id, name: organization.name },
    };
  }

  async login(dto: LoginDto, meta: { userAgent?: string; ip?: string }) {
    const user = await this.prisma.user.findUnique({ where: { email: dto.email } });
    if (!user || !user.active) {
      throw new UnauthorizedException('Credenciales inválidas');
    }
    const valid = await argon2.verify(user.passwordHash, dto.password);
    if (!valid) {
      throw new UnauthorizedException('Credenciales inválidas');
    }

    // Las membresías (organization_users) tienen RLS por organizationId, y
    // todavía no sabemos con cuál organización va a operar el request. Se
    // resuelve vía UserPrismaService, que fija app.current_user_id — hay
    // una policy adicional en la base (own_memberships_readable) que deja
    // leer las propias filas de membresía por userId, sin exponer datos de
    // negocio de ningún tenant ni requerir bypass de RLS.
    //
    // Importante: acá NO se usa `include: { role, organization }`. Esas
    // tablas tienen su propia RLS por organizationId, y en esta consulta
    // solo está fijado app.current_user_id (no app.current_tenant) — un
    // JOIN se ejecutaría igual, pero Postgres filtraría las filas
    // relacionadas y el include volvería `null` en vez de fallar, lo cual
    // rompe silenciosamente más adelante. Por eso el rol y la organización
    // de la membresía elegida se resuelven en un segundo paso, ya con
    // tenantPrisma.run(organizationId, ...) una vez que sabemos cuál es.
    const memberships = await this.userPrisma.run(user.id, (tx) =>
      tx.organizationUser.findMany({
        where: { userId: user.id, status: 'ACTIVE' },
      }),
    );

    if (memberships.length === 0) {
      throw new UnauthorizedException('El usuario no pertenece a ninguna organización activa');
    }

    let membership = memberships[0];
    if (memberships.length > 1) {
      if (!dto.organizationId) {
        const organizations = await Promise.all(
          memberships.map((m) =>
            this.tenantPrisma.run(m.organizationId, (tx) =>
              tx.organization.findUniqueOrThrow({ where: { id: m.organizationId } }),
            ),
          ),
        );
        return {
          requiresOrganizationSelection: true,
          organizations: organizations.map((o) => ({ id: o.id, name: o.name })),
        };
      }
      const selected = memberships.find((m) => m.organizationId === dto.organizationId);
      if (!selected) {
        throw new UnauthorizedException('No perteneces a esa organización');
      }
      membership = selected;
    }

    const [role, organization] = await this.tenantPrisma.run(membership.organizationId, (tx) =>
      Promise.all([
        tx.role.findUniqueOrThrow({ where: { id: membership.roleId } }),
        tx.organization.findUniqueOrThrow({ where: { id: membership.organizationId } }),
      ]),
    );

    const tokens = await this.issueTokens({
      userId: user.id,
      organizationId: membership.organizationId,
      roleId: membership.roleId,
      roleKey: role.key,
      userAgent: meta.userAgent,
      ip: meta.ip,
    });

    await this.audit.log({
      organizationId: membership.organizationId,
      userId: user.id,
      action: 'auth.login',
      ip: meta.ip,
      userAgent: meta.userAgent,
    });

    return {
      ...tokens,
      user: { id: user.id, name: user.name, email: user.email },
      organization: { id: organization.id, name: organization.name },
    };
  }

  async refresh(refreshToken: string) {
    const hash = hashOpaqueToken(refreshToken);
    const stored = await this.prisma.refreshToken.findUnique({ where: { tokenHash: hash } });
    if (!stored || stored.revokedAt || stored.expiresAt < new Date()) {
      throw new UnauthorizedException('Refresh token inválido o expirado');
    }

    // Rotación: el token usado se revoca y se emite uno nuevo.
    await this.prisma.refreshToken.update({
      where: { id: stored.id },
      data: { revokedAt: new Date() },
    });

    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: stored.userId } });
    // Sin include de `role` acá por la misma razón que en login(): esta
    // consulta solo fija app.current_user_id, y la tabla roles tiene su
    // propia RLS por organizationId — el rol se resuelve aparte, una vez
    // elegida la membresía, con tenantPrisma.run.
    const memberships = await this.userPrisma.run(user.id, (tx) =>
      tx.organizationUser.findMany({
        where: { userId: user.id, status: 'ACTIVE' },
      }),
    );
    if (memberships.length === 0) {
      throw new UnauthorizedException('El usuario ya no tiene organizaciones activas');
    }

    // Preservar la organización con la que se emitió el token original en
    // vez de re-elegir una arbitrariamente: un usuario con membresías en 2+
    // empresas no debe "cambiar" de empresa sin darse cuenta al refrescar.
    // El rol siempre se relee en vivo desde la membresía actual (no del
    // valor guardado en el token), así un cambio de rol también se refleja
    // en el próximo refresh y no solo cuando expira el access token.
    let membership = stored.organizationId
      ? memberships.find((m) => m.organizationId === stored.organizationId)
      : undefined;
    if (!membership) {
      // Token legado sin organizationId guardado, o la membresía original
      // ya no está activa (removido de esa organización): se cae de vuelta
      // a la primera membresía activa disponible.
      membership = memberships[0];
    }

    const role = await this.tenantPrisma.run(membership.organizationId, (tx) =>
      tx.role.findUniqueOrThrow({ where: { id: membership.roleId } }),
    );

    return this.issueTokens({
      userId: user.id,
      organizationId: membership.organizationId,
      roleId: membership.roleId,
      roleKey: role.key,
    });
  }

  async logout(refreshToken: string) {
    const hash = hashOpaqueToken(refreshToken);
    await this.prisma.refreshToken.updateMany({
      where: { tokenHash: hash, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  async requestPasswordReset(email: string) {
    const user = await this.prisma.user.findUnique({ where: { email } });
    if (!user) return; // no revelar si el email existe (evita enumeración)

    const { token, hash } = generateOpaqueToken();
    const expiresAt = new Date(Date.now() + 1000 * 60 * 30);
    await this.prisma.passwordResetToken.create({
      data: { userId: user.id, tokenHash: hash, expiresAt },
    });
    await this.mail.sendPasswordReset(user.email, token);
  }

  async confirmPasswordReset(token: string, newPassword: string) {
    const hash = hashOpaqueToken(token);
    const record = await this.prisma.passwordResetToken.findUnique({ where: { tokenHash: hash } });
    if (!record || record.usedAt || record.expiresAt < new Date()) {
      throw new BadRequestException('Token de reset inválido o expirado');
    }

    const passwordHash = await argon2.hash(newPassword);
    await this.prisma.$transaction([
      this.prisma.user.update({ where: { id: record.userId }, data: { passwordHash } }),
      this.prisma.passwordResetToken.update({ where: { id: record.id }, data: { usedAt: new Date() } }),
      this.prisma.refreshToken.updateMany({
        where: { userId: record.userId, revokedAt: null },
        data: { revokedAt: new Date() },
      }),
    ]);
  }

  private async issueEmailVerification(userId: string, email: string) {
    const { token, hash } = generateOpaqueToken();
    const expiresAt = new Date(Date.now() + 1000 * 60 * 60 * 48);
    await this.prisma.emailVerificationToken.create({
      data: { userId, tokenHash: hash, expiresAt },
    });
    await this.mail.sendEmailVerification(email, token);
  }

  async confirmEmailVerification(token: string) {
    const hash = hashOpaqueToken(token);
    const record = await this.prisma.emailVerificationToken.findUnique({ where: { tokenHash: hash } });
    if (!record || record.usedAt || record.expiresAt < new Date()) {
      throw new BadRequestException('Token de verificación inválido o expirado');
    }
    await this.prisma.$transaction([
      this.prisma.user.update({ where: { id: record.userId }, data: { emailVerifiedAt: new Date() } }),
      this.prisma.emailVerificationToken.update({ where: { id: record.id }, data: { usedAt: new Date() } }),
    ]);
  }

  private async issueTokens(options: IssueTokensOptions): Promise<AuthTokens> {
    const payload: AccessTokenPayload = {
      sub: options.userId,
      organizationId: options.organizationId,
      roleId: options.roleId,
      roleKey: options.roleKey,
    };
    const accessToken = await this.jwt.signAsync(payload, {
      secret: this.config.getOrThrow('JWT_ACCESS_SECRET'),
      expiresIn: this.config.get('JWT_ACCESS_EXPIRES_IN', '15m'),
    });

    const { token: refreshToken, hash } = generateOpaqueToken();
    const expiresAt = this.computeRefreshExpiry();
    await this.prisma.refreshToken.create({
      data: {
        userId: options.userId,
        organizationId: options.organizationId,
        roleId: options.roleId,
        tokenHash: hash,
        userAgent: options.userAgent,
        ip: options.ip,
        expiresAt,
      },
    });

    return { accessToken, refreshToken };
  }

  private computeRefreshExpiry(): Date {
    const raw = this.config.get('JWT_REFRESH_EXPIRES_IN', '30d');
    const match = /^(\d+)([smhd])$/.exec(raw);
    const amount = match ? Number(match[1]) : 30;
    const unit = match ? match[2] : 'd';
    const unitMs: Record<string, number> = { s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000 };
    return new Date(Date.now() + amount * (unitMs[unit] ?? unitMs.d));
  }
}
