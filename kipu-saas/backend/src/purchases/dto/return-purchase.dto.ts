import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsNumber,
  IsOptional,
  IsString,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';

export class ReturnPurchaseItemDto {
  @IsString()
  @MinLength(1)
  purchaseItemId!: string;

  @IsNumber()
  @Min(0.01)
  quantity!: number;
}

export class ReturnPurchaseDto {
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => ReturnPurchaseItemDto)
  items!: ReturnPurchaseItemDto[];

  @IsString()
  @MinLength(8)
  idempotencyKey!: string;

  @IsOptional()
  @IsString()
  reason?: string;
}
