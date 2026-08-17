import { Prisma } from '../../generated/prisma/client';
import { money, sumMoney } from '../common/money';

// Forma exacta del snapshot JSONB guardado en `commercial_receipts.snapshot`
// — la ÚNICA fuente que el PDF (`receipt-pdf.util.ts`) lee. Se construye
// UNA vez, al emitir el recibo (`ReceiptsService.issue`), y nunca se
// vuelve a tocar: si después cambia el nombre/dirección/logo de la
// empresa, el precio de un producto, o los datos del cliente, este objeto
// ya guardado no se entera — es exactamente el punto.
export interface ReceiptSnapshot {
  documentLabel: 'RECIBO DE VENTA';
  documentType: 'DOCUMENTO COMERCIAL NO FISCAL';
  issuer: {
    name: string;
    legalName: string;
    nit: string;
    logoUrl: string | null;
    address: string | null;
    phone: string | null;
    branch: { name: string; address: string | null } | null;
    posTerminal: { name: string; code: string } | null;
  };
  operation: {
    series: string;
    number: number;
    fullNumber: string;
    issuedAt: string;
    cashierName: string | null;
    saleId: string;
  };
  customer: {
    name: string;
    documentType: string;
    documentNumber: string;
  } | null;
  items: Array<{
    productName: string;
    sku: string | null;
    quantity: string;
    unitPrice: string;
    discount: string;
    subtotal: string;
  }>;
  totals: {
    subtotal: string;
    discount: string;
    total: string;
  };
  payments: {
    methods: Array<{ method: string; amount: string }>;
    paidTotal: string;
    balance: string;
  };
  observations: string | null;
}

type SaleWithRelations = Prisma.SaleGetPayload<{
  include: {
    items: {
      include: { product: { select: { id: true; name: true; sku: true } } };
    };
    payments: true;
    customer: true;
    warehouse: { include: { branch: true } };
    posTerminal: { include: { branch: true } };
  };
}>;

export function buildReceiptSnapshot(params: {
  organization: Prisma.OrganizationGetPayload<Record<string, never>>;
  sale: SaleWithRelations;
  paidTotal: Prisma.Decimal;
  balance: Prisma.Decimal;
  issuedByName: string | null;
  series: string;
  number: number;
}): ReceiptSnapshot {
  const {
    organization,
    sale,
    paidTotal,
    balance,
    issuedByName,
    series,
    number,
  } = params;
  const branch = sale.posTerminal?.branch ?? sale.warehouse?.branch ?? null;

  const methodTotals = new Map<string, Prisma.Decimal>();
  for (const p of sale.payments) {
    const prev = methodTotals.get(p.method) ?? money(0);
    methodTotals.set(p.method, prev.add(p.amount));
  }

  return {
    documentLabel: 'RECIBO DE VENTA',
    documentType: 'DOCUMENTO COMERCIAL NO FISCAL',
    issuer: {
      name: organization.name,
      legalName: organization.legalName,
      nit: organization.nit,
      logoUrl: organization.logoUrl,
      address: organization.address,
      phone: organization.phone,
      branch: branch ? { name: branch.name, address: branch.address } : null,
      posTerminal: sale.posTerminal
        ? { name: sale.posTerminal.name, code: sale.posTerminal.code }
        : null,
    },
    operation: {
      series,
      number,
      fullNumber: `${series}-${String(number).padStart(6, '0')}`,
      issuedAt: new Date().toISOString(),
      cashierName: issuedByName,
      saleId: sale.id,
    },
    customer: sale.customer
      ? {
          name: sale.customer.name,
          documentType: sale.customer.documentType,
          documentNumber: sale.customer.documentNumber,
        }
      : null,
    items: sale.items.map((item) => ({
      productName: item.product.name,
      sku: item.product.sku,
      quantity: money(item.quantity).toFixed(2),
      unitPrice: money(item.unitPrice).toFixed(2),
      discount: money(item.discount).toFixed(2),
      subtotal: money(item.subtotal).toFixed(2),
    })),
    totals: {
      subtotal: money(sale.subtotal).toFixed(2),
      discount: money(sale.discount).toFixed(2),
      total: money(sale.total).toFixed(2),
    },
    payments: {
      methods: [...methodTotals.entries()].map(([method, amount]) => ({
        method,
        amount: amount.toFixed(2),
      })),
      paidTotal: sumMoney([paidTotal]).toFixed(2),
      balance: money(balance).toFixed(2),
    },
    observations: null,
  };
}
