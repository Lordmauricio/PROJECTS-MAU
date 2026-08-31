import { readFileSync } from "node:fs";
import path from "node:path";

/**
 * Banco de pruebas del Service Worker (Offline 4.14.2).
 *
 * Carga y EJECUTA el `public/sw.js` real dentro de un scope simulado, en vez
 * de reimplementar sus reglas en el test. Es la diferencia entre probar el
 * comportamiento y probar una copia del comportamiento: si alguien cambia una
 * regla de caché en `sw.js`, estos tests lo ven. El archivo se carga con
 * `new Function`, cuyos parámetros (`self`, `caches`, `fetch`) TAPAN los
 * globales dentro del cuerpo del worker, así que el SW habla con estos dobles
 * sin saberlo y sin necesitar ningún gancho de test dentro del código de
 * producción.
 */

const SW_PATH = path.join(__dirname, "..", "..", "..", "..", "public", "sw.js");

export const ORIGIN = "https://kipu.local";
export const API_ORIGIN = "https://api.kipu.local";

function keyOf(request: Request | string): string {
  return typeof request === "string" ? new URL(request, ORIGIN).href : request.url;
}

/**
 * Una petición de navegación — la que el navegador emite al escribir una URL,
 * recargar, o abrir la PWA desde el icono. `new Request(url, {mode:"navigate"})`
 * está prohibido por la especificación (solo el navegador puede crearlas), así
 * que se define `mode` sobre la instancia: el SW lee `request.mode` y ve
 * exactamente lo mismo que vería en el navegador.
 */
export function navigationRequest(url: string): Request {
  const request = new Request(url);
  Object.defineProperty(request, "mode", { value: "navigate", configurable: true });
  return request;
}

/** Cache en memoria fiel a la API real: `match` devuelve SIEMPRE una Response nueva. */
class MemCache {
  readonly entries = new Map<string, Response>();

  async put(request: Request | string, response: Response) {
    this.entries.set(keyOf(request), response);
  }
  async match(request: Request | string) {
    const hit = this.entries.get(keyOf(request));
    // La Cache API real entrega una copia en cada `match`; devolver el mismo
    // objeto haría que un segundo lector encontrara el cuerpo ya consumido y
    // ocultaría bugs que sí aparecen en el navegador.
    return hit ? hit.clone() : undefined;
  }
  async delete(request: Request | string) {
    return this.entries.delete(keyOf(request));
  }
  async keys() {
    return [...this.entries.keys()].map((u) => new Request(u));
  }
}

class MemCacheStorage {
  readonly stores = new Map<string, MemCache>();

  async open(name: string) {
    let store = this.stores.get(name);
    if (!store) {
      store = new MemCache();
      this.stores.set(name, store);
    }
    return store;
  }
  async match(request: Request | string) {
    for (const store of this.stores.values()) {
      const hit = await store.match(request);
      if (hit) return hit;
    }
    return undefined;
  }
  async keys() {
    return [...this.stores.keys()];
  }
  async delete(name: string) {
    return this.stores.delete(name);
  }
  /** Todas las URLs guardadas, sin importar en qué caché — para auditar fugas. */
  allCachedUrls(): string[] {
    return [...this.stores.values()].flatMap((s) => [...s.entries.keys()]);
  }
}

export type FetchLog = { url: string; method: string };

export interface Harness {
  caches: MemCacheStorage;
  fetchLog: FetchLog[];
  /** Dispara el handler `install` y espera a que termine su `waitUntil`. */
  install(): Promise<void>;
  /** Dispara `activate` y espera. */
  activate(): Promise<void>;
  /**
   * Dispara `fetch`. Devuelve `null` cuando el SW decide NO responder
   * (passthrough) — que es justo lo que hay que comprobar para los POST.
   */
  handleFetch(request: Request): Promise<Response | null>;
  api: {
    chooseStrategy(request: Request): string;
    isCacheable(response: Response): boolean;
    extractStaticRefs(text: string): Set<string>;
    VERSION: string;
  };
}

export interface HarnessOptions {
  /** Respuestas por ruta (path o URL absoluta). `null` = fallo de red. */
  routes?: Record<string, { body: string; type?: string; status?: number } | null>;
  /** Si es true, TODO `fetch` falla: simula estar sin conexión. */
  offline?: boolean;
}

export function loadServiceWorker(options: HarnessOptions = {}): Harness {
  const cacheStorage = new MemCacheStorage();
  const fetchLog: FetchLog[] = [];
  const listeners: Record<string, ((event: unknown) => void)[]> = {};

  const fetchImpl = async (input: Request | string): Promise<Response> => {
    const url = keyOf(input);
    const method = typeof input === "string" ? "GET" : input.method;
    fetchLog.push({ url, method });
    if (options.offline) throw new TypeError("Failed to fetch");

    const pathname = new URL(url).pathname;
    const entry = options.routes?.[url] ?? options.routes?.[pathname];
    if (entry === null) throw new TypeError("Failed to fetch");
    if (entry === undefined) return new Response("no encontrado", { status: 404 });
    return new Response(entry.body, {
      status: entry.status ?? 200,
      headers: { "content-type": entry.type ?? "text/html" },
    });
  };

  const self = {
    location: new URL(ORIGIN),
    clients: { claim: async () => {} },
    skipWaiting: () => {},
    addEventListener(type: string, handler: (event: unknown) => void) {
      (listeners[type] ??= []).push(handler);
    },
  } as Record<string, unknown>;

  const source = readFileSync(SW_PATH, "utf8");
  new Function("self", "caches", "fetch", source)(self, cacheStorage, fetchImpl);

  async function dispatch(type: string, event: Record<string, unknown>) {
    const pending: Promise<unknown>[] = [];
    const enriched = {
      ...event,
      waitUntil: (p: Promise<unknown>) => pending.push(p),
      respondWith: (p: Promise<Response>) => pending.push(p),
    };
    for (const handler of listeners[type] ?? []) handler(enriched);
    return { enriched, pending };
  }

  return {
    caches: cacheStorage,
    fetchLog,
    api: self.__kipuSw as Harness["api"],
    async install() {
      const { pending } = await dispatch("install", {});
      await Promise.all(pending);
    },
    async activate() {
      const { pending } = await dispatch("activate", {});
      await Promise.all(pending);
    },
    async handleFetch(request: Request) {
      let responded: Promise<Response> | null = null;
      const event = {
        request,
        waitUntil: () => {},
        respondWith: (p: Promise<Response>) => {
          responded = p;
        },
      };
      for (const handler of listeners["fetch"] ?? []) handler(event);
      return responded ? await responded : null;
    },
  };
}
