// SPDX-License-Identifier: Apache-2.0

import * as vscode from "vscode";

const OUTPUT = vscode.window.createOutputChannel("Alp SDK");

export type LogLevel = "info" | "warn" | "error";

/** Append a timestamped, leveled line to the shared "Alp SDK" output channel.
 *  Existing callers pass just a message (level defaults to "info"), so the
 *  channel gains triage-grade prefixes without touching every call site. */
export function log(line: string, level: LogLevel = "info"): void {
  const ts = new Date().toISOString().slice(11, 23); // HH:MM:SS.mmm (UTC)
  OUTPUT.appendLine(`[${ts}] [${level}] ${line}`);
}

export function showOutput(): void {
  OUTPUT.show(true);
}

/** Fires when a `runInTerminal` run finishes (its process exits, or the task
 *  ends without ever starting one), carrying the run's `name` and its exit
 *  `code` (undefined if unknown). It is the real "an Alp command that ran in
 *  a terminal has finished" signal — the hub panels keep a standing
 *  subscription and re-query their status on it, instead of guessing with a
 *  blind delay. Fires for every `runInTerminal` run (bootstrap, `west`
 *  build/flash); refresh is idempotent, so a panel refreshing on an unrelated
 *  Alp run's finish is harmless. */
const terminalFinished = new vscode.EventEmitter<{
  name: string;
  code: number | undefined;
}>();
export const onDidFinishTerminalCommand = terminalFinished.event;

/** Fixed task identity for every `runInTerminal` run, so these never mix in
 *  with the user's own `tasks.json` entries in the Tasks UI. `run` (the
 *  `alpRun` task type's one contributed property — see package.json's
 *  `taskDefinitions`) carries the run's `name`, making each run's task
 *  definition distinct: without it every `runInTerminal` call built a
 *  byte-identical `{ type: TASK_TYPE }`, so VS Code's `ContributedTask.
 *  getMapKey()` could key "Alp Bootstrap", "Alp: west build", "Alp: west
 *  flash" and "Install tan" onto the SAME dedicated panel. */
const TASK_TYPE = "alpRun";
const TASK_SOURCE = "Alp SDK";

/** How long `runInTerminal` waits for `vscode.tasks.onDidStartTask` to
 *  confirm a dispatched task actually started before releasing its
 *  reservation. `executeTask()`'s Thenable resolves even when the task never
 *  starts (e.g. an uncontributed task type is refused), so that resolution
 *  alone is not proof of a real start -- only the start EVENT is.
 *
 *  DELIBERATELY GENEROUS. This is a "the task will never start" backstop, not
 *  a latency budget: firing it early on a merely SLOW host is strictly worse
 *  than firing it late. A spurious timeout releases the slot (reopening the
 *  #146 double-run window while the command is genuinely running), reports a
 *  finish the process never had, and then strands the run -- the late
 *  `onDidStartTask` finds no reservation, so `executionGeneration` is never
 *  recorded and the REAL end event is dropped by `finish()`'s generation
 *  check too. A machine under heavy load (a full `west update`, a loaded CI
 *  box) can take far longer than a few seconds to get a task terminal up. */
const RUN_START_TIMEOUT_MS = 60_000;

interface RunReservation {
  generation: number;
  execution: vscode.TaskExecution | null;
  started: boolean;
  watchdog: ReturnType<typeof setTimeout>;
}

/**
 * Reservations for still-running (or not-yet-confirmed-started) `runInTerminal`
 * runs, keyed by `name`. Backs `isRunInTerminalActive`/`revealRunInTerminal`
 * (the "already running, don't kill it" guard `west/vscodeAdapter.ts` needs)
 * and lets a same-named re-run terminate the stale one first.
 *
 * `vscode.tasks.executeTask` is async (it returns a Thenable, and its
 * terminal only appears after that resolves), so a caller can't reliably
 * learn "is a run under this name active right now" by polling
 * `vscode.window.terminals` the way the old `createTerminal`-based code
 * could -- and CANNOT wait for that Thenable to reserve the slot either: two
 * dispatches of the same name before either resolves would both see nothing
 * reserved (issue #146). So `runInTerminal` reserves the slot SYNCHRONOUSLY,
 * before `executeTask` is even called, keyed by a monotonic `generation`
 * rather than the (not-yet-known) `TaskExecution` object.
 */
const active = new Map<string, RunReservation>();
/** Maps a known `TaskExecution` (from `onDidStartTask` or the `executeTask`
 *  Thenable, whichever arrives first) back to the generation that dispatched
 *  it, so `finish()` below can identify which reservation (if any) a
 *  process/task-end event belongs to WITHOUT relying on `TaskExecution`
 *  object identity being the same instance across events (see finding this
 *  guards: a superseded/terminated run's late event must never clobber a
 *  fresh run already occupying the same name). */
