"use client";

import { useCallback, useEffect, useState } from "react";
import { ApiError } from "./api";
import { createLatestRequest } from "./latest-request";

/** Fetchers and success callbacks must be stable (useCallback) between requests. */
export function useRemoteLoad<T>(
  fetcher: () => Promise<T>,
  onSuccess: (value: T) => void,
  errorMessage: string,
) {
  const [runner] = useState(createLatestRequest);
  const [state, setState] = useState({
    fetcher,
    loading: true,
    error: null as string | null,
  });

  const execute = useCallback(
    () =>
      runner.run(
        fetcher,
        (value) => {
          onSuccess(value);
          setState({ fetcher, loading: false, error: null });
        },
        (error) => {
          setState({
            fetcher,
            loading: false,
            error: error instanceof ApiError ? error.message : errorMessage,
          });
        },
      ),
    [runner, fetcher, onSuccess, errorMessage],
  );

  useEffect(() => {
    void execute();
    return () => runner.cancel();
  }, [execute, runner]);

  const reload = useCallback(() => {
    setState({ fetcher, loading: true, error: null });
    return execute();
  }, [execute, fetcher]);

  // Changing filters immediately enters loading, before the next effect runs.
  const current = state.fetcher === fetcher;
  return {
    reload,
    loading: !current || state.loading,
    error: current ? state.error : null,
  };
}
