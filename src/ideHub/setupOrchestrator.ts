// SPDX-License-Identifier: Apache-2.0
//
// Zero-friction setup orchestrator — runs once on extension activation and
// shows a single non-intrusive notification when the ALP IDE environment is
// not ready (python/west missing, SDK not installed, no workspace).
//
// The notification is gated by a fingerprint stored in globalState so it does
// not repeat when the same problems persist across activations.  A new
// fingerprint (e.g., user fixed python but west is still missing) will trigger
// a fresh notification.

import * as vscode from "vscode";
import { queryAlpIdeState } from "./vscodeAdapter";

const ORCHESTRATOR_KEY = "alp.setupOrchestrator.lastShownFingerprint";

/** Build a short fingerprint from the issues present in the state. */
function issueFingerprint(issues: string[]): string {
  return issues.slice().sort().join("|");
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
    const state = await queryAlpIdeState();

    const issues: string[] = [];
    if (!state.setup.pythonAvailable) issues.push("python");
    if (!state.setup.westAvailable) issues.push("west");
    if (state.sdk.readiness !== "ready") issues.push("sdk");
    if (!state.workspace.workspaceRoot) issues.push("no-workspace");

    if (issues.length === 0) return;

    const fingerprint = issueFingerprint(issues);
    const lastShown = context.globalState.get<string>(ORCHESTRATOR_KEY, "");
    if (lastShown === fingerprint) return;

    await context.globalState.update(ORCHESTRATOR_KEY, fingerprint);

    const issueLabels: Record<string, string> = {
      python: "Python not found",
      west: "west not found",
      sdk: "ALP SDK not ready",
      "no-workspace": "No workspace open",
    };
    const summary = issues
      .map((k) => issueLabels[k] ?? k)
      .join(", ");

    const action = await vscode.window.showWarningMessage(
      `ALP IDE: environment not ready — ${summary}.`,
      "Open ALP IDE",
    );
    if (action === "Open ALP IDE") {
      await vscode.commands.executeCommand("alp.ideHub.focus");
    }
  } catch {
    // Never block activation.
  }
}
