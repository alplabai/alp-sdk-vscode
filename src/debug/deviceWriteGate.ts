// SPDX-License-Identifier: Apache-2.0
//
// The consent gate in front of a debug session that programs the board (#586).
//
// WHY THIS IS A PROVIDER AND NOT AN `if` IN `startDebugging`. #549 put a
// blocking modal on `tan flash` and on `west flash`. Debug reaches the same
// silicon by a route neither gate can see — it hands a cortex-debug
// configuration to another extension, which spawns JLinkGDBServerCL / openocd
// / pyocd itself, so no `tan` process and no west plan is involved. The
// obvious fix, a check in front of `vscode.debug.startDebugging`
// (`src/debug.ts`), closes only the `alp.debug` button. It does NOT close the
// entry point customers actually use: once `.vscode/launch.json` exists —
// written by `alp.debug` OR by `alp.configureDebugProfile`, which writes it
// and starts nothing — plain F5 and the Run and Debug dropdown launch that
// same configuration through VS Code's own machinery, and not one line of this
// extension runs. F5 is not a loophole here, it is the supported path: #406
// exists precisely so `--pre-launch-task` makes F5 build before it debugs.
//
// `resolveDebugConfiguration` is the one seam VS Code calls for EVERY launch
// of a type, whatever started it. Returning the configuration continues the
// launch; returning `undefined` aborts it silently, which is why the decline
// path also raises its own notification — an abort with no message reads as a
// bug, not as a refusal that was honoured.
//
// ACTIVATION IS PART OF THE GATE. A provider that is not registered yet gates
// nothing, and VS Code only waits for extensions that declare an `onDebug*`
// event before it resolves a launch. `workspaceContains:**/board.yaml` is an
// async file search while F5 is available immediately, so without
// `onDebugResolve:cortex-debug` in package.json a launch can resolve — and
// program the board — before this file has ever been loaded. cortex-debug
// declares that event for itself, which is why the session works without us.
//
// (VS Code appears to run the provider chain before the `preLaunchTask`
// runner, which would make a decline also cancel the rebuild. That ordering
// is an undocumented implementation detail of another product and nothing
// here pins it, so it is not relied on: the gate's guarantee is only that no
// DEBUG SESSION starts, not that no build ran.)
//
// SCOPE. Registered for `cortex-debug` and gated on the workspace holding a
// `board.yaml`. This extension can activate in a window that has nothing to do
// with Alp (`activationEvents` carries `onLanguage:yaml`), and a stranger's
// cortex-debug session must not sprout an Alp dialog. The board.yaml test —
// rather than matching the `ALP:`/`Alp:` name prefix — is deliberate: inside an
// Alp project a hand-written cortex-debug entry programs exactly the same
// silicon as a generated one, and the customer is owed the same dialog for it.

import * as fs from "fs";
import * as vscode from "vscode";
import {
  DebugWriteAsk,
  debugConsentMessage,
  describeDebugConsent,
  planDebugDeviceWrite,
} from "@alp-sdk/core/debug/deviceWriteConsent";
import { boardYamlPathForFolder } from "@alp-sdk/core/project/service";
import { collectWorkspaceDebugContext } from "./vscodeAdapter";
import { recordDebugConsentDeclined } from "./consentDecline";
import { notify, notifyAsync } from "../notify/vscodeAdapter";
import { planConfirm, planSuccess } from "../notify/service";
import { log } from "../util";

/**
 * Raise the blocking modal and return whether the customer authorised the
 * write.
 *
 * The confirm is caller-handled (no `run` in the presenter's table) so the
 * pick comes back and gates the launch; a presenter-run action would leave the
 * gate with nothing to read. Dismissal returns `undefined`, which is not
 * `programDevice`, so closing the dialog denies.
 */
