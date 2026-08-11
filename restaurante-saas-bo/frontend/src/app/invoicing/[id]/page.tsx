"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import AppShell from "@/components/AppShell";
import { api, ApiError } from "@/lib/api";
import { Invoice } from "@/lib/types";

export default function InvoiceDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const [invoice, setInvoice] = useState<Invoice | null>(null);
  const [motivo, setMotivo] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function load() {
    const data = await api<Invoice>(`/invoicing/invoices/${params.id}`);
    setInvoice(data);
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params.id]);

  async function handleCancel() {
    if (!motivo.trim()) {
      setError("Indica un motivo de anulacion");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await api(`/invoicing/invoices/${params.id}/cancel`, { method: "POST", body: { motivo } });
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "No se pudo anular la factura");
    } finally {
      setBusy(false);
    }
  }

  if (!invoice) {
    return (
      <AppShell>
        <div className="p-6 text-sm text-zinc-500">Cargando...</div>
      </AppShell>
    );
  }

  return (
    <AppShell>
      <div className="p-6 max-w-3xl space-y-6">
        <button onClick={() => router.push("/invoicing")} className="text-sm text-zinc-500 underline">
          &larr; Volver a facturas
        </button>

        <div className="bg-white rounded-lg border border-zinc-200 p-6 flex gap-6">
          <div className="flex-1 space-y-1 text-sm">
            <h1 className="text-lg font-semibold mb-2">Factura N° {invoice.numeroFactura}</h1>
            <p>
              <span className="text-zinc-500">Estado: </span>
              {invoice.state}
            </p>
            <p>
              <span className="text-zinc-500">Ambiente: </span>
              {invoice.environment === "TEST" ? "Piloto/Pruebas (sin validez fiscal)" : "Produccion"}
            </p>
            <p>
              <span className="text-zinc-500">Monto: </span>Bs. {Number(invoice.montoTotal).toFixed(2)}
            </p>
            <p>
              <span className="text-zinc-500">Fecha: </span>
              {new Date(invoice.fechaEmision).toLocaleString("es-BO")}
            </p>
            <p className="break-all">
              <span className="text-zinc-500">CUF: </span>
              {invoice.cuf}
            </p>
            <p className="break-all">
              <span className="text-zinc-500">CUFD: </span>
              {invoice.cufd}
            </p>
            <p className="break-all">
              <span className="text-zinc-500">CUIS: </span>
              {invoice.cuis}
            </p>
            {invoice.motivoAnulacion && (
              <p className="text-red-600">Motivo de anulacion: {invoice.motivoAnulacion}</p>
            )}
          </div>
          {invoice.qrImagePng && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={invoice.qrImagePng} alt="QR factura" className="w-40 h-40" />
          )}
        </div>

        {invoice.state === "VALIDA" && (
          <div className="bg-white rounded-lg border border-zinc-200 p-4 space-y-2">
            <h2 className="font-medium text-sm">Anular factura</h2>
            <input
              value={motivo}
              onChange={(e) => setMotivo(e.target.value)}
              placeholder="Motivo de anulacion"
              className="w-full rounded border border-zinc-300 px-3 py-1.5 text-sm"
            />
            {error && <p className="text-xs text-red-600">{error}</p>}
            <button
              disabled={busy}
              onClick={handleCancel}
              className="bg-red-600 text-white rounded px-3 py-1.5 text-sm disabled:opacity-50"
            >
              {busy ? "Anulando..." : "Anular factura"}
            </button>
          </div>
        )}

        <details className="bg-white rounded-lg border border-zinc-200 p-4">
          <summary className="cursor-pointer text-sm font-medium">Ver XML enviado al SIN</summary>
          <pre className="text-xs mt-3 whitespace-pre-wrap break-all">{invoice.xml}</pre>
        </details>
      </div>
    </AppShell>
  );
}
