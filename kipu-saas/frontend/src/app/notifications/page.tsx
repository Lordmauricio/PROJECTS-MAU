"use client";

import { useEffect, useState } from "react";
import AppShell from "@/components/AppShell";
import { api } from "@/lib/api";
import { ApiError } from "@/lib/auth-context";

interface Notification {
  id: string;
  type: string;
  title: string;
  message: string;
  read: boolean;
  readAt: string | null;
  createdAt: string;
}

interface NotificationsPage {
  items: Notification[];
  total: number;
  page: number;
  pageSize: number;
}

const PAGE_SIZE = 20;

function formatDate(iso: string): string {
  return new Date(iso).toLocaleString("es-BO", { dateStyle: "medium", timeStyle: "short" });
}

export default function NotificationsPage() {
  const [data, setData] = useState<NotificationsPage | null>(null);
  const [page, setPage] = useState(1);
  const [unreadOnly, setUnreadOnly] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    setLoadError(null);
    try {
      const query = `?page=${page}&pageSize=${PAGE_SIZE}${unreadOnly ? "&unreadOnly=true" : ""}`;
      setData(await api<NotificationsPage>(`/notifications${query}`));
    } catch (err) {
      setLoadError(err instanceof ApiError ? err.message : "No se pudo cargar las notificaciones");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, unreadOnly]);

  async function markRead(id: string) {
    setActionError(null);
    try {
      await api(`/notifications/${id}/read`, { method: "PATCH" });
      await load();
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : "No se pudo marcar como leída");
    }
  }

  async function markAllRead() {
    setActionError(null);
    try {
      await api(`/notifications/read-all`, { method: "PATCH" });
      await load();
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : "No se pudo marcar todas como leídas");
    }
  }

  const totalPages = data ? Math.max(1, Math.ceil(data.total / PAGE_SIZE)) : 1;

  return (
    <AppShell>
      <div className="p-6 max-w-3xl space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-lg font-semibold">Notificaciones</h1>
            <p className="text-sm text-zinc-500">Eventos importantes de tu negocio: ventas, compras, caja y cuentas pendientes.</p>
          </div>
          <button
            onClick={markAllRead}
            className="text-xs rounded border border-zinc-300 px-3 py-1.5 hover:bg-zinc-100"
          >
            Marcar todas como leídas
          </button>
        </div>

        {loadError && <p className="text-sm text-red-600 bg-red-50 rounded p-2">{loadError}</p>}
        {actionError && <p className="text-sm text-red-600 bg-red-50 rounded p-2">{actionError}</p>}

        <label className="flex items-center gap-2 text-sm text-zinc-600">
          <input
            type="checkbox"
            checked={unreadOnly}
            onChange={(e) => {
              setPage(1);
              setUnreadOnly(e.target.checked);
            }}
          />
          Solo no leídas
        </label>

        <div className="bg-white rounded-lg border border-zinc-200 divide-y divide-zinc-100">
          {loading && <p className="px-4 py-6 text-center text-zinc-400 text-sm">Cargando...</p>}
          {!loading && data?.items.length === 0 && (
            <p className="px-4 py-6 text-center text-zinc-400 text-sm">
              {unreadOnly ? "No tenés notificaciones sin leer" : "Todavía no tenés notificaciones"}
            </p>
          )}
          {!loading &&
            data?.items.map((n) => (
              <div key={n.id} className={`px-4 py-3 flex items-start gap-3 ${n.read ? "" : "bg-blue-50/50"}`}>
                <div className={`mt-1.5 h-2 w-2 rounded-full shrink-0 ${n.read ? "bg-zinc-200" : "bg-blue-600"}`} />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-zinc-800">{n.title}</p>
                  <p className="text-sm text-zinc-600">{n.message}</p>
                  <p className="text-xs text-zinc-400 mt-1">{formatDate(n.createdAt)}</p>
                </div>
                {!n.read && (
                  <button
                    onClick={() => markRead(n.id)}
                    className="text-xs text-blue-700 underline shrink-0"
                  >
                    Marcar leída
                  </button>
                )}
              </div>
            ))}
        </div>

        {data && data.total > PAGE_SIZE && (
          <div className="flex items-center justify-between text-sm text-zinc-500">
            <button
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page <= 1}
              className="rounded border border-zinc-300 px-3 py-1 disabled:opacity-40"
            >
              Anterior
            </button>
            <span>
              Página {page} de {totalPages}
            </span>
            <button
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              disabled={page >= totalPages}
              className="rounded border border-zinc-300 px-3 py-1 disabled:opacity-40"
            >
              Siguiente
            </button>
          </div>
        )}
      </div>
    </AppShell>
  );
}
