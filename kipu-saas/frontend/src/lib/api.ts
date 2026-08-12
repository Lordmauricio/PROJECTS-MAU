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
