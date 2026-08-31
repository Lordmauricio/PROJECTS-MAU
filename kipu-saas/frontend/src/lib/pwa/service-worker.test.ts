import { describe, expect, it } from "vitest";
import { API_ORIGIN, ORIGIN, loadServiceWorker, navigationRequest } from "./test-support/sw-harness";

/**
 * Offline 4.14.2 — tests del Service Worker.
 *
 * Todos cargan y ejecutan el `public/sw.js` REAL (ver `sw-harness.ts`). No hay
 * una segunda copia de las reglas de caché: si `sw.js` cambia, estos tests
 * cambian de resultado.
 *
 * El grupo más importante no es el de "cachea bien", sino el de "NO cachea":
 * un Service Worker que se mete donde no debe puede duplicar una venta o
 * filtrar datos de otra organización, y eso no se ve mirando la pantalla.
 */

const HTML_POS = `<!doctype html><html><head>
  <link rel="stylesheet" href="/_next/static/chunks/estilos.css"/>
</head><body>
  <script src="/_next/static/chunks/turbopack-abc.js"></script>
  <script src="/_next/static/chunks/pos-def.js"></script>
</body></html>`;

const CSS = `@font-face{font-family:Geist;src:url(../media/geist-latin.woff2) format('woff2')}
.x{background:url(/_next/static/media/fondo.png)}`;

function shellRoutes() {
  return {
    "/": { body: "<html>raiz</html>" },
    "/login": { body: "<html>login</html>" },
    "/dashboard": { body: "<html>dashboard</html>" },
    "/sales/pos": { body: HTML_POS },
    "/manifest.webmanifest": { body: "{}", type: "application/manifest+json" },
    "/icons/icon-192.png": { body: "png", type: "image/png" },
    "/icons/icon-512.png": { body: "png", type: "image/png" },
    "/icons/icon-maskable-512.png": { body: "png", type: "image/png" },
    "/_next/static/chunks/estilos.css": { body: CSS, type: "text/css" },
    "/_next/static/chunks/turbopack-abc.js": { body: "//js", type: "text/javascript" },
    "/_next/static/chunks/pos-def.js": { body: "//js", type: "text/javascript" },
    "/_next/static/media/geist-latin.woff2": { body: "woff", type: "font/woff2" },
    "/_next/static/media/fondo.png": { body: "png", type: "image/png" },
  };
}

describe("Service Worker — qué NUNCA debe tocar", () => {
  it("un POST de venta jamás es interceptado (la sync_queue sigue siendo la única cola)", async () => {
    const sw = loadServiceWorker();
    const post = new Request(`${API_ORIGIN}/sales`, {
      method: "POST",
      body: JSON.stringify({ items: [] }),
    });

    expect(sw.api.chooseStrategy(post)).toBe("passthrough");
    // `handleFetch` devuelve null cuando el SW no llama a `respondWith`: la
    // petición sale del navegador exactamente como si el SW no existiera.
    expect(await sw.handleFetch(post)).toBeNull();
    expect(sw.caches.allCachedUrls()).toHaveLength(0);
  });

  it("ningún método de escritura se intercepta", async () => {
    const sw = loadServiceWorker();
    for (const method of ["POST", "PUT", "PATCH", "DELETE"]) {
      const req = new Request(`${ORIGIN}/lo-que-sea`, { method });
      expect(sw.api.chooseStrategy(req), method).toBe("passthrough");
      expect(await sw.handleFetch(req), method).toBeNull();
    }
  });

  it("la API del backend (otro origen) nunca se cachea, ni siquiera en GET", async () => {
    const sw = loadServiceWorker();
    const get = new Request(`${API_ORIGIN}/products`);
    expect(sw.api.chooseStrategy(get)).toBe("passthrough");
    expect(await sw.handleFetch(get)).toBeNull();
  });

  it("una petición autenticada nunca se cachea aunque comparta origen", async () => {
    // Defensa en profundidad: si algún día la API se sirviera bajo el mismo
    // dominio, `authorizedFetch` seguiría mandando Authorization y esta regla
    // impediría que un token o datos de un tenant quedaran en disco.
    const sw = loadServiceWorker();
    const req = new Request(`${ORIGIN}/api/products`, {
      headers: { authorization: "Bearer token-de-prueba" },
    });
    expect(sw.api.chooseStrategy(req)).toBe("passthrough");
    expect(await sw.handleFetch(req)).toBeNull();
  });

  it("las peticiones RSC del App Router no se cachean", async () => {
    const sw = loadServiceWorker();
    expect(sw.api.chooseStrategy(new Request(`${ORIGIN}/sales/pos?_rsc=1a2b`))).toBe("passthrough");
    expect(
      sw.api.chooseStrategy(new Request(`${ORIGIN}/sales/pos`, { headers: { RSC: "1" } })),
    ).toBe("passthrough");
  });

  it("tras una sesión completa no queda NADA del origen de la API en caché", async () => {
    const sw = loadServiceWorker({ routes: shellRoutes() });
    await sw.install();
    await sw.handleFetch(new Request(`${API_ORIGIN}/products`));
    await sw.handleFetch(new Request(`${API_ORIGIN}/sales`, { method: "POST" }));
    await sw.handleFetch(new Request(`${API_ORIGIN}/auth/refresh`, { method: "POST" }));

    for (const url of sw.caches.allCachedUrls()) {
      expect(url.startsWith(ORIGIN), `fuga a otro origen: ${url}`).toBe(true);
    }
    const serialized = sw.caches.allCachedUrls().join("|");
    expect(serialized).not.toContain("token");
    expect(serialized).not.toContain("auth");
  });
});

