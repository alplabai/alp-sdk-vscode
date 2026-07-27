// SPDX-License-Identifier: Apache-2.0

import * as vscode from "vscode";
import { isCancellation } from "./notify/service";

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
 * rather than the (not-yet-known) `TaskExecution` object -- and consults this
 * same map itself before dispatching (see `runInTerminal`), so the guard
 * holds even for callers that never check `isRunInTerminalActive` first.
 */
const active = new Map<string, RunReservation>();
/** Maps a known `TaskExecution` (from `onDidStartTask` or the `executeTask`
 *  Thenable, whichever arrives first) back to the generation that dispatched
 *  it, so `finish()` below can tell whether a process/task-end event belongs
 *  to the CURRENT reservation for its name or a stale/superseded one (a
 *  superseded/terminated run's late event must never clobber a fresh run
 *  already occupying the same name). Being a WeakMap, this is keyed BY
 *  `TaskExecution` object identity, and so RELIES on VS Code handing back the
 *  same instance for every event tied to one execution (`onDidStartTask`,
 *  `onDidEndTaskProcess`, `onDidEndTask`, and the `executeTask` Thenable all
 *  memoize to the same object per execution id) -- if that ever stopped
 *  holding, `executionGeneration.get()` would return undefined for a genuine
 *  event and `finish()` would silently drop it forever. */
const executionGeneration = new WeakMap<vscode.TaskExecution, number>();
let nextGeneration = 0;

let taskTrackingReady = false;
const taskTrackingDisposables: vscode.Disposable[] = [];
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
    // The glanceable verdict (#332) is NOT raised here any more: it is planned
    // and presented by the `onDidFinishTerminalCommand` subscriber in
    // `src/extension.ts`, so a failed `west flash` gets a plan with real
    // actions ("Show Terminal", "Run Doctor") and keeps the exit code out of
    // the toast text. This file must not import the presenter — the presenter
    // imports log/showOutput/revealRunInTerminal from here.
    //
    // The event's own rule is unchanged: an undefined `code` means the task
    // ended without its process ever starting (the onDidEndTask backstop), so
    // there is no verdict to report and the subscriber stays silent.
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
  taskTrackingDisposables.push(
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
    }),
    // The real "finished" signal: fires once the spawned process itself exits,
    // carrying its real exit code.
    vscode.tasks.onDidEndTaskProcess((event) =>
      finish(event.execution, event.exitCode),
    ),
    // Backstop: a task can end without ever starting a process (e.g. the
    // binary doesn't exist) -- onDidEndTaskProcess never fires then, but
    // onDidEndTask always does, so this guarantees `terminalFinished` still
    // fires exactly once for every run.
    vscode.tasks.onDidEndTask((event) => finish(event.execution, undefined)),
  );
}

/** Disposes the `vscode.tasks.*` subscriptions `ensureTaskTracking` set up
 *  (no-op if it never ran). Harmless to skip at host teardown -- VS Code
 *  tears down the whole extension host anyway -- but this is the one
 *  listener set in this file that would otherwise outlive `deactivate`. */
