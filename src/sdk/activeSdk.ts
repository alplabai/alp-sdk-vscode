// SPDX-License-Identifier: Apache-2.0

import {
  checkSdkReadiness,
  clearActiveSdkPointer,
  narrowSdkCurrent,
  switchActiveSdk,
  westManifestLogLine,
  westManifestWarning,
} from "@alp-sdk/core/sdk/service";
import * as fs from "fs";
import * as vscode from "vscode";
import { fetchEnvelopeResult } from "../alpCli/envelope";
import { SUPPORTED_CLI_VERSION } from "../alpCli/service";
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
 * Reports only. The repair is `tan`'s, and at SUPPORTED_CLI_VERSION exactly
 * ONE of the two routes works: `tan bootstrap` reconciles the pointer, and
 * `tan sdk switch` (tan-cli#74) does NOT -- it refuses with `sdk.not-ported`
 * (tan-cli#305). `setActiveSdk` used to run that switch and no longer does
 * (#546), so reaching this warning means NOBODY TRIED: no repair ran, and the
 * offered action is the one that can still work (`bootstrap`).
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
 *
 * `reconcileActiveSdkAfterBootstrap` (#604/#614) also routes its writes
 * through here, but raises its OWN toast independently rather than through a
 * message override on this function: `warnIfWestManifestDangling` below can
 * return before the generic success notification ever fires, and a caller
 * whose whole point is "tell the customer something happened" must not
 * depend on a branch inside a shared writer that exists for a different
 * reason (adversarial review of #604/#614, Major #3).
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

  // #364 asked tan to reconcile `<topdir>/.west/config`'s own manifest pointer
  // -- the thing west reads directly, which the setting write and the
  // `.alp/sdk-path` mirror above both leave untouched (#349/#350). It did that
  // by spawning `tan sdk switch <sdkPath>`.
  //
  // THAT CALL IS GONE (#546). `tan sdk` at SUPPORTED_CLI_VERSION has exactly
  // four verbs -- list, current, install, switch -- and its own help says
  // install/switch "are not yet ported and refuse in this build -- use
  // --sdk-root instead (tan-cli#305)". The verb is in the vocabulary and
  // REFUSES: exit non-zero with `sdk.not-ported`, every time, on every
  // activation. So the run was not a best-effort reconcile that occasionally
  // degraded, it was a subprocess whose only possible outcome was the warning
  // below it, and that warning ("west may still resolve a stale workspace")
  // read as a rare degraded path rather than the only path there is.
  //
  // Nothing replaces it here, and nothing pretends to. `.west/config` is NOT
  // reconciled by this extension at all: the two writes above are the whole of
  // what activation does. The state is still OBSERVED rather than assumed --
  // `warnIfWestManifestDangling` below re-probes the pointer and warns the
  // customer when it now names an SDK that is gone, which is the failure a
  // reconcile would have prevented. Restoring the call is gated on tan-cli#305
  // landing the port; until then a `--sdk-root` override is the documented way
  // to aim a build at a specific SDK.
  //
  // Still gated on `workspaceRoot`, because the sentence is only true where a
  // west topdir can exist: with no folder open there is no `.west/config` to
  // leave unreconciled and nothing to say.
  //
  // AND THE SENTENCE IS ABOUT THE PIN, NOT ABOUT THE RESOLVED BINARY. Nothing
  // here probes tan, so "`tan sdk switch` refuses at 0.6.0" stated as a
  // fact about the running CLI would be false for a `alpSdk.cliPath` user on a
  // v0.4.x tan, where `switch` WORKED (tan-cli#74, gaps closed by #88). The
  // reason no call is made is that this build targets SUPPORTED_CLI_VERSION
  // and THAT binary refuses -- a true statement whichever tan resolves, and
  // the one that actually explains the decision. Probing the real version to
  // sharpen a log line would spawn a process on every SDK activation to
  // change nothing but prose.
  if (workspaceRoot) {
    log(
      `[sdk] ${sdkPath} is now the active SDK (setting + .alp/sdk-path pointer). ` +
        "`<topdir>/.west/config` was NOT reconciled and no CLI call was made: " +
        "this extension targets tan " +
        `${SUPPORTED_CLI_VERSION}, and \`tan sdk switch\` refuses at that pin ` +
        "(sdk.not-ported, tan-cli#305), so the call is not attempted on any " +
        "binary -- including an older one reached through `alpSdk.cliPath`, " +
        "where it may well have worked. If west resolves a stale workspace, " +
        "re-run `west init`/`west update` for this SDK or pass `--sdk-root` " +
        "-- the check below reports the pointer if it now dangles.",
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
 * After a `tan bootstrap` terminal run finishes, ask tan directly which SDK
 * it now resolves (`tan sdk current`) — the one moment tan's own resolution
 * ladder and `alpSdk.path` are known to be worth comparing (#604, #614).
 *
 * ONLY EVER FILLS IN AN EMPTY PIN. Adversarial review of the first version
 * found this call is architecturally unable to tell "tan-cli#185 relocated
 * THIS checkout" apart from ordinary disagreement: `sourceTier:
 * "globalDefault"` can be a DIFFERENT project's bootstrap answering for this
 * one (tan-cli#464's own `sdk.global-default-foreign-project` warning exists
 * because that is a real, everyday case, not a corner one), and a pin that
 * does not currently resolve (an unmounted external volume, a not-yet-cloned
 * SDK) looks identical to one whose checkout genuinely moved. So a non-empty
 * `alpSdk.path` — a customer's deliberate pin — is NEVER overwritten here,
 * no matter what tan answers; the disagreement is only logged. An EMPTY
 * `alpSdk.path` carries no such risk: there is nothing to destroy, and
 * filling it in from tan's own ladder is strictly better than leaving it
 * unset. (The dangling-pin-after-relocation case #604 opened with therefore
 * still needs a real fix — reading `bootstrap.workspace-relocated` off the
 * bootstrap run's OWN envelope, which the terminal route this reconciles
 * cannot see at all; tracked, not solved here.)
 *
 * `injectSdkRoot: false` on the `tan sdk current` call is load-bearing, not
 * cosmetic: without it, `runAlpCommand`'s `withSdkRoot` hands tan THIS
 * extension's own resolved SDK as `--sdk-root`, and tan reports it straight
 * back at `sourceTier: "sdkRootFlag"` — this extension asking tan to confirm
 * a fact it just told tan, and mistaking the echo for independent evidence.
 *
 * `checkSdkReadiness`'s local derivation stays the fallback everywhere else
 * in this extension — this is the one additional ask, and it fails silent:
 * no CLI, no answer, an answer already matching the pin, a pin already set,
 * or a resolved-but-unready SDK (`readiness.state === "missing"` — writing
 * that would make `setActiveSdk`'s own poison-guard pop an unrelated "not an
 * Alp SDK root" dialog + "Choose Another Folder" out of a run the customer
 * never asked this question of) all leave `alpSdk.path` untouched.
 *
 * Raises its OWN toast on a write, rather than routing a message through
 * `setActiveSdk` — that function can return before its own success
 * notification ever fires (`warnIfWestManifestDangling`), which would make
 * this call's whole "tell the customer" purpose silently depend on a branch
 * that exists for an unrelated reason.
 *
 * @param cwd - the SAME directory the bootstrap just ran in. `tan sdk
 *   current` resolves from cwd exactly like every other command, so asking
 *   from anywhere else would answer about a different project.
 */
export async function reconcileActiveSdkAfterBootstrap(
  context: vscode.ExtensionContext,
  cwd: string,
): Promise<void> {
  const result = await fetchEnvelopeResult(context, ["sdk", "current"], cwd, {
    injectSdkRoot: false,
  });
  // Logged verbatim, not matched by code — the same treatment
  // `project/vscodeAdapter.ts` documents for these two `"reserved"` codes
  // (`sdk.project-pin-unresolved` / `sdk.global-default-foreign-project`):
  // "reserved" means no consumer in this extension BINDS the spelling, not
  // that tan never emits it, and a literal `===` match is what a rename
  // could silently break. Each entry is checked before use — `isEnvelope`
  // only validates that `issues` is an array, never each entry's shape.
  for (const issue of result.issues) {
    if (issue && typeof issue.message === "string") {
      log(`[sdk] tan sdk current: ${issue.message}`, "warn");
    }
  }
  if (!result.ok) return;

  const current = narrowSdkCurrent(result.data);
  if (!current?.sdkPath) return;

  if (current.readiness?.state === "missing") {
    log(
      `[sdk] tan sdk current resolved ${current.sdkPath} (tier: ${current.sourceTier}), ` +
        "but reports it is not a ready SDK root -- not acting on it from an " +
        "unattended background check.",
      "warn",
    );
    return;
  }

  const configuredPath = vscode.workspace
    .getConfiguration("alpSdk")
    .get<string>("path", "")
    .trim();
  if (configuredPath === current.sdkPath) return;

  if (configuredPath) {
    // A non-empty pin is the customer's own choice, and this check has no
    // reliable way to tell a genuine relocation of THIS checkout from every
    // other cause of disagreement — see this function's own doc. Report it,
    // touch nothing.
    log(
      `[sdk] tan sdk current resolved ${current.sdkPath} (tier: ${current.sourceTier}), ` +
        `which disagrees with the pinned alpSdk.path (${configuredPath}) -- leaving the ` +
        'pin alone (no reliable relocation signal). Re-pin via "Select SDK" if this is stale.',
      "warn",
    );
    return;
  }

  log(
    `[sdk] tan sdk current resolved ${current.sdkPath} (tier: ${current.sourceTier}) with ` +
      "no alpSdk.path pinned -- pinning it.",
  );
  await setActiveSdk(current.sdkPath);
  // A real toast (an action makes it one, not the default status-bar blip
  // `setActiveSdk`'s own success message uses) — this call fires from a
  // background task the customer never explicitly triggered, so silence
  // here is worse than the dangling path this feature exists to close.
  notifyAsync(
    planSuccess(
      `Alp: pinned the active SDK after bootstrap → ${current.sdkPath} ` +
        `(tan sdk current, tier: ${current.sourceTier}).`,
      { actions: [{ id: "openSettings" }] },
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
async function selectSdk(): Promise<void> {
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
    if (uris?.[0]) await setActiveSdk(uris[0].fsPath);
  } else if (pick.sdkPath) {
    await setActiveSdk(pick.sdkPath);
  }
}

export function registerSelectSdkCommand(): vscode.Disposable {
  return vscode.commands.registerCommand("alp.selectSdk", () => selectSdk());
}
