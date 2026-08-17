import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, Min } from 'class-validator';

export const PURCHASE_STATUS_VALUES = [
  'DRAFT',
  'CONFIRMED',
  'PARTIALLY_RECEIVED',
  'RECEIVED',
  'CANCELLED',
] as const;

export class ListPurchasesQueryDto {
  @IsOptional()
  @IsIn(PURCHASE_STATUS_VALUES)
  status?: (typeof PURCHASE_STATUS_VALUES)[number];

  @IsOptional()
  @IsString()
  supplierId?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  pageSize?: number;
}
