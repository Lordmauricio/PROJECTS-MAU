/**
 * KIPU — Service Worker del App Shell (Offline 4.14.2).
 *
 * ÚNICO objetivo: que la app ARRANQUE sin Internet. La documentación de
 * Next 16 lo dice explícitamente ("a full page reload while offline still
 * fails because the browser needs the network to deliver the HTML; full
 * offline loads would need a service worker"), y era exactamente el hueco
 * que quedaba: Offline 1–4.6B dejaron construido todo lo que pasa DESPUÉS
 * de que la app abre (catálogo, venta, cola, PDF), pero nada de eso se
 * ejecuta si el navegador no puede entregar el HTML.
 *
 * QUÉ NO HACE ESTE ARCHIVO, deliberadamente:
 *
 * - NO guarda datos de negocio. Productos, clientes, ventas, cola de
 *   sincronización y contexto local siguen viviendo SOLO en Dexie/IndexedDB
 *   (`lib/offline/db.ts`). Acá no hay una segunda base de datos ni una copia
 *   de nada comercial.
 * - NO intercepta operaciones. Cualquier petición que no sea GET sale del
 *   handler sin tocarse (ver `fetch`), así que un POST de venta nunca pasa
 *   por caché ni por una cola paralela. La `sync_queue` de Offline 2 sigue
 *   siendo la única fuente de verdad de las operaciones offline.
 * - NO usa Background Sync. Reintentar la sincronización ya es trabajo del
 *   Sync Engine (`auto-sync.ts`), y duplicarlo acá abriría la puerta a dos
 *   motores compitiendo por la misma cola.
 * - NO cachea la API. El backend vive en otro origen
 *   (`NEXT_PUBLIC_API_URL`), y todo lo que no sea del propio origen sale
 *   directo. Además, por defensa en profundidad, tampoco se cachea ninguna
 *   petición que lleve cabecera `Authorization`, por si algún día la API
 *   pasara a compartir origen con el frontend.
 */

// Subir esta versión invalida TODAS las cachés anteriores (ver `activate`).
const VERSION = "v1";
const SHELL_CACHE = `kipu-shell-${VERSION}`;
const ASSET_CACHE = `kipu-assets-${VERSION}`;
const OWNED_CACHES = [SHELL_CACHE, ASSET_CACHE];

/**
 * Rutas que deben poder abrirse sin conexión. Es deliberadamente corto: la
 * prioridad de esta fase es "instalar → abrir sin Internet → vender", no
 * dejar las 30 pantallas disponibles offline. `/` entra porque es el
 * `start_url` del manifest (redirige a /dashboard o /login según sesión).
 *
 * Las tres rutas de negocio son estáticas en el build de Next (`○` en la
 * salida de `next build`), así que su HTML es un archivo prerenderizado y
 * precachearlo no depende del servidor en runtime.
 */
const PRECACHE_ROUTES = ["/", "/login", "/dashboard", "/sales/pos"];

/** Recursos sueltos que la instalación necesita para verse bien. */
const PRECACHE_ASSETS = [
  "/manifest.webmanifest",
  "/icons/icon-192.png",
  "/icons/icon-512.png",
  "/icons/icon-maskable-512.png",
];

/** Prefijo de los archivos con hash de contenido que emite Turbopack. */
const IMMUTABLE_PREFIX = "/_next/static/";

// ---------------------------------------------------------------------------
// Reglas de decisión
// ---------------------------------------------------------------------------

/**
 * Una petición RSC es la carga de datos de una navegación *soft* del App
 * Router (`?_rsc=...` o cabecera `RSC`). NUNCA se cachea: su cuerpo es un
 * flujo ligado a un build concreto y servirlo viejo rompe el enrutado de
 * formas difíciles de diagnosticar. Se deja fallar sin conexión, y Next cae
 * a una navegación dura — que sí resolvemos desde caché.
 */
function isRscRequest(request, url) {
  return request.headers.get("RSC") === "1" || url.searchParams.has("_rsc");
}

