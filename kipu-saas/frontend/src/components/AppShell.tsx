"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { useAuth } from "@/lib/auth-context";
import { api } from "@/lib/api";
import ConnectionBadge from "@/components/ConnectionBadge";
import { useAutoSync } from "@/lib/offline/react/useAutoSync";
import { useLocalDb } from "@/lib/offline/react/useLocalDb";
import { getPendingSyncSummary } from "@/lib/offline/session-lifecycle";

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
      { label: "Cuentas por Cobrar", href: "/receivables" },
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
      { label: "Cuentas por Pagar", href: "/payables" },
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
  const [unreadCount, setUnreadCount] = useState(0);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const localDb = useLocalDb();

  // Dispara el Sync Engine al iniciar, al reconectar y periódicamente como
  // respaldo — montado UNA vez acá (no en cada página) para que una venta
  // offline siga intentando sincronizarse aunque el usuario navegue a otra
  // pantalla después de crearla. Ver lib/offline/react/useAutoSync.ts.
  useAutoSync();

  useEffect(() => {
    if (!loading && !user) {
      router.replace("/login");
    }
  }, [loading, user, router]);

  // Logout con operaciones pendientes: nunca las borra en silencio — el
  // usuario decide explícitamente si de verdad quiere salir sabiendo que
  // hay ventas sin sincronizar en ESTE dispositivo (siguen ahí después,
  // `getPendingSyncSummary` es de solo lectura, ver Fase Offline 2).
  async function handleLogout() {
    if (localDb && organization) {
      const summary = await getPendingSyncSummary(organization.id);
      if (summary.pendingCount > 0) {
        const plural = summary.pendingCount === 1 ? "operación" : "operaciones";
        const confirmed = window.confirm(
          `Tenés ${summary.pendingCount} ${plural} sin sincronizar en este dispositivo.\n\n` +
            "Van a seguir guardadas acá y se sincronizarán solas la próxima vez que abras sesión " +
            "en este mismo dispositivo con conexión a internet.\n\n¿Cerrar sesión de todas formas?",
        );
        if (!confirmed) return;
      }
    }
    logout();
  }

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    async function poll() {
      try {
        const { count } = await api<{ count: number }>("/notifications/unread-count");
        if (!cancelled) setUnreadCount(count);
      } catch {
        // Silencioso: un fallo de red al pollear el contador no debe
        // interrumpir la navegación normal del usuario.
      }
    }
    poll();
    const interval = setInterval(poll, 30_000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
    // Se refresca también al navegar (p.ej. después de marcar como leídas en /notifications).
  }, [user, pathname]);

  if (loading || !user) {
    return <div className="flex flex-1 items-center justify-center text-zinc-500">Cargando...</div>;
  }

  const navContent = (
    <>
      <div className="px-4 py-5 border-b border-zinc-800">
        <div className="flex items-center justify-between gap-2">
          <p className="font-semibold text-lg tracking-tight">KIPU</p>
          <ConnectionBadge compact />
        </div>
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
                  onClick={() => setMobileNavOpen(false)}
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
              onClick={() => setMobileNavOpen(false)}
              className={`flex items-center justify-between px-4 py-2.5 text-sm ${
                pathname === item.href
                  ? "bg-zinc-800 text-white font-medium"
                  : "text-zinc-300 hover:bg-zinc-800"
              }`}
            >
              <span>{item.label}</span>
              {item.href === "/notifications" && unreadCount > 0 && (
                <span className="ml-2 rounded-full bg-blue-600 text-white text-[11px] leading-none px-1.5 py-1 min-w-[1.25rem] text-center">
                  {unreadCount > 99 ? "99+" : unreadCount}
                </span>
              )}
            </Link>
          )
        )}
      </nav>
      <button
        onClick={handleLogout}
        className="m-3 px-3 py-2 text-sm rounded bg-zinc-800 hover:bg-zinc-700 text-left"
      >
        Cerrar sesión
      </button>
    </>
  );

  return (
    <div className="flex flex-1 min-h-screen flex-col md:flex-row">
      {/* Barra superior — solo en móvil/tablet chico: hamburguesa + marca + estado de conexión. En md+ la navegación ya está siempre visible en el costado, así que esta barra desaparece. */}
      <header className="md:hidden flex items-center justify-between gap-2 px-4 py-3 bg-zinc-900 text-zinc-100">
        <button
          onClick={() => setMobileNavOpen(true)}
          aria-label="Abrir menú"
          aria-expanded={mobileNavOpen}
          className="p-1.5 -ml-1.5 rounded hover:bg-zinc-800"
        >
          <span aria-hidden="true" className="block text-xl leading-none">☰</span>
        </button>
        <p className="font-semibold tracking-tight">KIPU</p>
        <ConnectionBadge compact />
      </header>

      {mobileNavOpen && (
        <div className="md:hidden fixed inset-0 z-40 flex">
          <div
            className="fixed inset-0 bg-black/40"
            onClick={() => setMobileNavOpen(false)}
            aria-hidden="true"
          />
          <aside className="relative z-50 w-72 max-w-[85vw] bg-zinc-900 text-zinc-100 flex flex-col overflow-y-auto">
            {navContent}
          </aside>
        </div>
      )}

      <aside className="hidden md:flex w-64 shrink-0 bg-zinc-900 text-zinc-100 flex-col overflow-y-auto">
        {navContent}
      </aside>
      <main className="flex-1 bg-zinc-50 overflow-y-auto min-w-0">{children}</main>
    </div>
  );
}