export function disposeTaskTracking(): void {
  taskTrackingDisposables.splice(0).forEach((d) => d.dispose());
  taskTrackingReady = false;
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
 * name -- and, when BOTH apply at once, to the COMBINED form (source prefix
 * AND folder suffix together, e.g. `"Alp SDK: west flash (myproj)"`), which
 * an either/or match still misses -- so match `name` bounded by either or
 * both affixes at once, and log a miss instead of no-op'ing quietly.
 */
export function revealRunInTerminal(name: string): void {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const qualifiedLabel = new RegExp(`^(?:.*: )?${escaped}(?: \\(.*\\))?$`);
  const terminal = vscode.window.terminals.find((t) =>
    qualifiedLabel.test(t.name),
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
 * shows the command's real output. A run already active under `options.name`
 * is never interrupted: the dispatch is refused (warn + offer to reveal the
 * live terminal) rather than terminating a command that might be mid-flash
 * (issue #146) or racing a second dispatch into starting a concurrent
 * `tan bootstrap` against the same venv. This guard lives HERE, not only in
 * callers, so every caller gets it — `executeWestPlan` already checks
 * `isRunInTerminalActive` itself for a caller-specific message and returns
 * before ever reaching this function, so its check and this one never both
 * fire for the same dispatch.
 *
 * Completion is reported via `vscode.tasks.onDidEndTaskProcess` (carries the
 * real exit code), not `Terminal.onDidCloseTerminal`: a Task's terminal can
 * stay open after the process ends ("press any key to close"), so "terminal
 * closed" is no longer the same moment as "the command finished" — see
 * `ensureTaskTracking`. `onDidFinishTerminalCommand` keeps the same
 * `{name, code}` shape for its existing subscribers.
 *
 * The slot under `options.name` is reserved SYNCHRONOUSLY (before
 * `executeTask` is even called) and released if `vscode.tasks.onDidStartTask`
 * never confirms a real start within `RUN_START_TIMEOUT_MS` -- guaranteeing a
 * task that never starts (e.g. its type was never contributed) can't brick
 * the command forever (`isRunInTerminalActive` would stay true with no event
 * ever coming to clear it).
 */
export function runInTerminal(options: {
  name: string;
  argv: string[];
  /** REQUIRED, though it may be `undefined` — the key must be written, so "no
   *  working directory" is a decision a caller states and a reviewer can see,
   *  never an omission. `undefined` reaches `ProcessExecution` as "inherit the
   *  extension host's own cwd", which on Windows is the VS Code INSTALL
   *  DIRECTORY; a command that writes where it runs (`tan bootstrap`, `tan
   *  doctor --build --fix` — both create a venv + west workspace) then
   *  bootstraps there. Two `runAlpInTerminal` sites shipped with `cwd` simply
   *  left off, which is why this is not optional. */
  cwd: string | undefined;
  env?: Record<string, string>;
}): void {
  ensureTaskTracking();
  if (active.has(options.name)) {
    // Refuse rather than silently no-op or terminate a possibly-live run
    // (issue #146 in both directions: two concurrent bootstraps, or a flash
    // killed mid-write) -- tell the user why the click did nothing.
    void vscode.window
      .showWarningMessage(
        `"${options.name}" is still running — wait for it to finish before starting it again.`,
        "Show Terminal",
      )
      .then((choice) => {
        if (choice === "Show Terminal") revealRunInTerminal(options.name);
      });
    return;
  }

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
  // The `active.has` guard above means a live reservation is never clobbered
  // here in practice, but clear defensively anyway (finding #2): a stray
  // watchdog left running past its reservation would log a bogus "did not
  // start" error and fire a premature terminalFinished for a run that is
  // superseding it, not the run the watchdog was guarding.
  clearTimeout(active.get(options.name)?.watchdog);
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
      // `executeTask` is a main-thread RPC, so at window teardown it rejects
      // with a CancellationError for every run still in flight. The task was
      // abandoned with the window — it did not fail to start — and an "error"
      // line saying so is the closed-window-vs-broken confusion. Still release
      // the slot below: the reservation is per-window state either way.
      log(
        isCancellation(error)
          ? `[terminal] "${options.name}" abandoned, window closing`
          : `[terminal] "${options.name}" failed to start: ${error instanceof Error ? error.message : String(error)}`,
        isCancellation(error) ? "info" : "error",
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

// `reportError` used to live here. It moved to `src/notify/vscodeAdapter.ts`
// (same signature) so that ALL notification rendering sits behind one seam:
// leaving a second toast-raising helper here is exactly what let call sites
// hand-roll their own `showErrorMessage` variants. It cannot be re-exported
// from this file either — the presenter imports `log` / `showOutput` /
// `revealRunInTerminal` from here, so an import back would be a cycle.
