export interface Component {
  productId: string;
  quantity: number;
}
export interface MenuOption {
  id: string;
  name: string;
  price: number;
  replacesProductId?: string;
  components: Component[];
}
export interface MenuEntry {
  id: string;
  productId: string;
  name: string;
  presentation?: string | null;
  category: string;
  station: string;
  price: string;
  active: boolean;
  available: number | null;
  customizable?: boolean;
  components: Component[];
  options: MenuOption[];
}
export interface OrderLine {
  menuEntryId: string;
  productId: string;
  name: string;
  presentation?: string | null;
  category: string;
  station: string;
  quantity: number;
  unitPrice: string;
  subtotal: string;
  options: { id: string; name: string; price: string }[];
  components: { productId: string; name: string; quantity: string; referenceUnitPrice?: string }[];
}

export interface OrderQuote {
  items: OrderLine[];
  subtotal: string;
  discount: string;
  total: string;
  canFulfill: boolean;
  shortages: {
    productId: string;
    name: string;
    required: string;
    available: string;
    missing: string;
  }[];
}

export function menuTitle(entry: Pick<MenuEntry, "name" | "presentation">) {
  return entry.presentation
    ? `${entry.name} · ${entry.presentation}`
    : entry.name;
}
export interface RestaurantOrder {
  id: string;
  branchId: string;
  saleId: string;
  status: string;
  version: number;
  service: "DINE_IN" | "TAKEAWAY";
  customerName: string | null;
  notes: string | null;
  snapshot: OrderLine[];
  createdAt: string;
  queuedAt: string | null;
  printCount: number;
  sale: { status: string; total: string; discount: string };
  events: {
    id: string;
    action: string;
    detail: string | null;
    createdAt: string;
  }[];
}
export const orderLabels: Record<string, string> = {
  DRAFT: "Pendiente de cobro",
  QUEUED: "En espera",
  PREPARING: "En preparación",
  READY: "Listo para entregar",
  DELIVERED: "Entregado",
  CANCELLED: "Cancelado",
};
export function cents(value: string | number) {
  return Math.round(Number(value) * 100);
}
export function bolivianos(value: string | number) {
  return `Bs ${Number(value).toFixed(2)}`;
}
export function businessTime(value: string) {
  return new Intl.DateTimeFormat("es-BO", {
    timeZone: "America/La_Paz",
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}
export const control =
  "min-h-11 rounded-xl border border-zinc-300 bg-white px-3 py-2 text-sm";
export const primary =
  "min-h-11 rounded-xl bg-emerald-800 px-4 py-2 font-medium text-white hover:bg-emerald-900 disabled:opacity-50";
