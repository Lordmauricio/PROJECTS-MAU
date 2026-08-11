import { prisma } from "../../config/prisma";
import { HttpError } from "../../middleware/errorHandler";
import { generateCUF } from "./sin/cuf";
import { buildInvoiceXml } from "./sin/xmlBuilder";
import { buildQrData, buildQrImageDataUrl } from "./sin/qr";
import { getSinProvider } from "./sin/sinProvider";
import { FiscalIdentity } from "./sin/types";

const DOCUMENT_TYPE_CODE: Record<string, string> = {
  NIT: "1",
  CI: "2",
  CEX: "3",
  PASAPORTE: "4",
  OTRO: "5",
  SIN_NOMBRE: "5",
};

const IVA_RATE = 0.13; // Alicuota general del IVA en Bolivia

async function getOrCreateCuis(fiscalConfigId: string, identity: FiscalIdentity) {
  const config = await prisma.fiscalConfig.findUniqueOrThrow({ where: { id: fiscalConfigId } });
  if (config.cuis && config.cuisFechaVigencia && config.cuisFechaVigencia > new Date()) {
    return config.cuis;
  }
  const provider = getSinProvider();
  const result = await provider.obtenerCuis(identity);
  await prisma.fiscalConfig.update({
    where: { id: fiscalConfigId },
    data: { cuis: result.cuis, cuisFechaVigencia: result.fechaVigencia },
  });
  return result.cuis;
}

async function getOrCreateCufd(fiscalConfigId: string, identity: FiscalIdentity, cuis: string) {
  const latest = await prisma.cufdCache.findFirst({
    where: { fiscalConfigId, fechaVigencia: { gt: new Date() } },
    orderBy: { createdAt: "desc" },
  });
  if (latest) return latest;

  const provider = getSinProvider();
  const result = await provider.obtenerCufd(identity, cuis);
  return prisma.cufdCache.create({
    data: {
      fiscalConfigId,
      cufd: result.cufd,
      codigoControl: result.codigoControl,
      fechaVigencia: result.fechaVigencia,
    },
  });
}

async function nextInvoiceNumber(branchId: string): Promise<number> {
  const sequence = await prisma.invoiceSequence.update({
    where: { branchId },
    data: { lastNumber: { increment: 1 } },
  });
  return sequence.lastNumber;
}

