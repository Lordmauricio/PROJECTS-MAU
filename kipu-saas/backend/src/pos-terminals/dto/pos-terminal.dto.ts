import { IsBoolean, IsOptional, IsString, MinLength } from 'class-validator';

export class CreatePOSTerminalDto {
  @IsString()
  branchId!: string;

  @IsString()
  @MinLength(2)
  name!: string;

  @IsString()
  code!: string;
}

export class UpdatePOSTerminalDto {
  @IsOptional()
  @IsString()
  @MinLength(2)
  name?: string;

  @IsOptional()
  @IsBoolean()
  active?: boolean;
}
