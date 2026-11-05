"use client";
import { useRef, useState } from "react";
import { api, ApiError } from "./api";
import { useSubmitGuard } from "./use-submit-guard";
interface Attempt {
  path: string;
  body: unknown;
  method: string;
}
export function useRecordedAction(reload: () => void) {
  const pending = useRef<Attempt | null>(null);
  const [uncertain, setUncertain] = useState(false),
    [error, setError] = useState<string | null>(null),
    [notice, setNotice] = useState<string | null>(null);
  const submit = useSubmitGuard(
    async (path: string, body: unknown, method: string = "POST") => {
      const request = pending.current ?? { path, body, method };
      pending.current = request;
      setError(null);
      setNotice(null);
      try {
        await api(request.path, { method: request.method, body: request.body });
        pending.current = null;
        setUncertain(false);
        setNotice("Operación registrada.");
        reload();
      } catch (e) {
        setError(e instanceof Error ? e.message : "No se pudo registrar");
        if (e instanceof ApiError && e.status < 500) {
          pending.current = null;
          setUncertain(false);
          reload();
        } else setUncertain(true);
      }
    },
  );
  return {
    busy: submit.submitting || uncertain,
    uncertain,
    error,
    notice,
    run: submit.onSubmit,
    retry: () =>
      pending.current &&
      submit.onSubmit(
        pending.current.path,
        pending.current.body,
        pending.current.method,
      ),
  };
}
