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
    /**
     * True while a bootstrap run is STILL EXECUTING in a terminal.
     *
     * REQUIRED, not optional: every other gate here is a snapshot of the disk,
     * and `westInitialized` flips the moment `.west/config` is written — which
     * is the FIRST thing `tan bootstrap` does, not the last. Without this term
     * a refresh landing mid-run (window focus, a settings edit) reports a
     * half-fetched module tree as ready and the surface enables Build/Flash
     * over it. tan v0.4.0 widens that window further: it no longer reuses a
     * workspace across a patch-level Zephyr bump, so a `west update` can now
     * run where none did before. Making the key mandatory means "no bootstrap
     * is running" is something a caller states and a reviewer can see, never
     * an omission that silently reads as `undefined`.
     */
    bootstrapRunning: boolean;
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
 * initialized west workspace), AND no bootstrap still running. `tan` is INFO
 * only — it is managed/auto-fetched, so a missing `tan` never flips readiness;
 * it just shows as "managed" in the tooltip.
 *
 * Three presented states, never two: an in-flight bootstrap is neither ready
 * nor broken, so it gets its own text/tooltip instead of borrowing the
 * "setup" warning (which reads as "something is wrong, act now" for a run
 * whose only correct action is to wait).
 */
export function envReadinessPresentation(
  state: ReadinessState,
): EnvReadinessPresentation {
  const { pythonAvailable, westAvailable, bootstrapRunning, toolVersions } =
    state.setup;
  const ready =
    !bootstrapRunning &&
    pythonAvailable &&
    westAvailable &&
    state.sdk.readiness === "ready" &&
    state.workspace.westInitialized;

  const v = (x: string | null, fallback = "not found"): string => x ?? fallback;
  const tan = toolVersions.tan ? `tan ${toolVersions.tan}` : "tan managed";
  const sdk = state.sdk.version
    ? `Alp SDK v${state.sdk.version}`
    : "Alp SDK not installed";
  // Mid-run the on-disk answer is "initialized" from the first write of
  // `.west/config` onward, so reporting it verbatim is what claimed ready over
  // a half-fetched tree. Say what is actually happening instead.
  const ws = bootstrapRunning
    ? "Workspace: Bootstrapping — still running, do not build yet"
    : state.workspace.westInitialized
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
    text: bootstrapRunning
      ? "$(sync~spin) Alp: bootstrapping"
      : ready
        ? "$(check) Alp"
        : "$(warning) Alp: setup",
    tooltip,
  };
}
