"use client";

import { createContext, useContext, useEffect, useRef, useState, ReactNode } from "react";
import { useRouter } from "next/navigation";
import { api, ApiError, registerSessionExpiredHandler } from "./api";

export interface AuthUser {
  id: string;
  name: string;
  email: string;
}

export interface AuthOrganization {
  id: string;
  name: string;
}

interface LoginResult {
  accessToken?: string;
  refreshToken?: string;
  user?: AuthUser;
  organization?: AuthOrganization;
  requiresOrganizationSelection?: boolean;
  organizations?: AuthOrganization[];
}

interface AuthContextValue {
  token: string | null;
  user: AuthUser | null;
  organization: AuthOrganization | null;
  loading: boolean;
  login: (email: string, password: string, organizationId?: string) => Promise<LoginResult>;
  setSession: (result: { accessToken: string; refreshToken: string; user: AuthUser; organization: AuthOrganization }) => void;
  logout: () => void;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

function persistSession(result: { accessToken: string; refreshToken: string; user: AuthUser; organization: AuthOrganization }) {
  localStorage.setItem("kipu_token", result.accessToken);
  localStorage.setItem("kipu_refresh_token", result.refreshToken);
  localStorage.setItem("kipu_user", JSON.stringify(result.user));
  localStorage.setItem("kipu_organization", JSON.stringify(result.organization));
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [token, setToken] = useState<string | null>(null);
  const [user, setUser] = useState<AuthUser | null>(null);
  const [organization, setOrganization] = useState<AuthOrganization | null>(null);
  const [loading, setLoading] = useState(true);
  const router = useRouter();

  useEffect(() => {
    const storedToken = localStorage.getItem("kipu_token");
    const storedUser = localStorage.getItem("kipu_user");
    const storedOrg = localStorage.getItem("kipu_organization");
    if (storedToken && storedUser && storedOrg) {
      setToken(storedToken);
      setUser(JSON.parse(storedUser));
      setOrganization(JSON.parse(storedOrg));
    }
    setLoading(false);
  }, []);

  async function login(email: string, password: string, organizationId?: string): Promise<LoginResult> {
    const result = await api<LoginResult>("/auth/login", {
      method: "POST",
      body: { email, password, organizationId },
    });

    if (result.requiresOrganizationSelection) {
      return result;
    }

    if (!result.accessToken || !result.refreshToken || !result.user || !result.organization) {
      throw new Error(
        "Respuesta de login incompleta: faltan campos de sesión (accessToken/refreshToken/user/organization).",
      );
    }

    const session = {
      accessToken: result.accessToken,
      refreshToken: result.refreshToken,
      user: result.user,
      organization: result.organization,
    };
    persistSession(session);
    setToken(session.accessToken);
    setUser(session.user);
    setOrganization(session.organization);
    router.push("/dashboard");
    return result;
  }

  function setSession(result: { accessToken: string; refreshToken: string; user: AuthUser; organization: AuthOrganization }) {
    persistSession(result);
    setToken(result.accessToken);
    setUser(result.user);
    setOrganization(result.organization);
  }

  function logout() {
    localStorage.removeItem("kipu_token");
    localStorage.removeItem("kipu_refresh_token");
    localStorage.removeItem("kipu_user");
    localStorage.removeItem("kipu_organization");
    setToken(null);
    setUser(null);
    setOrganization(null);
    router.push("/login");
  }

  // `lib/api.ts` no es un componente React — no puede llamar a `logout()`
  // directamente. Se registra acá (Offline 4.1) para que, cuando el ciclo
  // de refresh automático de una llamada interactiva descubra que la
  // sesión está revocada o expirada sin poder renovarse, la app reaccione
  // exactamente igual que un logout manual (limpia sesión, redirige a
  // /login) — sin que `lib/api.ts` necesite importar React ni este
  // contexto. El ref evita capturar una versión vieja de `logout` en un
  // closure obsoleto; se actualiza en su propio efecto (nunca durante el
  // render) porque escribir un ref en el cuerpo del render es inseguro bajo
  // renderizado concurrente de React 19 (el render puede descartarse/
  // repetirse) — regla `react-hooks/refs` del lint del propio proyecto.
  const logoutRef = useRef(logout);
  useEffect(() => {
    logoutRef.current = logout;
  });
  useEffect(() => {
    registerSessionExpiredHandler(() => logoutRef.current());
    return () => registerSessionExpiredHandler(null);
  }, []);

  return (
    <AuthContext.Provider value={{ token, user, organization, loading, login, setSession, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth debe usarse dentro de AuthProvider");
  return ctx;
}

export { ApiError };
