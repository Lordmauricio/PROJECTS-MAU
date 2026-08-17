import {
  IsIn,
  IsNumber,
  IsOptional,
  IsString,
  Min,
  MinLength,
} from 'class-validator';

export const PAYABLE_PAYMENT_METHODS = [
  'CASH',
  'CARD',
  'TRANSFER',
  'QR',
] as const;

export class CreatePayablePaymentDto {
  @IsIn(PAYABLE_PAYMENT_METHODS)
  method!: (typeof PAYABLE_PAYMENT_METHODS)[number];

  @IsNumber()
  @Min(0.01)
  amount!: number;

  // Requerido solo cuando method = CASH y se quiere que el pago afecte una
  // caja (Fase Comercial 6) — a diferencia de Ventas, una Payable no tiene
  // un punto de venta implícito, así que el usuario elige explícitamente de
  // qué caja sale el efectivo.
  @IsOptional()
  @IsString()
  posTerminalId?: string;

  @IsString()
  @MinLength(8)
  idempotencyKey!: string;
}
