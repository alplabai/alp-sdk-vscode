// SPDX-License-Identifier: Apache-2.0
//
// Pure presentation for the status-bar Alp env-readiness item (and anywhere
// else the one-line readiness glance is needed). No vscode/fs — the surface
// (src/statusBar.ts) turns this into a StatusBarItem. Kept decoupled from
// src/ideHub via a local structural type so core has no back-dependency on the
// extension host.

/** The slice of AlpIdeState this readiness glance reads. */
export interface ReadinessState {
  setup: {
    pythonAvailable: boolean;
    westAvailable: boolean;
    toolVersions: {
      python: string | null;
      west: string | null;
      tan: string | null;
    };
  };
  sdk: { version: string | null; readiness: string };
  workspace: { westInitialized: boolean };
}

export interface EnvReadinessPresentation {
  ready: boolean;
  /** Status-bar text incl. a `$(codicon)` glyph. */
  text: string;
  /** Multi-line hover with the verbatim tool/SDK/workspace detail. */
  tooltip: string;
}

/**
 * Readiness = the four hard gates (Python, west, an SDK that is `ready`, and an
 * initialized west workspace). `tan` is INFO only — it is managed/auto-fetched,
 * so a missing `tan` never flips readiness; it just shows as "managed" in the
 * tooltip.
 */
export function envReadinessPresentation(
  state: ReadinessState,
): EnvReadinessPresentation {
  const { pythonAvailable, westAvailable, toolVersions } = state.setup;
  const ready =
    pythonAvailable &&
    westAvailable &&
    state.sdk.readiness === "ready" &&
    state.workspace.westInitialized;

  const v = (x: string | null, fallback = "not found"): string => x ?? fallback;
  const tan = toolVersions.tan ? `tan ${toolVersions.tan}` : "tan managed";
  const sdk = state.sdk.version
    ? `Alp SDK v${state.sdk.version}`
    : "Alp SDK not installed";
  const ws = state.workspace.westInitialized
    ? "Workspace: Initialized"
    : "Workspace: Not initialized";

  const tooltip = [
    `Python ${v(toolVersions.python)}`,
    `west ${v(toolVersions.west)}`,
    tan,
    sdk,
    ws,
  ].join("\n");

  return {
    ready,
    text: ready ? "$(check) Alp" : "$(warning) Alp: setup",
    tooltip,
  };
}
