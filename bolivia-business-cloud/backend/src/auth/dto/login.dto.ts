import { IsEmail, IsOptional, IsString } from 'class-validator';

export class LoginDto {
  @IsEmail()
  email!: string;

  @IsString()
  password!: string;

  // Si el usuario pertenece a más de una organización, debe indicar cuál.
  @IsOptional()
  @IsString()
  organizationId?: string;
}
