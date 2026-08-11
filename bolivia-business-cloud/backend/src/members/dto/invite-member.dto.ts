import { IsEmail, IsOptional, IsString } from 'class-validator';

export class InviteMemberDto {
  @IsEmail()
  email!: string;

  @IsOptional()
  @IsString()
  name?: string;

  @IsString()
  roleId!: string;
}

export class ChangeMemberRoleDto {
  @IsString()
  roleId!: string;
}
