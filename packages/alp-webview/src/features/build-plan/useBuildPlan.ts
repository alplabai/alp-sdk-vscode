import { useEffect, useMemo, useState } from "react";
import type { BuildPlanData } from "../../types";
import { onMessage, postMessage } from "../../vscode";

export interface UseBuildPlan {
  plan: BuildPlanData | null;
  error: string | null;
  loading: boolean;
  reload(): void;
  /** Write the plan's files to disk (`alp build --materialise`). */
  materialise(): void;
  /** Run the build live in a terminal (`alp build`). */
  build(): void;
}

/**
 * Requests the build plan from the extension (`alp build --plan`) and tracks the
 * three states the view renders: loading, a plan, or an error/empty message.
 */
export function useBuildPlan(): UseBuildPlan {
  const [plan, setPlan] = useState<BuildPlanData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const off = onMessage((msg) => {
      if (msg.type === "buildPlanData") {
        setPlan(msg.plan);
        setError(msg.error ?? null);
        setLoading(false);
      }
    });
    postMessage({ type: "requestBuildPlan" });
    return off;
  }, []);

  return useMemo<UseBuildPlan>(
    () => ({
      plan,
      error,
      loading,
      reload() {
        setLoading(true);
        setPlan(null);
        setError(null);
        postMessage({ type: "requestBuildPlan" });
      },
      materialise() {
        postMessage({ type: "materialiseBuildPlan" });
      },
      build() {
        postMessage({ type: "runBuild" });
      },
    }),
    [plan, error, loading],
  );
}
