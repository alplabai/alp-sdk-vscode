// SPDX-License-Identifier: Apache-2.0
//
// Zero-friction setup orchestrator — runs once on extension activation and
// shows a single non-intrusive notification when the Alp IDE environment is
// not ready (python/west missing, SDK not installed, no workspace).
//
// The notification is gated by a fingerprint stored in globalState so it does
// not repeat when the same problems persist across activations.  A new
// fingerprint (e.g., user fixed python but west is still missing) will trigger
// a fresh notification.
//
// Drift detection: after every successful state query the tool version
// fingerprint is persisted in workspaceState.  On the next activation, if any
// version string has changed the user is notified and prompted to recheck.

import * as vscode from "vscode";
import type { ToolVersions } from "./messages";
import type { NotifyAction } from "../notify/models";
import { notify, notifyAsync } from "../notify/vscodeAdapter";
import { log } from "../util";
import { queryAlpIdeState } from "./vscodeAdapter";

export const ORCHESTRATOR_KEY = "alp.setupOrchestrator.lastShownFingerprint";
const DRIFT_VERSION_KEY = "alp.setupOrchestrator.lastToolVersions";

/**
 * Clear the "already shown" fingerprint so the next activation's readiness
 * check re-evaluates and re-shows the bootstrap nudge if still not ready.
 *
 * Call this when a NEW project is about to be opened (e.g. right after the
 * New Project wizard scaffolds one) — globalState is machine-wide, so
 * without this a dismissal recorded for one project's issue set silently
 * suppresses the nudge for every later project with the same issues.
 */
export async function resetSetupNudge(
  context: vscode.ExtensionContext,
): Promise<void> {
  await context.globalState.update(ORCHESTRATOR_KEY, undefined);
}

/** Build a short fingerprint from the issues present in the state. */
function issueFingerprint(issues: string[]): string {
  return issues.slice().sort().join("|");
}

/** Serialize tool versions to a stable string for comparison. */
function versionFingerprint(versions: ToolVersions): string {
  return [
    `py:${versions.python ?? ""}`,
    `west:${versions.west ?? ""}`,
    `cmake:${versions.cmake ?? ""}`,
    `ninja:${versions.ninja ?? ""}`,
  ].join("|");
}

/** Display names for the fingerprint's tool keys. */
const TOOL_LABELS: Record<string, string> = {
  py: "Python",
  west: "west",
  cmake: "cmake",
  ninja: "ninja",
};

/** `"west:1.2.0"` -> `["west", "1.2.0"]`. */
function splitFingerprintEntry(entry: string): [string, string] {
  const at = entry.indexOf(":");
  return at < 0 ? [entry, ""] : [entry.slice(0, at), entry.slice(at + 1)];
}

/**
 * Name the tools whose version actually moved, as `west 1.2.0 → 1.3.0`. Both
 * arguments come from `versionFingerprint`, so the entries line up by index.
 *
 * This is what turns "something changed, go re-verify" into a sentence the user
 * can act on: a deliberate west upgrade and a toolchain that silently broke read
 * identically without it, and both fingerprints were already in hand. Empty when
 * the two strings differ only in shape (a fingerprint written by an older
 * extension), which the caller falls back on.
 */
function describeVersionDrift(previous: string, current: string): string {
  const before = previous.split("|");
  return current
    .split("|")
    .flatMap((entry, index) => {
      const was = before[index] ?? "";
      if (entry === was) return [];
      const [tool, now] = splitFingerprintEntry(entry);
      return [
        `${TOOL_LABELS[tool] ?? tool} ${splitFingerprintEntry(was)[1] || "not found"} → ${now || "not found"}`,
      ];
    })
    .join(", ");
}

/**
 * Evaluate prerequisites on first open and offer the IDE Hub panel
 * when the environment is not ready.
 *
 * Runs asynchronously after activation — never throws.
 */
