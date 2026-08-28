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

  // Opcional (a diferencia de `Payment.idempotencyKey`, que sí es
  // obligatoria): generada una vez por el cliente (uuid) y reutilizada en
  // cualquier reintento/doble click/timeout del mismo intento de creación —
  // mismo patrón que `OpenCashRegisterDto.idempotencyKey`. El POS web
  // actual no la envía todavía (no la necesitaba: el botón se deshabilita
  // mientras el request está en vuelo), así que queda opcional para no
  // romper ese caller — sin ella, `create` se comporta exactamente igual
  // que antes, sin protección ante reintentos. Un cliente que reintenta de
  // verdad (offline, timeout de red) SÍ debe enviarla.
  @IsOptional()
  @IsString()
  @MinLength(8)
  idempotencyKey?: string;
}