export async function issueInvoiceForOrder(companyId: string, orderId: string, usuario: string) {
  const order = await prisma.order.findFirst({
    where: { id: orderId, companyId },
    include: { items: true, customer: true, branch: { include: { fiscalConfig: true } } },
  });
  if (!order) throw new HttpError(404, "Pedido no encontrado");
  if (order.status !== "PAID") throw new HttpError(409, "El pedido debe estar pagado antes de facturar");
  const existingInvoice = await prisma.invoice.findUnique({ where: { orderId: order.id } });
  if (existingInvoice) throw new HttpError(409, "Este pedido ya tiene una factura emitida");

  const fiscalConfig = order.branch.fiscalConfig;
  if (!fiscalConfig) throw new HttpError(422, "La sucursal no tiene configuracion fiscal");

  const identity: FiscalIdentity = {
    nit: fiscalConfig.nit,
    razonSocial: fiscalConfig.razonSocial,
    codigoSucursal: fiscalConfig.codigoSucursal,
    codigoPuntoVenta: fiscalConfig.codigoPuntoVenta,
    codigoModalidad: fiscalConfig.codigoModalidad,
    codigoAmbiente: fiscalConfig.codigoAmbiente,
    codigoSistema: fiscalConfig.codigoSistema,
  };

  const cuis = await getOrCreateCuis(fiscalConfig.id, identity);
  const cufd = await getOrCreateCufd(fiscalConfig.id, identity, cuis);
  const numeroFactura = await nextInvoiceNumber(order.branchId);

  const fechaEmision = new Date();
  const cuf = generateCUF({
    nit: fiscalConfig.nit,
    fechaEmision,
    codigoSucursal: fiscalConfig.codigoSucursal,
    codigoPuntoVenta: fiscalConfig.codigoPuntoVenta,
    numeroFactura,
    codigoModalidad: fiscalConfig.codigoModalidad,
    codigoTipoEmision: 1,
    codigoTipoFacturaDocumento: 1,
    codigoTipoDocumentoSector: 1,
    codigoControlCufd: cufd.codigoControl,
  });

  const customer = order.customer;
  const documentType = customer?.documentType ?? "SIN_NOMBRE";
  const documentNumber = customer?.documentNumber ?? "99001";
  const nombreCliente = customer?.name ?? "Sin Nombre";

  const montoTotal = Number(order.total);
  const montoTotalSujetoIva = Number((montoTotal / (1 + IVA_RATE)).toFixed(2));

  const xml = buildInvoiceXml({
    nitEmisor: fiscalConfig.nit,
    razonSocialEmisor: fiscalConfig.razonSocial,
    municipio: order.branch.municipio ?? "",
    telefono: order.branch.phone ?? undefined,
    codigoSucursal: fiscalConfig.codigoSucursal,
    codigoPuntoVenta: fiscalConfig.codigoPuntoVenta,
    numeroFactura,
    cuf,
    cufd: cufd.cufd,
    codigoControl: cufd.codigoControl,
    fechaEmision,
    nombreRazonSocialCliente: nombreCliente,
    codigoTipoDocumentoIdentidad: DOCUMENT_TYPE_CODE[documentType] ?? "5",
    numeroDocumentoCliente: documentNumber,
    complementoCliente: customer?.complement ?? undefined,
    codigoMetodoPago: 1,
    montoTotal,
    montoTotalSujetoIva,
    codigoMoneda: 1,
    leyenda:
      "Ley N. 453: El proveedor del servicio de facturacion se encuentra impedido de revelar tus datos a terceros",
    usuario,
    items: order.items.map((item) => ({
      codigoProductoSin: "99100", // Codigo generico "otros servicios"; ajustar con el nomenclador SIN por producto
      descripcion: item.productName,
      cantidad: item.quantity,
      unidadMedida: "58",
      precioUnitario: Number(item.unitPrice),
      montoDescuento: 0,
      subTotal: Number(item.subtotal),
    })),
  });

  const qrData = buildQrData({ nit: fiscalConfig.nit, cuf });
  const qrImagePng = await buildQrImageDataUrl(qrData);

  const provider = getSinProvider();
  const sendResult = await provider.enviarFactura(xml);
  if (!sendResult.aceptada) {
    throw new HttpError(422, `El SIN rechazo la factura: ${sendResult.observaciones?.join("; ") ?? "sin detalle"}`);
  }

  const invoice = await prisma.invoice.create({
    data: {
      companyId,
      branchId: order.branchId,
      orderId: order.id,
      customerId: order.customerId,
      numeroFactura,
      cuf,
      cufd: cufd.cufd,
      cuis,
      xml,
      qrData,
      qrImagePng,
      montoTotal: order.total,
      environment: fiscalConfig.environment,
    },
  });

  return invoice;
}

export async function cancelInvoice(companyId: string, invoiceId: string, motivo: string) {
  const invoice = await prisma.invoice.findFirst({ where: { id: invoiceId, companyId } });
  if (!invoice) throw new HttpError(404, "Factura no encontrada");
  if (invoice.state === "ANULADA") throw new HttpError(409, "La factura ya esta anulada");

  const provider = getSinProvider();
  const result = await provider.anularFactura(invoice.cuf, motivo);
  if (!result.aceptada) {
    throw new HttpError(422, `El SIN rechazo la anulacion: ${result.observaciones?.join("; ") ?? "sin detalle"}`);
  }

  return prisma.invoice.update({
    where: { id: invoice.id },
    data: { state: "ANULADA", motivoAnulacion: motivo, anuladaAt: new Date() },
  });
}
