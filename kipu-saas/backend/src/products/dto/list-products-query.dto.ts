import { IsISO8601, IsOptional, IsString } from 'class-validator';

// `updatedSince` habilita la sincronización incremental de catálogo
// (Offline 4.3): cuando está presente, `ProductsService.list` deja de
// filtrar `active: true` (el cliente offline necesita enterarse también de
// los productos recién desactivados, ver `docs/architecture.md` sección
// 22) y ordena por `updatedAt` en vez de `name`. Sin este parámetro, el
// comportamiento es EXACTAMENTE el de siempre — todos los consumidores
// existentes (`inventory/products`, `purchases`, `inventory/movements`,
// `reports`) nunca lo envían, así que no se ven afectados.
export class ListProductsQueryDto {
  @IsOptional()
  @IsString()
  q?: string;

  @IsOptional()
  @IsISO8601()
  updatedSince?: string;
}
