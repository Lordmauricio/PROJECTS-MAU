"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { useAuth } from "@/lib/auth-context";
import { api } from "@/lib/api";

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
    label: "Restaurante",
    children: [
      { label: "Caja gastronómica", href: "/restaurant/pos" },
      { label: "Cocina y despacho", href: "/restaurant/kitchen" },
      { label: "Producción por tandas", href: "/restaurant/production" },
      { label: "Menú y combos", href: "/restaurant/menu" },
    ],
  },
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
  const [menuOpen, setMenuOpen] = useState(false);
  const navigationRef = useRef<HTMLElement>(null);
  const mainRef = useRef<HTMLElement>(null);
  const toggleRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!menuOpen) return;
    const desktop = window.matchMedia("(min-width: 1024px)");
    if (desktop.matches) return;
    const main = mainRef.current;
    const toggle = toggleRef.current;
    const previousOverflow = document.body.style.overflow;
    if (main) main.inert = true;
    document.body.style.overflow = "hidden";
    const focusable = () => [
      ...(navigationRef.current?.querySelectorAll<HTMLElement>(
        "a[href], button:not([disabled])",
      ) ?? []),
      ...(toggleRef.current ? [toggleRef.current] : []),
    ];
    focusable()[0]?.focus();
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        setMenuOpen(false);
      }
      if (event.key !== "Tab") return;
      const items = focusable();
      const first = items[0];
      const last = items.at(-1);
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last?.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first?.focus();
      }
    };
    const resize = () => {
      if (desktop.matches) setMenuOpen(false);
    };
    window.addEventListener("keydown", handleKey);
    desktop.addEventListener("change", resize);
    return () => {
      if (main) main.inert = false;
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", handleKey);
      desktop.removeEventListener("change", resize);
      toggle?.focus();
    };
  }, [menuOpen]);

  useEffect(() => {
    if (!loading && !user) {
      router.replace("/login");
    }
  }, [loading, user, router]);

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    async function poll() {
      try {
        const { count } = await api<{ count: number }>(
          "/notifications/unread-count",
        );
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
    return (
      <div className="flex flex-1 items-center justify-center text-zinc-500">
        Cargando...
      </div>
    );
  }

  return (
    <div className="flex flex-1 min-h-screen min-w-0">
      <a href="#main-content" className="skip-link">
        Ir al contenido
      </a>
      <button
        ref={toggleRef}
        aria-controls="navigation-panel"
        aria-label={menuOpen ? "Cerrar navegación" : "Abrir navegación"}
        aria-expanded={menuOpen}
        onClick={() => setMenuOpen(!menuOpen)}
        className="fixed bottom-4 left-4 z-50 min-h-11 rounded-full bg-zinc-900 px-4 py-2 text-sm text-white shadow-lg lg:hidden"
      >
        {menuOpen ? "Cerrar menú" : "Menú"}
      </button>
      {menuOpen && (
        <button
          tabIndex={-1}
          aria-label="Cerrar panel de navegación"
          className="fixed inset-0 z-30 bg-black/40 lg:hidden"
          onClick={() => setMenuOpen(false)}
        />
      )}
      <aside
        ref={navigationRef}
        id="navigation-panel"
        role={menuOpen ? "dialog" : undefined}
        aria-modal={menuOpen ? true : undefined}
        aria-label="Navegación principal"
        className={`${menuOpen ? "flex" : "hidden"} fixed inset-y-0 left-0 z-40 w-64 shrink-0 bg-zinc-900 text-zinc-100 flex-col overflow-y-auto pb-20 lg:sticky lg:top-0 lg:h-screen lg:flex lg:pb-0 print:hidden`}
      >
        <div className="px-4 py-5 border-b border-zinc-800">
          <p className="font-semibold text-lg tracking-tight">KIPU</p>
          <p className="text-xs text-zinc-400 mt-1 truncate">
            {organization?.name}
          </p>
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
                    aria-current={pathname === child.href ? "page" : undefined}
                    onClick={() => setMenuOpen(false)}
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
                aria-current={pathname === item.href ? "page" : undefined}
                onClick={() => setMenuOpen(false)}
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
            ),
          )}
        </nav>
        <button
          onClick={logout}
          className="m-3 px-3 py-2 text-sm rounded bg-zinc-800 hover:bg-zinc-700 text-left"
        >
          Cerrar sesión
        </button>
      </aside>
      <main
        ref={mainRef}
        id="main-content"
        tabIndex={-1}
        className="app-main min-w-0 flex-1 bg-zinc-50 pb-24 lg:pb-0"
      >
        {children}
      </main>
    </div>
  );
}
