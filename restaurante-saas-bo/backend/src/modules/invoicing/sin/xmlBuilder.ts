import { create } from "xmlbuilder2";

// Estructura de referencia (cabecera + detalle) para el documento "Factura
// Compra Venta" que exige el SIN. Los nombres de etiqueta siguen el patron
// publicado en la documentacion general de facturacion electronica boliviana,
// pero DEBEN verificarse tag por tag contra el XSD del Anexo Tecnico vigente
// antes de enviarse a un ambiente real del SIN: un nombre de campo incorrecto
// hace que la factura sea rechazada.

export interface InvoiceXmlItem {
  codigoProductoSin: string; // Nomenclador de productos/servicios del SIN
  descripcion: string;
  cantidad: number;
  unidadMedida: string;
  precioUnitario: number;
  montoDescuento: number;
  subTotal: number;
}

export interface InvoiceXmlInput {
  nitEmisor: string;
  razonSocialEmisor: string;
  municipio: string;
  telefono?: string;
  codigoSucursal: number;
  codigoPuntoVenta: number;
  numeroFactura: number;
  cuf: string;
  cufd: string;
  codigoControl: string;
  fechaEmision: Date;
  nombreRazonSocialCliente: string;
  codigoTipoDocumentoIdentidad: string;
  numeroDocumentoCliente: string;
  complementoCliente?: string;
  codigoMetodoPago: number; // 1 = Efectivo
  montoTotal: number;
  montoTotalSujetoIva: number;
  codigoMoneda: number; // 1 = Bolivianos
  leyenda: string;
  usuario: string;
  items: InvoiceXmlItem[];
}

export function buildInvoiceXml(input: InvoiceXmlInput): string {
  const doc = create({ version: "1.0", encoding: "UTF-8" }).ele("facturaElectronicaCompraVenta");

  const cabecera = doc.ele("cabecera");
  cabecera.ele("nitEmisor").txt(input.nitEmisor).up();
  cabecera.ele("razonSocialEmisor").txt(input.razonSocialEmisor).up();
  cabecera.ele("municipio").txt(input.municipio).up();
  cabecera.ele("telefono").txt(input.telefono ?? "").up();
  cabecera.ele("codigoSucursal").txt(String(input.codigoSucursal)).up();
  cabecera.ele("codigoPuntoVenta").txt(String(input.codigoPuntoVenta)).up();
  cabecera.ele("fechaEmision").txt(input.fechaEmision.toISOString()).up();
  cabecera.ele("numeroFactura").txt(String(input.numeroFactura)).up();
  cabecera.ele("cuf").txt(input.cuf).up();
  cabecera.ele("cufd").txt(input.cufd).up();
  cabecera.ele("codigoControl").txt(input.codigoControl).up();
  cabecera.ele("nombreRazonSocialCliente").txt(input.nombreRazonSocialCliente).up();
  cabecera.ele("codigoTipoDocumentoIdentidad").txt(input.codigoTipoDocumentoIdentidad).up();
  cabecera.ele("numeroDocumentoCliente").txt(input.numeroDocumentoCliente).up();
  cabecera.ele("complemento").txt(input.complementoCliente ?? "").up();
  cabecera.ele("codigoMetodoPago").txt(String(input.codigoMetodoPago)).up();
  cabecera.ele("montoTotal").txt(input.montoTotal.toFixed(2)).up();
  cabecera.ele("montoTotalSujetoIva").txt(input.montoTotalSujetoIva.toFixed(2)).up();
  cabecera.ele("codigoMoneda").txt(String(input.codigoMoneda)).up();
  cabecera.ele("leyenda").txt(input.leyenda).up();
  cabecera.ele("usuario").txt(input.usuario).up();
  cabecera.up();

  const detalle = doc.ele("detalle");
  input.items.forEach((item, index) => {
    const linea = detalle.ele("item");
    linea.ele("numeroItem").txt(String(index + 1)).up();
    linea.ele("codigoProductoSin").txt(item.codigoProductoSin).up();
    linea.ele("descripcion").txt(item.descripcion).up();
    linea.ele("cantidad").txt(String(item.cantidad)).up();
    linea.ele("unidadMedida").txt(item.unidadMedida).up();
    linea.ele("precioUnitario").txt(item.precioUnitario.toFixed(2)).up();
    linea.ele("montoDescuento").txt(item.montoDescuento.toFixed(2)).up();
    linea.ele("subTotal").txt(item.subTotal.toFixed(2)).up();
    linea.up();
  });
  detalle.up();

  return doc.end({ prettyPrint: true });
}
