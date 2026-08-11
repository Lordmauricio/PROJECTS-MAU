"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import AppShell from "@/components/AppShell";
import { api } from "@/lib/api";
import { Invoice } from "@/lib/types";

export default function InvoicingPage() {
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api<Invoice[]>("/invoicing/invoices")
      .then(setInvoices)
      .finally(() => setLoading(false));
  }, []);

  return (
    <AppShell>
      <div className="p-6">
        <h1 className="text-lg font-semibold mb-1">Facturas emitidas</h1>
        <p className="text-sm text-zinc-500 mb-4">
          Mientras el sistema no este homologado ante el SIN, estas facturas se emiten en{" "}
          <strong>ambiente simulado</strong> y no tienen validez fiscal.
        </p>
        {loading ? (
          <p className="text-sm text-zinc-500">Cargando...</p>
        ) : (
          <div className="bg-white rounded-lg border border-zinc-200 overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-zinc-50 text-zinc-500 text-left">
                <tr>
                  <th className="px-4 py-2">N°</th>
                  <th className="px-4 py-2">Fecha</th>
                  <th className="px-4 py-2">CUF</th>
                  <th className="px-4 py-2">Monto</th>
                  <th className="px-4 py-2">Ambiente</th>
                  <th className="px-4 py-2">Estado</th>
                </tr>
              </thead>
              <tbody>
                {invoices.map((inv) => (
                  <tr key={inv.id} className="border-t border-zinc-100">
                    <td className="px-4 py-2">
                      <Link href={`/invoicing/${inv.id}`} className="text-zinc-900 underline">
                        {inv.numeroFactura}
                      </Link>
                    </td>
                    <td className="px-4 py-2">{new Date(inv.fechaEmision).toLocaleString("es-BO")}</td>
                    <td className="px-4 py-2 font-mono text-xs">{inv.cuf.slice(0, 24)}...</td>
                    <td className="px-4 py-2">Bs. {Number(inv.montoTotal).toFixed(2)}</td>
                    <td className="px-4 py-2">{inv.environment === "TEST" ? "Piloto/Pruebas" : "Produccion"}</td>
                    <td className="px-4 py-2">{inv.state}</td>
                  </tr>
                ))}
                {invoices.length === 0 && (
                  <tr>
                    <td colSpan={6} className="px-4 py-6 text-center text-zinc-400">
                      Sin facturas todavia
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </AppShell>
  );
}
