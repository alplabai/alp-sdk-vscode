// SPDX-License-Identifier: Apache-2.0
//
// The PURE notification planner: (outcome | failure | precondition | success)
// -> NotificationPlan. No `vscode`, no `fs`, no `child_process` — deterministic
// in, deterministic out, unit-tested by `test/notify.service.test.js`.
//
// This file exists to make four failure modes STRUCTURALLY impossible rather
// than a review convention (see `models.ts` for the list). The one that costs
// the most in the field: a call site hand-picking `showErrorMessage` while a
// classified `CliOutcome` is in scope, so an exit-2 validation failure reads
// like a crash — `planCliOutcome` reads `outcome.severity` and nothing else.

import { CliOutcome } from "../alpCli/models";
import {
  ActionId,
  NotificationPlan,
  NotifyAction,
  NotifyChannel,
  NotifySeverity,
} from "./models";

export interface OperationContext {
  /** What the USER asked for, sentence-start and capitalised: "Generating the
   *  Zephyr .conf", "Validating board.yaml", "Creating the project". */
  operation: string;
  /** The surface owns an inline error region (a panel that renders issues
   *  itself), so the plan is logged but never toasted. */
  inline?: boolean;
  /** Site-specific actions, appended after the outcome-derived ones. Where the
   *  board.yaml genuinely IS the input the CLI rejected, this is how
   *  `{ id: "openBoardYaml" }` gets on the plan — see `kindActions`. */
  extraActions?: NotifyAction[];
  dedupeKey?: string;
}

/**
 * True for VS Code's `CancellationError` — "the window went away", NOT "the
 * thing failed".
 *
 * When the extension host tears a window down (reload, close, or a folder-open
 * that replaces the workspace) the RPC protocol rejects EVERY pending
 * main-thread reply with one of these. An unanswered toast is the likeliest
 * pending call, so any `await` on a notification, a memento write or a
 * `executeCommand` can land here through no fault of its own. Logging that as
 * a failure is the closed-window-vs-broken confusion this seam exists to keep
 * out of the customer-facing channel.
 *
 * STRUCTURAL, and deliberately narrow:
 *  - `instanceof vscode.CancellationError` is unavailable twice over — this
 *    module is pure (no `vscode`), and the error crosses the RPC boundary, so
 *    the prototype would not survive anyway.
 *  - BOTH `name` and `message` must be exactly "Canceled" (VS Code's own
 *    `CancellationError` sets `this.name = this.message = "Canceled"`).
 *    Matching the message alone would swallow a REAL fault whose text merely
 *    mentions cancellation ("Bootstrap was canceled by the user") — a silenced
 *    real error is worse than the noisy line this predicate removes.
 */
export function isCancellation(err: unknown): boolean {
  if (typeof err !== "object" || err === null) return false;
  const e = err as { name?: unknown; message?: unknown };
  return e.name === "Canceled" && e.message === "Canceled";
}

/** Raw-diagnostic markers that must never reach a customer-facing sentence.
 *  An explicit errno list (not `E[A-Z]+`) so ordinary prose can't trip it. */
const ERRNO =
  /\bE(?:ACCES|ADDRINUSE|AGAIN|BADF|BUSY|CANCELED|CONNREFUSED|CONNRESET|EXIST|FAULT|HOSTUNREACH|INVAL|IO|ISDIR|LOOP|MFILE|NAMETOOLONG|NETUNREACH|NFILE|NOENT|NOMEM|NOSPC|NOTDIR|NOTEMPTY|NOTFOUND|PERM|PIPE|PROTO|ROFS|SPIPE|TIMEDOUT|XDEV)\b/;