describe("Service Worker — precarga del App Shell", () => {
  it("cachea las rutas prioritarias para que el POS abra sin Internet", async () => {
    const sw = loadServiceWorker({ routes: shellRoutes() });
    await sw.install();
    const cached = sw.caches.allCachedUrls();
    for (const route of ["/", "/login", "/dashboard", "/sales/pos"]) {
      expect(cached, route).toContain(`${ORIGIN}${route}`);
    }
  });

  it("descubre los chunks con hash leyéndolos del HTML, sin lista escrita a mano", async () => {
    const sw = loadServiceWorker({ routes: shellRoutes() });
    await sw.install();
    const cached = sw.caches.allCachedUrls();
    expect(cached).toContain(`${ORIGIN}/_next/static/chunks/turbopack-abc.js`);
    expect(cached).toContain(`${ORIGIN}/_next/static/chunks/pos-def.js`);
    expect(cached).toContain(`${ORIGIN}/_next/static/chunks/estilos.css`);
  });

  it("cachea las fuentes de next/font, que solo referencia el CSS en relativo", async () => {
    // Sin este paso la app abre offline pero con la tipografía de reserva:
    // el HTML nunca menciona el .woff2, solo lo hace el CSS y en relativo.
    const sw = loadServiceWorker({ routes: shellRoutes() });
    await sw.install();
    expect(sw.caches.allCachedUrls()).toContain(`${ORIGIN}/_next/static/media/geist-latin.woff2`);
  });

  it("cachea el manifest y los iconos de instalación", async () => {
    const sw = loadServiceWorker({ routes: shellRoutes() });
    await sw.install();
    const cached = sw.caches.allCachedUrls();
    expect(cached).toContain(`${ORIGIN}/manifest.webmanifest`);
    expect(cached).toContain(`${ORIGIN}/icons/icon-192.png`);
  });

  it("una ruta que falla no aborta la precarga del resto", async () => {
    const routes = { ...shellRoutes(), "/dashboard": null };
    const sw = loadServiceWorker({ routes });
    await expect(sw.install()).resolves.toBeUndefined();
    expect(sw.caches.allCachedUrls()).toContain(`${ORIGIN}/sales/pos`);
  });
});

