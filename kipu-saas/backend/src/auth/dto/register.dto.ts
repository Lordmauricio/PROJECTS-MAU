import { IsEmail, IsString, MinLength } from 'class-validator';

export class RegisterDto {
  @IsString()
  @MinLength(2)
  organizationName!: string;

  @IsString()
  @MinLength(2)
  legalName!: string;

  @IsString()
  @MinLength(5)
  nit!: string;

  @IsString()
  @MinLength(2)
  branchName!: string;

  @IsString()
  @MinLength(2)
  ownerName!: string;

  @IsEmail()
  email!: string;

  @IsString()
  @MinLength(8)
  password!: string;
}
