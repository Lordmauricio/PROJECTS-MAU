import PDFDocument from 'pdfkit';
import { ReceiptSnapshot } from './receipt-snapshot';
import { PdfFormat } from './dto/pdf-query.dto';

// Ambos formatos leen EXCLUSIVAMENTE `snapshot` — nunca vuelven a
// consultar `Sale`/`Customer`/`Organization` ni ninguna otra tabla
// mutable. Es la garantía de inmutabilidad del recibo: el PDF de un
// recibo emitido hace un año se ve exactamente igual hoy, sin importar
// cuánto haya cambiado el nombre de la empresa o el precio de un
// producto desde entonces.

const MM = 2.834645669; // 1mm en puntos PDF
const THERMAL_WIDTH = 80 * MM;
const THERMAL_PAGE_HEIGHT = 1500; // generoso; continúa en más páginas del mismo tamaño si hace falta

function renderToBuffer(doc: PDFKit.PDFDocument): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    doc.on('data', (chunk: Buffer) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
    doc.end();
  });
}

/** Etiqueta no-fiscal, SIEMPRE visible arriba de todo, en ambos formatos. */
function drawHeader(
  doc: PDFKit.PDFDocument,
  snapshot: ReceiptSnapshot,
  titleSize: number,
) {
  doc
    .fontSize(titleSize)
    .font('Helvetica-Bold')
    .text(snapshot.documentLabel, { align: 'center' });
  doc
    .fontSize(titleSize - 4)
    .font('Helvetica-Bold')
    .fillColor('#b00020')
    .text(snapshot.documentType, { align: 'center' })
    .fillColor('black');
  doc.moveDown(0.5);
}

function ensureSpace(
  doc: PDFKit.PDFDocument,
  needed: number,
  pageOptions: PDFKit.PDFDocumentOptions,
) {
  const bottom = doc.page.height - doc.page.margins.bottom;
  if (doc.y + needed > bottom) {
    doc.addPage(pageOptions);
  }
}

export async function renderReceiptPdf(
  snapshot: ReceiptSnapshot,
  format: PdfFormat,
): Promise<Buffer> {
  return format === 'thermal80' ? renderThermal(snapshot) : renderA4(snapshot);
}

function renderA4(snapshot: ReceiptSnapshot): Promise<Buffer> {
  const pageOptions: PDFKit.PDFDocumentOptions = {
    size: 'A4',
    margins: { top: 40, bottom: 40, left: 50, right: 50 },
  };
  const doc = new PDFDocument(pageOptions);

  drawHeader(doc, snapshot, 20);

  doc.fontSize(14).font('Helvetica-Bold').text(snapshot.issuer.name);
  doc.fontSize(9).font('Helvetica');
  doc.text(`Razón social: ${snapshot.issuer.legalName}`);
  doc.text(`NIT: ${snapshot.issuer.nit}`);
  if (snapshot.issuer.address)
    doc.text(`Dirección: ${snapshot.issuer.address}`);
  if (snapshot.issuer.phone) doc.text(`Teléfono: ${snapshot.issuer.phone}`);
  if (snapshot.issuer.branch)
    doc.text(`Sucursal: ${snapshot.issuer.branch.name}`);
  if (snapshot.issuer.posTerminal)
    doc.text(
      `Punto de venta: ${snapshot.issuer.posTerminal.name} (${snapshot.issuer.posTerminal.code})`,
    );
  doc.moveDown();

  doc
    .fontSize(11)
    .font('Helvetica-Bold')
    .text(`Recibo N.° ${snapshot.operation.fullNumber}`);
  doc.fontSize(9).font('Helvetica');
  doc.text(
    `Fecha de emisión: ${new Date(snapshot.operation.issuedAt).toLocaleString('es-BO')}`,
  );
  if (snapshot.operation.cashierName)
    doc.text(`Cajero: ${snapshot.operation.cashierName}`);
  doc.text(`Venta relacionada: ${snapshot.operation.saleId}`);
  doc.moveDown();

  doc.fontSize(10).font('Helvetica-Bold').text('Cliente');
  doc.fontSize(9).font('Helvetica');
  if (snapshot.customer) {
    doc.text(`Nombre: ${snapshot.customer.name}`);
    doc.text(
      `${snapshot.customer.documentType}: ${snapshot.customer.documentNumber}`,
    );
  } else {
    doc.text('Cliente ocasional');
  }
  doc.moveDown();

  doc.fontSize(10).font('Helvetica-Bold').text('Detalle');
  doc.moveDown(0.3);
  const colX = {
    product: 50,
    qty: 300,
    price: 360,
    discount: 430,
    subtotal: 490,
  };
  doc.fontSize(8).font('Helvetica-Bold');
  doc.text('Producto', colX.product, doc.y, { continued: false, width: 240 });
  const headerY = doc.y - doc.currentLineHeight();
  doc.text('Cant.', colX.qty, headerY, { width: 55 });
  doc.text('Precio', colX.price, headerY, { width: 65 });
  doc.text('Desc.', colX.discount, headerY, { width: 55 });
  doc.text('Subtotal', colX.subtotal, headerY, { width: 65 });
  doc.moveDown(0.5);
  doc.font('Helvetica').fontSize(8);
  for (const item of snapshot.items) {
    ensureSpace(doc, 14, pageOptions);
    const rowY = doc.y;
    doc.text(
      item.productName + (item.sku ? ` (${item.sku})` : ''),
      colX.product,
      rowY,
      { width: 240 },
    );
    doc.text(item.quantity, colX.qty, rowY, { width: 55 });
    doc.text(`Bs. ${item.unitPrice}`, colX.price, rowY, { width: 65 });
    doc.text(`Bs. ${item.discount}`, colX.discount, rowY, { width: 55 });
    doc.text(`Bs. ${item.subtotal}`, colX.subtotal, rowY, { width: 65 });
    doc.moveDown(0.4);
  }
  doc.moveDown(0.5);

  ensureSpace(doc, 60, pageOptions);
  doc.fontSize(9).font('Helvetica');
  doc.text(`Subtotal: Bs. ${snapshot.totals.subtotal}`, { align: 'right' });
  doc.text(`Descuento: Bs. ${snapshot.totals.discount}`, { align: 'right' });
  doc
    .fontSize(11)
    .font('Helvetica-Bold')
    .text(`TOTAL: Bs. ${snapshot.totals.total}`, { align: 'right' });
  doc.moveDown();

  ensureSpace(doc, 80, pageOptions);
  doc.fontSize(10).font('Helvetica-Bold').text('Pagos');
  doc.fontSize(9).font('Helvetica');
  if (snapshot.payments.methods.length === 0) {
    doc.text('Sin pagos registrados');
  } else {
    for (const p of snapshot.payments.methods) {
      doc.text(`${p.method}: Bs. ${p.amount}`);
    }
  }
  doc.text(`Total pagado: Bs. ${snapshot.payments.paidTotal}`);
  doc.text(`Saldo pendiente: Bs. ${snapshot.payments.balance}`);

  if (snapshot.observations) {
    doc.moveDown();
    doc.fontSize(9).font('Helvetica-Bold').text('Observaciones');
    doc.font('Helvetica').text(snapshot.observations);
  }

  doc.moveDown(2);
  ensureSpace(doc, 30, pageOptions);
  doc
    .fontSize(7)
    .fillColor('#666666')
    .text(
      'Este documento es un recibo comercial interno. NO constituye factura ni documento fiscal y no sustituye la facturación exigida por la normativa tributaria vigente.',
      { align: 'center' },
    );

  return renderToBuffer(doc);
}