/**
 * Decide qué hacer con una petición. Función pura y exportada al scope del
 * worker a propósito: es la pieza que los tests ejercitan directamente,
 * sobre ESTE archivo, sin reimplementar las reglas en otro lado.
 *
 * Devuelve uno de:
 *   "passthrough"  → el SW no responde; el navegador hace lo de siempre.
 *   "cache-first"  → caché y, si no está, red (recursos inmutables).
 *   "network-first"→ red y, si falla, caché (navegaciones).
 *   "swr"          → caché inmediata + revalidación en segundo plano.
 */
function chooseStrategy(request) {
  // 1. Todo lo que no sea GET sale intacto. Acá es donde queda garantizado
  //    que un POST /sales jamás es interceptado ni encolado por el SW.
  if (request.method !== "GET") return "passthrough";

  const url = new URL(request.url);

  // 2. Otro origen = la API del backend. Nunca se cachea, ni siquiera un GET.
  if (url.origin !== self.location.origin) return "passthrough";

  // 3. Defensa en profundidad: una petición autenticada nunca se cachea,
  //    aunque comparta origen. Cubre el caso de que la API pase algún día a
  //    servirse bajo el mismo dominio que el frontend.
  if (request.headers.get("authorization")) return "passthrough";

  // 4. Datos de navegación del App Router: red, sin cachear nunca.
  if (isRscRequest(request, url)) return "passthrough";

  // 5. Assets con hash de contenido: el nombre cambia si cambia el archivo,
  //    así que la caché no puede quedar obsoleta.
  if (url.pathname.startsWith(IMMUTABLE_PREFIX)) return "cache-first";

  // 6. Navegaciones: red primero para no servir un HTML viejo estando online,
  //    caché como red de seguridad cuando no hay conexión.
  if (request.mode === "navigate") return "network-first";

  // 7. Resto del mismo origen (iconos, manifest, favicon...).
  return "swr";
}

/** Solo se guardan respuestas que de verdad sirven para reconstruir la app. */
function isCacheable(response) {
  if (!response || !response.ok) return false;
  // `opaque`/`opaqueredirect` no se pueden inspeccionar: guardarlas es
  // guardar algo que no sabemos qué es.
  if (response.type === "opaque" || response.type === "opaqueredirect") return false;
  const cc = response.headers.get("cache-control") || "";
  if (cc.includes("no-store")) return false;
  return true;
}

// ---------------------------------------------------------------------------
// Precarga del App Shell
// ---------------------------------------------------------------------------

/**
 * Turbopack emite los chunks con el hash del contenido en el nombre
 * (`/_next/static/chunks/08ttfj81-47mu.js`), así que una lista de precarga
 * escrita a mano quedaría obsoleta en el primer build. En vez de eso se
 * descarga el HTML de cada ruta y se extraen SUS PROPIAS referencias: la
 * lista se regenera sola en cada despliegue, sin tocar el pipeline de build.
 */
function extractStaticRefs(text) {
  const refs = new Set();
  const re = /\/_next\/static\/[A-Za-z0-9._@\-/]+/g;
  let match;
  while ((match = re.exec(text)) !== null) {
    refs.add(match[0]);
  }
  return refs;
}

/** Guarda una URL en la caché indicada; nunca lanza (un fallo no aborta todo). */
async function cacheUrl(cache, url) {
  try {
    const response = await fetch(url, { credentials: "same-origin" });
    if (isCacheable(response)) await cache.put(url, response.clone());
    return response;
  } catch {
    return null;
  }
}

