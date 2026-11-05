"use client";
import { useCallback, useEffect, useState } from "react";
import { flushSync } from "react-dom";
import Link from "next/link";
import AppShell from "@/components/AppShell";
import OrderTicket from "@/components/OrderTicket";
import { api, ApiError } from "@/lib/api";
import { useRemoteLoad } from "@/lib/use-remote-load";
import { useSubmitGuard } from "@/lib/use-submit-guard";
import {
  businessTime,
  control,
  orderLabels,
  primary,
  type RestaurantOrder,
} from "@/lib/restaurant";

export default function KitchenPage() {
  const [orders, setOrders] = useState<RestaurantOrder[]>([]);
  const [branches, setBranches] = useState<{ id: string; name: string }[]>([]);
  const [branchId, setBranchId] = useState("");
  const [station, setStation] = useState("");
  const [status, setStatus] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [ticket, setTicket] = useState<RestaurantOrder | null>(null);
  const [clock, setClock] = useState(() => Date.now());
  const fetchData = useCallback(() => {
    const params = new URLSearchParams();
    if (branchId) params.set("branchId", branchId);
    if (status && (!station || ["DELIVERED", "CANCELLED"].includes(status)))
      params.set("status", status);
    return Promise.all([
      api<RestaurantOrder[]>(`/restaurant/orders?${params}`),
      api<{ id: string; name: string }[]>("/branches"),
    ]);
  }, [branchId, status, station]);
  const receive = useCallback(
    ([orders, branches]: Awaited<ReturnType<typeof fetchData>>) => {
      setOrders(orders);
      setBranches(branches);
    },
    [],
  );
  const {
    loading,
    error: loadError,
    reload,
  } = useRemoteLoad(fetchData, receive, "No se pudo actualizar cocina");
  useEffect(() => {
    const interval = setInterval(() => {
      setClock(Date.now());
      void reload();
    }, 15000);
    return () => clearInterval(interval);
  }, [reload]);
  const action = useSubmitGuard(
    async (order: RestaurantOrder, next: string) => {
      setError(null);
      try {
        await api(`/restaurant/orders/${order.id}/status`, {
          method: "POST",
          body: (() => {
            const task =
              next !== "DELIVERED"
                ? (order.tasks.find((task) => task.station === station) ??
                  (order.tasks.length === 1 ? order.tasks[0] : undefined))
                : undefined;
            return {
              status: next,
              version: task?.version ?? order.version,
              ...(task ? { station: task.station } : {}),
            };
          })(),
        });
        await reload();
      } catch (err) {
        setError(
          err instanceof ApiError
            ? err.message
            : "No se pudo cambiar el estado. Actualiza antes de reintentar.",
        );
        await reload();
      }
    },
  );
  const stationAction = useSubmitGuard(
    async (order: RestaurantOrder, stationName: string, next: string) => {
      setError(null);
      const task = order.tasks.find((task) => task.station === stationName);
      if (!task) return;
      try {
        await api(`/restaurant/orders/${order.id}/status`, {
          method: "POST",
          body: { station: stationName, status: next, version: task.version },
        });
        await reload();
      } catch (err) {
        setError(
          err instanceof ApiError
            ? err.message
            : "No se pudo actualizar la estación",
        );
        await reload();
      }
    },
  );
  const print = useSubmitGuard(async (order: RestaurantOrder) => {
    setError(null);
    try {
      const printed = await api<RestaurantOrder>(
        `/restaurant/orders/${order.id}/print`,
        { method: "POST", body: station ? { station } : {} },
      );
      flushSync(() => setTicket(printed));
      window.print();
      await reload();
    } catch (err) {
      setError(
        err instanceof ApiError
          ? err.message
          : "No se pudo preparar la comanda",
      );
    }
  });
  const stations = [
    ...new Set(
      orders.flatMap((order) => order.snapshot.map((line) => line.station)),
    ),
  ];
  function minutes(from: string, to?: string | null) {
    return Math.max(
      0,
      Math.floor(
        ((to ? new Date(to).getTime() : clock) - new Date(from).getTime()) /
          60000,
      ),
    );
  }
  function cardStatus(order: RestaurantOrder) {
    return ["DELIVERED", "CANCELLED"].includes(order.status)
      ? order.status
      : station
        ? (order.tasks.find((task) => task.station === station)?.status ??
          order.status)
        : order.status;
  }
  const visible = orders.filter(
    (order) =>
      order.status !== "DRAFT" &&
      (!station || order.snapshot.some((line) => line.station === station)),
  );
  const columns = status ? [status] : ["QUEUED", "PREPARING", "READY"];
  return (
    <AppShell>
      <div className="kitchen-screen mx-auto max-w-[1700px] space-y-6 p-4 md:p-8">
        <header className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-widest text-emerald-800">
              KIPU · Cocina y despacho
            </p>
            <h1 className="mt-2 text-3xl font-semibold">
              Cada pedido, a su tiempo
            </h1>
            <p className="mt-2 text-sm text-zinc-500">
              Actualización cada 15 segundos · Horario de Bolivia
            </p>
          </div>
          <div className="flex gap-2">
            <button className={control} onClick={() => void reload()}>
              Actualizar tablero
            </button>
            <Link className={control} href="/restaurant/production">
              Tandas
            </Link>
            <Link className={control} href="/restaurant/pos">
              Ir a caja →
            </Link>
          </div>
        </header>
        {(error || loadError) && (
          <p role="alert" className="rounded-xl bg-red-50 p-4 text-red-800">
            {error || loadError}
          </p>
        )}
        <div className="flex flex-wrap gap-3">
          <label className="text-sm">
            Sucursal
            <select
              className={`${control} ml-2`}
              value={branchId}
              onChange={(e) => setBranchId(e.target.value)}
            >
              <option value="">Todas</option>
              {branches.map((branch) => (
                <option key={branch.id} value={branch.id}>
                  {branch.name}
                </option>
              ))}
            </select>
          </label>
          <label className="text-sm">
            Estación
            <select
              className={`${control} ml-2`}
              aria-label="Filtrar por estación"
              value={station}
              onChange={(e) => setStation(e.target.value)}
            >
              <option value="">Todas</option>
              {stations.map((station) => (
                <option key={station}>{station}</option>
              ))}
            </select>
          </label>
          <label className="text-sm">
            Estado
            <select
              className={`${control} ml-2`}
              value={status}
              onChange={(e) => setStatus(e.target.value)}
            >
              <option value="">En servicio</option>
              {["QUEUED", "PREPARING", "READY", "DELIVERED", "CANCELLED"].map(
                (value) => (
                  <option value={value} key={value}>
                    {orderLabels[value]}
                  </option>
                ),
              )}
            </select>
          </label>
        </div>
        {loading && !orders.length && <p role="status">Cargando comandas…</p>}
        <div
          className={`grid items-start gap-5 ${columns.length > 1 ? "xl:grid-cols-3" : ""}`}
        >
          {columns.map((column) => (
            <section
              className="rounded-2xl bg-zinc-100 p-3"
              key={column}
              aria-label={orderLabels[column]}
            >
              <h2 className="mb-3 flex justify-between px-2 font-semibold">
                {orderLabels[column]}
                <span className="text-zinc-500">
                  {visible.filter((o) => cardStatus(o) === column).length}
                </span>
              </h2>
              <div className="space-y-3">
                {visible
                  .filter((order) => cardStatus(order) === column)
                  .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
                  .map((order) => (
                    <article
                      key={order.id}
                      className="space-y-4 rounded-xl border border-zinc-200 bg-white p-4 shadow-sm"
                      aria-label={`Pedido ${order.id.slice(-6)}`}
                    >
                      <header className="flex justify-between gap-2">
                        <div>
                          <h3 className="text-lg font-semibold">
                            #{order.id.slice(-6).toUpperCase()}
                          </h3>
                          <p className="text-xs text-zinc-500">
                            {businessTime(order.queuedAt || order.createdAt)} ·{" "}
                            {minutes(
                              order.queuedAt || order.createdAt,
                              order.deliveredAt,
                            )}{" "}
                            min en cocina
                          </p>
                        </div>
                        <span
                          className={`self-start rounded-full px-3 py-1 text-xs font-medium ${order.service === "TAKEAWAY" ? "bg-amber-50 text-amber-900" : "bg-emerald-50 text-emerald-900"}`}
                        >
                          {order.service === "TAKEAWAY"
                            ? "Para llevar"
                            : "Salón"}
                        </span>
                      </header>
                      {order.account && <p className="font-semibold">{order.account.table.name} · {order.account.label}<span className="block text-xs font-normal">{order.account.waiterName} · {order.sale.status === "PAID" ? "Cobrado" : "Cuenta abierta"}</span></p>}
                      {order.customerName && (
                        <p className="text-sm font-medium">
                          {order.customerName}
                        </p>
                      )}
                      <ul className="space-y-3">
                        {order.snapshot
                          .filter(
                            (line) => !station || line.station === station,
                          )
                          .map((line, index) => (
                            <li key={index}>
                              <p className="font-semibold">
                                {line.quantity} × {line.name}
                              </p>
                              <p className="text-xs text-zinc-500">
                                {line.station}
                              </p>
                              {line.options.map((option) => (
                                <p
                                  className="mt-1 text-sm text-emerald-900"
                                  key={option.id}
                                >
                                  + {option.name}
                                </p>
                              ))}
                            </li>
                          ))}
                      </ul>
                      {order.notes && (
                        <p className="rounded-lg bg-amber-50 p-3 text-sm text-amber-950">
                          {order.notes}
                        </p>
                      )}
                      <div className="space-y-2 border-t border-zinc-100 pt-3">
                        {order.tasks
                          .filter(
                            (task) => !station || task.station === station,
                          )
                          .map((task) => (
                            <div
                              key={task.id}
                              className="rounded-lg bg-zinc-50 p-2 text-sm"
                            >
                              <p className="font-medium">
                                {task.station} ·{" "}
                                {orderLabels[task.status] ?? task.status}
                              </p>
                              {task.startedAt && (
                                <p className="text-xs text-zinc-500">
                                  Inicio: {businessTime(task.startedAt)} ·{" "}
                                  {minutes(task.startedAt, task.readyAt)} min
                                  {task.readyAt
                                    ? ` · Listo: ${businessTime(task.readyAt)}`
                                    : ""}
                                </p>
                              )}
                              {!station &&
                                order.tasks.length > 1 &&
                                ["QUEUED", "PREPARING"].includes(task.status) &&
                                !["CANCELLED", "DELIVERED"].includes(
                                  order.status,
                                ) && (
                                  <button
                                    disabled={
                                      stationAction.submitting || loading
                                    }
                                    className={`${control} mt-2 w-full`}
                                    onClick={() =>
                                      stationAction.onSubmit(
                                        order,
                                        task.station,
                                        task.status === "QUEUED"
                                          ? "PREPARING"
                                          : "READY",
                                      )
                                    }
                                  >
                                    {task.status === "QUEUED"
                                      ? `Iniciar ${task.station}`
                                      : `Listo ${task.station}`}
                                  </button>
                                )}
                            </div>
                          ))}
                      </div>
                      <div className="flex flex-wrap gap-2">
                        {["QUEUED", "PREPARING", "READY"].includes(column) &&
                          (order.tasks.length <= 1 ||
                            station ||
                            order.status === "READY") &&
                          (column !== "READY" || order.status === "READY") && (
                            <button
                              disabled={action.submitting || loading}
                              className={`${primary} flex-1`}
                              onClick={() =>
                                action.onSubmit(
                                  order,
                                  column === "QUEUED"
                                    ? "PREPARING"
                                    : column === "PREPARING"
                                      ? "READY"
                                      : "DELIVERED",
                                )
                              }
                            >
                              {column === "QUEUED"
                                ? "Iniciar preparación"
                                : column === "PREPARING"
                                  ? "Marcar listo"
                                  : "Entregar pedido"}
                            </button>
                          )}
                        <button
                          disabled={print.submitting}
                          className={control}
                          onClick={() => print.onSubmit(order)}
                        >
                          {(
                            station
                              ? order.tasks.find(
                                  (task) => task.station === station,
                                )?.printCount
                              : order.printCount
                          )
                            ? "Reimprimir"
                            : "Imprimir"}
                        </button>
                        <Link
                          className={`${control} text-center text-sm`}
                          href={`/sales/${order.saleId}`}
                        >
                          Ver venta
                        </Link>
                      </div>
                    </article>
                  ))}
                {!visible.some((o) => cardStatus(o) === column) && (
                  <p className="px-2 py-8 text-sm text-zinc-500">
                    Sin pedidos en este estado.
                  </p>
                )}
              </div>
            </section>
          ))}
        </div>
        <p className="text-xs text-zinc-500">
          Se muestran hasta 100 pedidos por consulta. Las impresiones registran
          la solicitud y el número de copia; confirma la salida en tu impresora.
        </p>
      </div>
      {ticket && <OrderTicket order={ticket} />}
    </AppShell>
  );
}
