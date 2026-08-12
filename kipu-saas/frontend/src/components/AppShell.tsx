"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect } from "react";
import { useAuth } from "@/lib/auth-context";

interface NavLeaf {
  label: string;
  href: string;
}

interface NavGroup {
  label: string;
  href?: string;
  children?: NavLeaf[];
}

// Estructura de navegación exacta de la sección 8 del prompt.
const NAV: NavGroup[] = [
  { label: "Inicio", href: "/dashboard" },
  {
    label: "Ventas",
    children: [
      { label: "POS", href: "/sales/pos" },
      { label: "Ventas", href: "/sales" },
      { label: "Cotizaciones", href: "/sales/quotes" },
    ],
  },
  {
    label: "Facturación",
    children: [
      { label: "Facturas", href: "/invoicing" },
      { label: "Anulaciones", href: "/invoicing/cancellations" },
      { label: "Notas de crédito/débito", href: "/invoicing/credit-notes" },
    ],
  },
  {
    label: "Compras",
    children: [
      { label: "Compras", href: "/purchases" },
      { label: "Proveedores", href: "/purchases/suppliers" },
    ],
  },
  {
    label: "Inventario",
    children: [
      { label: "Productos", href: "/inventory/products" },
      { label: "Categorías", href: "/inventory/categories" },
      { label: "Almacenes", href: "/inventory/warehouses" },
      { label: "Movimientos", href: "/inventory/movements" },
    ],
  },
  { label: "Clientes", href: "/customers" },
  { label: "Caja y Bancos", href: "/cash" },
  { label: "Reportes", href: "/reports" },
  { label: "Usuarios y Permisos", href: "/users" },
  { label: "Configuración", href: "/settings" },
  { label: "Suscripción", href: "/subscription" },
  { label: "Integración SIN", href: "/sin" },
  { label: "Notificaciones", href: "/notifications" },
];

export default function AppShell({ children }: { children: React.ReactNode }) {
  const { user, organization, loading, logout } = useAuth();
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    if (!loading && !user) {
      router.replace("/login");
    }
  }, [loading, user, router]);

  if (loading || !user) {
    return <div className="flex flex-1 items-center justify-center text-zinc-500">Cargando...</div>;
  }

  return (
    <div className="flex flex-1 min-h-screen">
      <aside className="w-64 shrink-0 bg-zinc-900 text-zinc-100 flex flex-col overflow-y-auto">
        <div className="px-4 py-5 border-b border-zinc-800">
          <p className="font-semibold text-lg tracking-tight">KIPU</p>
          <p className="text-xs text-zinc-400 mt-1 truncate">{organization?.name}</p>
          <p className="text-xs text-zinc-500 truncate">{user.name}</p>
        </div>
        <nav className="flex-1 py-3">
          {NAV.map((item) =>
            item.children ? (
              <div key={item.label} className="mb-1">
                <p className="px-4 pt-3 pb-1 text-[11px] font-semibold uppercase tracking-wide text-zinc-500">
                  {item.label}
                </p>
                {item.children.map((child) => (
                  <Link
                    key={child.href}
                    href={child.href}
                    className={`block px-6 py-2 text-sm ${
                      pathname === child.href
                        ? "bg-zinc-800 text-white font-medium"
                        : "text-zinc-300 hover:bg-zinc-800"
                    }`}
                  >
                    {child.label}
                  </Link>
                ))}
              </div>
            ) : (
              <Link
                key={item.href}
                href={item.href!}
                className={`block px-4 py-2.5 text-sm ${
                  pathname === item.href
                    ? "bg-zinc-800 text-white font-medium"
                    : "text-zinc-300 hover:bg-zinc-800"
                }`}
              >
                {item.label}
              </Link>
            )
          )}
        </nav>
        <button onClick={logout} className="m-3 px-3 py-2 text-sm rounded bg-zinc-800 hover:bg-zinc-700 text-left">
          Cerrar sesión
        </button>
      </aside>
      <main className="flex-1 bg-zinc-50 overflow-y-auto">{children}</main>
    </div>
  );
}
