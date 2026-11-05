"use client";
import type { RestaurantOrder } from "@/lib/restaurant";
import { businessTime, orderLabels } from "@/lib/restaurant";

export default function OrderTicket({ order }: { order: RestaurantOrder }) {
  const copy = order.printCopy ?? order.printCount;
  return (
    <section className="order-ticket hidden print:block">
      <h1>KIPU · Comanda {order.id.slice(-8).toUpperCase()}</h1>
      <p>{copy > 1 ? `REIMPRESIÓN · Copia ${copy}` : "ORIGINAL · Copia 1"}</p>
      <p>Estado: {orderLabels[order.status] ?? order.status}</p>
      {order.printStation && <p>Estación: {order.printStation}</p>}
      <p>
        {businessTime(order.createdAt)} ·{" "}
        {order.service === "DINE_IN" ? "Salón" : "Para llevar"}
      </p>
      {order.customerName && <p>{order.customerName}</p>}
      {order.snapshot
        .filter(
          (line) => !order.printStation || line.station === order.printStation,
        )
        .map((line, index) => (
          <div key={index}>
            <strong>
              {line.quantity} × {line.name}
            </strong>
            <p>{line.station}</p>
            {line.options.map((option) => (
              <p key={option.id}>+ {option.name}</p>
            ))}
          </div>
        ))}
      {order.notes && <p>Observaciones: {order.notes}</p>}
      <p>Comanda de cocina · No es factura ni recibo de pago</p>
    </section>
  );
}
