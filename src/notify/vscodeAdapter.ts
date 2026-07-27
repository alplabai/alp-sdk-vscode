// SPDX-License-Identifier: Apache-2.0
//
// The ONE presenter. Every customer-facing notification in the extension is
// rendered here — `test/notify.guard.test.js` fails the build if any other
// file calls `vscode.window.show*Message` (only `util.ts`'s synchronous
// runInTerminal busy-guard is allowlisted, because importing this module from
// `util.ts` would be a cycle: this file imports log/showOutput/
// revealRunInTerminal FROM util.ts).
//
// What a single presenter buys, none of which survives being re-typed at 85
// call sites: the detail is logged in exactly one place, every non-info toast
// gets a way into the output channel, vscode command ids live in exactly one
// table, and a repeated cause can be de-duplicated.

import * as vscode from "vscode";

import { collectProjectContext } from "../project/vscodeAdapter";
import { log, revealRunInTerminal, showOutput } from "../util";
import { ActionId, NotificationPlan, NotifyAction } from "./models";

/**
 * This extension's own `<publisher>.<name>`, as VS Code registered it — the
 * `openExtensions` default. Set once from `context.extension.id` in
 * `activate`, because the presenter is a module and has no context.
 *
 * NOT a literal: the hardcoded copy that used to sit in the search filter read
 * `alplabai.alp-sdk` while package.json publishes `"publisher": "AlpLabAI"`,
 * so the Extensions view opened on nothing.
 * `test/setupOrchestrator.service.test.js` fails if it is re-typed.
 */
let thisExtensionId = "";

export function setExtensionId(id: string): void {
  thisExtensionId = id;
}

/**
 * The ONLY place vscode command ids and button titles live.
 *
 * THE CONTRACT: an action WITH a `run` is executed here and `notify` returns
 * undefined; an action WITHOUT a `run` is returned to the caller so it can
 * branch. Modal confirms and every "Start Anyway"-style flow depend on that —
 * moving one of them into a `run` would silently swallow the pick that gates
 * the real work.
 */
const ACTIONS: Record<
  ActionId,
  { title: string; run?: (arg?: string) => Thenable<unknown> }
> = {
  showOutput: {
    title: "Show Output",
    run: async () => showOutput(),
  },
  // Handled inside `present` (it needs the plan's issues), so no `run` here —
  // it must never be returned to a caller as an unhandled pick either.
  showIssues: { title: "Show All Issues" },
  runDoctor: {
    title: "Run Doctor",
    run: () => vscode.commands.executeCommand("alp.toolchainDoctor"),
  },
  installTanCli: {
    title: "Install tan CLI",
    run: () => vscode.commands.executeCommand("alp.installTanCli"),
  },
  updateCli: {
    title: "Update tan CLI",
    run: () => vscode.commands.executeCommand("alp.updateCli"),
  },
  openSettings: {
    title: "Open Settings",
    run: (arg) =>
      vscode.commands.executeCommand(
        "workbench.action.openSettings",
        arg ?? "alpSdk",
      ),
  },
  openFolder: {
    title: "Open Folder",
    run: () => vscode.commands.executeCommand("alp.switchWorkspace"),
  },
  newProject: {
    title: "New Project",
    run: () => vscode.commands.executeCommand("alp.newProjectWizard"),
  },
  openSetupFlow: {
    title: "Open Setup",
    run: () => vscode.commands.executeCommand("alp.openSetupFlow"),
  },
  bootstrap: {
    title: "Run Bootstrap",
    run: () => vscode.commands.executeCommand("alp.installDependencies"),
  },
  openBoardYaml: { title: "Open board.yaml", run: openBoardYaml },
  openLaunchJson: { title: "Open launch.json", run: openLaunchJson },
  openSdkManager: {
    title: "Open SDK Manager",
    run: () => vscode.commands.executeCommand("alp.openSdkManager"),
  },
  openTroubleshooting: {
    title: "Open Troubleshooting",
    run: () =>
      vscode.commands.executeCommand("alp.openDebugTroubleshootingPanel"),
  },
  openExtensions: {
    title: "Open Extensions",
    run: (arg) =>
      vscode.commands.executeCommand(
        "workbench.extensions.search",
        `@id:${arg ?? thisExtensionId}`,
      ),
  },
  reloadWindow: {
    title: "Reload Window",
    run: () => vscode.commands.executeCommand("workbench.action.reloadWindow"),
  },
  showTerminal: {
    title: "Show Terminal",
    run: async (arg) => {
      if (arg) revealRunInTerminal(arg);
    },
  },
  // ── caller-handled: no `run`, so the id comes back from notify() ──
  retry: { title: "Retry" },
  startAnyway: { title: "Start Anyway" },
  applyChanges: { title: "Apply Changes" },
  openAnyway: { title: "Open Anyway" },
  deleteFromDisk: { title: "Delete from disk" },
  custom: { title: "" }, // title always overridden by NotifyAction.title
};

