import { Transform } from 'class-transformer';

/**
 * Los formularios del frontend envían campos opcionales vacíos como `""`
 * (input controlado), no como `undefined`. Para un campo `@IsOptional()`
 * eso no basta: class-validator solo saltea la validación cuando el valor
 * es `undefined`/`null`, así que `""` sigue pasando por validadores como
 * `@IsEmail()` y falla. Peor aún para columnas con `@@unique` por
 * organización (ej. `Supplier.nit`, `Product.sku`/`barcode`): dos filas con
 * `""` SÍ chocan entre sí en Postgres (a diferencia de `NULL`), rompiendo
 * la creación del segundo registro sin ese campo.
 *
 * Uso: @EmptyToUndefined() antes de @IsOptional().
 */
export const EmptyToUndefined = () =>
  Transform(({ value }) => (typeof value === 'string' && value.trim() === '' ? undefined : value));
