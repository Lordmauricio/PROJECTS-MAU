"use client";

import { createContext, useContext, useMemo, useSyncExternalStore, ReactNode } from "react";
import { useRouter } from "next/navigation";
import { api, ApiError } from "./api";

import {
  clearSession, getServerSessionSnapshot, getSessionSnapshot, parseSession,
  persistSession, subscribeToSession,
} from "./session-store";
import type { AuthUser, AuthOrganization } from "./session-store";
export type { AuthUser, AuthOrganization } from "./session-store";

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

export function AuthProvider({ children }: { children: ReactNode }) {
  const snapshot = useSyncExternalStore(
    subscribeToSession, getSessionSnapshot, getServerSessionSnapshot,
  );
  const session = useMemo(() => parseSession(snapshot), [snapshot]);
  const token = session?.accessToken ?? null;
  const user = session?.user ?? null;
  const organization = session?.organization ?? null;
  const loading = snapshot === null;
  const router = useRouter();

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
    router.push("/dashboard");
    return result;
  }

  function setSession(result: { accessToken: string; refreshToken: string; user: AuthUser; organization: AuthOrganization }) {
    persistSession(result);
  }

  function logout() {
    clearSession();
    router.push("/login");
  }

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