/** Keys of plans currently on screen — a second plan with the same key is
 *  dropped rather than stacked. Only lives for the toast's lifetime, so it is
 *  NOT a substitute for the per-window one-shot guards in alpCli. */
const onScreen = new Set<string>();

/**
 * Render a plan. Returns the picked action's id when that action is
 * caller-handled (no `run`), and undefined otherwise — including when the
 * presenter ran the action itself, when the plan was silent/status-bar/
 * de-duplicated, and when the user dismissed the notification.
 */
export async function notify(
  plan: NotificationPlan,
): Promise<ActionId | undefined> {
  return (await present(plan))?.id;
}

/** Fire-and-forget: for webview `onDidReceiveMessage` handlers and other
 *  synchronous callers that must not block their message pump — awaiting a
 *  toast there reorders it against the `post()`/`refresh()` that follow, and a
 *  dismissed toast can leave a panel spinning forever.
 *
 *  Nobody reads the pick here, so a caller-handled action (no `run` in ACTIONS)
 *  would render a button that does NOTHING when clicked — the exact dead end
 *  this seam exists to prevent. They are stripped BEFORE presenting rather than
 *  fixed per call site, because the planner emits `retry` unconditionally for
 *  exit-3 and for the notInstalled/downloadFailed/timeout binary failures, and
 *  any of those can reach any fire-and-forget site. `notify()` (awaited) is
 *  deliberately untouched — there the pick comes back and is acted on. */
export function notifyAsync(plan: NotificationPlan): void {
  const actions = plan.actions.filter(isPresenterHandled);
  // Same backstop as the planner's `finalize`, re-applied because stripping can
  // empty an otherwise non-empty plan (an info-severity toast gets no appended
  // "Show Output", so nothing else would refill it).
  if (actions.length === 0 && plan.channel !== "statusBar") {
    actions.push({ id: "showOutput" });
  }
  void notify({ ...plan, actions }).then((picked) => {
    if (picked) {
      log(
        `[notify] fire-and-forget action "${picked}" was picked but nobody can handle it — ${plan.message}`,
        "warn",
      );
    }
  });
}

/** True when the presenter itself acts on the pick (`run`), or handles it
 *  inline (`showIssues`) — i.e. the button does something without a caller. */
function isPresenterHandled(action: NotifyAction): boolean {
  return action.id === "showIssues" || Boolean(ACTIONS[action.id].run);
}

async function present(
  plan: NotificationPlan,
): Promise<NotifyAction | undefined> {
  // 1. The channel first, and the ONLY place `detail` is ever written.
  log(
    plan.detail ? `${plan.message} — ${plan.detail}` : plan.message,
    plan.severity === "error"
      ? "error"
      : plan.severity === "warning"
        ? "warn"
        : "info",
  );

  if (plan.channel === "silent") return undefined;

  if (plan.channel === "statusBar") {
    vscode.window.setStatusBarMessage(plan.message, plan.timeoutMs ?? 5000);
    return undefined;
  }

  if (plan.dedupeKey) {
    if (onScreen.has(plan.dedupeKey)) return undefined;
    onScreen.add(plan.dedupeKey);
  }
  try {
    return await show(plan);
  } finally {
    if (plan.dedupeKey) onScreen.delete(plan.dedupeKey);
  }
}

