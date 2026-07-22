// SPDX-License-Identifier: Apache-2.0
//
// SDK Manager webview message handlers, extracted from sdkManagerPanel.ts so a
// host panel (the Hub / OverviewPanel) can own the SDK Manager surface without
// a second panel class. `createSdkMessageHandler(deps)` returns a predicate:
// it handles the SDK-specific message types and returns true, or returns false
// so the host handles its own `ready`/`runCommand`/`openUrl`/`closePanel`.
//
// The `handleUninstallSdk` path deletes a folder from disk (fs.rmSync) after a
// modal confirmation — the confirm, the Alp-managed-vs-external path check, and
// the active-pointer clear are preserved exactly as they were in the panel.

import type { SdkInstallAdapter } from "@alp-sdk/core/sdk/adapterCore";
import type { SdkRelease } from "@alp-sdk/core/sdk/models";
import { installSdkRelease } from "@alp-sdk/core/sdk/service";
import * as cp from "child_process";
import * as fs from "fs";
import * as path from "path";
import * as vscode from "vscode";
import { runAlpCommand } from "../alpCli/vscodeAdapter";
import { clearActiveSdk, setActiveSdk } from "../sdk/activeSdk";
import { writeAlpSetting } from "../sdk/settingsWrite";
import { log as logChannel } from "../util";
import type { ExtToWebviewMessage, WebviewToExtMessage } from "./messages";
import { sdkCacheRoot } from "./vscodeAdapter";

export interface SdkHandlerDeps {
  context: vscode.ExtensionContext;
  post: (msg: ExtToWebviewMessage) => void;
  refresh: () => Promise<void>;
}

/**
 * Build a handler for the SDK Manager webview messages. Returns a function that
 * returns `true` when it consumed the message, `false` otherwise (so the host
 * can handle `ready`/`runCommand`/`openUrl`/`closePanel`).
 */
