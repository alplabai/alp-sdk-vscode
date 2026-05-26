# Build / Flash / Debug Ergonomics — Design

**Date:** 2026-05-26
**Status:** Approved (design); spec under review
**Branch:** feat/dev-tools

## Goal

Make the everyday build/flash loop fast and legible: compiler errors land in the
**Problems panel** (clickable), Build/Flash are one click from the **status bar**,
the build stops re-prompting for its target on every run, and power users get an
editable **`.vscode/tasks.json`**. This is the second "developer speedup"
sub-project after auto-connect SDK; it builds on the existing west commands.

## Current state (what already exists)

- `alp.westBuild` / `alp.westFlash` / `alp.westRunNativeSim` exist
  (`src/west.ts`). Build does validate → generate → run.
- They execute via a **raw terminal** (`src/west/vscodeAdapter.ts`
  `executeWestPlan` → `terminal.sendText`), so build output is unstructured and
  **never reaches the Problems panel**.
- Build **prompts for board + example path on every invocation** (input boxes).
- The status bar (`src/statusBar.ts`) shows only the board summary
  (`$(circuit-board) <sku> · <preset>`) — no action buttons.
- `alp.configureDebugProfile` already generates **launch.json** via a tested core
  writer (`packages/alp-core/src/debug/launchJsonCore.ts`,
  `createLaunchJsonWritePlan(existingContent, next) → {content, replaced}`,
  merge-by-name). **There is no `tasks.json` generation.**

## Chosen approach (Approach 1)

The extension runs the `west build` step through the **VS Code Task API** with a
**contributed** problem matcher. The status-bar buttons and palette commands all
flow through that path, so errors reach the Problems panel however the build is
launched. A separate command also writes an editable `.vscode/tasks.json` whose
tasks reference the *same* contributed matcher. One matcher definition, two entry
points. Validation/generation stay as TypeScript pre-steps; only the compiler
output of the `west build` step is parsed by the matcher.

## Architecture

Hard logic stays pure + unit-tested in `@alp-sdk/core`; the VS Code layer is thin.

### Contributed problem matcher (`package.json`)

- `contributes.problemPatterns`: a pattern named `alp-west-gcc` matching the
  GCC/Zephyr diagnostic line `file:line:col: error|warning: message`:
  regexp `^(.+?):(\\d+):(\\d+):\\s+(warning|error|fatal error):\\s+(.+)$`
  with `file:1, line:2, column:3, severity:4, message:5`.
- `contributes.problemMatchers`: `$alp-west`, `owner: "alp"`, `source: "west"`,
  `fileLocation: ["autoDetect", "${workspaceFolder}"]`, `pattern: "alp-west-gcc"`.

### Task execution (`src/west/vscodeAdapter.ts`)

`executeWestPlan(plan)` is rewritten to run a `vscode.Task` (the matcher choice is
driven entirely by `plan.kind`, no extra argument):
- `new vscode.Task(definition, scope, name, "alp", new vscode.ShellExecution(plan.command, { cwd: plan.westCwd ?? undefined, env: plan.env }), problemMatchers)`.
- `problemMatchers = plan.kind === "build" ? ["$alp-west"] : []`.
- `definition = { type: "alp-west", kind: plan.kind }`.
- Reuse/cleanup: rely on the Task API (no manual terminal bookkeeping). Returns a
  promise that resolves on task end (so callers can know the exit code if needed),
  but build/flash callers may fire-and-forget.

The pure `WestCommandPlan` (`@alp-sdk/core/west/models`: `terminalName`,
`command`, `westCwd`, `env`) is unchanged; we add a `kind` so the adapter knows
whether to attach the matcher. `kind` is set by the core plan builders
(`createWestBuildPreparation` → build, `createWestFlashPlan` → flash,
`createWestNativeRunPlan` → run).

### Build-target memory (`@alp-sdk/core` + `src/west.ts`)

