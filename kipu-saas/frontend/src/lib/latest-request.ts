/** A new request invalidates older responses, including their errors. */
export function createLatestRequest() {
  let generation = 0;
  return {
    cancel() {
      generation++;
    },
    async run<T>(
      fetcher: () => Promise<T>,
      success: (value: T) => void,
      failure: (error: unknown) => void,
    ) {
      const current = ++generation;
      try {
        const value = await fetcher();
        if (current === generation) success(value);
      } catch (error) {
        if (current === generation) failure(error);
      }
    },
  };
}
