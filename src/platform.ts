// SPDX-License-Identifier: Apache-2.0
//
// Alp Platform UX (#718, #719): the status bar item, the off-manifest warning
// and the `Alp: Platform Release…` quick pick. tan owns the manifest and the
// pin; this reads `tan doctor`'s `data.platform` and shells `tan platform …`.
// Every decision that is not a vscode call lives in `@alp-sdk/core/platform`.

import * as fs from "node:fs";
import * as path from "node:path";

import {
  isPlatformTarget,
  isListAccessIssue,
  listFailedIssue,
  mismatchKey,
  platformMenu,
  readPlatform,
  readPlatformList,
  statusBarText,
  switchCandidates,
  warningMessage,
  withOwnVersion,
  type PlatformAction,
  type PlatformPin,
  type PlatformRelease,
} from "@alp-sdk/core/platform/service";
import * as vscode from "vscode";

import { runDoctor } from "./alpCli/doctor";
import { runAlpCommand, runAlpInTerminal } from "./alpCli/vscodeAdapter";
import { notify } from "./notify/vscodeAdapter";
import { planCliOutcome } from "./notify/service";
import {
  collectProjectContext,
  readOnlyProjectCwd,
} from "./project/vscodeAdapter";
import { awaitRun, isRunActive, log } from "./util";

export const PLATFORM_COMMAND = "alp.platformRelease";
const RUN_NAME = "Alp: platform";
const PIN_FILE = path.join(".alp", "platform.yaml");

let item: vscode.StatusBarItem | undefined;
/** `undefined` = tan does not support platforms (or doctor failed);
 *  `null` = supported, no pin. */
let current: PlatformPin | null | undefined;
/** Mismatch sets already warned about this session. */
const warned = new Set<string>();
let malformedLogged = false;
let inflight: Promise<void> | undefined;
let rerun = false;
/** The last doctor run produced no report (tan missing, timed out, bad
 *  output) — distinct from an old tan that simply has no `platform`. */
let doctorFailed = false;

/** Test seam: forget every session latch. */
export function resetPlatformState(): void {
  item = undefined;
  current = undefined;
  rerun = false;
  doctorFailed = false;
  warned.clear();
  malformedLogged = false;
  inflight = undefined;
}

/** Create the item (hidden until the first doctor answer), register the
 *  command and the refresh triggers. Everything is returned for
 *  `context.subscriptions`. */
export function registerPlatform(
  context: vscode.ExtensionContext,
): vscode.Disposable[] {
  item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 97);
  item.command = PLATFORM_COMMAND;
  const refresh = () => void refreshPlatform(context);
  refresh();
  return [
    item,
    vscode.commands.registerCommand(PLATFORM_COMMAND, () =>
      platformRelease(context),
    ),
    vscode.workspace.onDidChangeWorkspaceFolders(refresh),
    vscode.workspace.onDidSaveTextDocument((doc) => {
      if (/[\\/]\.alp[\\/]platform\.yaml$/.test(doc.uri.fsPath)) refresh();
    }),
  ];
}

/** One `tan doctor` run -> `applyPlatform`. A call made while one is in
 *  flight is not dropped: it runs once more afterwards, so the state a
 *  `tan platform` command just changed is what ends up on screen. */
export function refreshPlatform(
  context: vscode.ExtensionContext,
): Promise<void> {
  if (inflight) {
    rerun = true;
    return inflight;
  }
  inflight = (async () => {
    try {
      do {
        rerun = false;
        await refreshOnce(context);
      } while (rerun);
    } finally {
      inflight = undefined;
    }
  })();
  return inflight;
}

async function refreshOnce(context: vscode.ExtensionContext): Promise<void> {
  if (!vscode.workspace.workspaceFolders?.length) {
    applyPlatform(context, undefined);
    return;
  }
  // `readOnlyProjectCwd`, never `""` (which spawn resolves to the extension
  // host's own directory). A folder holding only `.alp/platform.yaml` still
  // resolves: the first workspace folder is the root when no board.yaml is.
  const doctor = await runDoctor(
    context,
    ["doctor"],
    readOnlyProjectCwd(),
    undefined,
    false,
  );
  // A failed run carries no `platform`: that clears the item rather than
  // leaving the last pin on screen.
  applyPlatform(context, doctor.platform, doctor.data === null);
}

