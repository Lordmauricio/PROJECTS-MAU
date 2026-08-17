import {
  IsNumber,
  IsOptional,
  IsString,
  Min,
  MinLength,
} from 'class-validator';

export class CloseCashRegisterDto {
  // Efectivo contado físicamente por el usuario al momento del cierre
  // (arqueo). El sistema compara esto contra el saldo esperado (calculado
  // desde el saldo inicial + movimientos) para obtener la diferencia.
  @IsNumber()
  @Min(0)
  countedAmount!: number;

  @IsOptional()
  @IsString()
  observation?: string;

  @IsString()
  @MinLength(8)
  idempotencyKey!: string;
}
