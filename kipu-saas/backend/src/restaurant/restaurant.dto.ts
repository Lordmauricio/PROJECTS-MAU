import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';

export class ComponentDto {
  @IsString() @MinLength(1) productId!: string;
  @IsNumber({ maxDecimalPlaces: 2 }) @Min(0.01) @Max(10000) quantity!: number;
}

export class MenuOptionDto {
  @IsString() @MinLength(1) @MaxLength(60) id!: string;
  @IsString() @MinLength(1) @MaxLength(100) name!: string;
  @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) @Max(100000) price!: number;
  @IsOptional() @IsString() replacesProductId?: string;
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(30)
  @ValidateNested({ each: true })
  @Type(() => ComponentDto)
  components!: ComponentDto[];
}

export class SaveMenuEntryDto {
  @IsString() @MinLength(1) productId!: string;
  @IsString() @MinLength(1) @MaxLength(100) name!: string;
  @IsOptional() @IsString() @MaxLength(60) presentation?: string;
  @IsString() @MinLength(1) @MaxLength(60) category!: string;
  @IsString() @MinLength(1) @MaxLength(60) station!: string;
  @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) @Max(100000) price!: number;
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(30)
  @ValidateNested({ each: true })
  @Type(() => ComponentDto)
  components!: ComponentDto[];
  @IsArray()
  @ArrayMaxSize(30)
  @ValidateNested({ each: true })
  @Type(() => MenuOptionDto)
  options!: MenuOptionDto[];
  @IsBoolean() active!: boolean;
}

export class OrderLineDto {
  @IsString() @MinLength(1) menuEntryId!: string;
  @IsInt() @Min(1) @Max(1000) quantity!: number;
  @IsArray()
  @ArrayMaxSize(30)
  @ArrayUnique()
  @IsString({ each: true })
  optionIds!: string[];
}

export class QuoteOrderDto {
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  discount?: number;
  @IsString() @MinLength(1) posTerminalId!: string;
  @IsString() @MinLength(1) warehouseId!: string;
  @IsIn(['DINE_IN', 'TAKEAWAY']) service!: 'DINE_IN' | 'TAKEAWAY';
  @IsOptional() @IsString() @MaxLength(100) customerName?: string;
  @IsOptional() @IsString() @MaxLength(500) notes?: string;
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => OrderLineDto)
  items!: OrderLineDto[];
}

export class CreateOrderDto extends QuoteOrderDto {
  @IsString() @MinLength(8) @MaxLength(100) requestKey!: string;
}

export class TransitionOrderDto {
  @IsIn(['PREPARING', 'READY', 'DELIVERED']) status!:
    'PREPARING' | 'READY' | 'DELIVERED';
  @IsInt() @Min(0) version!: number;
}

export class CancelOrderDto {
  @IsString() @MinLength(1) @MaxLength(500) reason!: string;
}

export class ListOrdersDto {
  @IsOptional() @IsString() branchId?: string;
  @IsOptional()
  @IsIn(['DRAFT', 'QUEUED', 'PREPARING', 'READY', 'DELIVERED', 'CANCELLED'])
  status?:
    'DRAFT' | 'QUEUED' | 'PREPARING' | 'READY' | 'DELIVERED' | 'CANCELLED';
}
