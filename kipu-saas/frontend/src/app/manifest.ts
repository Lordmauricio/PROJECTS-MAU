import type { MetadataRoute } from "next";

/**
 * Offline 4.14.1 — Web App Manifest.
 *
 * Se usa la ruta de metadatos `app/manifest.ts` de Next (servida en
 * `/manifest.webmanifest`) en vez de un archivo suelto en `public/`: es la
 * vía oficial del App Router, queda tipada contra la especificación y se
 * sirve con el `Content-Type` correcto sin configurar nada — CERO cambios a
 * `next.config.ts`.
 *
 * La identidad visual NO se inventa: `theme_color` es el `zinc-900`
 * (#18181b) del sidebar y de la barra superior móvil de `AppShell`, y
 * `background_color` es el `zinc-50` (#fafafa) que `layout.tsx` ya aplica al
 * `<body>`. Así la pantalla de arranque de Android y la barra de estado
 * coinciden exactamente con la app que se abre a continuación, sin ese
 * parpadeo blanco que delata una PWA mal configurada.
 *
 * `start_url: "/"` apunta a `app/page.tsx`, que redirige a `/dashboard` o a
 * `/login` según haya sesión persistida. Es deliberado: es la MISMA puerta de
 * entrada que usa la web, así que la app instalada no necesita un camino
 * propio que pueda divergir. El Service Worker (4.14.2) precachea `/` junto
 * con las rutas prioritarias justamente para que esa decisión funcione sin
 * conexión.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/",
    name: "KIPU SAAS",
    short_name: "KIPU",
    description: "Plataforma de gestión empresarial para negocios en Bolivia",
    lang: "es",
    start_url: "/",
    scope: "/",
    display: "standalone",
    // Sin bloquear la orientación: el POS se usa en vertical en un teléfono y
    // en horizontal en una tablet o en Windows, y es la misma pantalla.
    orientation: "any",
    background_color: "#fafafa",
    theme_color: "#18181b",
    categories: ["business", "productivity", "finance"],
    icons: [
      {
        src: "/icons/icon-192.png",
        sizes: "192x192",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/icons/icon-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "any",
      },
      // Android recorta el icono a la forma del lanzador (círculo, squircle,
      // etc.). El icono `maskable` lleva el wordmark reducido para que quede
      // entero dentro de la zona segura del 80% y no se le coman las letras.
      {
        src: "/icons/icon-maskable-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  };
}
