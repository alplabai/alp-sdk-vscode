// SPDX-License-Identifier: Apache-2.0
//
// Mirror of src/ideHub/phase.ts — the canonical selector. Kept in sync
// manually (same discipline as messages.ts <-> types.ts): the webview is a
// separate Vite build and cannot import the extension host's sources. If you
// change the logic here, change it there too (and vice versa) — the host
// copy is unit-tested in test/phase.test.js.
import type { AlpIdeState } from "../../types";

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
