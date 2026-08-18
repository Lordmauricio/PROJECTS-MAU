import { Body, Controller, Get, Post, Req, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Request } from 'express';
import { AuthService } from './auth.service';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import {
  ConfirmEmailVerificationDto,
  ConfirmPasswordResetDto,
  RefreshDto,
  RequestPasswordResetDto,
} from './dto/refresh.dto';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { PermissionsGuard } from '../common/guards/permissions.guard';
import { NoPermissionRequired } from '../common/decorators/no-permission-required.decorator';
import { CurrentAuth } from '../common/decorators/current-auth.decorator';
import type { AccessTokenPayload } from './auth.service';

@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post('register')
  register(@Body() dto: RegisterDto, @Req() req: Request) {
    return this.auth.register(dto, {
      userAgent: req.headers['user-agent'],
      ip: req.ip,
    });
  }

  // 10/min por IP. Se evaluó bajarlo a 5 (es el vector clásico de fuerza
  // bruta de contraseñas) y se descartó: el límite es POR IP, y el caso de
  // uso real de KIPU son comercios donde varios cajeros comparten una única
  // conexión NAT — con 5/min, el cuarto empleado que entra en el mismo
  // minuto se queda afuera. 10/min sigue haciendo inviable adivinar una
  // contraseña (Argon2id, y además hay que acertar también el email),
  // sin romper a un negocio con varias cajas. Si un despliegue termina las
  // conexiones por usuario (proxy con TRUST_PROXY=true e IPs reales), se
  // puede bajar sin ese costo.
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post('login')
  login(@Body() dto: LoginDto, @Req() req: Request) {
    return this.auth.login(dto, {
      userAgent: req.headers['user-agent'],
      ip: req.ip,
    });
  }

  // El refresh token tiene 256 bits de entropía, así que la fuerza bruta es
  // inviable; el límite existe igual como defensa en profundidad y para que
  // un cliente en bucle no golpee la base sin freno. 30/min tolera varias
  // pestañas abiertas renovando a la vez.
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @Post('refresh')
  refresh(@Body() dto: RefreshDto) {
    return this.auth.refresh(dto.refreshToken);
  }

  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @Post('logout')
  async logout(@Body() dto: RefreshDto) {
    await this.auth.logout(dto.refreshToken);
    return { ok: true };
  }

  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post('password-reset/request')
  async requestPasswordReset(@Body() dto: RequestPasswordResetDto) {
    await this.auth.requestPasswordReset(dto.email);
    return { ok: true };
  }

  // Mismo criterio que el reset: consume un token de un solo uso, así que
  // más de unos pocos intentos por minuto solo puede ser abuso.
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post('password-reset/confirm')
  async confirmPasswordReset(@Body() dto: ConfirmPasswordResetDto) {
    await this.auth.confirmPasswordReset(dto.token, dto.newPassword);
    return { ok: true };
  }

  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post('email-verification/confirm')
  async confirmEmailVerification(@Body() dto: ConfirmEmailVerificationDto) {
    await this.auth.confirmEmailVerification(dto.token);
    return { ok: true };
  }

  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @NoPermissionRequired()
  @Get('me')
  me(@CurrentAuth() auth: AccessTokenPayload) {
    return auth;
  }
}
