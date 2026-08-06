// SPDX-License-Identifier: Apache-2.0

import {
  checkSdkReadiness,
  clearActiveSdkPointer,
  switchActiveSdk,
  westManifestLogLine,
  westManifestWarning,
} from "@alp-sdk/core/sdk/service";
import * as fs from "fs";
import * as vscode from "vscode";
import { runAlpCommand } from "../alpCli/vscodeAdapter";
import { danglingWestManifest } from "../environment/vscodeAdapter";
import { queryAlpIdeState } from "../ideHub/vscodeAdapter";
import { planFailure, planSuccess } from "../notify/service";
import { notify, notifyAsync } from "../notify/vscodeAdapter";
import { collectProjectContext } from "../project/vscodeAdapter";
import { log } from "../util";
import { writeAlpSetting } from "./settingsWrite";

/**
 * Warn when the west workspace's own manifest pointer names a directory that no
 * longer exists — the state issue #349 reported, in which `west` silently
 * resolves an unrelated workspace (or none) no matter what the active-SDK
 * pointer says. Returns true when it warned, so callers can suppress a bare
 * "success" that would read as "nothing left to do".
 *
 * Reports only. The repair is `tan`'s, and as of the pinned v0.4.0 BOTH routes
 * exist: `tan bootstrap` reconciles the pointer, and so does `tan sdk switch`
 * (tan-cli#74, with the three gaps #88 closed -- notably the bare-version form
 * resolving only against `~/.alp/sdk-cache` while this extension installs to
 * `~/.alp/sdk`, so the repair could not reach the layout that reported #349).
 * `setActiveSdk` runs that switch itself now, so reaching this warning means
 * the repair RAN and did not fix it -- worth saying differently from "nobody
 * tried".
 */
export function warnIfWestManifestDangling(sdkRoot: string | null): boolean {
  const status = danglingWestManifest(sdkRoot);
  if (!status) return false;

  // Both helpers are non-null for a `dangling` status, which is the only kind
  // `danglingWestManifest` returns.
  log(`[sdk] ${westManifestLogLine(status)}`, "warn");

  // Built as a plan literal, not via `planFailure`: naming the workspace and
  // the manifest path IS the diagnosis here, and planFailure's raw-diagnostic
  // scrub would demote that sentence into the channel. Fire-and-forget so the
  // synchronous `true` still reaches the caller. The presenter appends
  // "Show Output" to any non-info plan, so the channel link is not named here.
  notifyAsync({
    severity: "warning",
    channel: "toast",
    message: westManifestWarning(status) as string,
    // `tan bootstrap` reconciles the manifest pointer (tan-cli #31) for a
    // workspace that exists but dangles.
    actions: [{ id: "bootstrap" }],
  });
  return true;
}

/**
 * Set the active SDK via the `alpSdk.path` setting — the single source project
 * resolution + the CLI (`--sdk-root`) already read. Scope it to the Workspace
 * when a folder is open (per-project override) and Global otherwise (the default
 * for windows without one); VS Code merges Workspace over Global. Refreshes the
 * native trees + status bar afterwards.
 */
