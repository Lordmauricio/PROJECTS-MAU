import { IsISO8601, IsOptional, IsString } from 'class-validator';

// `updatedSince` habilita la sincronización incremental de catálogo
// (Offline 4.3). A diferencia de productos, `CustomersService.list` NUNCA
// filtró por `active` (ver el service) — no hace falta ningún bypass acá,
// los clientes desactivados ya venían incluidos siempre. Sin este
// parámetro, el comportamiento es idéntico al de siempre.
export class ListCustomersQueryDto {
  @IsOptional()
  @IsString()
  q?: string;

  @IsOptional()
  @IsISO8601()
  updatedSince?: string;
}
