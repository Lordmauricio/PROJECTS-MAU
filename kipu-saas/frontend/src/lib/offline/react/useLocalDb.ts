"use client";

import { useMemo } from "react";
import { useAuth } from "@/lib/auth-context";
import { getLocalDb, type KipuLocalDB } from "../db";

/**
 * Base local de la organización ACTIVA de la sesión (`useAuth().organization`
 * — la misma fuente que ya usa el resto de la app, nunca un valor propio).
 * `null` mientras no hay organización resuelta todavía (cargando, o sin
 * sesión) — ningún componente debe intentar leer/escribir en una base sin
 * saber a qué organización pertenece.
 */
export function useLocalDb(): KipuLocalDB | null {
  const { organization } = useAuth();
  return useMemo(() => (organization ? getLocalDb(organization.id) : null), [organization]);
}