async function show(plan: NotificationPlan): Promise<NotifyAction | undefined> {
  const actions = withShowOutput(plan);
  const titles = actions.map(titleOf);
  // `{}` is a valid MessageOptions, so the modal/non-modal split needs no
  // second overload; a non-modal plan's `modalDetail` is simply never set.
  const options: vscode.MessageOptions =
    plan.channel === "modal" ? { modal: true, detail: plan.modalDetail } : {};

  const picked = await (plan.severity === "error"
    ? vscode.window.showErrorMessage(plan.message, options, ...titles)
    : plan.severity === "warning"
      ? vscode.window.showWarningMessage(plan.message, options, ...titles)
      : vscode.window.showInformationMessage(plan.message, options, ...titles));
  if (picked === undefined) return undefined;
  const action = actions.find((a) => titleOf(a) === picked);
  if (!action) return undefined;

  if (action.id === "showIssues") {
    for (const issue of plan.issues ?? []) {
      log(`[${issue.severity}] ${issue.code}: ${issue.message}`);
    }
    showOutput();
    return undefined;
  }
  const run = ACTIONS[action.id].run;
  if (!run) return action;
  await run(action.arg);
  return undefined;
}

function titleOf(action: NotifyAction): string {
  return action.title ?? ACTIONS[action.id].title;
}

/** Append the reserved "Show Output" to anything worse than info — unless the
 *  plan already offers a way into the same channel, since two buttons pointing
 *  at one destination is worse than none.
 *
 *  NEVER on a modal: it is blocking and already carries Cancel, so it has no
 *  dead end to backstop, and these are the destructive confirms ("Remove SDK
 *  <name>?", "Remove west initialization…"). An output-log button between the
 *  destructive verb and Cancel is noise, and a mis-click on it silently
 *  cancels the delete. */
function withShowOutput(plan: NotificationPlan): NotifyAction[] {
  const actions = [...plan.actions];
  if (plan.channel === "modal") return actions;
  const revealsChannel = actions.some(
    (a) => a.id === "showIssues" || a.id === "showOutput",
  );
  if (plan.severity !== "info" && !revealsChannel) {
    actions.push({ id: "showOutput" });
  }
  return actions;
}

// The three paths below all reveal the channel when they cannot open the file:
// a button that writes one line the customer never sees is the same dead end as
// a button with no handler.

async function openBoardYaml(arg?: string): Promise<void> {
  // `src/project/service.ts` (via collectProjectContext) is the single source
  // of truth for the board.yaml path — never re-resolve it here.
  const target = arg ?? collectProjectContext().boardYamlPath;
  if (!target) {
    log("[notify] no board.yaml path resolved — nothing to open", "warn");
    showOutput();
    return;
  }
  await openPath(target);
}

async function openLaunchJson(arg?: string): Promise<void> {
  const root = collectProjectContext().workspaceRoot;
  const target = arg ?? (root ? `${root}/.vscode/launch.json` : null);
  if (!target) {
    log("[notify] no workspace root — cannot open launch.json", "warn");
    showOutput();
    return;
  }
  await openPath(target);
}

async function openPath(target: string): Promise<void> {
  try {
    const doc = await vscode.workspace.openTextDocument(
      vscode.Uri.file(target),
    );
    await vscode.window.showTextDocument(doc, { preview: false });
  } catch (error) {
    log(
      `[notify] could not open ${target}: ${error instanceof Error ? error.message : String(error)}`,
      "warn",
    );
    showOutput();
  }
}

/**
 * Report a diagnosable failure: log the full detail to the "Alp SDK" channel
 * AND show an error toast that always offers "Show Output" (plus any caller
 * actions). Picking "Show Output" reveals the channel and returns undefined;
 * otherwise the picked caller action is returned.
 *
 * TRANSITIONAL — it moved here from `src/util.ts` unchanged in signature so
 * its existing callers keep compiling while they are migrated. It bypasses the
 * pure planner, so it guarantees only the channel + "Show Output"; new code
 * builds a plan (`planFailure` / `planCliOutcome` / `planPrecondition`) and
 * calls `notify`, which also guarantees the severity and the message hygiene.
 *
 * Do not pass a caller action literally titled "Show Output" — that title is
 * reserved for the appended house action and would be indistinguishable.
 */
export async function reportError(
  message: string,
  detail?: string,
  ...actions: string[]
): Promise<string | undefined> {
  const picked = await present({
    severity: "error",
    channel: "toast",
    message,
    detail,
    actions: actions.map((title) => ({ id: "custom" as ActionId, title })),
  });
  return picked?.title;
}
