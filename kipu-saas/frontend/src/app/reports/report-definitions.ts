// Definiciones de UI para los 17 reportes (Fase Comercial 7). Esto es
// SOLO presentación (qué filtros mostrar, qué columna leer de la fila que
// ya devuelve `ReportsService`) — nunca recalcula ni reinterpreta números,
// solo los lee y los formatea. La fuente de verdad de qué filtros aplica
// cada reporte y qué trae cada fila es el backend
// (`backend/src/reports/reports.service.ts` /
// `reports.controller.ts`); esta lista se mantiene alineada a mano con
// esa implementación.

export type FilterKey =
  | "dateFrom"
  | "dateTo"
  | "branchId"
  | "warehouseId"
  | "posTerminalId"
  | "userId"
  | "productId"
  | "categoryId"
  | "paymentMethod"
  | "status";

export interface ReportColumn {
  key: string; // path punteado dentro de la fila, ej. "customer.name"
  label: string;
  money?: boolean;
  date?: boolean;
  boolean?: boolean;
}

export interface ReportDefinition {
  key: string;
  label: string;
  group: string;
  filters: FilterKey[];
  statusOptions?: { value: string; label: string }[];
  columns: ReportColumn[];
  paginated: boolean;
  hasLimit?: boolean;
}

export const SALE_STATUS_OPTIONS = [
  { value: "DRAFT", label: "Borrador" },
  { value: "CONFIRMED", label: "Confirmada" },
  { value: "PARTIALLY_PAID", label: "Pago parcial" },
  { value: "PAID", label: "Pagada" },
  { value: "CANCELLED", label: "Cancelada" },
  { value: "REFUNDED", label: "Reembolsada" },
];

export const PURCHASE_STATUS_OPTIONS = [
  { value: "DRAFT", label: "Borrador" },
  { value: "CONFIRMED", label: "Confirmada" },
  { value: "PARTIALLY_RECEIVED", label: "Recepción parcial" },
  { value: "RECEIVED", label: "Recibida" },
  { value: "CANCELLED", label: "Cancelada" },
];

export const ACCOUNT_STATUS_OPTIONS = [
  { value: "PENDING", label: "Pendiente" },
  { value: "PAID", label: "Pagada" },
  { value: "OVERDUE", label: "Vencida" },
  { value: "CANCELLED", label: "Anulada" },
];

export const CASH_REGISTER_STATUS_OPTIONS = [
  { value: "OPEN", label: "Abierta" },
  { value: "CLOSED", label: "Cerrada" },
];

const SALES_FILTERS: FilterKey[] = [
  "dateFrom",
  "dateTo",
  "branchId",
  "warehouseId",
  "posTerminalId",
  "userId",
  "productId",
  "categoryId",
];

