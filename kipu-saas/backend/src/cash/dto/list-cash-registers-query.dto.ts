import { IsIn, IsOptional, IsString } from 'class-validator';

export const CASH_REGISTER_STATUS_VALUES = ['OPEN', 'CLOSED'] as const;

export class ListCashRegistersQueryDto {
  @IsOptional()
  @IsIn(CASH_REGISTER_STATUS_VALUES)
  status?: (typeof CASH_REGISTER_STATUS_VALUES)[number];

  @IsOptional()
  @IsString()
  posTerminalId?: string;
}

export class ListExpensesQueryDto {
  @IsOptional()
  @IsString()
  cashRegisterId?: string;
}
