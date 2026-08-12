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

    // Las membresías (organization_users) tienen RLS: como todavía no
    // sabemos a qué organización pertenece el request, no podemos usar
    // tenantPrisma.run con un id de organización. Se resuelve con el rol
    // admin (PrismaService directo) solo para esta única consulta de
    // "¿a qué organizaciones pertenece este usuario?" — es información
    // sobre el propio usuario autenticado, no una fuga entre tenants.
    const memberships = await this.prisma.organizationUser.findMany({
      where: { userId: user.id, status: 'ACTIVE' },
      include: { organization: true, role: true },
    });

    if (memberships.length === 0) {
      throw new UnauthorizedException('El usuario no pertenece a ninguna organización activa');
    }

    let membership = memberships[0];
    if (memberships.length > 1) {
      if (!dto.organizationId) {
        return {
          requiresOrganizationSelection: true,
          organizations: memberships.map((m) => ({ id: m.organization.id, name: m.organization.name })),
        };
      }
      const selected = memberships.find((m) => m.organizationId === dto.organizationId);
      if (!selected) {
        throw new UnauthorizedException('No perteneces a esa organización');
      }
      membership = selected;
    }

    const tokens = await this.issueTokens({
      userId: user.id,
      organizationId: membership.organizationId,
      roleId: membership.roleId,
      roleKey: membership.role.key,
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
      organization: { id: membership.organization.id, name: membership.organization.name },
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
    const memberships = await this.prisma.organizationUser.findMany({
      where: { userId: user.id, status: 'ACTIVE' },
      include: { role: true },
    });
    const membership = memberships[0];
    if (!membership) {
      throw new UnauthorizedException('El usuario ya no tiene organizaciones activas');
    }

    return this.issueTokens({
      userId: user.id,
      organizationId: membership.organizationId,
      roleId: membership.roleId,
      roleKey: membership.role.key,
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
