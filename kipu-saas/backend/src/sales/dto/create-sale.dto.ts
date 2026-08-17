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

export class CreateSaleItemDto {
  @IsString()
  @MinLength(1)
  productId!: string;

  @IsNumber()
  @Min(0.01)
  quantity!: number;

  // Si no se envía, el service usa el precio vigente del producto.
  @IsOptional()
  @IsNumber()
  @Min(0)
  unitPrice?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  discount?: number;
}

export class CreateSaleDto {
  @IsString()
  @MinLength(1)
  posTerminalId!: string;

  @IsString()
  @MinLength(1)
  warehouseId!: string;

  @IsOptional()
  @IsString()
  customerId?: string;

  // Descuento a nivel de venta (además de cualquier descuento por ítem).
  @IsOptional()
  @IsNumber()
  @Min(0)
  discount?: number;

  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => CreateSaleItemDto)
  items!: CreateSaleItemDto[];
}
