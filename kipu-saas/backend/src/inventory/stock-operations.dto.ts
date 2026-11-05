import {
  IsString,
  MinLength,
  MaxLength,
  IsNumber,
  Min,
  Max,
  IsOptional,
  IsIn,
  IsBoolean,
} from 'class-validator';
export class StockOperationDto {
  @IsString() @MinLength(1) warehouseId!: string;
  @IsString() @MinLength(1) productId!: string;
  @IsIn(['RECEIPT', 'CLASSIFY', 'COUNT', 'WASTE', 'STAFF']) kind!:
    'RECEIPT' | 'CLASSIFY' | 'COUNT' | 'WASTE' | 'STAFF';
  @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) @Max(1000000) quantity!: number;
  @IsOptional() @IsString() lotId?: string;
  @IsOptional() @IsString() @MaxLength(100) lotCode?: string;
  @IsOptional() @IsString() expiresOn?: string;
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  expectedQuantity?: number;
  @IsString() @MinLength(1) @MaxLength(500) reason!: string;
  @IsString() @MinLength(8) @MaxLength(100) requestKey!: string;
}
export class TrackingDto {
  @IsBoolean() required!: boolean;
}
