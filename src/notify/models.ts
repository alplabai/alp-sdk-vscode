// SPDX-License-Identifier: Apache-2.0
//
// Types for the ONE notification seam. Every customer-facing notification is
// a `NotificationPlan` built by the pure planner (`service.ts`) and rendered
// by the single presenter (`vscodeAdapter.ts`). Nothing else in the extension
// may call `vscode.window.show*Message` — `test/notify.guard.test.js` enforces
// that, and this split is what makes the four structural guarantees possible:
//
//   1. severity comes from the CLI outcome, never from the call site;
//   2. a toast/modal always carries at least one action (no dead ends);
//   3. raw stderr / errno / exit codes / absolute paths go to `detail`, which
//      is logged to the "Alp SDK" channel and never rendered in a toast;
//   4. every envelope issue stays reachable, not just `issues[0]`.

import { AlpIssue } from "../alpCli/models";

/** Where a plan is rendered. `silent` = the channel only (a panel already owns
 *  an inline error region); `statusBar` = transient, no dismissal click. */
export type NotifyChannel = "statusBar" | "toast" | "modal" | "silent";

export type NotifySeverity = "info" | "warning" | "error";

/**
 * Stable action ids. The PURE planner may name only these — never a `vscode`
 * command id and never a button title; the presenter owns both.
 *
 * `showOutput` is RESERVED: the presenter appends it to any non-info plan that
 * has no other channel-revealing action, so a planner rarely names it (naming
 * it explicitly is fine — it is de-duplicated, never shown twice).
 *
 * Ids WITHOUT a `run` in the presenter's ACTIONS table are returned to the
 * caller so it can branch (`retry`, `startAnyway`, `applyChanges`,
 * `openAnyway`, `deleteFromDisk`) — that is what keeps modal-confirm and
 * branch-on-pick call sites working. They are meaningful ONLY on an awaited
 * `notify()`: `notifyAsync()` discards the pick, so it strips them from the
 * plan before presenting rather than render a button that does nothing.
 */
export type ActionId =
  | "showOutput"
  | "showIssues"
  | "runDoctor"
  | "installTanCli"
  | "updateCli"
  | "openSettings" // arg = setting key, default "alpSdk"
  | "openFolder"
  | "newProject"
  | "openSetupFlow"
  | "bootstrap"
  | "openBoardYaml" // arg = absolute path, else the resolved project board.yaml
  | "openLaunchJson"
  | "openSdkManager"
  | "openTroubleshooting"
  | "openExtensions" // arg = extension id, default this extension
  | "downloadGit"
  | "reloadWindow"
  | "showTerminal" // arg = the runInTerminal run name
  // caller-handled — no `run`, so `notify()` returns the id and the caller
  // decides what happens next:
  | "retry"
  | "startAnyway"
  | "applyChanges"
  | "openAnyway"
  | "deleteFromDisk"
  // presenter-only: an ad-hoc button whose title comes from `NotifyAction.title`.
  // Exists solely for `reportError`'s legacy `...actions: string[]` parameter;
  // the pure planner never emits it.
  | "custom";

export interface NotifyAction {
  id: ActionId;
  /** Action-specific argument (a setting key, an extension id, a path, a run
   *  name). Never rendered — the title comes from the presenter's table. */
  arg?: string;
  /** Title override for any action; the presenter falls back to the ACTIONS
   *  table when absent. Required for `id: "custom"`, which has no default
   *  title. */
  title?: string;
}

export interface NotificationPlan {
  severity: NotifySeverity;
  channel: NotifyChannel;
  /** The customer-facing sentence. CONTRACT: no raw stderr, no stack, no
   *  errno (ENOENT/EACCES/…), no exit code, no absolute path, no internal
   *  identifier. Anything of that kind belongs in `detail`. */
  message: string;
  /** Everything `message` must not carry. Logged to the "Alp SDK" output
   *  channel by the presenter — the ONLY place it is written — and never
   *  rendered in a notification. */
  detail?: string;
  /** `modal` only: fills `vscode.MessageOptions.detail`, which IS rendered on
   *  the dialog. Destructive confirms need their path/consequence text ON the
   *  dialog, so it must not be routed into the channel-only `detail`. */
  modalDetail?: string;
  /** May be empty ONLY when `channel === "statusBar"`. Every toast and modal
   *  carries at least one action — that is what makes a dead end impossible. */
  actions: NotifyAction[];
  /** The WHOLE issue array, so nothing after `issues[0]` is unreachable. */
  issues?: AlpIssue[];
  /** The presenter drops a plan whose key is already on screen, killing the
   *  one-cause-three-toasts stacks. NOT a substitute for per-window one-shot
   *  guards: it only suppresses while an identical toast is still up. */
  dedupeKey?: string;
  /** `statusBar` only; defaults to 5000 ms. */
  timeoutMs?: number;
}
