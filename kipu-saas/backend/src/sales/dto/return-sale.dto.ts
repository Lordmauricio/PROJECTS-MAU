import { IsOptional, IsString } from 'class-validator';

export class ReturnSaleDto {
  // Caja desde la que se descuenta el reembolso en efectivo, si corresponde
  // (ver `SalesService.returnSale`). Por defecto se usa el punto de venta
  // de la propia venta; se puede indicar otro explícitamente.
  @IsOptional()
  @IsString()
  posTerminalId?: string;

  @IsOptional()
  @IsString()
  reason?: string;
}
