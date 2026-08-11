// Contratos del modulo de facturacion electronica.
//
// IMPORTANTE: estos tipos modelan el flujo general publicado por el SIN para
// la Modalidad "Facturacion Electronica en Linea" (CUIS -> CUFD -> CUF ->
// envio de factura). Los nombres exactos de campos, longitudes y algoritmos
// deben verificarse contra el "Anexo Tecnico" vigente descargado de
// impuestos.gob.bo al momento de la homologacion, ya que el SIN los
// actualiza por versiones.

export interface FiscalIdentity {
  nit: string;
  razonSocial: string;
  codigoSucursal: number;
  codigoPuntoVenta: number;
  codigoModalidad: number; // 2 = Electronica en linea
  codigoAmbiente: number; // 1 = Produccion, 2 = Piloto
  codigoSistema: string | null;
}

export interface CuisResult {
  cuis: string;
  fechaVigencia: Date;
}

export interface CufdResult {
  cufd: string;
  codigoControl: string;
  fechaVigencia: Date;
}

export interface SendInvoiceResult {
  aceptada: boolean;
  codigoRecepcion?: string;
  observaciones?: string[];
}

// Interfaz que debe implementar cualquier "conector" hacia el SIN.
// Hoy existe MockSinClient (ambiente simulado, sin llamadas reales).
// Cuando se obtienen credenciales homologadas, se implementa SoapSinClient
// contra los web services reales (SOAP/WSDL) del SIN y se cambia
// SIN_PROVIDER=soap en el .env, sin tocar el resto del sistema.
export interface SinProvider {
  obtenerCuis(identity: FiscalIdentity): Promise<CuisResult>;
  obtenerCufd(identity: FiscalIdentity, cuis: string): Promise<CufdResult>;
  enviarFactura(xml: string): Promise<SendInvoiceResult>;
  anularFactura(cuf: string, motivo: string): Promise<SendInvoiceResult>;
}
