import {
  IsNumber,
  IsOptional,
  IsString,
  Min,
  MinLength,
} from 'class-validator';

export class OpenCashRegisterDto {
  @IsString()
  @MinLength(1)
  posTerminalId!: string;

  @IsOptional()
  @IsNumber()
  @Min(0)
  openingAmount?: number;

  // Generada una vez por el cliente (uuid) y reutilizada en cualquier
  // reintento/doble click del mismo intento de apertura — mismo patrón que
  // `Payment.idempotencyKey`. Es lo que permite distinguir un retry legítimo
  // de una segunda apertura real (que además choca con el índice único
  // parcial de la base, ver la migración).
  @IsString()
  @MinLength(8)
  idempotencyKey!: string;
}