function renderThermal(snapshot: ReceiptSnapshot): Promise<Buffer> {
  const pageOptions: PDFKit.PDFDocumentOptions = {
    size: [THERMAL_WIDTH, THERMAL_PAGE_HEIGHT],
    margins: { top: 10, bottom: 10, left: 8, right: 8 },
  };
  const doc = new PDFDocument(pageOptions);

  drawHeader(doc, snapshot, 11);

  doc
    .fontSize(9)
    .font('Helvetica-Bold')
    .text(snapshot.issuer.name, { align: 'center' });
  doc.fontSize(7).font('Helvetica');
  doc.text(`NIT: ${snapshot.issuer.nit}`, { align: 'center' });
  if (snapshot.issuer.address)
    doc.text(snapshot.issuer.address, { align: 'center' });
  if (snapshot.issuer.branch)
    doc.text(snapshot.issuer.branch.name, { align: 'center' });
  if (snapshot.issuer.posTerminal)
    doc.text(`POS: ${snapshot.issuer.posTerminal.name}`, { align: 'center' });
  doc.moveDown(0.5);
  doc.text('--------------------------------', { align: 'center' });

  doc
    .fontSize(8)
    .font('Helvetica-Bold')
    .text(`Recibo N.° ${snapshot.operation.fullNumber}`);
  doc.fontSize(7).font('Helvetica');
  doc.text(new Date(snapshot.operation.issuedAt).toLocaleString('es-BO'));
  if (snapshot.operation.cashierName)
    doc.text(`Cajero: ${snapshot.operation.cashierName}`);
  doc.text('--------------------------------', { align: 'center' });

  if (snapshot.customer) {
    doc.text(`Cliente: ${snapshot.customer.name}`);
    doc.text(
      `${snapshot.customer.documentType}: ${snapshot.customer.documentNumber}`,
    );
  } else {
    doc.text('Cliente ocasional');
  }
  doc.text('--------------------------------', { align: 'center' });

  for (const item of snapshot.items) {
    ensureSpace(doc, 24, pageOptions);
    doc.font('Helvetica-Bold').text(item.productName);
    doc
      .font('Helvetica')
      .text(`${item.quantity} x Bs. ${item.unitPrice} = Bs. ${item.subtotal}`);
    if (Number(item.discount) > 0) doc.text(`  Desc: Bs. ${item.discount}`);
  }
  doc.text('--------------------------------', { align: 'center' });

  ensureSpace(doc, 60, pageOptions);
  doc.text(`Subtotal: Bs. ${snapshot.totals.subtotal}`, { align: 'right' });
  doc.text(`Descuento: Bs. ${snapshot.totals.discount}`, { align: 'right' });
  doc
    .fontSize(9)
    .font('Helvetica-Bold')
    .text(`TOTAL: Bs. ${snapshot.totals.total}`, { align: 'right' });
  doc.fontSize(7).font('Helvetica');
  doc.moveDown(0.3);

  for (const p of snapshot.payments.methods) {
    doc.text(`${p.method}: Bs. ${p.amount}`);
  }
  doc.text(`Pagado: Bs. ${snapshot.payments.paidTotal}`);
  doc.text(`Saldo: Bs. ${snapshot.payments.balance}`);

  if (snapshot.observations) {
    doc.moveDown(0.3);
    doc.text(snapshot.observations);
  }

  doc.moveDown(0.8);
  ensureSpace(doc, 40, pageOptions);
  doc
    .fontSize(6)
    .fillColor('#666666')
    .text(
      'Documento comercial NO fiscal. No sustituye la factura exigida por ley.',
      {
        align: 'center',
      },
    );

  return renderToBuffer(doc);
}
