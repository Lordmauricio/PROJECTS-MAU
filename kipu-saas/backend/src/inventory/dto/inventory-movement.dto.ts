import {
  IsIn,
  IsNumber,
  IsOptional,
  IsString,
  Min,
  MinLength,
} from 'class-validator';

// Núcleo mínimo de esta fase: solo entrada manual (IN, para poder cargar
// stock inicial sin que exista todavía el módulo de Compras) y ajustes con
// signo (ADJUSTMENT). Transferencias entre almacenes y kardex avanzado
// quedan para la Fase Comercial 4 — no se modelan acá.
export type ManualMovementType = 'IN' | 'ADJUSTMENT';
export type AdjustmentDirection = 'INCREASE' | 'DECREASE';

export class CreateInventoryMovementDto {
  @IsString()
  @MinLength(1)
  warehouseId!: string;

  @IsString()
  @MinLength(1)
  productId!: string;

  @IsIn(['IN', 'ADJUSTMENT'])
  type!: ManualMovementType;

  // Requerido solo cuando type = ADJUSTMENT (un IN siempre incrementa).
  @IsOptional()
  @IsIn(['INCREASE', 'DECREASE'])
  direction?: AdjustmentDirection;

  @IsNumber()
  @Min(0.01)
  quantity!: number;

  @IsOptional()
  @IsString()
  reason?: string;
}
