import { useEffect, useMemo, useState } from "react";
import type { BuildPlanData, SizeReport, SystemManifest } from "../../types";
import { onMessage, postMessage } from "../../vscode";

export interface UseBuildPlan {
  plan: BuildPlanData | null;
  error: string | null;
  loading: boolean;
  /** The system manifest (post-build contract), pushed alongside the plan. */
  manifest: SystemManifest | null;
  /** True when `manifest` is the populated build output, false = SDK projection. */
  manifestPostBuild: boolean;
  manifestError: string | null;
  /** Per-slice footprint vs the SoM budget (`tan size`). Null before a build
   *  or when the measurement failed — never rendered as zero. */
  sizes: SizeReport | null;
  sizesError: string | null;
  reload(): void;
  /** Write the plan's files to disk (`alp build --materialise`). */
  materialise(): void;
  /** Run the build live in a terminal (`alp build`). */
  build(): void;
  /** Flash a single manifest slice (`alp flash --core <id>`). */
  flashSlice(coreId: string): void;
}

/**
 * Requests the build plan from the extension (`alp build --plan`) and tracks the
 * three states the view renders: loading, a plan, or an error/empty message.
 */
export function useBuildPlan(): UseBuildPlan {
  const [plan, setPlan] = useState<BuildPlanData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [manifest, setManifest] = useState<SystemManifest | null>(null);
  const [manifestPostBuild, setManifestPostBuild] = useState(false);
  const [manifestError, setManifestError] = useState<string | null>(null);
  const [sizes, setSizes] = useState<SizeReport | null>(null);
  const [sizesError, setSizesError] = useState<string | null>(null);

  useEffect(() => {
    const off = onMessage((msg) => {
      if (msg.type === "buildPlanData") {
        setPlan(msg.plan);
        setError(msg.error ?? null);
        setLoading(false);
      } else if (msg.type === "systemManifestData") {
        setManifest(msg.manifest);
        setManifestPostBuild(msg.postBuild);
        setManifestError(msg.error ?? null);
      } else if (msg.type === "sliceSizesData") {
        setSizes(msg.report);
        setSizesError(msg.error ?? null);
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
      manifest,
      manifestPostBuild,
      manifestError,
      sizes,
      sizesError,
      reload() {
        setLoading(true);
        setPlan(null);
        setError(null);
        setManifest(null);
        setManifestError(null);
        setSizes(null);
        setSizesError(null);
        postMessage({ type: "requestBuildPlan" });
      },
      materialise() {
        postMessage({ type: "materialiseBuildPlan" });
      },
      build() {
        postMessage({ type: "runBuild" });
      },
      flashSlice(coreId: string) {
        postMessage({ type: "flashSlice", coreId });
      },
    }),
    [
      plan,
      error,
      loading,
      manifest,
      manifestPostBuild,
      manifestError,
      sizes,
      sizesError,
    ],
  );
}
