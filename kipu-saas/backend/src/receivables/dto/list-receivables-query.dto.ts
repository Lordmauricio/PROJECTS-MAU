import { IsIn, IsOptional, IsString } from 'class-validator';

export const RECEIVABLE_STATUS_VALUES = [
  'PENDING',
  'PAID',
  'OVERDUE',
  'CANCELLED',
] as const;

export class ListReceivablesQueryDto {
  @IsOptional()
  @IsIn(RECEIVABLE_STATUS_VALUES)
  status?: (typeof RECEIVABLE_STATUS_VALUES)[number];

  @IsOptional()
  @IsString()
  customerId?: string;
}