export async function setActiveSdk(
  context: vscode.ExtensionContext,
  sdkPath: string,
): Promise<void> {
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
    log(
      `[sdk] activate rejected — ${sdkPath} is not an SDK root: ${report.issues.join(" ")}`,
    );
    // The loader-script name and the rejected path stay in the channel line
    // above; the toast says what the user actually did wrong and — the point of
    // this fix — offers both ways out instead of only "Show Output".
    const picked = await notify(
      planFailure({
        operation: "Activating that SDK",
        cause: "That folder is not an Alp SDK root.",
        actions: [
          // `retry` carries no `run` in the presenter's table, so the pick comes
          // back here and re-opens the picker the user came from.
          { id: "retry", title: "Choose Another Folder" },
          { id: "openSdkManager" },
        ],
      }),
    );
    if (picked === "retry") {
      void vscode.commands.executeCommand("alp.selectSdk");
    }
    return;
  }

  const hasWorkspace = (vscode.workspace.workspaceFolders?.length ?? 0) > 0;
  const target = hasWorkspace
    ? vscode.ConfigurationTarget.Workspace
    : vscode.ConfigurationTarget.Global;
  const written = await writeAlpSetting("path", sdkPath, target);
  if (!written) return;

  // Mirror the choice into the shared `.alp/sdk-path` pointer so the CLI
  // (`alp sdk current`/`switch`) and the extension agree on the active SDK.
  // Best-effort: the setting write above is authoritative — a pointer-write
  // failure (read-only tree, no workspace) must not break activation.
  const projectContext = collectProjectContext();
  const workspaceRoot = projectContext.workspaceRoot;
  if (workspaceRoot) {
    try {
      switchActiveSdk(
        workspaceRoot,
        sdkPath,
        (p, content) => fs.writeFileSync(p, content),
        (p) => fs.mkdirSync(p, { recursive: true }),
      );
    } catch (err) {
      // Pointer mirror is best-effort; the setting write is the source of truth.
      log(
        `[sdk] .alp/sdk-path pointer mirror failed (best-effort): ${String(err)}`,
      );
    }
  }

  // #364: hand the switch to tan so it reconciles `<topdir>/.west/config`'s own
  // manifest pointer -- the thing west reads directly, which the setting write
  // and the `.alp/sdk-path` mirror above both leave untouched (#349/#350).
  //
  // Best-effort, exactly like the pointer mirror: the setting write is
  // authoritative, and a tan that is absent, older or failing must not break
  // activation. What it must not do is fail SILENTLY, so both outcomes log.
  //
  // Deliberately NOT matched on `sdk.west-config-reconciled` /
  // `sdk.west-config-not-reconciled`: neither is in tan's frozen
  // `contract/issue-codes.json`, so an exact-string match here would be a new
  // fail-open surface of exactly the kind tan-cli#106 froze codes to prevent --
  // rename one upstream and this reads as success forever. The STATE is
  // observable instead (`warnIfWestManifestDangling` below re-probes it), and a
  // state probe cannot be renamed out from under us.
  //
  // Gated on `workspaceRoot`, not run with an undefined cwd: the thing being
  // repaired is `<topdir>/.west/config`, which only exists inside a workspace.
  // With no folder open there is nothing to reconcile, and letting tan pick its
  // own cwd would aim the switch at whatever directory the extension host
  // happens to be in. `sdkPath` is absolute for the same class of reason -- a
  // bare version resolves against `~/.alp/sdk-cache`, not the `~/.alp/sdk` this
  // extension installs into (tan-cli#88).
  try {
    if (!workspaceRoot) {
      log(
        "[sdk] no workspace folder — skipping `tan sdk switch` (nothing to reconcile without a west topdir)",
      );
    } else {
      // `interactive: true`: `setActiveSdk` runs only from an explicit
      // "switch SDK" / "browse for an SDK" webview action, never on its own.
      const { outcome } = await runAlpCommand(
        context,
        ["sdk", "switch", sdkPath],
        workspaceRoot,
        { interactive: true },
      );
      log(
        outcome.ok
          ? `[sdk] tan sdk switch reconciled the workspace for ${sdkPath}`
          : `[sdk] tan sdk switch did not reconcile (${outcome.message}) -- the active-SDK setting is set, but west may still resolve a stale workspace`,
        outcome.ok ? "info" : "warn",
      );
    }
  } catch (err) {
    log(
      `[sdk] tan sdk switch could not run (best-effort): ${String(err)}`,
      "warn",
    );
  }

  await vscode.commands.executeCommand("alp.views.refresh");
  log(
    `[sdk] active SDK set → ${sdkPath} (${hasWorkspace ? "workspace" : "global"})`,
  );

  // #349: switching the active SDK does not touch `<topdir>/.west/config`, which
  // west reads directly. If that pointer names a version that is gone, a bare
  // "active SDK set" success reads as "nothing left to do" while every later
  // build/flash resolves the wrong workspace. Warn instead — the workspace, not
  // the pointer, is what still needs fixing. Pass the SDK just activated, not
  // the context's (possibly stale) sdkRoot.
  if (warnIfWestManifestDangling(sdkPath)) return;

  // Status bar, not a toast: the `$(package)` item one line below already
  // renders the active SDK, so a dismissible popup for it is a click with no
  // information in it.
  notifyAsync(
    planSuccess(
      hasWorkspace
        ? `Alp: active SDK for this project → ${sdkPath}`
        : `Alp: default SDK → ${sdkPath} (open a project folder to override per-project)`,
    ),
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

  // The `.alp/sdk-path` pointer is the OTHER half of a pin — `setActiveSdk`
  // writes it, and `resolveSdkRoot` reads it ABOVE auto-discovery. Clearing the
  // setting alone left the pointer standing, so resolution returned the same
  // SDK, the badge never moved, and Deactivate read as a dead button. Cleared
  // FIRST so a settings-write failure below cannot leave the pointer outliving
  // a cleared setting.
  const workspaceRoot = collectProjectContext().workspaceRoot;
  let pointerCleared = false;
  if (workspaceRoot) {
    try {
      pointerCleared = clearActiveSdkPointer(
        workspaceRoot,
        (p) => fs.existsSync(p),
        (p) => fs.unlinkSync(p),
      );
    } catch (err) {
      // Best-effort like the mirror write in setActiveSdk — but never silent,
      // or the next Deactivate looks dead for exactly the same reason.
      log(`[sdk] .alp/sdk-path pointer clear failed: ${String(err)}`);
    }
  }

  if (!hadWorkspace && !hadGlobal && !pointerCleared) {
    // Nothing to act on and the status bar already reads "No SDK" — ack it
    // there rather than making the user dismiss a popup.
    notifyAsync(planSuccess("Alp: no active SDK to clear."));
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
  log(
    `[sdk] active SDK cleared (workspace=${workspaceCleared}, global=${globalCleared})`,
  );

  if (workspaceCleared && globalCleared) {
    notifyAsync(planSuccess("Alp: active SDK cleared."));
  }
  // No second toast for a partial clear: the scope that didn't land failed
  // because its settings file is dirty, and `writeAlpSetting` has already said
  // so — with Open Settings + Retry on it. Stacking a buttonless warning on top
  // of that gave one Deactivate click two warnings for one cause.
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
async function selectSdk(context: vscode.ExtensionContext): Promise<void> {
  const state = await queryAlpIdeState().catch(() => null);
  const active = state?.sdk.activePath ?? null;
  const entries = state?.sdk.localEntries ?? [];

  const items: SdkPickItem[] = entries.map((entry) => {
    const label = entry.version ?? pathTail(entry.path);
    return {
      label: entry.active ? `$(check) ${label}` : label,
      description: entry.active ? "active" : "",
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
    if (uris?.[0]) await setActiveSdk(context, uris[0].fsPath);
  } else if (pick.sdkPath) {
    await setActiveSdk(context, pick.sdkPath);
  }
}

export function registerSelectSdkCommand(
  context: vscode.ExtensionContext,
): vscode.Disposable {
  return vscode.commands.registerCommand("alp.selectSdk", () =>
    selectSdk(context),
  );
}
