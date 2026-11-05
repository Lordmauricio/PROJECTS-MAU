"use client";
import type { RestaurantOrder } from "@/lib/restaurant";
import { businessTime } from "@/lib/restaurant";

export default function OrderTicket({ order }: { order: RestaurantOrder }) {
  return (
    <section className="order-ticket hidden print:block">
      <h1>KIPU · Comanda {order.id.slice(-8).toUpperCase()}</h1>
      <p>
        {order.printCount > 1
          ? `REIMPRESIÓN · Copia ${order.printCount}`
          : "ORIGINAL · Copia 1"}
      </p>
      <p>
        {businessTime(order.createdAt)} ·{" "}
        {order.service === "DINE_IN" ? "Salón" : "Para llevar"}
      </p>
      {order.customerName && <p>{order.customerName}</p>}
      {order.snapshot.map((line, index) => (
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