- New pure core module `@alp-sdk/core/west/buildTarget.ts`:
  - `BuildTarget = { board: string; example: string }`.
  - `normalizeBuildTarget(raw: Partial<BuildTarget> | null): BuildTarget | null` —
    returns a target only when both fields are non-empty after trimming, else null.
- The extension stores the last target in `context.workspaceState`
  (key `alp.buildTarget`). `westBuild` reads it; if absent it prompts (the
  existing input boxes) and saves the result. New command **`alp.setBuildTarget`**
  always prompts and overwrites (the "change target" affordance).
- `context` is threaded into `registerWestCommands(context)` (today it takes no
  args; `extension.ts` already has `context`).

### Status bar (`src/statusBar.ts`)

Add two `StatusBarItem`s to the right of the summary item:
- `$(tools) Build` → command `alp.westBuild`, tooltip shows the remembered target.
- `$(zap) Flash` → command `alp.westFlash`.
Both are shown only when a board.yaml is present (same `hasBoard` signal the
summary uses) and hidden otherwise. They are created in `createStatusBar` and
returned/disposed with the existing item.

### tasks.json generation (`@alp-sdk/core` + `src/west/` adapter)

- New pure core module `@alp-sdk/core/west/tasksJsonCore.ts`, mirroring
  `launchJsonCore`:
  - `createTasksJsonWritePlan(existingContent: string | null, tasks: TaskDraft[]) → { content, replaced }`,
    merging by task `label` (replace same-label, else append), preserving unknown
    top-level keys and other tasks, defaulting `version: "2.0.0"`. Throws on
    invalid JSON / non-object (same messages style as launchJsonCore).
  - A builder `buildAlpWestTasks(target: BuildTarget) → TaskDraft[]` producing:
    - `alp: west build` — `shell` task running the full pipeline via the `alp`
      CLI then west (`alp generate --all && west build -b <board> <example>`),
      `problemMatcher: ["$alp-west"]`, `group: { kind: "build", isDefault: true }`.
    - `alp: west flash` — `west flash`, no matcher.
- New command **`alp.generateTasksJson`** (adapter does the file I/O): reads
  `<workspace>/.vscode/tasks.json` if present, applies `createTasksJsonWritePlan`,
  writes it back, reports wrote/updated (mirrors `configureDebugProfile`).

## Data flow

Status-bar Build / palette `alp.westBuild` → resolve target (workspaceState, else
prompt+save) → validate → generate → `executeWestPlan(buildPlan)` runs `west build`
as a Task with `$alp-west` → compiler diagnostics populate the Problems panel.
Flash is the same path without validation/generation and without the matcher.

## Error handling

- Validation/generation failures: unchanged (output channel + error message;
  build blocked before the task runs).
- Build task non-zero exit: surfaced by the task terminal + matcher entries (no
  extra dialog — the Problems panel is the signal).
- `alp.generateTasksJson`: no workspace → error message; existing `tasks.json`
  that isn't valid JSON / not an object → throw with a clear message (don't
  clobber); valid file → merge our two tasks by label, leave the user's tasks
  intact.
- No remembered target and the user cancels the prompt → no-op (as today).

## Testing

Pure core (`node:test`):
- `normalizeBuildTarget` — both fields present → target; missing/blank → null; trims.
- `createTasksJsonWritePlan` — empty/no file → new doc with our tasks + version
  2.0.0; existing same-label task → replaced=true; existing other tasks/unknown
  keys → preserved; invalid JSON → throws.
- `buildAlpWestTasks` — correct label, command string for a given target, matcher
  on build only, default build group.

The Task-API execution, status-bar items, and `workspaceState` memory are thin
adapters verified in the Extension Development Host (this repo's convention).

## Out of scope

- Background/watch build with begin/end problem patterns (one-shot build only).
- Debug launch.json (already handled by `alp.configureDebugProfile`).
- A custom `TaskProvider` contributing tasks dynamically (we generate a file and
  run via the Task API; no provider).
- Changing the validate→generate→build pipeline semantics.