export function createSdkMessageHandler(
  deps: SdkHandlerDeps,
): (msg: WebviewToExtMessage) => boolean {
  const { context, post, refresh } = deps;

  async function handleSelectSdkPath(): Promise<void> {
    const uris = await vscode.window.showOpenDialog({
      canSelectFiles: false,
      canSelectFolders: true,
      canSelectMany: false,
      title: "Select Alp SDK root directory",
    });
    if (!uris || uris.length === 0) return;
    await handleSwitchSdk(uris[0].fsPath);
  }

  async function handleSwitchSdk(sdkPath: string): Promise<void> {
    try {
      await setActiveSdk(sdkPath);
    } catch (err) {
      void vscode.window.showErrorMessage(
        `Alp: failed to set active SDK — ${String(err)}`,
      );
    }
    await refresh();
  }

  /** Delete a local SDK's folder from disk (after confirmation). Works for any
   *  local SDK — Alp-managed (~/.alp/sdk) or external (Browse / a checkout); the
   *  confirm spells out the path and warns when it isn't Alp-managed. Clears the
   *  active pointer if it pointed at the removed install. */
  async function handleUninstallSdk(sdkPath: string): Promise<void> {
    const cacheRoot = path.resolve(sdkCacheRoot());
    const target = path.resolve(sdkPath);
    const alpManaged =
      target === cacheRoot || target.startsWith(cacheRoot + path.sep);

    const name = path.basename(target);
    const detail = alpManaged
      ? `This permanently deletes ${target}.`
      : `${target} is not an Alp-managed install (added via Browse or a ` +
        `checkout). Permanently delete this folder from disk? This cannot be undone.`;
    const confirm = await vscode.window.showWarningMessage(
      `Remove SDK ${name}?`,
      { modal: true, detail },
      "Delete from disk",
    );
    if (confirm !== "Delete from disk") return;

    try {
      fs.rmSync(target, { recursive: true, force: true });
    } catch (err) {
      void vscode.window.showErrorMessage(
        `Alp: failed to remove SDK — ${String(err)}`,
      );
      return;
    }

    // Clear the active SDK setting if it pointed at the removed install, so
    // nothing dangles after removal. The folder is already gone, so a failure
    // to clear the pointer must not abort the flow — it downgrades the final
    // message instead of throwing (which, on this fire-and-forget handler,
    // would become an unhandled rejection and skip the refresh).
    const cfg = vscode.workspace.getConfiguration("alpSdk");
    const inspected = cfg.inspect<string>("path");
    const needWorkspace = Boolean(
      inspected?.workspaceValue &&
      path.resolve(inspected.workspaceValue) === target,
    );
    const needGlobal = Boolean(
      inspected?.globalValue && path.resolve(inspected.globalValue) === target,
    );

    let pointerCleared = true;
    try {
      if (needWorkspace) {
        pointerCleared =
          (await writeAlpSetting(
            "path",
            undefined,
            vscode.ConfigurationTarget.Workspace,
          )) && pointerCleared;
      }
      if (needGlobal) {
        pointerCleared =
          (await writeAlpSetting(
            "path",
            undefined,
            vscode.ConfigurationTarget.Global,
          )) && pointerCleared;
      }
    } catch {
      pointerCleared = false;
    }

    if (pointerCleared) {
      void vscode.window.showInformationMessage(`Alp: removed SDK ${name}.`);
    } else {
      void vscode.window.showWarningMessage(
        `Alp: removed SDK ${name}, but its active-SDK setting couldn't be ` +
          "cleared — save your settings file, then run Deactivate to finish.",
      );
    }
    await vscode.commands.executeCommand("alp.views.refresh");
    await refresh();
  }

  /** Deactivate — clear the active SDK without deleting anything. */
  async function handleDeactivateSdk(): Promise<void> {
    try {
      await clearActiveSdk();
    } catch (err) {
      void vscode.window.showErrorMessage(
        `Alp: failed to deactivate SDK — ${String(err)}`,
      );
    }
    await refresh();
  }

  async function handleRequestSdkReleases(): Promise<void> {
    // Delegate the GitHub releases fetch to `alp sdk list --format json`.
    const { outcome } = await runAlpCommand(context, ["sdk", "list"]);
    const envelope = outcome.envelope;
    if (!envelope || !envelope.ok) {
      void vscode.window.showErrorMessage(
        envelope
          ? "Alp: failed to fetch SDK releases. Check your network connection."
          : `Alp: ${outcome.message}`,
      );
      // Resolve the webview's "Loading SDK list…" spinner even on failure — the
      // toast explains why; an empty list drops the user to the actionable empty
      // state (Browse to a local SDK) instead of spinning forever.
      post({ type: "sdkReleasesLoaded", releases: [] });
      return;
    }
    const releases =
      (envelope.data as { releases?: SdkRelease[] }).releases ?? [];
    post({ type: "sdkReleasesLoaded", releases });
  }

  async function handleRequestSdkInstall(version: string): Promise<void> {
    const cacheRoot = sdkCacheRoot();
    fs.mkdirSync(cacheRoot, { recursive: true });

    // Already installed → say so instead of a silent, instant no-op. Installs
    // are side-by-side under ~/.alp/sdk/<version>, so this never overwrites.
    if (fs.existsSync(path.join(cacheRoot, version))) {
      void vscode.window.showInformationMessage(
        `Alp: SDK ${version} is already installed — activate it from the Local tab.`,
      );
      await refresh();
      return;
    }

    const gitInstallAdapter: SdkInstallAdapter = (ver, destPath) =>
      new Promise<void>((resolve, reject) => {
        const proc = cp.spawn("git", [
          "clone",
          "--branch",
          ver,
          "--depth",
          "1",
          "https://github.com/alplabai/alp-sdk.git",
          destPath,
        ]);
        proc.on("exit", (code) =>
          code === 0
            ? resolve()
            : reject(new Error(`git clone exited with code ${code}`)),
        );
        proc.on("error", reject);
      });

    const sendProgress = (
      log: string,
      done: boolean,
      success?: boolean,
    ): void => {
      // Tee every install-progress line into the "Alp SDK" channel so the
      // transcript survives the panel closing (P1.2). The param is named `log`
      // (the webview message field), so the channel logger is aliased.
      logChannel(`[sdk-install] ${log}`);
      post({ type: "sdkInstallProgress", log, done, success });
    };

    sendProgress(`Installing SDK ${version}…`, false);

    await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: `Alp: Installing SDK ${version}`,
        cancellable: false,
      },
      async () => {
        try {
          await installSdkRelease(
            version,
            cacheRoot,
            gitInstallAdapter,
            (p) => fs.existsSync(p),
            (p) => {
              try {
                return fs.readFileSync(p, "utf8");
              } catch {
                return "";
              }
            },
          );
          sendProgress(`SDK ${version} installed successfully.`, true, true);
          await refresh();
        } catch (err) {
          sendProgress(`Install failed: ${String(err)}`, true, false);
          void vscode.window.showErrorMessage(
            `Alp: SDK install failed — ${String(err)}`,
          );
        }
      },
    );
  }

  return (msg: WebviewToExtMessage): boolean => {
    switch (msg.type) {
      case "selectSdkPath":
        void handleSelectSdkPath();
        return true;
      case "requestSdkReleases":
        void handleRequestSdkReleases();
        return true;
      case "requestSdkInstall":
        void handleRequestSdkInstall(msg.version);
        return true;
      case "switchSdk":
        void handleSwitchSdk(msg.sdkPath);
        return true;
      case "uninstallSdk":
        void handleUninstallSdk(msg.sdkPath);
        return true;
      case "deactivateSdk":
        void handleDeactivateSdk();
        return true;
      default:
        return false;
    }
  };
}
