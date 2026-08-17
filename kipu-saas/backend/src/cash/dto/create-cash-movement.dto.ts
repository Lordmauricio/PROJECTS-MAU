import {
  IsIn,
  IsNumber,
  IsOptional,
  IsString,
  Min,
  MinLength,
} from 'class-validator';

// Movimientos manuales que un usuario puede registrar directamente sobre una
// caja abierta. SALE_PAYMENT y EXPENSE también existen como `type` en
// `cash_movements`, pero esos los genera el sistema (SalesService al cobrar
// en efectivo, CashService.registerExpense al registrar un gasto) — nunca se
// aceptan como input directo acá, para que un cliente no pueda forjar un
// movimiento que aparente venir de una venta o un gasto real.
export const MANUAL_CASH_MOVEMENT_TYPES = ['CASH_IN', 'CASH_OUT'] as const;
export type ManualCashMovementType =
  (typeof MANUAL_CASH_MOVEMENT_TYPES)[number];

export class CreateCashMovementDto {
  @IsIn(MANUAL_CASH_MOVEMENT_TYPES)
  type!: ManualCashMovementType;

  @IsNumber()
  @Min(0.01)
  amount!: number;

  @IsOptional()
  @IsString()
  reason?: string;

  @IsString()
  @MinLength(8)
  idempotencyKey!: string;
}
