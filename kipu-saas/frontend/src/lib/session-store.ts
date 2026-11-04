export interface AuthUser {
  id: string;
  name: string;
  email: string;
}

export interface AuthOrganization {
  id: string;
  name: string;
}

export interface Session {
  accessToken: string;
  refreshToken: string;
  user: AuthUser;
  organization: AuthOrganization;
}

const SESSION_CHANGED = "kipu-session-changed";
const KEYS = [
  "kipu_token",
  "kipu_refresh_token",
  "kipu_user",
  "kipu_organization",
];

// Strings give useSyncExternalStore a stable snapshot until storage changes.
// null is reserved for server rendering; an empty string means no session.
export function getSessionSnapshot(): string | null {
  if (typeof window === "undefined") return null;
  try {
    return JSON.stringify(KEYS.map((key) => window.localStorage.getItem(key)));
  } catch {
    return "";
  }
}

export function getServerSessionSnapshot(): null {
  return null;
}

export function parseSession(snapshot: string | null): Session | null {
  if (!snapshot) return null;
  try {
    const values: unknown = JSON.parse(snapshot);
    if (
      !Array.isArray(values) ||
      values.length !== 4 ||
      !values.every((value) => typeof value === "string" && value.trim())
    )
      return null;
    const [accessToken, refreshToken, rawUser, rawOrganization] =
      values as string[];
    const user: unknown = JSON.parse(rawUser);
    const organization: unknown = JSON.parse(rawOrganization);
    if (
      !isRecord(user) ||
      !isRecord(organization) ||
      !hasText(user.id) ||
      !hasText(user.name) ||
      !hasText(user.email) ||
      !hasText(organization.id) ||
      !hasText(organization.name)
    )
      return null;
    return {
      accessToken,
      refreshToken,
      user: { id: user.id, name: user.name, email: user.email },
      organization: { id: organization.id, name: organization.name },
    };
  } catch {
    // Old or corrupted browser data must return the user to login, not crash.
    return null;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasText(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

export function subscribeToSession(onChange: () => void): () => void {
  function onStorage(event: StorageEvent) {
    if (event.key === null || KEYS.includes(event.key)) onChange();
  }
  window.addEventListener("storage", onStorage);
  window.addEventListener(SESSION_CHANGED, onChange);
  return () => {
    window.removeEventListener("storage", onStorage);
    window.removeEventListener(SESSION_CHANGED, onChange);
  };
}

export function persistSession(session: Session): void {
  const values = [
    session.accessToken,
    session.refreshToken,
    JSON.stringify(session.user),
    JSON.stringify(session.organization),
  ];
  KEYS.forEach((key, index) => window.localStorage.setItem(key, values[index]));
  window.dispatchEvent(new Event(SESSION_CHANGED));
}

export function clearSession(): void {
  KEYS.forEach((key) => window.localStorage.removeItem(key));
  window.dispatchEvent(new Event(SESSION_CHANGED));
}
