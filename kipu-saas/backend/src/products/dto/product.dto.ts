import { IsBoolean, IsNumber, IsOptional, IsString, Min, MinLength } from 'class-validator';
import { EmptyToUndefined } from '../../common/decorators/empty-to-undefined.decorator';

export class CreateProductDto {
  @IsString()
  @MinLength(1)
  name!: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsString()
  code?: string;

  // EmptyToUndefined es obligatorio acá: Product tiene
  // @@unique([organizationId, sku]) y @@unique([organizationId, barcode]),
  // y a diferencia de NULL, dos filas con sku/barcode = "" SÍ chocan entre
  // sí en Postgres — rompería crear un segundo producto sin ese campo.
  @EmptyToUndefined()
  @IsOptional()
  @IsString()
  sku?: string;

  @EmptyToUndefined()
  @IsOptional()
  @IsString()
  barcode?: string;

  @IsOptional()
  @IsString()
  brand?: string;

  @IsOptional()
  @IsString()
  categoryId?: string;

  @IsOptional()
  @IsString()
  unitId?: string;

  @IsOptional()
  @IsString()
  supplierId?: string;

  @IsOptional()
  @IsNumber()
  @Min(0)
  cost?: number;

  @IsNumber()
  @Min(0)
  price!: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  wholesalePrice?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  minStock?: number;

  @IsOptional()
  @IsString()
  imageUrl?: string;
}

export class UpdateProductDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  name?: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsString()
  code?: string;

  // EmptyToUndefined es obligatorio acá: Product tiene
  // @@unique([organizationId, sku]) y @@unique([organizationId, barcode]),
  // y a diferencia de NULL, dos filas con sku/barcode = "" SÍ chocan entre
  // sí en Postgres — rompería crear un segundo producto sin ese campo.
  @EmptyToUndefined()
  @IsOptional()
  @IsString()
  sku?: string;

  @EmptyToUndefined()
  @IsOptional()
  @IsString()
  barcode?: string;

  @IsOptional()
  @IsString()
  brand?: string;

  @IsOptional()
  @IsString()
  categoryId?: string;

  @IsOptional()
  @IsString()
  unitId?: string;

  @IsOptional()
  @IsString()
  supplierId?: string;

  @IsOptional()
  @IsNumber()
  @Min(0)
  cost?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  price?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  wholesalePrice?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  minStock?: number;

  @IsOptional()
  @IsString()
  imageUrl?: string;

  @IsOptional()
  @IsBoolean()
  active?: boolean;
}