export async function confirmDebugDeviceWrite(
  ask: DebugWriteAsk,
  workspaceRoot: string | null,
): Promise<boolean> {
  const picked = await notify(
    planConfirm({
      message: debugConsentMessage(ask),
      modalDetail: describeDebugConsent(ask, { workspaceRoot }),
      confirm: { id: "programDevice" },
    }),
  );
  if (picked !== "programDevice") {
    log("[debug] consent declined — no session started, nothing written");
    // So `alp.debug` can tell an honoured refusal from a launch VS Code
    // itself turned down: both surface as `startDebugging` resolving false,
    // and reporting a deliberate "no" as a failure is a second, contradictory
    // message for one decision.
    recordDebugConsentDeclined(ask.configName);
    notifyAsync(
      planSuccess("Alp Debug cancelled — nothing was written to the device."),
    );
    return false;
  }
  return true;
}

/**
 * Whether the folder THIS launch belongs to is an Alp project.
 *
 * The launch's own folder, never a window-wide probe. `alpSdk.boardYamlPath`
 * is declared `"scope": "resource"` so a multi-root folder can pin its own,
 * and the window-wide reader scopes its lookup to
 * `vscode.window.activeTextEditor` (src/project/vscodeAdapter.ts) — which is
 * undefined for an F5 started from the Run view. Asking the window instead of
 * the folder therefore answered "not an Alp project" for real Alp launches,
 * and answered for folder A on folder B's launches in a multi-root window.
 *
 * Two probes, cheap one first. The deep search exists because the activation
 * predicate matches a board.yaml at ANY depth (a `workspaceContains` glob
 * that recurses), and a gate narrower
 * than the event that switches it on leaves real projects ungated (open the
 * parent directory of a project and every launch in it escapes).
 */
async function isAlpLaunchFolder(
  folder: vscode.WorkspaceFolder | undefined,
): Promise<boolean> {
  if (folder === undefined) {
    // A folderless launch has no resource to scope to; the window-wide probe
    // is the only answer available, and is correct for a single-root window.
    return collectWorkspaceDebugContext().boardYamlExists;
  }
  const configured =
    vscode.workspace
      .getConfiguration("alpSdk", folder.uri)
      .get<string>("boardYamlPath") ?? "board.yaml";
  const boardYaml = boardYamlPathForFolder(
    folder.uri.fsPath,
    configured,
    process.platform,
  );
  if (boardYaml !== null && fs.existsSync(boardYaml)) return true;
  const deep = await vscode.workspace.findFiles(
    new vscode.RelativePattern(folder, "**/board.yaml"),
    "**/node_modules/**",
    1,
  );
  return deep.length > 0;
}

/**
 * The provider hook. `undefined` aborts the session; the configuration itself
 * continues it, unchanged — this gate never edits what it lets through.
 */
export async function resolveDebugDeviceWrite(
  folder: vscode.WorkspaceFolder | undefined,
  config: vscode.DebugConfiguration,
): Promise<vscode.DebugConfiguration | undefined> {
  const decision = planDebugDeviceWrite(
    config as unknown as Record<string, unknown>,
    { boardYamlExists: await isAlpLaunchFolder(folder) },
  );
  if (decision.kind === "allow") return config;
  // The folder the launch belongs to, so the dialog's root line matches the
  // `${workspaceFolder}` the adapter will expand in the artefact path.
  const workspaceRoot =
    folder !== undefined
      ? folder.uri.fsPath
      : collectWorkspaceDebugContext().workspaceRoot;
  return (await confirmDebugDeviceWrite(decision, workspaceRoot))
    ? config
    : undefined;
}

/**
 * Register the gate. Called at activation — an unregistered provider gates
 * nothing, and there is deliberately no setting that disables it: a consent
 * gate with an off switch is a consent gate that is off in the one workspace
 * where it mattered.
 */
export function registerDebugDeviceWriteGate(): vscode.Disposable[] {
  return [
    vscode.debug.registerDebugConfigurationProvider("cortex-debug", {
      resolveDebugConfiguration: resolveDebugDeviceWrite,
    }),
  ];
}
