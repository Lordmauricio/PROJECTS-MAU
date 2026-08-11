"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect } from "react";
import { useAuth } from "@/lib/auth-context";

const NAV_ITEMS = [
  { href: "/pos", label: "Punto de Venta" },
  { href: "/orders", label: "Pedidos" },
  { href: "/menu", label: "Menu" },
  { href: "/invoicing", label: "Facturacion" },
  { href: "/fiscal-config", label: "Config. Fiscal" },
  { href: "/users", label: "Usuarios" },
];

export default function AppShell({ children }: { children: React.ReactNode }) {
  const { user, loading, logout } = useAuth();
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    if (!loading && !user) {
      router.replace("/login");
    }
  }, [loading, user, router]);

  if (loading || !user) {
    return (
      <div className="flex flex-1 items-center justify-center text-zinc-500">Cargando...</div>
    );
  }

  return (
    <div className="flex flex-1 min-h-screen">
      <aside className="w-56 shrink-0 bg-zinc-900 text-zinc-100 flex flex-col">
        <div className="px-4 py-5 border-b border-zinc-800">
          <p className="font-semibold text-sm">Restaurante SaaS BO</p>
          <p className="text-xs text-zinc-400 mt-1">{user.name}</p>
        </div>
        <nav className="flex-1 py-3">
          {NAV_ITEMS.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className={`block px-4 py-2.5 text-sm ${
                pathname?.startsWith(item.href)
                  ? "bg-zinc-800 text-white font-medium"
                  : "text-zinc-300 hover:bg-zinc-800"
              }`}
            >
              {item.label}
            </Link>
          ))}
        </nav>
        <button
          onClick={logout}
          className="m-3 px-3 py-2 text-sm rounded bg-zinc-800 hover:bg-zinc-700 text-left"
        >
          Cerrar sesion
        </button>
      </aside>
      <main className="flex-1 bg-zinc-50 overflow-y-auto">{children}</main>
    </div>
  );
}
