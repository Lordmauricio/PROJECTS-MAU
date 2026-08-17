import { IsIn, IsOptional } from 'class-validator';

export const PDF_FORMATS = ['a4', 'thermal80'] as const;
export type PdfFormat = (typeof PDF_FORMATS)[number];

export class PdfQueryDto {
  @IsOptional()
  @IsIn(PDF_FORMATS)
  format?: PdfFormat;
}
