import { Type } from 'class-transformer';
import {
  IsString,
  MinLength,
  MaxLength,
  IsNumber,
  Min,
  Max,
  IsArray,
  ArrayMinSize,
  ArrayMaxSize,
  ValidateNested,
  IsOptional,
  IsInt,
  IsIn,
} from 'class-validator';
export class RecipeIngredientDto {
  @IsString() @MinLength(1) productId!: string;
  @IsString() @MinLength(1) @MaxLength(30) inputUnit!: string;
  @IsNumber({ maxDecimalPlaces: 4 })
  @Min(0.0001)
  @Max(1000000)
  quantity!: number;
  @IsNumber({ maxDecimalPlaces: 6 })
  @Min(0.000001)
  @Max(1000000)
  toBaseFactor!: number;
}
export class SaveRecipeDto {
  @IsString() @MinLength(8) @MaxLength(100) requestKey!: string;
  @IsString() @MinLength(1) @MaxLength(100) name!: string;
  @IsString() @MinLength(1) @MaxLength(60) station!: string;
  @IsString() @MinLength(1) outputProductId!: string;
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.01)
  @Max(10000)
  yieldQuantity!: number;
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => RecipeIngredientDto)
  ingredients!: RecipeIngredientDto[];
  @IsOptional() @IsInt() @Min(1) expectedRevision?: number;
}
export class PlanRecipeDto {
  @IsString() @MinLength(1) versionId!: string;
  @IsString() @MinLength(1) warehouseId!: string;
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.01)
  @Max(10000)
  plannedQuantity!: number;
  @IsString() @MinLength(8) @MaxLength(100) requestKey!: string;
}
export class ActualIngredientDto {
  @IsString() @MinLength(1) productId!: string;
  @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) @Max(1000000) quantity!: number;
}
export class RecipeRunActionDto {
  @IsInt() @Min(0) version!: number;
  @IsIn(['PREPARING', 'READY', 'CANCELLED']) status!:
    'PREPARING' | 'READY' | 'CANCELLED';
  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => ActualIngredientDto)
  actualInputs?: ActualIngredientDto[];
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.01)
  @Max(10000)
  producedQuantity?: number;
  @IsOptional() @IsString() @MaxLength(100) lotCode?: string;
  @IsOptional() @IsString() expiresOn?: string;
  @IsOptional() @IsString() @MaxLength(500) reason?: string;
}