export const REPORTS: ReportDefinition[] = [
  {
    key: "sales",
    label: "Reporte de ventas",
    group: "Ventas",
    filters: [...SALES_FILTERS, "paymentMethod", "status"],
    statusOptions: SALE_STATUS_OPTIONS,
    paginated: true,
    columns: [
      { key: "id", label: "ID" },
      { key: "createdAt", label: "Fecha", date: true },
      { key: "status", label: "Estado" },
      { key: "customer.name", label: "Cliente" },
      { key: "warehouse.name", label: "Almacén" },
      { key: "posTerminal.name", label: "POS" },
      { key: "subtotal", label: "Subtotal", money: true },
      { key: "discount", label: "Descuento", money: true },
      { key: "total", label: "Total", money: true },
    ],
  },
  {
    key: "purchases",
    label: "Reporte de compras",
    group: "Compras",
    filters: ["dateFrom", "dateTo", "branchId", "warehouseId", "userId", "productId", "categoryId", "status"],
    statusOptions: PURCHASE_STATUS_OPTIONS,
    paginated: true,
    columns: [
      { key: "id", label: "ID" },
      { key: "createdAt", label: "Fecha", date: true },
      { key: "status", label: "Estado" },
      { key: "supplier.name", label: "Proveedor" },
      { key: "warehouse.name", label: "Almacén" },
      { key: "subtotal", label: "Subtotal", money: true },
      { key: "discount", label: "Descuento", money: true },
      { key: "total", label: "Total", money: true },
    ],
  },
  {
    key: "income",
    label: "Reporte de ingresos",
    group: "Caja",
    filters: ["dateFrom", "dateTo", "branchId", "posTerminalId", "userId"],
    paginated: true,
    columns: [
      { key: "createdAt", label: "Fecha", date: true },
      { key: "type", label: "Tipo" },
      { key: "cashRegister.posTerminal.name", label: "POS" },
      { key: "amount", label: "Monto", money: true },
      { key: "reason", label: "Motivo" },
    ],
  },
  {
    key: "expenses",
    label: "Reporte de egresos",
    group: "Caja",
    filters: ["dateFrom", "dateTo", "branchId", "posTerminalId", "userId"],
    paginated: true,
    columns: [
      { key: "createdAt", label: "Fecha", date: true },
      { key: "type", label: "Tipo" },
      { key: "cashRegister.posTerminal.name", label: "POS" },
      { key: "amount", label: "Monto", money: true },
      { key: "reason", label: "Motivo" },
    ],
  },
  {
    key: "cash",
    label: "Reporte de caja",
    group: "Caja",
    filters: ["dateFrom", "dateTo", "branchId", "posTerminalId", "status"],
    statusOptions: CASH_REGISTER_STATUS_OPTIONS,
    paginated: true,
    columns: [
      { key: "posTerminal.name", label: "POS" },
      { key: "status", label: "Estado" },
      { key: "openedAt", label: "Apertura", date: true },
      { key: "closedAt", label: "Cierre", date: true },
      { key: "openingAmount", label: "Apertura (Bs.)", money: true },
      { key: "currentBalance", label: "Saldo actual", money: true },
      { key: "difference", label: "Diferencia (cierre)", money: true },
    ],
  },
  {
    key: "inventory",
    label: "Reporte de inventario",
    group: "Inventario",
    filters: ["branchId", "warehouseId", "productId", "categoryId"],
    paginated: false,
    columns: [
      { key: "product.name", label: "Producto" },
      { key: "product.sku", label: "SKU" },
      { key: "warehouse.name", label: "Almacén" },
      { key: "quantity", label: "Cantidad" },
      { key: "unitCost", label: "Costo unitario", money: true },
      { key: "value", label: "Valor", money: true },
      { key: "lowStock", label: "Stock bajo", boolean: true },
    ],
  },
  {
    key: "movements",
    label: "Kardex / movimientos",
    group: "Inventario",
    filters: ["dateFrom", "dateTo", "warehouseId", "productId"],
    paginated: true,
    columns: [
      { key: "createdAt", label: "Fecha", date: true },
      { key: "product.name", label: "Producto" },
      { key: "warehouse.name", label: "Almacén" },
      { key: "type", label: "Tipo" },
      { key: "quantity", label: "Cantidad" },
      { key: "stockBefore", label: "Saldo antes" },
      { key: "stockAfter", label: "Saldo después" },
      { key: "reason", label: "Motivo" },
    ],
  },
  {
    key: "receivables",
    label: "Cuentas por cobrar",
    group: "Cuentas",
    filters: ["dateFrom", "dateTo", "status"],
    statusOptions: ACCOUNT_STATUS_OPTIONS,
    paginated: true,
    columns: [
      { key: "customer.name", label: "Cliente" },
      { key: "dueDate", label: "Vencimiento", date: true },
      { key: "status", label: "Estado" },
      { key: "amount", label: "Monto", money: true },
      { key: "paidTotal", label: "Pagado", money: true },
      { key: "balance", label: "Saldo", money: true },
    ],
  },
  {
    key: "payables",
    label: "Cuentas por pagar",
    group: "Cuentas",
    filters: ["dateFrom", "dateTo", "status"],
    statusOptions: ACCOUNT_STATUS_OPTIONS,
    paginated: true,
    columns: [
      { key: "supplier.name", label: "Proveedor" },
      { key: "dueDate", label: "Vencimiento", date: true },
      { key: "status", label: "Estado" },
      { key: "amount", label: "Monto", money: true },
      { key: "paidTotal", label: "Pagado", money: true },
      { key: "balance", label: "Saldo", money: true },
    ],
  },
  {
    key: "top-products",
    label: "Productos más vendidos",
    group: "Ventas",
    filters: SALES_FILTERS.filter((f) => f !== "productId"),
    paginated: false,
    hasLimit: true,
    columns: [
      { key: "product.name", label: "Producto" },
      { key: "product.sku", label: "SKU" },
      { key: "quantity", label: "Cantidad vendida" },
      { key: "total", label: "Total vendido", money: true },
      { key: "salesCount", label: "N.º de ventas" },
    ],
  },
  {
    key: "sales-by-product",
    label: "Ventas por producto",
    group: "Ventas",
    filters: SALES_FILTERS.filter((f) => f !== "productId"),
    paginated: false,
    hasLimit: true,
    columns: [
      { key: "product.name", label: "Producto" },
      { key: "product.sku", label: "SKU" },
      { key: "quantity", label: "Cantidad vendida" },
      { key: "total", label: "Total vendido", money: true },
      { key: "salesCount", label: "N.º de ventas" },
    ],
  },
  {
    key: "sales-by-category",
    label: "Ventas por categoría",
    group: "Ventas",
    filters: SALES_FILTERS.filter((f) => f !== "productId" && f !== "categoryId"),
    paginated: false,
    columns: [
      { key: "categoryName", label: "Categoría" },
      { key: "quantity", label: "Cantidad vendida" },
      { key: "total", label: "Total vendido", money: true },
      { key: "salesCount", label: "N.º de ventas" },
    ],
  },
  {
    key: "sales-by-branch",
    label: "Ventas por sucursal",
    group: "Ventas",
    filters: SALES_FILTERS.filter((f) => f !== "branchId"),
    paginated: false,
    columns: [
      { key: "branchName", label: "Sucursal" },
      { key: "total", label: "Total vendido", money: true },
      { key: "salesCount", label: "N.º de ventas" },
    ],
  },
  {
    key: "sales-by-pos",
    label: "Ventas por punto de venta",
    group: "Ventas",
    filters: SALES_FILTERS.filter((f) => f !== "posTerminalId"),
    paginated: false,
    columns: [
      { key: "posTerminalName", label: "Punto de venta" },
      { key: "total", label: "Total vendido", money: true },
      { key: "salesCount", label: "N.º de ventas" },
    ],
  },
  {
    key: "sales-by-user",
    label: "Ventas por usuario/cajero",
    group: "Ventas",
    filters: SALES_FILTERS.filter((f) => f !== "userId"),
    paginated: false,
    columns: [
      { key: "userName", label: "Usuario" },
      { key: "total", label: "Total vendido", money: true },
      { key: "salesCount", label: "N.º de ventas" },
    ],
  },
  {
    key: "payment-methods",
    label: "Métodos de pago",
    group: "Ventas",
    filters: ["dateFrom", "dateTo", "branchId", "posTerminalId"],
    paginated: false,
    columns: [
      { key: "method", label: "Método" },
      { key: "total", label: "Total cobrado", money: true },
      { key: "paymentsCount", label: "N.º de pagos" },
    ],
  },
  {
    key: "sales-by-date",
    label: "Ventas por rango de fechas",
    group: "Ventas",
    filters: [...SALES_FILTERS, "paymentMethod", "status"],
    statusOptions: SALE_STATUS_OPTIONS,
    paginated: false,
    columns: [
      { key: "date", label: "Fecha" },
      { key: "total", label: "Total vendido", money: true },
      { key: "salesCount", label: "N.º de ventas" },
    ],
  },
];

export const FILTER_LABELS: Record<FilterKey, string> = {
  dateFrom: "Desde",
  dateTo: "Hasta",
  branchId: "Sucursal",
  warehouseId: "Almacén",
  posTerminalId: "Punto de venta",
  userId: "Usuario",
  productId: "Producto",
  categoryId: "Categoría",
  paymentMethod: "Método de pago",
  status: "Estado",
};

export const PAYMENT_METHOD_OPTIONS = [
  { value: "CASH", label: "Efectivo" },
  { value: "CARD", label: "Tarjeta" },
  { value: "TRANSFER", label: "Transferencia" },
  { value: "QR", label: "QR" },
];

export function getPath(row: unknown, path: string): unknown {
  return path.split(".").reduce<unknown>((acc, key) => {
    if (acc === null || acc === undefined || typeof acc !== "object") return undefined;
    return (acc as Record<string, unknown>)[key];
  }, row);
}