async function precacheAppShell() {
  const shell = await caches.open(SHELL_CACHE);
  const assets = await caches.open(ASSET_CACHE);

  await Promise.all(PRECACHE_ASSETS.map((u) => cacheUrl(assets, u)));

  // Primer nivel: el HTML de cada ruta, y los `/_next/static/**` que ese
  // HTML referencia (JS y CSS).
  const cssUrls = new Set();
  const staticUrls = new Set();

  for (const route of PRECACHE_ROUTES) {
    const response = await cacheUrl(shell, route);
    if (!response) continue;
    for (const ref of extractStaticRefs(await response.clone().text())) {
      staticUrls.add(ref);
      if (ref.endsWith(".css")) cssUrls.add(ref);
    }
  }

  await Promise.all([...staticUrls].map((u) => cacheUrl(assets, u)));

  // Segundo nivel: las fuentes de `next/font` (Geist) viven en
  // `/_next/static/media/*.woff2` y las referencia el CSS, no el HTML. Sin
  // este paso la app abre offline pero con la tipografía de reserva.
  const fontUrls = new Set();
  for (const cssUrl of cssUrls) {
    const hit = await assets.match(cssUrl);
    if (!hit) continue;
    // Se lee UNA sola vez: el cuerpo de una Response se consume al leerlo.
    const css = await hit.text();
    for (const ref of extractStaticRefs(css)) {
      if (!staticUrls.has(ref)) fontUrls.add(ref);
    }
    // El CSS de `next/font` referencia las fuentes en relativo
    // (`url(../media/x.woff2)`), que el patrón absoluto de arriba no ve.
    for (const m of css.matchAll(/url\((?:"|')?\.\.\/(media\/[A-Za-z0-9._@-]+)/g)) {
      fontUrls.add(`${IMMUTABLE_PREFIX}${m[1]}`);
    }
  }

  await Promise.all([...fontUrls].map((u) => cacheUrl(assets, u)));
}

// ---------------------------------------------------------------------------
// Estrategias
// ---------------------------------------------------------------------------

async function cacheFirst(request) {
  const cached = await caches.match(request);
  if (cached) return cached;
  const response = await fetch(request);
  if (isCacheable(response)) {
    const cache = await caches.open(ASSET_CACHE);
    await cache.put(request, response.clone());
  }
  return response;
}

async function networkFirst(request) {
  try {
    const response = await fetch(request);
    if (isCacheable(response)) {
      const cache = await caches.open(SHELL_CACHE);
      await cache.put(request, response.clone());
    }
    return response;
  } catch (error) {
    const cached = await caches.match(request);
    if (cached) return cached;
    // Cualquier ruta no precacheada cae al `start_url`, que ya decide entre
    // /dashboard y /login según la sesión guardada. Es una degradación
    // honesta: nunca se inventa una pantalla que no existe.
    const fallback = await caches.match("/");
    if (fallback) return fallback;
    throw error;
  }
}

async function staleWhileRevalidate(request) {
  const cache = await caches.open(ASSET_CACHE);
  const cached = await cache.match(request);
  const network = fetch(request)
    .then((response) => {
      if (isCacheable(response)) cache.put(request, response.clone());
      return response;
    })
    .catch(() => null);
  if (cached) return cached;
  const response = await network;
  if (response) return response;
  throw new Error(`Sin conexión y sin copia en caché: ${request.url}`);
}

// ---------------------------------------------------------------------------
// Ciclo de vida
// ---------------------------------------------------------------------------

self.addEventListener("install", (event) => {
  event.waitUntil(precacheAppShell());
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      // Borra cachés de versiones anteriores de ESTE service worker. No toca
      // IndexedDB ni localStorage: las ventas pendientes nunca se pierden por
      // actualizar la app.
      const names = await caches.keys();
      await Promise.all(
        names
          .filter((n) => n.startsWith("kipu-") && !OWNED_CACHES.includes(n))
          .map((n) => caches.delete(n)),
      );
      await self.clients.claim();
    })(),
  );
});

self.addEventListener("fetch", (event) => {
  const strategy = chooseStrategy(event.request);
  // No llamar a `respondWith` deja la petición exactamente como estaba: el
  // navegador la ejecuta sin que el SW participe.
  if (strategy === "passthrough") return;

  if (strategy === "cache-first") event.respondWith(cacheFirst(event.request));
  else if (strategy === "network-first") event.respondWith(networkFirst(event.request));
  else event.respondWith(staleWhileRevalidate(event.request));
});

self.addEventListener("message", (event) => {
  // Permite que la página pida activar una versión nueva sin esperar a que se
  // cierren todas las pestañas. No se hace automático en `install`: activar un
  // SW nuevo bajo una página que ya cargó los chunks del build anterior puede
  // dejarla pidiendo archivos que ya no existen.
  if (event.data && event.data.type === "SKIP_WAITING") self.skipWaiting();
});

// Expuesto para los tests, que cargan ESTE archivo y ejercitan las reglas
// reales en vez de reimplementarlas.
self.__kipuSw = { chooseStrategy, isCacheable, extractStaticRefs, VERSION };
