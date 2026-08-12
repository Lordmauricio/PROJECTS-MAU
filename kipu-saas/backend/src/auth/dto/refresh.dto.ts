import { IsString } from 'class-validator';

export class RefreshDto {
  @IsString()
  refreshToken!: string;
}

export class RequestPasswordResetDto {
  @IsString()
  email!: string;
}

export class ConfirmPasswordResetDto {
  @IsString()
  token!: string;

  @IsString()
  newPassword!: string;
}

export class ConfirmEmailVerificationDto {
  @IsString()
  token!: string;
}
