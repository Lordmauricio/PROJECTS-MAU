"use client";

import { useCallback, useRef, useState } from "react";

/**
 * Evita que un formulario se envíe dos veces.
 *
 * El problema real que resuelve: en las pantallas de datos maestros
 * (clientes, proveedores, productos, categorías, unidades, almacenes,
 * usuarios) un doble click creaba dos registros. A diferencia de los flujos
 * de dinero — ventas, pagos, caja, compras —, que están protegidos en el
 * backend con `idempotencyKey` y locks, estos endpoints son un POST simple:
 * dos requests idénticos son dos altas legítimas desde el punto de vista del
 * servidor, porque un negocio SÍ puede tener dos clientes con el mismo
 * nombre.
 *
 * Por eso la protección va acá y no en el backend: no se puede distinguir
 * "doble click" de "dos altas reales" mirando solo el payload. Lo que sí se
 * puede es impedir que un mismo formulario dispare dos veces mientras el
 * primer envío sigue en vuelo.
 *
 * Usa un `ref` además del estado porque `setState` es asíncrono: dos clicks
 * en el mismo tick de React leerían ambos `submitting === false` y pasarían
 * los dos. El `ref` se actualiza de forma síncrona y cierra esa ventana.
 */
export function useSubmitGuard<Args extends unknown[]>(
  handler: (...args: Args) => Promise<void>
): { submitting: boolean; onSubmit: (...args: Args) => Promise<void> } {
  const [submitting, setSubmitting] = useState(false);
  const inFlight = useRef(false);

  const onSubmit = useCallback(
    async (...args: Args) => {
      if (inFlight.current) return;
      inFlight.current = true;
      setSubmitting(true);
      try {
        await handler(...args);
      } finally {
        inFlight.current = false;
        setSubmitting(false);
      }
    },
    [handler]
  );

  return { submitting, onSubmit };
}
