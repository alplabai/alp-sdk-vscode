import { useCallback, useState } from "react";

export type AsyncStatus = "idle" | "loading" | "success" | "error";

export interface AsyncState<T> {
  status: AsyncStatus;
  data?: T;
  error?: Error;
}

export interface UseAsync<T> {
  state: AsyncState<T>;
  run: (promise: Promise<T>) => void;
  reset: () => void;
}

export function useAsync<T>(): UseAsync<T> {
  const [state, setState] = useState<AsyncState<T>>({ status: "idle" });

  const run = useCallback((promise: Promise<T>) => {
    setState({ status: "loading" });
    promise.then(
      (data) => setState({ status: "success", data }),
      (err) =>
        setState({
          status: "error",
          error: err instanceof Error ? err : new Error(String(err)),
        }),
    );
  }, []);

  const reset = useCallback(() => setState({ status: "idle" }), []);

  return { state, run, reset };
}
