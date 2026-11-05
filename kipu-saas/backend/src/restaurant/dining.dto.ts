import {
  IsString,
  MinLength,
  MaxLength,
  IsInt,
  Min,
  Max,
  IsOptional,
  IsArray,
  ArrayMinSize,
  ArrayMaxSize,
  ArrayUnique,
  IsNumber,
  IsIn,
} from 'class-validator';
export class SaveTableDto {
  @IsString() @MinLength(1) branchId!: string;
  @IsString() @MinLength(1) @MaxLength(60) name!: string;
  @IsString() @MinLength(1) @MaxLength(60) area!: string;
  @IsInt() @Min(1) @Max(100) seats!: number;
}
export class OpenAccountDto {
  @IsString() @MinLength(1) tableId!: string;
  @IsString() @MinLength(1) posTerminalId!: string;
  @IsString() @MinLength(1) warehouseId!: string;
  @IsString() @MinLength(1) @MaxLength(100) label!: string;
  @IsOptional() @IsString() waiterId?: string;
  @IsString() @MinLength(8) @MaxLength(100) requestKey!: string;
}
export class AccountActionDto {
  @IsInt() @Min(0) version!: number;
}
export class MoveAccountDto extends AccountActionDto {
  @IsString() @MinLength(1) tableId!: string;
}
export class AssignWaiterDto extends AccountActionDto {
  @IsString() @MinLength(1) waiterId!: string;
}
export class SplitAccountDto extends AccountActionDto {
  @IsString() @MinLength(1) @MaxLength(100) label!: string;
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(100)
  @ArrayUnique()
  @IsString({ each: true })
  orderIds!: string[];
  @IsString() @MinLength(8) @MaxLength(100) requestKey!: string;
}
export class MergeAccountDto extends AccountActionDto {
  @IsString() @MinLength(1) sourceId!: string;
  @IsInt() @Min(0) sourceVersion!: number;
}
export class CloseAccountDto extends AccountActionDto {
  @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) @Max(100000) tipAmount!: number;
  @IsIn(['CASH', 'CARD', 'TRANSFER', 'QR']) tipMethod!: string;
}
