import { IsEmail, IsOptional } from 'class-validator';

export class SendReceiptEmailDto {
  /** Si se omite, se usa el email del cliente de la venta (si tiene uno registrado). */
  @IsOptional()
  @IsEmail()
  email?: string;
}
