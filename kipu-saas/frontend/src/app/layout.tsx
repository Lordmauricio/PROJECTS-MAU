import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { AuthProvider } from "@/lib/auth-context";
import { ServiceWorkerRegistrar } from "@/components/ServiceWorkerRegistrar";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "KIPU SAAS",
  description: "Plataforma de gestión empresarial para negocios en Bolivia",
  // Nombre corto que Android/iOS muestran bajo el icono al instalar. El
  // manifest (`app/manifest.ts`) se enlaza solo: Next inserta el
  // `<link rel="manifest">` al detectar esa ruta de metadatos.
  applicationName: "KIPU",
  appleWebApp: {
    capable: true,
    title: "KIPU",
    statusBarStyle: "black-translucent",
  },
};

/**
 * Offline 4.14.1 — viewport. Antes de esta fase el proyecto no exportaba
 * ninguno, así que dependía del `<meta name="viewport">` por defecto de
 * Next. Se hace explícito porque la app pasa a instalarse en un teléfono:
 * `themeColor` pinta la barra de estado de Android con el MISMO `zinc-900`
 * de la barra superior de `AppShell`, de modo que en modo `standalone` no se
 * ve una franja de otro color encima de la app.
 *
 * NO se fija `maximumScale`/`userScalable`: bloquear el zoom rompe la
 * accesibilidad de quien necesita agrandar el texto, y en un POS que se usa
 * a diario eso importa más que evitar un zoom accidental.
 */
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#18181b",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html
      lang="es"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col bg-zinc-50 text-zinc-900">
        <ServiceWorkerRegistrar />
        <AuthProvider>{children}</AuthProvider>
      </body>
    </html>
  );
}
