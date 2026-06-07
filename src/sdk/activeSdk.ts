// SPDX-License-Identifier: Apache-2.0

import * as vscode from "vscode";
import { queryAlpIdeState } from "../ideHub/vscodeAdapter";

/**
 * Set the active SDK via the `alpSdk.path` setting — the single source project
 * resolution + the CLI (`--sdk-root`) already read. Scope it to the Workspace
 * when a folder is open (per-project override) and Global otherwise (the default
 * for windows without one); VS Code merges Workspace over Global. Refreshes the
 * native trees + status bar afterwards.
 */
export async function setActiveSdk(sdkPath: string): Promise<void> {
  const hasWorkspace = (vscode.workspace.workspaceFolders?.length ?? 0) > 0;
  const target = hasWorkspace
    ? vscode.ConfigurationTarget.Workspace
    : vscode.ConfigurationTarget.Global;
  await vscode.workspace
    .getConfiguration("alpSdk")
    .update("path", sdkPath, target);
  await vscode.commands.executeCommand("alp.views.refresh");
  void vscode.window.showInformationMessage(
    hasWorkspace
      ? `Alp: active SDK for this project → ${sdkPath}`
      : `Alp: default SDK → ${sdkPath} (open a project folder to override per-project)`,
  );
}

/** Last path segment (cross-platform); the cache dir is named after the tag. */
function pathTail(p: string): string {
  return p.split(/[\\/]/).filter(Boolean).pop() ?? p;
}

type SdkPickItem = vscode.QuickPickItem & {
  sdkPath?: string;
  action?: "browse" | "manage";
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

  if (pick.action === "manage") {
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
