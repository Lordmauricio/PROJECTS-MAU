import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsNumber,
  IsOptional,
  IsString,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';

export class CreatePurchaseItemDto {
  @IsString()
  @MinLength(1)
  productId!: string;

  @IsNumber()
  @Min(0.01)
  quantity!: number;

  // Si no se envía, el service usa el costo vigente del producto (Product.cost).
  @IsOptional()
  @IsNumber()
  @Min(0)
  unitCost?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  discount?: number;
}

export class CreatePurchaseDto {
  @IsString()
  @MinLength(1)
  supplierId!: string;

  @IsString()
  @MinLength(1)
  warehouseId!: string;

  // Descuento a nivel de orden (además de cualquier descuento por ítem).
  @IsOptional()
  @IsNumber()
  @Min(0)
  discount?: number;

  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => CreatePurchaseItemDto)
  items!: CreatePurchaseItemDto[];
}

// Misma forma que CreatePurchaseDto: mientras la orden está en DRAFT se
// reemplaza completo (proveedor/almacén/descuento/ítems), no PATCH parcial
// item por item — evita ambigüedad sobre qué ítem se está editando.
export class UpdatePurchaseDto extends CreatePurchaseDto {}
