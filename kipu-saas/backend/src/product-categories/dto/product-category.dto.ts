import { IsBoolean, IsInt, IsOptional, IsString, MinLength } from 'class-validator';

export class CreateProductCategoryDto {
  @IsString()
  @MinLength(1)
  name!: string;

  @IsOptional()
  @IsInt()
  sortOrder?: number;
}

export class UpdateProductCategoryDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  name?: string;

  @IsOptional()
  @IsInt()
  sortOrder?: number;

  @IsOptional()
  @IsBoolean()
  active?: boolean;
}
