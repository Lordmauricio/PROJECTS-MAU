export interface Category {
  id: string;
  name: string;
  sortOrder: number;
  active: boolean;
}

export interface Product {
  id: string;
  name: string;
  description?: string | null;
  price: string;
  categoryId?: string | null;
  active: boolean;
}

export interface OrderItem {
  id: string;
  productId: string;
  productName: string;
  unitPrice: string;
  quantity: number;
  subtotal: string;
}

export interface Payment {
  id: string;
  method: "CASH" | "CARD" | "QR_SIMPLE" | "OTHER";
  amount: string;
  receivedAmount?: string | null;
  changeAmount?: string | null;
}

export interface Invoice {
  id: string;
  numeroFactura: number;
  cuf: string;
  cufd: string;
  cuis: string;
  montoTotal: string;
  state: "VALIDA" | "ANULADA" | "OBSERVADA";
  environment: "TEST" | "PRODUCTION";
  qrImagePng?: string | null;
  qrData: string;
  xml: string;
  fechaEmision: string;
  motivoAnulacion?: string | null;
}

export interface Order {
  id: string;
  type: "DINE_IN" | "TAKEAWAY" | "DELIVERY";
  status: "OPEN" | "IN_PREPARATION" | "READY" | "DELIVERED" | "PAID" | "CANCELLED";
  tableNumber?: string | null;
  subtotal: string;
  discount: string;
  total: string;
  createdAt: string;
  items: OrderItem[];
  payments: Payment[];
  invoice?: Invoice | null;
  customer?: { id: string; name: string } | null;
}

export interface Branch {
  id: string;
  name: string;
  fiscalConfig?: FiscalConfig | null;
}

export interface FiscalConfig {
  id: string;
  branchId: string;
  environment: "TEST" | "PRODUCTION";
  nit: string;
  razonSocial: string;
  codigoSucursal: number;
  codigoPuntoVenta: number;
  codigoSistema?: string | null;
  cuis?: string | null;
  cuisFechaVigencia?: string | null;
}
