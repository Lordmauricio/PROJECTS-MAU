import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, Min } from 'class-validator';

export const SALE_STATUS_VALUES = [
  'DRAFT',
  'CONFIRMED',
  'PARTIALLY_PAID',
  'PAID',
  'CANCELLED',
  'REFUNDED',
] as const;

export class ListSalesQueryDto {
  @IsOptional()
  @IsIn(SALE_STATUS_VALUES)
  status?: (typeof SALE_STATUS_VALUES)[number];

  @IsOptional()
  @IsString()
  customerId?: string;

  @IsOptional()
  @IsString()
  posTerminalId?: string;

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
