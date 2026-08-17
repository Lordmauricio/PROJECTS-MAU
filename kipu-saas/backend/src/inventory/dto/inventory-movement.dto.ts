import {
  IsIn,
  IsNumber,
  IsOptional,
  IsString,
  Min,
  MinLength,
} from 'class-validator';

// Registro directo (Fase Comercial 4): entrada manual (IN), salida manual
// (OUT), o ajuste con signo (ADJUSTMENT). Transferencias tienen su propio
// DTO (`CreateInventoryTransferDto`) porque afectan dos almacenes a la vez.
export type ManualMovementType = 'IN' | 'OUT' | 'ADJUSTMENT';
export type AdjustmentDirection = 'INCREASE' | 'DECREASE';

export class CreateInventoryMovementDto {
  @IsString()
  @MinLength(1)
  warehouseId!: string;

  @IsString()
  @MinLength(1)
  productId!: string;

  @IsIn(['IN', 'OUT', 'ADJUSTMENT'])
  type!: ManualMovementType;

  // Requerido solo cuando type = ADJUSTMENT (IN/OUT ya tienen dirección implícita).
  @IsOptional()
  @IsIn(['INCREASE', 'DECREASE'])
  direction?: AdjustmentDirection;

  @IsNumber()
  @Min(0.01)
  quantity!: number;

  @IsOptional()
  @IsString()
  reason?: string;

  // Generada una vez por el cliente (uuid) y reutilizada en cualquier
  // reintento/doble click del mismo intento de movimiento — sin esto, un
  // doble click duplicaría el cambio de stock.
  @IsString()
  @MinLength(8)
  idempotencyKey!: string;
}
