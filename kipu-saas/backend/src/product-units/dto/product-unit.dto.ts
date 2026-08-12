import { IsBoolean, IsOptional, IsString, MinLength } from 'class-validator';

export class CreateProductUnitDto {
  @IsString()
  @MinLength(1)
  name!: string;

  @IsString()
  @MinLength(1)
  symbol!: string;
}

export class UpdateProductUnitDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  name?: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  symbol?: string;

  @IsOptional()
  @IsBoolean()
  active?: boolean;
}
