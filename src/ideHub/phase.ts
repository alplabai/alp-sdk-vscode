// SPDX-License-Identifier: Apache-2.0
import type { AlpIdeState } from "./messages";

export type Phase = "no-env" | "no-project" | "invalid-board" | "ready";

export function derivePhase(state: AlpIdeState): Phase {
  const { setup, sdk, workspace } = state;
  const envReady =
    setup.pythonAvailable &&
    setup.westAvailable &&
    workspace.westInitialized &&
    sdk.readiness === "ready";
  if (!envReady) return "no-env";
  if (!workspace.boardYamlExists) return "no-project";
  if (!workspace.boardYamlValid) return "invalid-board";
  return "ready";
}

export const LADDER_STEPS = [
  { id: "environment", label: "Environment", phase: "no-env" },
  { id: "project", label: "Project", phase: "no-project" },
  { id: "board", label: "Board", phase: "invalid-board" },
  { id: "build", label: "Build & Flash", phase: "ready" },
] as const;