const EXIT_CODE = /\bexit(?:ed)?(?:\s+(?:code|with(?:\s+code)?))?[\s:]+-?\d+/i;
const STACK = /\n\s*at\s|\bat\s[\w$.]+\s\(/;
const ABSOLUTE_PATH =
  /[A-Za-z]:[\\/]|(?:^|[\s"'(])\/(?:home|Users|usr|var|tmp|opt|mnt|etc|private)\//;

/** True when `text` carries an errno, an exit code, or a stack frame. */
function looksRaw(text: string): boolean {
  return ERRNO.test(text) || EXIT_CODE.test(text) || STACK.test(text);
}

function joinDetail(...parts: (string | undefined)[]): string | undefined {
  const kept = parts.filter((p): p is string => Boolean(p && p.trim()));
  return kept.length > 0 ? kept.join(" — ") : undefined;
}

/**
 * The one exit through which every plan leaves this module. Enforces the
 * "no dead end" invariant: a toast or modal with no action would leave the
 * customer with nothing but a dismiss click, so `showOutput` backstops it (the
 * presenter de-duplicates, so this never yields two channel buttons).
 */
function finalize(plan: NotificationPlan): NotificationPlan {
  if (plan.channel !== "statusBar" && plan.actions.length === 0) {
    plan.actions.push({ id: "showOutput" });
  }
  return plan;
}

/**
 * The remedies that fit each stable exit-code family (CLI.md).
 *
 * `openBoardYaml` is deliberately NOT here. Exit 2 means "the CLI rejected the
 * input", not "board.yaml is wrong": `tan init --som <bad sku>` and a failed
 * SDK-list both exit 2, and in the New Project flow there is usually no
 * project — the button would resolve nothing, or worse, open an unrelated
 * open folder's board.yaml. Sites whose exit-2 really is board.yaml (validate,
 * generate) pass it themselves via `ctx.extraActions`.
 */
function kindActions(outcome: CliOutcome): NotifyAction[] {
  switch (outcome.kind) {
    case "success":
    case "validation":
      return [];
    case "write":
      return [{ id: "retry" }];
    case "doctor":
      return [{ id: "bootstrap" }, { id: "runDoctor" }];
    default:
      return [{ id: "runDoctor" }];
  }
}

/**
 * "The tan CLI never produced an envelope" — the binary itself is the problem.
 * `CliOutcome.unavailable.reason` (set by the two producers in `src/alpCli/`)
 * decides the sentence and the remedy, so no call site has to guess: the
 * never-installed reasons offer Install, the installed-but-broken ones offer
 * Settings/Doctor. That distinction is the whole point — offering "Open
 * Settings → alpSdk.cliPath" to a first-run user who has no binary at all is
 * the wrong fix, and it is what every site did before this seam.
 */
function unavailablePlan(
  outcome: CliOutcome,
  ctx: OperationContext,
): { message: string; actions: NotifyAction[] } {
  const op = ctx.operation;
  const settings: NotifyAction = {
    id: "openSettings",
    arg: "alpSdk.cliPath",
  };
  switch (outcome.unavailable?.reason) {
    case "notInstalled":
      return {
        message: `${op} needs the tan CLI, which isn't installed yet.`,
        actions: [{ id: "installTanCli" }, { id: "retry" }],
      };
    case "noPrebuilt":
      return {
        // `outcome.message` VERBATIM, for the same reason `checksumRefused`
        // below takes it verbatim: only the producer knows the two facts that
        // make this sentence worth reading — WHICH host, and WHICH tan release.
        // It is `noPrebuiltMessage` (`src/alpCli/service.ts`) by construction:
        // `classifyUnavailable` reaches this reason by matching that function's
        // own opening. The composed sentence this replaced ("there's no
        // prebuilt build for this machine") named neither, so a customer on a
        // host the pinned release simply doesn't build for could not tell it
        // from a broken install — and the remedy button alone doesn't say it.
        message: outcome.message,
        actions: [settings],
      };
    case "cliPathMissing":
      return {
        message: `${op} can't find the tan CLI that the alpSdk.cliPath setting points at.`,
        actions: [settings, { id: "installTanCli" }],
      };
    case "downloadFailed":
      return {
        message: `${op} couldn't download the tan CLI.`,
        actions: [{ id: "retry" }, settings],
      };
    case "notNative":
      return {
        message: `${op} needs the tan CLI, but the binary it resolved isn't it.`,
        actions: [settings, { id: "installTanCli" }],
      };
    case "corrupt":
      return {
        message: `${op} couldn't start the tan CLI — the installed copy looks broken.`,
        actions: [{ id: "installTanCli" }, settings],
      };
    case "checksumRefused":
      return {
        // `outcome.message` VERBATIM, not a sentence composed here. This is the
        // one reason carrying FIVE distinct causes over two arms, all of which
        // must stay distinguishable and only the producer knows which fired.
        // Downloading (#389): the bytes did not match / the checksum could not
        // be fetched / the release does not list this asset. Cached (#386): the
        // copy predates the digest record and cannot be checked against
        // anything / the copy on disk no longer matches its record. It is a
        // customer sentence by construction: `ChecksumError` keeps every
        // digest, URL and path on `detail`, which stays channel-only.
        message: outcome.message,
        // Retry is safe by construction — it re-verifies, so it can never
        // install the refused bytes — and a one-off mismatch really is often a
        // corrupted transfer. `showOutput` is named explicitly rather than left
        // to `finalize`'s backstop, because `retry` is caller-handled and
        // `notifyAsync` strips it: without this the toast would be a dead end
        // at exactly the moment the digests matter most.
        //
        // `settings` is deliberately ABSENT, and must stay absent. Every other
        // remedy here can be offered mid-tamper; `alpSdk.cliPath` cannot,
        // because that source is never checksum-verified.
        actions: [{ id: "retry" }, { id: "showOutput" }],
      };
    case "consentDeclined":
      return {
        // Names all three routes past this refusal: the setting (this
        // sentence's own subject), `alpSdk.cliPath` (a binary the customer
        // already has, no download needed), and the two commands below,
        // which proceed regardless of this setting — running one of them IS
        // consent. Nothing here claims the BINARY is broken (it is `corrupt`
        // /`checksumRefused` that say that), so no Doctor button.
        message:
          `${op} needs the tan CLI, and its download hasn't been consented ` +
          "to yet. Set alpSdk.tanCliDownloadConsent to allow it, or point " +
          "alpSdk.cliPath at a tan you already have.",
        actions: [
          { id: "openSettings", arg: "alpSdk.tanCliDownloadConsent" },
          { id: "installTanCli" },
          { id: "updateCli" },
        ],
      };
    case "timeout":
      return {
        message: `${op} timed out waiting for the tan CLI.`,
        actions: [{ id: "retry" }, { id: "runDoctor" }],
      };
    default:
      return {
        message: `${op} couldn't start the tan CLI.`,
        actions: [{ id: "runDoctor" }, { id: "installTanCli" }],
      };
  }
}

/**
 * Plan a notification for a classified `CliOutcome`.
 *
 * SEVERITY COMES FROM THE OUTCOME — `classifyOutcome` already maps exit 2
 * (validation) and exit 4 (doctor) to "warning", every other non-zero to
 * "error", and 0 to "info". There is deliberately no severity parameter: the
 * call site cannot override it.
 */
export function planCliOutcome(
  outcome: CliOutcome,
  ctx: OperationContext,
): NotificationPlan {
  const extras = ctx.extraActions ?? [];
  const toastOrSilent: NotifyChannel = ctx.inline ? "silent" : "toast";

  // A. The binary never ran — no envelope, and we know why.
  if (outcome.unavailable) {
    const { message, actions } = unavailablePlan(outcome, ctx);
    return finalize({
      severity: outcome.severity,
      channel: toastOrSilent,
      message,
      detail: outcome.unavailable.detail,
      actions: [...actions, ...extras],
      dedupeKey: ctx.dedupeKey ?? "cli-unavailable",
    });
  }

  // B. It ran, but stdout was not an envelope this extension understands —
  //    CLI-shape skew (a tan older/newer than the pinned contract), not a
  //    missing binary, so the remedy is a version fix, not an install.
  if (!outcome.envelope) {
    return finalize({
      severity: outcome.severity,
      channel: toastOrSilent,
      message: `${ctx.operation} failed — the tan CLI didn't return a result this extension understands.`,
      detail: joinDetail(outcome.message, `exit ${outcome.exitCode}`),
      actions: [{ id: "updateCli" }, { id: "runDoctor" }, ...extras],
      dedupeKey: ctx.dedupeKey,
    });
  }

  // C. A real envelope. The issues are the message; ALL of them travel on the
  //    plan so nothing after issues[0] is unreachable (the old `summarize()`
  //    dropped the rest, and no surface ever showed them).
  const issues = outcome.envelope.issues ?? [];
  const first = issues[0]?.message;
  const more = Math.max(0, issues.length - 1);
  const generic = outcome.ok
    ? `${ctx.operation} finished.`
    : `${ctx.operation} failed.`;
  const message =
    first && !looksRaw(first)
      ? `${ctx.operation}: ${first}${more > 0 ? ` (+${more} more)` : ""}`
      : generic;

  return finalize({
    severity: outcome.severity,
    channel: ctx.inline
      ? "silent"
      : outcome.ok && issues.length === 0
        ? "statusBar"
        : "toast",
    message,
    // The exit code is channel detail, never a customer sentence.
    detail: joinDetail(
      outcome.ok ? undefined : `exit ${outcome.exitCode} (${outcome.kind})`,
      first && looksRaw(first) ? first : undefined,
    ),
    actions: [
      ...(issues.length > 0 ? [{ id: "showIssues" as ActionId }] : []),
      ...kindActions(outcome),
      ...extras,
    ],
    issues: issues.length > 0 ? issues : undefined,
    dedupeKey: ctx.dedupeKey,
  });
}

/**
 * Plan a failure that is NOT CLI-backed (a filesystem write, a thrown Node
 * error, a refused action). `cause` is the customer-facing sentence; anything
 * raw belongs in `detail`. As a backstop, a `cause` that still carries an
 * errno, an exit code, a stack frame or an absolute path is demoted into
 * `detail` and replaced with a plain "<operation> failed." — so a call site
 * that passes `String(err)` straight through leaks nothing.
 */
export function planFailure(input: {
  operation: string;
  cause: string;
  detail?: string;
  severity?: NotifySeverity;
  channel?: NotifyChannel;
  modalDetail?: string;
  actions?: NotifyAction[];
  dedupeKey?: string;
}): NotificationPlan {
  const leaks = looksRaw(input.cause) || ABSOLUTE_PATH.test(input.cause);
  return finalize({
    severity: input.severity ?? "error",
    channel: input.channel ?? "toast",
    message: leaks ? `${input.operation} failed.` : input.cause,
    detail: leaks
      ? joinDetail(input.cause, input.detail)
      : joinDetail(input.detail),
    modalDetail: input.modalDetail,
    actions: [...(input.actions ?? [])],
    dedupeKey: input.dedupeKey,
  });
}

/**
 * A blocking confirm. Modal, and `modalDetail` stays ON the dialog — the
 * consequence text of a destructive action (the absolute path being deleted,
 * "this cannot be undone") must not be routed into the channel-only `detail`,
 * which would turn a delete confirm into a dismissible toast.
 *
 * `confirm` MUST be a caller-handled action (no `run` in the presenter's
 * table) so the pick comes back and gates the real work.
 */
export function planConfirm(input: {
  message: string;
  modalDetail: string;
  confirm: NotifyAction;
  severity?: NotifySeverity;
}): NotificationPlan {
  return finalize({
    severity: input.severity ?? "warning",
    channel: "modal",
    message: input.message,
    modalDetail: input.modalDetail,
    actions: [input.confirm],
  });
}

export type PreconditionKind =
  | "noWorkspace"
  | "noBoardYaml"
  | "noSdk"
  | "noZephyrWorkspace";

/**
 * A precondition that isn't met yet. ALWAYS severity "warning", never "error":
 * "you haven't opened a folder / created a project yet" is a first-run state,
 * not a failure, and rendering it red is what made the extension feel broken
 * on first launch. Each kind carries the command that actually resolves it.
 */
export function planPrecondition(
  kind: PreconditionKind,
  ctx?: {
    /** Lower-case verb phrase: "write launch.json", "scaffold a module". */
    operation?: string;
    /** The path/setting that would otherwise be interpolated into the text. */
    detail?: string;
    extraActions?: NotifyAction[];
    dedupeKey?: string;
  },
): NotificationPlan {
  const base: Record<
    PreconditionKind,
    { message: string; actions: NotifyAction[] }
  > = {
    noWorkspace: {
      message: ctx?.operation
        ? `Open a folder to ${ctx.operation}.`
        : "Open a folder to use this command.",
      actions: [{ id: "openFolder" }],
    },
    noBoardYaml: {
      message: "No board.yaml in this folder yet.",
      actions: [{ id: "newProject" }, { id: "openSetupFlow" }],
    },
    noSdk: {
      message: "No Alp SDK is active yet.",
      actions: [{ id: "openSdkManager" }],
    },
    noZephyrWorkspace: {
      message:
        "No Zephyr workspace yet — a build can't start until one is bootstrapped.",
      actions: [{ id: "bootstrap" }],
    },
  };
  const { message, actions } = base[kind];
  return finalize({
    severity: "warning",
    channel: "toast",
    message,
    detail: ctx?.detail,
    actions: [...actions, ...(ctx?.extraActions ?? [])],
    dedupeKey: ctx?.dedupeKey,
  });
}

/**
 * Transient success. The status bar by default — a success the user must
 * dismiss is a cost with no information: the thing that succeeded is already
 * on screen (a document opened, a panel refreshed, a terminal still showing
 * its own output).
 *
 * A caller that passes `actions` (site-specific extras, the same convention
 * `planFailure`'s `actions` and `planPrecondition`'s `ctx.extraActions`
 * already use) gets a toast instead: the presenter's `statusBar` branch calls
 * `vscode.window.setStatusBarMessage`, which renders no buttons, so a plan
 * that actually has something worth a click needs the channel that can show
 * it. #331's "Show Result" (reveal the Build Plan panel from a build-finish
 * success) is the first caller.
 *
 * `timeoutMs` and `actions` are independent options that MAY be passed
 * together, but only one of them ever does anything on a given plan: the
 * presenter reads `timeoutMs` only on its `statusBar` branch
 * (`vscode.window.setStatusBarMessage(message, timeoutMs ?? 5000)`), which is
 * exactly the branch a non-empty `actions` steers away from — so a caller
 * combining both gets an actionable toast that never auto-dismisses, with
 * `timeoutMs` silently unused. Not worth a union: no caller does this today,
 * and the two options genuinely don't interact once the channel is fixed —
 * this note exists so a future combined caller isn't left debugging why its
 * timeout was ignored.
 */
export function planSuccess(
  message: string,
  options?: { timeoutMs?: number; detail?: string; actions?: NotifyAction[] },
): NotificationPlan {
  const actions = options?.actions ?? [];
  return finalize({
    severity: "info",
    channel: actions.length > 0 ? "toast" : "statusBar",
    message,
    detail: options?.detail,
    actions,
    timeoutMs: options?.timeoutMs,
  });
}
