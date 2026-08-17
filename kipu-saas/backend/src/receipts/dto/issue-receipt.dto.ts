import { IsString, MinLength } from 'class-validator';

export class IssueReceiptDto {
  @IsString()
  @MinLength(1)
  saleId!: string;
}
