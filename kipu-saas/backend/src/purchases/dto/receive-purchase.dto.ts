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

export class ReceivePurchaseItemDto {
  @IsString()
  @MinLength(1)
  purchaseItemId!: string;

  @IsNumber()
  @Min(0.01)
  quantity!: number;
}

export class ReceivePurchaseDto {
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => ReceivePurchaseItemDto)
  items!: ReceivePurchaseItemDto[];

  // Generada una vez por el cliente (uuid) y reutilizada en cualquier
  // reintento/doble click del mismo intento de recepción. Obligatoria: es
  // lo que permite responder de forma idempotente sin recibir dos veces.
  @IsString()
  @MinLength(8)
  idempotencyKey!: string;

  @IsOptional()
  @IsString()
  notes?: string;
}
