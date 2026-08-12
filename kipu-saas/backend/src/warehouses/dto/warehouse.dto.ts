import { IsBoolean, IsOptional, IsString, MinLength } from 'class-validator';

export class CreateWarehouseDto {
  @IsString()
  branchId!: string;

  @IsString()
  @MinLength(2)
  name!: string;

  @IsOptional()
  @IsString()
  address?: string;
}

export class UpdateWarehouseDto {
  @IsOptional()
  @IsString()
  @MinLength(2)
  name?: string;

  @IsOptional()
  @IsString()
  address?: string;

  @IsOptional()
  @IsBoolean()
  active?: boolean;
}
