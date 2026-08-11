// Generacion del CUF (Codigo Unico de Facturacion).
//
// ATENCION - CAMPO CRITICO PARA HOMOLOGACION:
// Esta es una implementacion de referencia que respeta la FORMA general del
// CUF descrita publicamente por el SIN (concatenacion de campos de la
// factura + digito verificador modulo 11), pero el orden exacto de campos,
// el ancho de cada uno y el metodo preciso de calculo del digito verificador
// deben confirmarse contra el "Anexo Tecnico Facturacion Electronica" vigente
// (impuestos.gob.bo) antes de emitir facturas reales. No usar este algoritmo
// en produccion sin validarlo primero contra el ambiente Piloto del SIN.
//
// Todos los anchos de campo estan centralizados en FIELD_WIDTHS para que un
// ajuste futuro sea un cambio de una linea.

export const FIELD_WIDTHS = {
  nit: 13,
  fecha: 14, // yyyyMMddHHmmss
  sucursal: 4,
  puntoVenta: 4,
  numeroFactura: 10,
  codigoControl: 5,
};

export interface CufInput {
  nit: string;
  fechaEmision: Date;
  codigoSucursal: number;
  codigoPuntoVenta: number;
  numeroFactura: number;
  codigoModalidad: number;
  codigoTipoEmision: number;
  codigoTipoFacturaDocumento: number;
  codigoTipoDocumentoSector: number;
  codigoControlCufd: string;
}

function pad(value: string | number, width: number): string {
  return String(value).padStart(width, "0").slice(-width);
}

function formatFecha(date: Date): string {
  const yyyy = date.getUTCFullYear();
  const MM = pad(date.getUTCMonth() + 1, 2);
  const dd = pad(date.getUTCDate(), 2);
  const HH = pad(date.getUTCHours(), 2);
  const mm = pad(date.getUTCMinutes(), 2);
  const ss = pad(date.getUTCSeconds(), 2);
  return `${yyyy}${MM}${dd}${HH}${mm}${ss}`;
}

// Digito verificador modulo 11 (algoritmo estandar boliviano usado en NIT/CUF):
// se pondera cada digito de derecha a izquierda con pesos ciclicos 2..7,
// se suma, se calcula 11 - (suma % 11); si da 10 el digito es 1, si da 11 es 0.
function modulo11(digits: string): number {
  let sum = 0;
  let weight = 2;
  for (let i = digits.length - 1; i >= 0; i--) {
    sum += Number(digits[i]) * weight;
    weight = weight === 7 ? 2 : weight + 1;
  }
  const remainder = 11 - (sum % 11);
  if (remainder === 11) return 0;
  if (remainder === 10) return 1;
  return remainder;
}

function controlCodeToDigits(codigoControl: string): string {
  // El codigo de control del CUFD puede incluir letras; se convierte cada
  // caracter a su valor numerico (A=10, B=11, ...) para poder incluirlo en
  // el calculo del digito verificador, tal como exige un CUF puramente numerico.
  return codigoControl
    .toUpperCase()
    .split("")
    .map((ch) => {
      const code = ch.charCodeAt(0);
      if (code >= 48 && code <= 57) return ch; // 0-9
      if (code >= 65 && code <= 90) return String(code - 55); // A-Z -> 10-35
      return "0";
    })
    .join("")
    .slice(0, FIELD_WIDTHS.codigoControl)
    .padStart(FIELD_WIDTHS.codigoControl, "0");
}

export function generateCUF(input: CufInput): string {
  const nit = pad(input.nit, FIELD_WIDTHS.nit);
  const fecha = formatFecha(input.fechaEmision);
  const sucursal = pad(input.codigoSucursal, FIELD_WIDTHS.sucursal);
  const puntoVenta = pad(input.codigoPuntoVenta, FIELD_WIDTHS.puntoVenta);
  const numeroFactura = pad(input.numeroFactura, FIELD_WIDTHS.numeroFactura);
  const modalidad = pad(input.codigoModalidad, 1);
  const tipoEmision = pad(input.codigoTipoEmision, 1);
  const tipoFactura = pad(input.codigoTipoFacturaDocumento, 1);
  const tipoDocumentoSector = pad(input.codigoTipoDocumentoSector, 2);
  const controlDigits = controlCodeToDigits(input.codigoControlCufd);

  const base =
    nit + fecha + sucursal + modalidad + tipoEmision + tipoFactura + tipoDocumentoSector + numeroFactura + puntoVenta + controlDigits;

  const dv = modulo11(base);

  return `${base}${dv}`;
}
