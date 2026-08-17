import { Type } from 'class-transformer';
import {
  IsArray,
  IsIn,
  IsNumber,
  IsOptional,
  IsString,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';

// Subconjunto de PaymentMethod utilizable como método de un pago individual.
// MIXED no se usa acá: un "pago mixto" se representa como varios Payment
// (uno por método), no como un único registro con method="MIXED".
export const PAYMENT_METHODS = ['CASH', 'CARD', 'TRANSFER', 'QR'] as const;
export type SalePaymentMethod = (typeof PAYMENT_METHODS)[number];

export class SalePaymentDto {
  @IsIn(PAYMENT_METHODS)
  method!: SalePaymentMethod;

  @IsNumber()
  @Min(0.01)
  amount!: number;

  // Generada una vez por el cliente (uuid) y reutilizada en cualquier
  // reintento/doble click del mismo intento de cobro. Obligatoria: es lo
  // que permite responder de forma idempotente en vez de cobrar dos veces.
  @IsString()
  @MinLength(8)
  idempotencyKey!: string;
}

export class CreatePaymentDto extends SalePaymentDto {}

export class ConfirmSaleDto {
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => SalePaymentDto)
  payments?: SalePaymentDto[];
}
