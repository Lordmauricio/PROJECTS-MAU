import type { Metadata } from "next";
import "./globals.css";
import { AuthProvider } from "@/lib/auth-context";

export const metadata: Metadata = {
  title: "KIPU SAAS",
  description: "Gestión para restaurantes, comida rápida y pollerías en Cochabamba, Bolivia",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html
      lang="es"
      className="h-full antialiased"
    >
      <body className="min-h-full flex flex-col bg-zinc-50 text-zinc-900">
        <AuthProvider>{children}</AuthProvider>
      </body>
    </html>
  );
}
