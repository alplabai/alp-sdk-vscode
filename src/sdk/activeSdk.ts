// SPDX-License-Identifier: Apache-2.0

import { checkSdkReadiness } from "@alp-sdk/core/sdk/service";
import * as fs from "fs";
import * as vscode from "vscode";
import { queryAlpIdeState } from "../ideHub/vscodeAdapter";
import { writeAlpSetting } from "./settingsWrite";

/**
 * Set the active SDK via the `alpSdk.path` setting — the single source project
 * resolution + the CLI (`--sdk-root`) already read. Scope it to the Workspace
 * when a folder is open (per-project override) and Global otherwise (the default
 * for windows without one); VS Code merges Workspace over Global. Refreshes the
 * native trees + status bar afterwards.
 */
export async function setActiveSdk(sdkPath: string): Promise<void> {
  // Probe readiness before writing: a folder that is not an SDK root (missing
  // scripts/alp_project.py) would poison alpSdk.path — resolveSdkRoot rejects it
  // AND skips auto-discovery of a valid sibling. Surface the error, write nothing.
  const report = checkSdkReadiness(
    sdkPath,
    (p) => fs.existsSync(p),
    (p) => {
      try {
        return fs.readFileSync(p, "utf8");
      } catch {
        return "";
      }
    },
  );
  if (report.state === "missing") {
    void vscode.window.showErrorMessage(report.issues.join(" "));
    return;
  }

  const hasWorkspace = (vscode.workspace.workspaceFolders?.length ?? 0) > 0;
  const target = hasWorkspace
    ? vscode.ConfigurationTarget.Workspace
    : vscode.ConfigurationTarget.Global;
  const written = await writeAlpSetting("path", sdkPath, target);
  if (!written) return;
  await vscode.commands.executeCommand("alp.views.refresh");
  void vscode.window.showInformationMessage(
    hasWorkspace
      ? `Alp: active SDK for this project → ${sdkPath}`
      : `Alp: default SDK → ${sdkPath} (open a project folder to override per-project)`,
  );
}

/**
 * Clear the active SDK (deactivate) — remove the `alpSdk.path` setting at both
 * scopes. The SDK stays installed/listed; nothing on disk is deleted. Project
 * resolution then reports no active SDK (or auto-discovers one if present).
 */
export async function clearActiveSdk(): Promise<void> {
  const cfg = vscode.workspace.getConfiguration("alpSdk");
  const inspected = cfg.inspect<string>("path");
  const hadWorkspace = inspected?.workspaceValue !== undefined;
  const hadGlobal = inspected?.globalValue !== undefined;
  if (!hadWorkspace && !hadGlobal) {
    void vscode.window.showInformationMessage("Alp: no active SDK to clear.");
    return;
  }

  // A scope that wasn't set counts as "already clear"; only an attempted write
  // that didn't land marks a scope as still-set. writeAlpSetting has already
  // told the user how to recover in that case.
  const workspaceCleared = hadWorkspace
    ? await writeAlpSetting(
        "path",
        undefined,
        vscode.ConfigurationTarget.Workspace,
      )
    : true;
  const globalCleared = hadGlobal
    ? await writeAlpSetting(
        "path",
        undefined,
        vscode.ConfigurationTarget.Global,
      )
    : true;

  if (!workspaceCleared && !globalCleared) return; // nothing changed
  await vscode.commands.executeCommand("alp.views.refresh");

  if (workspaceCleared && globalCleared) {
    void vscode.window.showInformationMessage("Alp: active SDK cleared.");
  } else {
    const stillSet = !workspaceCleared
      ? "this project's"
      : "the global default";
    void vscode.window.showWarningMessage(
      `Alp: ${stillSet} SDK setting still points at an SDK — save that ` +
        "settings file and run Deactivate again to finish clearing it.",
    );
  }
}

/** Last path segment (cross-platform); the cache dir is named after the tag. */
function pathTail(p: string): string {
  return p.split(/[\\/]/).filter(Boolean).pop() ?? p;
}

type SdkPickItem = vscode.QuickPickItem & {
  sdkPath?: string;
  action?: "browse" | "manage" | "deactivate";
};

/** Quick Pick to choose the active SDK from the installed (side-by-side) set. */
async function selectSdk(): Promise<void> {
  const state = await queryAlpIdeState().catch(() => null);
  const active = state?.sdk.activePath ?? null;
  const entries = state?.sdk.localEntries ?? [];

  const items: SdkPickItem[] = entries.map((entry) => {
    const label = entry.version ?? pathTail(entry.path);
    return {
      label: entry.path === active ? `$(check) ${label}` : label,
      description: entry.path === active ? "active" : "",
      detail: entry.path,
      sdkPath: entry.path,
    };
  });
  if (active) {
    items.push({
      label: "$(circle-slash) Deactivate (no active SDK)",
      action: "deactivate",
    });
  }
  items.push(
    {
      label: "$(folder-opened) Browse for an SDK folder…",
      action: "browse",
    },
    { label: "$(gear) Open SDK Manager", action: "manage" },
  );

  const hasWorkspace = (vscode.workspace.workspaceFolders?.length ?? 0) > 0;
  const pick = await vscode.window.showQuickPick(items, {
    title: "Alp: Select active SDK",
    placeHolder: hasWorkspace
      ? "Sets the active SDK for this project"
      : "Sets the default SDK (open a project folder to override per-project)",
  });
  if (!pick) return;

  if (pick.action === "deactivate") {
    await clearActiveSdk();
  } else if (pick.action === "manage") {
    await vscode.commands.executeCommand("alp.openSdkManager");
  } else if (pick.action === "browse") {
    const uris = await vscode.window.showOpenDialog({
      canSelectFiles: false,
      canSelectFolders: true,
      canSelectMany: false,
      title: "Select Alp SDK root directory",
    });
    if (uris?.[0]) await setActiveSdk(uris[0].fsPath);
  } else if (pick.sdkPath) {
    await setActiveSdk(pick.sdkPath);
  }
}

export function registerSelectSdkCommand(): vscode.Disposable {
  return vscode.commands.registerCommand("alp.selectSdk", selectSdk);
}
