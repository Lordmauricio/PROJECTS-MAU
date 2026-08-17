const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4200";

export class ApiError extends Error {
  constructor(public status: number, message: string, public details?: unknown) {
    super(message);
  }
}

function getToken(): string | null {
  if (typeof window === "undefined") return null;
  return localStorage.getItem("kipu_token");
}

export async function api<T = unknown>(
  path: string,
  options: { method?: string; body?: unknown; token?: string } = {}
): Promise<T> {
  const token = options.token ?? getToken();
  const res = await fetch(`${API_URL}${path}`, {
    method: options.method ?? "GET",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
  });

  if (res.status === 204) return undefined as T;

  const data = await res.json().catch(() => undefined);
  if (!res.ok) {
    const rawMessage = data?.message ?? data?.error ?? "Error de red";
    const message = Array.isArray(rawMessage) ? rawMessage.join(", ") : rawMessage;
    throw new ApiError(res.status, message, data);
  }
  return data as T;
}

/** Descarga un archivo (export CSV/Excel) autenticado y dispara el guardado en el navegador. */
export async function apiDownload(path: string, filename: string, token?: string): Promise<void> {
  const authToken = token ?? getToken();
  const res = await fetch(`${API_URL}${path}`, {
    headers: authToken ? { Authorization: `Bearer ${authToken}` } : {},
  });
  if (!res.ok) {
    const data = await res.json().catch(() => undefined);
    const rawMessage = data?.message ?? data?.error ?? "No se pudo exportar";
    const message = Array.isArray(rawMessage) ? rawMessage.join(", ") : rawMessage;
    throw new ApiError(res.status, message, data);
  }
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

/** Trae un archivo autenticado (ej. un PDF) como blob URL para verlo/imprimirlo en una pestaña nueva — el caller es responsable de revocar la URL cuando ya no la necesite. */
export async function apiBlobUrl(path: string, token?: string): Promise<string> {
  const authToken = token ?? getToken();
  const res = await fetch(`${API_URL}${path}`, {
    headers: authToken ? { Authorization: `Bearer ${authToken}` } : {},
  });
  if (!res.ok) {
    const data = await res.json().catch(() => undefined);
    const rawMessage = data?.message ?? data?.error ?? "No se pudo generar el documento";
    const message = Array.isArray(rawMessage) ? rawMessage.join(", ") : rawMessage;
    throw new ApiError(res.status, message, data);
  }
  const blob = await res.blob();
  return URL.createObjectURL(blob);
}
