// SPDX-License-Identifier: Apache-2.0

import { execFileSync } from "child_process";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import * as vscode from "vscode";
import {
  candidateSdkPaths,
  detectSdkRoots,
  isSdkRoot,
} from "@alp-sdk/core/sdkConnect/detect";
import { collectProjectContext } from "../project/vscodeAdapter";

const CLONE_URL = "https://github.com/alplabai/alp-sdk";
const PROMPT_DISMISSED_KEY = "alp.sdkConnectPromptDismissed";

/** Connected == the resolver turns the configured path into a live sdkRoot. */
export function isSdkConnected(): boolean {
  return collectProjectContext().sdkRoot !== null;
}

function workspaceRoot(): string | null {
  return vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? null;
}

async function setSdkPath(sdkPath: string): Promise<void> {
  await vscode.workspace
    .getConfiguration("alpSdk")
    .update("path", sdkPath, vscode.ConfigurationTarget.Global);
  await vscode.commands.executeCommand("setContext", "alpSdk.sdkConnected", true);
  await vscode.commands.executeCommand("alp.refreshProjectView");
  vscode.window.showInformationMessage(`Alp SDK connected: ${sdkPath}`);
}

function gitAvailable(): boolean {
  try {
    execFileSync("git", ["--version"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

async function cloneSdk(): Promise<void> {
  if (!gitAvailable()) {
    const install = "Install git";
    const choice = await vscode.window.showErrorMessage(
      "git was not found on PATH. Install git to clone the Alp SDK.",
      install,
    );
    if (choice === install) {
      void vscode.env.openExternal(vscode.Uri.parse("https://git-scm.com/downloads"));
    }
    return;
  }

  const defaultDir = workspaceRoot()
    ? path.resolve(workspaceRoot()!, "..")
    : os.homedir();
  const picked = await vscode.window.showOpenDialog({
    canSelectFiles: false,
    canSelectFolders: true,
    canSelectMany: false,
    defaultUri: vscode.Uri.file(defaultDir),
    openLabel: "Clone Alp SDK here",
    title: "Choose a parent folder for the alp-sdk clone",
  });
  if (!picked || picked.length === 0) return;

  const parent = picked[0]!.fsPath;
  const dest = path.join(parent, "alp-sdk");

  // Idempotent: a valid checkout already at the destination -> just use it.
  if (isSdkRoot(dest, fs.existsSync)) {
    await setSdkPath(dest);
    return;
  }

  const task = new vscode.Task(
    { type: "alp-sdk-clone" },
    vscode.TaskScope.Workspace,
    "Clone Alp SDK",
    "alp",
    new vscode.ShellExecution("git", ["clone", CLONE_URL, dest]),
  );

  const endListener = vscode.tasks.onDidEndTaskProcess(async (e) => {
    // Match on the extension-owned definition type, not the display name
    // (the name could collide with another task on the process-wide bus).
    if (e.execution.task.definition.type !== "alp-sdk-clone") return;
    endListener.dispose();
    try {
      if (e.exitCode !== 0) {
        vscode.window.showErrorMessage(
          `Alp: clone failed (git exit ${e.exitCode}). See the terminal for details.`,
        );
      } else if (!isSdkRoot(dest, fs.existsSync)) {
        vscode.window.showErrorMessage(
          `Alp: clone finished but ${dest} is not a valid Alp SDK checkout.`,
        );
      } else {
        await setSdkPath(dest);
      }
    } catch (err) {
      vscode.window.showErrorMessage(`Alp: failed to connect cloned SDK. ${String(err)}`);
    }
  });

  // Dispose the listener if the task can't even start, so it doesn't leak
  // and fire on an unrelated future task.
  try {
    await vscode.tasks.executeTask(task);
  } catch (err) {
    endListener.dispose();
    vscode.window.showErrorMessage(`Alp: could not start the clone task. ${String(err)}`);
  }
}

async function connectSdk(): Promise<void> {
  if (isSdkConnected()) {
    vscode.window.showInformationMessage(
      `Alp SDK already connected: ${collectProjectContext().sdkRoot}`,
    );
    return;
  }

  const found = detectSdkRoots(
    candidateSdkPaths(workspaceRoot(), os.homedir()),
    fs.existsSync,
  );
  const CLONE = "Clone a fresh copy…";

  if (found.length > 0) {
    const pick = await vscode.window.showQuickPick([...found, CLONE], {
      placeHolder: "Select an Alp SDK checkout to connect",
    });
    if (!pick) return;
    if (pick !== CLONE) {
      await setSdkPath(pick);
      return;
    }
    await cloneSdk();
    return;
  }

  const CONFIRM = "Clone";
  const choice = await vscode.window.showInformationMessage(
    "No Alp SDK checkout found. Clone alplabai/alp-sdk?",
    CONFIRM,
    "Cancel",
  );
  if (choice === CONFIRM) await cloneSdk();
}

export function registerSdkConnectCommand(): vscode.Disposable {
  return vscode.commands.registerCommand("alp.connectSdk", () => connectSdk());
}

/** One-time activation prompt; also seeds the alpSdk.sdkConnected context key. */
export async function maybeOfferSdkConnect(
  context: vscode.ExtensionContext,
): Promise<void> {
  const connected = isSdkConnected();
  await vscode.commands.executeCommand(
    "setContext",
    "alpSdk.sdkConnected",
    connected,
  );
  if (connected) return;
  if (context.globalState.get<boolean>(PROMPT_DISMISSED_KEY)) return;

  const CONNECT = "Connect SDK";
  const LATER = "Later";
  const NEVER = "Don't ask again";
  const choice = await vscode.window.showInformationMessage(
    "No Alp SDK connected. Connect it to load SoMs, boards, chips and libraries.",
    CONNECT,
    LATER,
    NEVER,
  );
  if (choice === CONNECT) {
    await vscode.commands.executeCommand("alp.connectSdk");
  } else if (choice === NEVER) {
    await context.globalState.update(PROMPT_DISMISSED_KEY, true);
  }
}