const executionGeneration = new WeakMap<vscode.TaskExecution, number>();
let nextGeneration = 0;

let taskTrackingReady = false;
function ensureTaskTracking(): void {
  if (taskTrackingReady) return;
  taskTrackingReady = true;

  const finish = (
    execution: vscode.TaskExecution,
    code: number | undefined,
  ): void => {
    const name = runNameOf(execution);
    if (!name) return;
    const entry = active.get(name);
    const generation = executionGeneration.get(execution);
    // Generation check makes the two listeners below idempotent for the same
    // run, and stops a finished/superseded run's late event from clobbering
    // a fresh run already occupying the same name.
    if (!entry || generation === undefined || entry.generation !== generation) {
      return;
    }
    active.delete(name);
    log(`[terminal] "${name}" exited (code=${code ?? "unknown"})`);
    terminalFinished.fire({ name, code });
  };

  // The real "did it actually start" signal (see RUN_START_TIMEOUT_MS):
  // confirms the reservation, clears its watchdog, and records which
  // TaskExecution belongs to it.
  // ponytail: this attributes the starting execution to whichever reservation
  // is CURRENT for `name`, not necessarily the one that dispatched it -- a
  // second runInTerminal() for the same name landing before the first's
  // start confirms could misattribute. Callers that must serialize a name
  // guard with isRunInTerminalActive() before calling (west/vscodeAdapter.ts
  // already does, for the #146 case this module exists to fix); upgrade path
  // if a second caller needs it: a per-dispatch nonce in the task definition.
  vscode.tasks.onDidStartTask((event) => {
    const name = runNameOf(event.execution);
    if (!name) return;
    const entry = active.get(name);
    if (!entry) {
      // Reservation already gone: either superseded by a newer same-named run
      // (benign) or released by the watchdog before this start arrived. The
      // latter STRANDS this run -- with no reservation there is no generation
      // to record, so `finish()` will drop its end event and nothing will ever
      // report its completion. Never silent: this is the one trace that
      // explains a run whose terminal is visibly working while the UI believes
      // nothing is active.
      log(
        `[terminal] "${name}" started with no live reservation -- superseded, or it took longer than ${RUN_START_TIMEOUT_MS / 1000}s to start; its completion will not be reported`,
        "warn",
      );
      return;
    }
    entry.started = true;
    entry.execution = event.execution;
    clearTimeout(entry.watchdog);
    executionGeneration.set(event.execution, entry.generation);
  });
  // The real "finished" signal: fires once the spawned process itself exits,
  // carrying its real exit code.
  vscode.tasks.onDidEndTaskProcess((event) =>
    finish(event.execution, event.exitCode),
  );
  // Backstop: a task can end without ever starting a process (e.g. the
  // binary doesn't exist) -- onDidEndTaskProcess never fires then, but
  // onDidEndTask always does, so this guarantees `terminalFinished` still
  // fires exactly once for every run.
  vscode.tasks.onDidEndTask((event) => finish(event.execution, undefined));
}

/** The `run` (name) this task's definition carries, or undefined for a task
 *  this module didn't dispatch (foreign type, or missing `run`). */
function runNameOf(execution: vscode.TaskExecution): string | undefined {
  const def = execution.task.definition as { type?: string; run?: unknown };
  return def.type === TASK_TYPE && typeof def.run === "string"
    ? def.run
    : undefined;
}

/** True when a `runInTerminal` run under `name` is still executing (or its
 *  start is still pending confirmation). */
export function isRunInTerminalActive(name: string): boolean {
  return active.has(name);
}

/**
 * Reveal the terminal panel for an in-flight `runInTerminal` run (no-op if
 * `name` isn't active, or its terminal hasn't appeared yet). In a multi-root
 * `.code-workspace` VS Code renames the task's terminal to a QUALIFIED LABEL
 * (a source prefix and/or a ` (folder)` suffix) instead of the plain task
 * name, so an exact-equality match silently misses there -- widen the match
 * to the qualified-label shapes, and log a miss instead of no-op'ing quietly.
 */
export function revealRunInTerminal(name: string): void {
  const terminal = vscode.window.terminals.find(
    (t) =>
      t.name === name ||
      t.name.endsWith(": " + name) ||
      t.name.startsWith(name + " ("),
  );
  if (!terminal) {
    log(
      `[terminal] revealRunInTerminal: no terminal found matching "${name}" (checked exact and multi-root qualified-label forms)`,
      "warn",
    );
    return;
  }
  terminal.show();
}

