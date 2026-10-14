import { useEffect, useMemo, useState } from "react";
import type {
  BuildPlanData,
  ManifestProvenance,
  MemoryView,
  SizeReport,
  SystemManifest,
} from "../../types";
import { onMessage, postMessage } from "../../vscode";

export interface UseBuildPlan {
  plan: BuildPlanData | null;
  error: string | null;
  loading: boolean;
  /** The system manifest (post-build contract), pushed alongside the plan. */
  manifest: SystemManifest | null;
  /** True when `manifest` is the populated build output, false = SDK projection. */
  manifestPostBuild: boolean;
  /** #470: when the manifest was written, and whether it still describes the
   *  last build. Null on the projection path, which has no file. */
  manifestProvenance: ManifestProvenance | null;
  manifestError: string | null;
  /** #484: the address-space view of that same manifest — what it pins, and
   *  what the customer declared that it could not place. Host-computed. */
  memory: MemoryView | null;
  /** Per-slice footprint vs the SoM budget (`tan size`). Null before a build
   *  or when the measurement failed — never rendered as zero. */
  sizes: SizeReport | null;
  sizesError: string | null;
  /** Flash a single manifest slice (`tan flash --core <id>`). */
  flashSlice(coreId: string): void;
}

/**
 * Requests the build plan from the extension on mount and tracks what the
 * host pushes back. Refresh, Build and Materialise are editor-title commands
 * (`alp.buildPlan.*`) that the HOST runs and answers with the same messages,
 * so nothing here re-requests: the panel re-renders whatever arrives.
 */
export function useBuildPlan(): UseBuildPlan {
  const [plan, setPlan] = useState<BuildPlanData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [manifest, setManifest] = useState<SystemManifest | null>(null);
  const [manifestPostBuild, setManifestPostBuild] = useState(false);
  const [manifestProvenance, setManifestProvenance] =
    useState<ManifestProvenance | null>(null);
  const [manifestError, setManifestError] = useState<string | null>(null);
  const [memory, setMemory] = useState<MemoryView | null>(null);
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
        setManifestProvenance(msg.provenance ?? null);
        setMemory(msg.memory ?? null);
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
      manifestProvenance,
      manifestError,
      memory,
      sizes,
      sizesError,
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
      manifestProvenance,
      manifestError,
      memory,
      sizes,
      sizesError,
    ],
  );
}
