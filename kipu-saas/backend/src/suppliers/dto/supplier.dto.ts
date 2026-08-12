import { IsBoolean, IsEmail, IsOptional, IsString, MinLength } from 'class-validator';
import { EmptyToUndefined } from '../../common/decorators/empty-to-undefined.decorator';

export class CreateSupplierDto {
  @IsString()
  @MinLength(1)
  name!: string;

  @IsOptional()
  @IsString()
  businessName?: string;

  // EmptyToUndefined es obligatorio acá: Supplier tiene
  // @@unique([organizationId, nit]), y a diferencia de NULL, dos filas con
  // nit = "" SÍ chocan entre sí en Postgres — rompería crear un segundo
  // proveedor sin NIT en la misma empresa.
  @EmptyToUndefined()
  @IsOptional()
  @IsString()
  nit?: string;

  @IsOptional()
  @IsString()
  phone?: string;

  @EmptyToUndefined()
  @IsOptional()
  @IsEmail()
  email?: string;

  @IsOptional()
  @IsString()
  address?: string;
}

export class UpdateSupplierDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  name?: string;

  @IsOptional()
  @IsString()
  businessName?: string;

  @EmptyToUndefined()
  @IsOptional()
  @IsString()
  nit?: string;

  @IsOptional()
  @IsString()
  phone?: string;

  @EmptyToUndefined()
  @IsOptional()
  @IsEmail()
  email?: string;

  @IsOptional()
  @IsString()
  address?: string;

  @IsOptional()
  @IsBoolean()
  active?: boolean;
}