/**
 * Launch `argv` in a dedicated terminal via a VS Code Task
 * (`ProcessExecution`). `argv` is spawned directly as an argv ARRAY — no
 * shell in between, so there is no shell-quoting layer to get wrong (the
 * previous `sendText`-into-a-wrapper-shell design could merge/drop tokens,
 * and `exit $LASTEXITCODE` reported success when PowerShell itself failed to
 * launch the command). A single-purpose binary that exits fast and nonzero
 * (e.g. a refused `tan bootstrap`) no longer gets misclassified as "the
 * terminal process failed to launch" either — a Task terminal stays open and
 * shows the command's real output. A previous still-running task under
 * `options.name` is terminated first, so a re-run reuses the named slot
 * instead of piling up (mirrors the old dispose-before-recreate).
 *
 * Completion is reported via `vscode.tasks.onDidEndTaskProcess` (carries the
 * real exit code), not `Terminal.onDidCloseTerminal`: a Task's terminal can
 * stay open after the process ends ("press any key to close"), so "terminal
 * closed" is no longer the same moment as "the command finished" — see
 * `ensureTaskTracking`. `onDidFinishTerminalCommand` keeps the same
 * `{name, code}` shape for its existing subscribers.
 *
 * The slot under `options.name` is reserved SYNCHRONOUSLY (before
 * `executeTask` is even called), and released if `vscode.tasks.onDidStartTask`
 * never confirms a real start within `RUN_START_TIMEOUT_MS` -- closing the
 * async window where two rapid same-named dispatches could otherwise both
 * see nothing running (issue #146) and, separately, guaranteeing a task that
 * never starts (e.g. its type was never contributed) can't brick the
 * command forever (`isRunInTerminalActive` would stay true with no event
 * ever coming to clear it).
 */
export function runInTerminal(options: {
  name: string;
  argv: string[];
  cwd?: string;
  env?: Record<string, string>;
}): void {
  ensureTaskTracking();
  active.get(options.name)?.execution?.terminate();

  const generation = ++nextGeneration;
  const release = (): void => {
    if (active.get(options.name) === reservation) {
      active.delete(options.name);
    }
  };
  const reservation: RunReservation = {
    generation,
    execution: null,
    started: false,
    // unref: a pending watchdog must never be the reason a process (or a
    // headless test harness) can't exit cleanly.
    watchdog: setTimeout(() => {
      if (reservation.started) return; // onDidStartTask already confirmed it
      log(
        `[terminal] "${options.name}" did not start within ${RUN_START_TIMEOUT_MS / 1000}s -- releasing the slot so the command isn't bricked`,
        "error",
      );
      release();
      terminalFinished.fire({ name: options.name, code: undefined });
    }, RUN_START_TIMEOUT_MS).unref(),
  };
  active.set(options.name, reservation);

  const execution = new vscode.ProcessExecution(
    options.argv[0],
    options.argv.slice(1),
    { cwd: options.cwd, env: options.env },
  );
  const task = new vscode.Task(
    { type: TASK_TYPE, run: options.name },
    vscode.TaskScope.Workspace,
    options.name,
    TASK_SOURCE,
    execution,
  );
  task.presentationOptions = {
    reveal: vscode.TaskRevealKind.Always,
    panel: vscode.TaskPanelKind.Dedicated,
    clear: true,
  };
  void vscode.tasks.executeTask(task).then(
    (taskExecution) => {
      if (active.get(options.name) !== reservation) return; // superseded
      reservation.execution = taskExecution;
      executionGeneration.set(taskExecution, generation);
    },
    (error) => {
      log(
        `[terminal] "${options.name}" failed to start: ${error instanceof Error ? error.message : String(error)}`,
        "error",
      );
      // executeTask's Thenable can also resolve on a failed start (VS Code
      // internals), so this rejection path is a bonus, not the only guard --
      // the watchdog above is what guarantees release either way.
      if (!reservation.started) {
        clearTimeout(reservation.watchdog);
        release();
        terminalFinished.fire({ name: options.name, code: undefined });
      }
    },
  );
}

const SHOW_OUTPUT = "Show Output";

/** Report a diagnosable failure: log the full detail to the "Alp SDK" channel
 *  AND show an error toast that always offers "Show Output" (plus any caller
 *  actions). Picking "Show Output" reveals the channel and returns undefined;
 *  otherwise the picked caller action is returned. The house pattern for every
 *  error toast tied to a failure the channel can explain.
 *
 *  Do not pass a caller action literally titled "Show Output" — that title is
 *  reserved for the appended house action and would be indistinguishable. */
export async function reportError(
  message: string,
  detail?: string,
  ...actions: string[]
): Promise<string | undefined> {
  log(detail ? `${message} — ${detail}` : message, "error");
  const pick = await vscode.window.showErrorMessage(
    message,
    ...actions,
    SHOW_OUTPUT,
  );
  if (pick === SHOW_OUTPUT) {
    showOutput();
    return undefined;
  }
  return pick;
}
