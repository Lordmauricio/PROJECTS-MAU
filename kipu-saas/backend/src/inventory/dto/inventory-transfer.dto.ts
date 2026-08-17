import {
  IsNumber,
  IsOptional,
  IsString,
  Min,
  MinLength,
} from 'class-validator';

export class CreateInventoryTransferDto {
  @IsString()
  @MinLength(1)
  fromWarehouseId!: string;

  @IsString()
  @MinLength(1)
  toWarehouseId!: string;

  @IsString()
  @MinLength(1)
  productId!: string;

  @IsNumber()
  @Min(0.01)
  quantity!: number;

  @IsString()
  @MinLength(8)
  idempotencyKey!: string;

  @IsOptional()
  @IsString()
  reason?: string;
}
