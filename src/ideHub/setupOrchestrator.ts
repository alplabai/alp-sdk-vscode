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
import { log } from "../util";
import { queryAlpIdeState } from "./vscodeAdapter";

const ORCHESTRATOR_KEY = "alp.setupOrchestrator.lastShownFingerprint";
const DRIFT_VERSION_KEY = "alp.setupOrchestrator.lastToolVersions";

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
        void vscode.window
          .showWarningMessage(
            "Alp IDE: build tool versions have changed since last session. Re-verify your build environment.",
            "Open Alp IDE",
          )
          .then((action) => {
            if (action === "Open Alp IDE") {
              void vscode.commands.executeCommand("alp.ideHub.focus");
            }
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
    const canBootstrap =
      !issues.includes("no-workspace") &&
      (issues.includes("west") || issues.includes("python"));

    const RUN_BOOTSTRAP = "Run Bootstrap";
    const OPEN_HUB = "Open Alp IDE";
    const message = canBootstrap
      ? `Alp: build environment not set up (${summary}). Run Bootstrap to install west + Zephyr build tools.`
      : `Alp IDE: environment not ready — ${summary}.`;
    const actions = canBootstrap
      ? [RUN_BOOTSTRAP, OPEN_HUB, "Don't show again"]
      : [OPEN_HUB, "Don't show again"];

    const action = await vscode.window.showWarningMessage(message, ...actions);

    // Only record the fingerprint once the user actually responded; an
    // auto-dismissed toast returns undefined and is left unrecorded so it is
    // retried on the next activation rather than lost for the install lifetime.
    if (action !== undefined) {
      await context.globalState.update(ORCHESTRATOR_KEY, fingerprint);
    }
    if (action === RUN_BOOTSTRAP) {
      await vscode.commands.executeCommand("alp.installDependencies");
    } else if (action === OPEN_HUB) {
      await vscode.commands.executeCommand("alp.ideHub.focus");
    }
  } catch (err) {
    // Never block activation — but record why the readiness check failed
    // instead of dropping it silently.
    log(`[setup] readiness check failed: ${String(err)}`, "warn");
  }
}
