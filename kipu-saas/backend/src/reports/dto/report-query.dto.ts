import { Type } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsISO8601,
  IsOptional,
  IsString,
  Min,
} from 'class-validator';

// DTO de filtros COMPARTIDO por todos los reportes (sección "FILTROS" del
// pedido): cada endpoint de ReportsController usa solo los campos que le
// aplican (ver `docs/architecture.md` sección 13) e ignora el resto — un
// único DTO evita 17 DTOs casi idénticos y mantiene la validación
// (`whitelist`/`forbidNonWhitelisted` en `main.ts`) consistente entre todos.
//
// Ningún filtro puede escapar el tenant: todo id que llega acá (branchId,
// warehouseId, posTerminalId, productId, categoryId, userId) se usa
// SIEMPRE combinado con `organizationId` en el `WHERE`, y las tablas
// referenciadas tienen RLS `FORCE` — un id de otro tenant simplemente no
// matchea nada (0 filas), nunca filtra datos ajenos. Ver
// `reports.security.spec.ts`.
export class ReportQueryDto {
  @IsOptional()
  @IsISO8601()
  dateFrom?: string;

  @IsOptional()
  @IsISO8601()
  dateTo?: string;

  @IsOptional()
  @IsString()
  branchId?: string;

  @IsOptional()
  @IsString()
  warehouseId?: string;

  @IsOptional()
  @IsString()
  posTerminalId?: string;

  /** createdById de Sale/Purchase — "usuario/cajero". */
  @IsOptional()
  @IsString()
  userId?: string;

  @IsOptional()
  @IsString()
  productId?: string;

  @IsOptional()
  @IsString()
  categoryId?: string;

  @IsOptional()
  @IsIn(['CASH', 'CARD', 'TRANSFER', 'QR'])
  paymentMethod?: string;

  /** Significado depende del reporte: SaleStatus, PurchaseStatus, o ReceivablePayableStatus. Validado como string suelto acá; cada service filtra solo si el valor aplica a su propio enum. */
  @IsOptional()
  @IsString()
  status?: string;

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

  /** Solo para reportes "top N" (productos más vendidos). */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  limit?: number;
}

export const REPORT_EXPORT_FORMATS = ['csv', 'xlsx'] as const;
export type ReportExportFormat = (typeof REPORT_EXPORT_FORMATS)[number];

export class ReportExportQueryDto extends ReportQueryDto {
  @IsIn(REPORT_EXPORT_FORMATS)
  format!: ReportExportFormat;
}