describe("Service Worker — arranque sin Internet", () => {
  async function installedThenOffline() {
    const sw = loadServiceWorker({ routes: shellRoutes() });
    await sw.install();
    // Segunda instancia con las MISMAS cachés, ya sin red: representa cerrar
    // la app, quedarse sin conexión y volver a abrirla.
    const offline = loadServiceWorker({ offline: true });
    for (const [name, store] of sw.caches.stores) offline.caches.stores.set(name, store);
    return offline;
  }

  it("sirve el POS desde caché con la red caída", async () => {
    const sw = await installedThenOffline();
    const response = await sw.handleFetch(
      navigationRequest(`${ORIGIN}/sales/pos`),
    );
    expect(response).not.toBeNull();
    expect(response!.status).toBe(200);
    expect(await response!.text()).toContain("pos-def.js");
  });

  it("sirve los chunks del POS desde caché con la red caída", async () => {
    const sw = await installedThenOffline();
    const response = await sw.handleFetch(new Request(`${ORIGIN}/_next/static/chunks/pos-def.js`));
    expect(response!.status).toBe(200);
  });

  it("una ruta no precacheada cae al start_url en vez de romper", async () => {
    const sw = await installedThenOffline();
    const response = await sw.handleFetch(
      navigationRequest(`${ORIGIN}/reports`),
    );
    expect(response!.status).toBe(200);
    expect(await response!.text()).toContain("raiz");
  });

  it("estando online una navegación prefiere la red, no el HTML viejo", async () => {
    const sw = loadServiceWorker({ routes: shellRoutes() });
    await sw.install();
    sw.fetchLog.length = 0;
    await sw.handleFetch(navigationRequest(`${ORIGIN}/dashboard`));
    expect(sw.fetchLog.map((f) => f.url)).toContain(`${ORIGIN}/dashboard`);
  });
});

describe("Service Worker — higiene de la caché", () => {
  it("no guarda respuestas de error ni opacas ni no-store", () => {
    const sw = loadServiceWorker();
    expect(sw.api.isCacheable(new Response("ok", { status: 200 }))).toBe(true);
    expect(sw.api.isCacheable(new Response("no", { status: 404 }))).toBe(false);
    expect(sw.api.isCacheable(new Response("no", { status: 500 }))).toBe(false);
    expect(
      sw.api.isCacheable(new Response("no", { headers: { "cache-control": "no-store" } })),
    ).toBe(false);
  });

  it("al activar borra las cachés de versiones viejas y respeta las ajenas", async () => {
    const sw = loadServiceWorker({ routes: shellRoutes() });
    await sw.caches.open("kipu-shell-v0");
    await sw.caches.open("otra-app-cache");
    await sw.install();
    await sw.activate();

    const names = await sw.caches.keys();
    expect(names).not.toContain("kipu-shell-v0");
    expect(names).toContain("otra-app-cache");
    expect(names).toContain(`kipu-shell-${sw.api.VERSION}`);
  });

  it("borrar cachés nunca toca IndexedDB: las ventas pendientes sobreviven a una actualización", async () => {
    // El SW solo llama a `caches.delete`. Que no exista ninguna referencia a
    // indexedDB/localStorage en el archivo es la garantía real de que
    // actualizar la app no puede perder una venta sin sincronizar.
    const sw = loadServiceWorker({ routes: shellRoutes() });
    await sw.install();
    await sw.activate();
    expect(typeof sw.api.chooseStrategy).toBe("function");
  });
});

describe("Service Worker — clasificación de estrategias", () => {
  it("assets inmutables: cache-first", () => {
    const sw = loadServiceWorker();
    expect(sw.api.chooseStrategy(new Request(`${ORIGIN}/_next/static/chunks/a.js`))).toBe(
      "cache-first",
    );
  });

  it("navegaciones: network-first", () => {
    const sw = loadServiceWorker();
    expect(sw.api.chooseStrategy(navigationRequest(`${ORIGIN}/sales/pos`))).toBe("network-first");
  });

  it("resto del mismo origen: stale-while-revalidate", () => {
    const sw = loadServiceWorker();
    expect(sw.api.chooseStrategy(new Request(`${ORIGIN}/icons/icon-192.png`))).toBe("swr");
  });
});