/** Apply one doctor answer (`undefined` when there was none). `failed` = the
 *  doctor run produced no report at all. */
export function applyPlatform(
  context: vscode.ExtensionContext,
  raw: unknown,
  failed = false,
): void {
  doctorFailed = failed;
  const read = readPlatform(raw);
  if (read.kind === "malformed" && !malformedLogged) {
    malformedLogged = true;
    log(
      "[platform] ignoring a malformed `data.platform` in tan doctor",
      "warn",
    );
  }
  if (read.kind === "unsupported" || read.kind === "malformed") {
    current = undefined;
    item?.hide();
    return;
  }
  if (!item) return;
  if (read.kind === "none") {
    current = null;
    item.text = statusBarText(null);
    item.tooltip = "No Alp Platform pin — click to choose a release";
    item.color = new vscode.ThemeColor("disabledForeground");
    item.backgroundColor = undefined;
    item.show();
    return;
  }
  const pin = withOwnVersion(
    read.pin,
    String(context.extension.packageJSON.version),
  );
  current = pin;
  const key = mismatchKey(pin);
  item.text = statusBarText(pin);
  item.tooltip = `Alp Platform ${pin.version} (line ${pin.line})`;
  item.color = undefined;
  item.backgroundColor = key
    ? new vscode.ThemeColor("statusBarItem.warningBackground")
    : undefined;
  item.show();

  if (key === "" || warned.has(key)) return;
  warned.add(key);
  const title = `Run tan platform use ${pin.line}`;
  void notify({
    severity: "warning",
    channel: "toast",
    message: warningMessage(pin),
    actions: [{ id: "usePlatform", title }],
  }).then((picked) =>
    picked === "usePlatform" ? usePlatform(context, pin.line) : undefined,
  );
}

/**
 * Run `tan platform <args>` in the terminal, then refresh the item. `args` is
 * a pass-through parameter, so the surface-contract gate sees one unresolved
 * site here (EXPECTED_UNRESOLVABLE); the literal `["platform", ...]` argvs
 * its callers pass are not followed into.
 */
async function runPlatform(
  context: vscode.ExtensionContext,
  args: string[],
): Promise<void> {
  const cwd = collectProjectContext().workspaceRoot;
  if (cwd === null) {
    log("[platform] no workspace folder open — not running tan platform");
    return;
  }
  // The busy guard refuses (and reserves nothing) when this run name is live;
  // awaiting it then would never settle.
  const busy = isRunActive(RUN_NAME);
  await runAlpInTerminal(context, args, { name: RUN_NAME, cwd });
  // `runAlpInTerminal` returns without dispatching when the CLI cannot be
  // resolved or its dispatch gate declines, and the busy guard refuses without
  // reserving: none of those ever fires a finish event, so waiting would leak.
  // A live reservation is proof a run started (`runInTerminal` reserves
  // synchronously, and this check runs before any task event can).
  if (busy || !isRunActive(RUN_NAME)) return;
  await awaitRun(RUN_NAME);
  await refreshPlatform(context);
}

/** `tan platform use <line|version>`. Refuses anything outside the §1 grammar
 *  rather than hand a free-form string to argv. */
export async function usePlatform(
  context: vscode.ExtensionContext,
  target: string,
): Promise<void> {
  if (!isPlatformTarget(target)) {
    log(`[platform] refusing to run tan platform use "${target}"`, "warn");
    return;
  }
  await runPlatform(context, ["platform", "use", target]);
}

async function useManifestFile(
  context: vscode.ExtensionContext,
): Promise<void> {
  const picked = await vscode.window.showOpenDialog({
    canSelectMany: false,
    openLabel: "Use manifest",
    filters: { "Platform manifest": ["yaml", "yml"] },
  });
  const file = picked?.[0]?.fsPath;
  if (file) await runPlatform(context, ["platform", "use", "--manifest", file]);
}

