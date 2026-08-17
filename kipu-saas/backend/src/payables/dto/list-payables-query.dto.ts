import { IsIn, IsOptional, IsString } from 'class-validator';

export const PAYABLE_STATUS_VALUES = [
  'PENDING',
  'PAID',
  'OVERDUE',
  'CANCELLED',
] as const;

export class ListPayablesQueryDto {
  @IsOptional()
  @IsIn(PAYABLE_STATUS_VALUES)
  status?: (typeof PAYABLE_STATUS_VALUES)[number];

  @IsOptional()
  @IsString()
  supplierId?: string;
}