export async function maybeOfferSetupPanel(
  context: vscode.ExtensionContext,
): Promise<void> {
  try {
    const state = await queryAlpIdeState(null, context);

    // --- drift detection ---------------------------------------------------
    const currentVersionFp = versionFingerprint(state.setup.toolVersions);
    const lastVersionFp = context.workspaceState.get<string>(
      DRIFT_VERSION_KEY,
      "",
    );
    if (lastVersionFp && lastVersionFp !== currentVersionFp) {
      // Versions changed since last run — inform once (globalState gates repeat)
      const driftKey = `${ORCHESTRATOR_KEY}.drift`;
      const lastDriftShown = context.globalState.get<string>(driftKey, "");
      if (lastDriftShown !== currentVersionFp) {
        await context.globalState.update(driftKey, currentVersionFp);
        const drift = describeVersionDrift(lastVersionFp, currentVersionFp);
        // Info, not warning: nothing failed — a tool moved. Doctor is the thing
        // that actually re-verifies the environment (the old "Open Alp IDE"
        // focused a panel that re-verifies nothing). "info" never gets the
        // presenter's automatic channel link, so it is named here.
        notifyAsync({
          severity: "info",
          channel: "toast",
          message: drift
            ? `Alp IDE: build tools changed since last session — ${drift}. Run Doctor to re-verify the environment.`
            : "Alp IDE: build tool versions have changed since last session. Run Doctor to re-verify the environment.",
          actions: [{ id: "runDoctor" }, { id: "showOutput" }],
        });
      }
    }
    await context.workspaceState.update(DRIFT_VERSION_KEY, currentVersionFp);

    // --- missing prerequisites notification --------------------------------
    const issues: string[] = [];
    if (!state.setup.pythonAvailable) issues.push("python");
    if (!state.setup.westAvailable) issues.push("west");
    if (state.sdk.readiness !== "ready") issues.push("sdk");
    if (!state.workspace.workspaceRoot) issues.push("no-workspace");

    if (issues.length === 0) return;

    const fingerprint = issueFingerprint(issues);
    const lastShown = context.globalState.get<string>(ORCHESTRATOR_KEY, "");
    if (lastShown === fingerprint) return;

    const issueLabels: Record<string, string> = {
      python: "Python not found",
      west: "west not found",
      sdk: "Alp SDK not ready",
      "no-workspace": "No workspace open",
    };
    const summary = issues.map((k) => issueLabels[k] ?? k).join(", ");

    // west/python missing on an open project = the build environment hasn't been
    // bootstrapped — the actionable fix is `alp bootstrap` (installs west +
    // Zephyr's Python deps). Offer it as a one-click action and say so plainly,
    // instead of leaving the user to decode "west not found". SDK-not-ready is a
    // separate fix (SDK Manager), and no-workspace means "open a folder" first —
    // neither is a bootstrap, so don't offer it for those.
    const noWorkspace = issues.includes("no-workspace");
    const canBootstrap =
      !noWorkspace && (issues.includes("west") || issues.includes("python"));

    // One control per state, instead of one panel-focus button for all four:
    // the toast used to collapse "no folder open", "SDK not installed" and
    // "build tools missing" into a comma summary whose only button opened a
    // panel — so neither opening a folder nor installing the SDK had a control
    // that did it.
    const actions: NotifyAction[] = [];
    if (noWorkspace) actions.push({ id: "openFolder" });
    if (canBootstrap) actions.push({ id: "bootstrap" });
    if (issues.includes("sdk")) actions.push({ id: "openSdkManager" });
    // The presenter's ad-hoc button: it carries no `run`, so this pick — and
    // only this pick — comes back and records the fingerprint.
    actions.push({ id: "custom", title: "Don't show again" });

    const message = noWorkspace
      ? "Alp: open a project folder to finish setting up the build environment."
      : canBootstrap
        ? `Alp: build environment not set up (${summary}). Run Bootstrap to install west + Zephyr build tools.`
        : "Alp: no Alp SDK is ready yet — install or activate one from the SDK Manager.";

    const picked = await notify({
      severity: "warning",
      channel: "toast",
      message,
      // The full issue set reaches the channel even when the sentence names
      // only the first thing to fix.
      detail: summary,
      actions,
    });

    // "Don't show again" is now the ONLY response that records the fingerprint.
    // An auto-dismissed toast returns undefined and stays unrecorded so it is
    // retried on the next activation rather than lost for the install lifetime;
    // a remedy click no longer silences a state that is still broken — if the
    // remedy worked the issue set is empty next time and nothing is shown, and
    // if it didn't, the nudge is still the correct thing to show.
    if (picked === "custom") {
      await context.globalState.update(ORCHESTRATOR_KEY, fingerprint);
    }
  } catch (err) {
    // Never block activation — but record why the readiness check failed
    // instead of dropping it silently.
    log(`[setup] readiness check failed: ${String(err)}`, "warn");
  }
}