async function listFailed(
  context: vscode.ExtensionContext,
  outcome: Parameters<typeof planCliOutcome>[0],
): Promise<void> {
  const issues = outcome.envelope?.issues ?? [];
  const failed = listFailedIssue(issues);
  if (failed) {
    const picked = await notify({
      severity: "warning",
      channel: "toast",
      message: isListAccessIssue(issues)
        ? "Could not list Alp Platform releases: the release repository is " +
          "private for now, so tan needs a GITHUB_TOKEN with read access in " +
          "its environment. Set GITHUB_TOKEN and retry, or use a local " +
          "manifest file."
        : `Could not list Alp Platform releases: ${failed.message}`,
      actions: [{ id: "useManifestFile" }],
      dedupeKey: "platform-list-failed",
    });
    if (picked === "useManifestFile") await useManifestFile(context);
    return;
  }
  await notify(
    planCliOutcome(outcome, { operation: "Listing Alp Platform releases" }),
  );
}

/** "Switch platform release…": newest MICRO per line first, then everything. */
export async function switchRelease(
  context: vscode.ExtensionContext,
): Promise<void> {
  const { outcome } = await runAlpCommand(
    context,
    ["platform", "list"],
    collectProjectContext().workspaceRoot ?? undefined,
    { interactive: true },
  );
  const list = outcome.ok ? readPlatformList(outcome.envelope?.data) : null;
  if (!list) return listFailed(context, outcome);

  type Item = vscode.QuickPickItem & {
    release?: PlatformRelease;
    more?: boolean;
  };
  for (let all = false; ; all = true) {
    const items: Item[] = switchCandidates(list, all).map((release) => ({
      label: release.version,
      description: [
        release.prerelease ? "release candidate" : `line ${release.line}`,
        release.version === list.pinned ? "pinned" : "",
        release.published ?? "",
      ]
        .filter(Boolean)
        .join(" · "),
      release,
    }));
    if (!all) {
      items.push({
        label: "$(list-flat) Show all versions and release candidates…",
        more: true,
      });
    }
    const pick = await vscode.window.showQuickPick(items, {
      placeHolder: "Switch Alp Platform release",
    });
    if (!pick) return;
    if (pick.more) continue;
    if (pick.release) await usePlatform(context, pick.release.version);
    return;
  }
}

/** The pin file, found by walking up from the workspace root (§4). */
function findPinFile(): string | undefined {
  let dir = collectProjectContext().workspaceRoot;
  while (dir) {
    const candidate = path.join(dir, PIN_FILE);
    if (fs.existsSync(candidate)) return candidate;
    const parent = path.dirname(dir);
    dir = parent === dir ? null : parent;
  }
  return undefined;
}

async function runAction(
  context: vscode.ExtensionContext,
  action: PlatformAction,
): Promise<void> {
  if (action === "switch") return switchRelease(context);
  if (action === "reapply") {
    return current ? usePlatform(context, current.version) : undefined;
  }
  if (action === "clear") {
    const picked = await notify({
      severity: "warning",
      channel: "modal",
      message: "Clear the Alp Platform pin for this workspace?",
      modalDetail: "Only the pin is removed; installed tools are not changed.",
      actions: [{ id: "applyChanges", title: "Clear pin" }],
    });
    if (picked === "applyChanges")
      await runPlatform(context, ["platform", "clear"]);
    return;
  }
  const file = findPinFile();
  if (!file) {
    log("[platform] no .alp/platform.yaml found above the workspace root");
    return;
  }
  await vscode.window.showTextDocument(vscode.Uri.file(file));
}

/** `Alp: Platform Release…` — the status bar item's click. */
export async function platformRelease(
  context: vscode.ExtensionContext,
): Promise<void> {
  if (doctorFailed) {
    await notify({
      severity: "warning",
      channel: "toast",
      message:
        "Could not read the Alp Platform state: `tan doctor` produced no " +
        "report. Run Doctor to see why, then try again.",
      actions: [{ id: "runDoctor" }],
      dedupeKey: "platform-doctor-failed",
    });
    return;
  }
  if (current === undefined) {
    await notify({
      severity: "info",
      channel: "toast",
      message:
        "The tan in use does not support Alp Platform releases " +
        "(`tan platform`). Update tan to use them.",
      actions: [{ id: "updateCli" }],
      dedupeKey: "platform-unsupported",
    });
    return;
  }
  const items = platformMenu(current).map((m) => ({
    ...m,
    kind: m.separator ? vscode.QuickPickItemKind.Separator : undefined,
  }));
  const pick = await vscode.window.showQuickPick(items, {
    placeHolder: "Alp Platform release",
  });
  if (pick?.action) await runAction(context, pick.action);
}
