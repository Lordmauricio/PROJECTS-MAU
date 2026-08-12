import { IsBoolean, IsEmail, IsEnum, IsOptional, IsString, MinLength } from 'class-validator';

enum PartyDocumentTypeDto {
  NIT = 'NIT',
  CI = 'CI',
  CEX = 'CEX',
  PASAPORTE = 'PASAPORTE',
  OTRO = 'OTRO',
  SIN_NOMBRE = 'SIN_NOMBRE',
}

export class CreateCustomerDto {
  @IsString()
  @MinLength(1)
  name!: string;

  @IsOptional()
  @IsString()
  businessName?: string;

  @IsOptional()
  @IsEnum(PartyDocumentTypeDto)
  documentType?: PartyDocumentTypeDto;

  @IsOptional()
  @IsString()
  documentNumber?: string;

  @IsOptional()
  @IsString()
  phone?: string;

  @IsOptional()
  @IsEmail()
  email?: string;

  @IsOptional()
  @IsString()
  address?: string;
}

export class UpdateCustomerDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  name?: string;

  @IsOptional()
  @IsString()
  businessName?: string;

  @IsOptional()
  @IsEnum(PartyDocumentTypeDto)
  documentType?: PartyDocumentTypeDto;

  @IsOptional()
  @IsString()
  documentNumber?: string;

  @IsOptional()
  @IsString()
  phone?: string;

  @IsOptional()
  @IsEmail()
  email?: string;

  @IsOptional()
  @IsString()
  address?: string;

  @IsOptional()
  @IsBoolean()
  active?: boolean;
}
