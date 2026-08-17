import { IsIn, IsNumber, IsString, Min, MinLength } from 'class-validator';

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

  @IsString()
  @MinLength(8)
  idempotencyKey!: string;
}
