"use client";

import { useEffect } from "react";

/**
 * Offline 4.14.2 — registra el Service Worker del App Shell (`public/sw.js`).
 *
 * Se sirve desde `public/` y no como módulo empaquetado por Turbopack a
 * propósito: un worker servido desde `/_next/static/...` solo puede tomar
 * como alcance ese directorio salvo que el servidor mande la cabecera
 * `Service-Worker-Allowed`, y necesitamos alcance `/` para que el SW controle
 * `/login`, `/dashboard` y `/sales/pos`. Desde la raíz eso es automático.
 *
 * No renderiza nada: es solo el efecto de registro. Va en el layout raíz para
 * que cualquier pantalla por la que entre el usuario deje el App Shell
 * cacheado, no únicamente el POS.
 */
export function ServiceWorkerRegistrar() {
  useEffect(() => {
    if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return;

    // En desarrollo NO se registra: `next dev` sirve los módulos sin hash de
    // contenido y con recarga en caliente, así que un SW cacheando encima
    // produce exactamente el tipo de bug fantasma ("cambié el archivo y no se
    // ve") que cuesta horas encontrar. Además se desregistra cualquier SW que
    // hubiera quedado de una sesión de producción en el mismo `localhost`.
    if (process.env.NODE_ENV !== "production") {
      navigator.serviceWorker.getRegistrations().then((regs) => {
        for (const reg of regs) void reg.unregister();
      });
      return;
    }

    // `updateViaCache: "none"` evita que el propio `sw.js` quede cacheado por
    // el HTTP cache del navegador: sin esto, una versión nueva del worker
    // puede tardar hasta 24 h en detectarse.
    navigator.serviceWorker.register("/sw.js", { scope: "/", updateViaCache: "none" }).catch(() => {
      // Un fallo de registro NUNCA debe romper la app: sin Service Worker
      // KIPU sigue funcionando exactamente como antes de Offline 4.14 (online,
      // con toda la capa Dexie intacta). Solo se pierde el arranque sin
      // Internet. El caso más común no es un bug sino un contexto no seguro:
      // el navegador solo registra workers sobre HTTPS o localhost.
    });
  }, []);

  return null;
}
