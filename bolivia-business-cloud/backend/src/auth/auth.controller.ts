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
import { CurrentAuth } from '../common/decorators/current-auth.decorator';
import type { AccessTokenPayload } from './auth.service';

@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Post('register')
  register(@Body() dto: RegisterDto) {
    return this.auth.register(dto);
  }

  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post('login')
  login(@Body() dto: LoginDto, @Req() req: Request) {
    return this.auth.login(dto, { userAgent: req.headers['user-agent'], ip: req.ip });
  }

  @Post('refresh')
  refresh(@Body() dto: RefreshDto) {
    return this.auth.refresh(dto.refreshToken);
  }

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

  @Post('password-reset/confirm')
  async confirmPasswordReset(@Body() dto: ConfirmPasswordResetDto) {
    await this.auth.confirmPasswordReset(dto.token, dto.newPassword);
    return { ok: true };
  }

  @Post('email-verification/confirm')
  async confirmEmailVerification(@Body() dto: ConfirmEmailVerificationDto) {
    await this.auth.confirmEmailVerification(dto.token);
    return { ok: true };
  }

  @UseGuards(JwtAuthGuard)
  @Get('me')
  me(@CurrentAuth() auth: AccessTokenPayload) {
    return auth;
  }
}
