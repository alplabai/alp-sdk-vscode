# Build / Flash / Debug Ergonomics Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the build/flash loop ergonomic — compiler errors in the Problems panel, status-bar Build/Flash buttons, remembered build target, and a generated `.vscode/tasks.json`.

**Architecture:** The extension runs `west build` via the VS Code **Task API** with a *contributed* `$alp-west` problem matcher; status-bar buttons and palette commands share that path. Pure, tested core gains a `kind` on the west plan, a build-target normalizer, and a `tasks.json` content builder (mirroring the existing `launchJsonCore`). The west adapter stops using a raw terminal.

**Tech Stack:** TypeScript, VS Code extension API (Task, ShellExecution, problem matchers, StatusBarItem, workspaceState), pnpm workspace, `node:test`.

**Spec:** `docs/superpowers/specs/2026-05-26-build-flash-ergonomics-design.md`

---

## Background the implementer needs

- **Build:** `pnpm run compile` (`tsc --build` + alp-cli compile). **Run it before tests.**
- **Tests:** `node --test test/*.test.js` (node:test + node:assert/strict). Core modules are imported as `@alp-sdk/core/<area>/<file>` (compiled to `packages/alp-core/dist`). The suite is currently **185/185 green**; keep it green and add no new failures.
- **Branch:** work on `feat/dev-tools` (do NOT start on main).
- **No `Co-Authored-By: Claude` / "Generated with" trailer** on commits (hard project rule).
- **Brand string is "Alp", never "ALP"** in user-facing strings.
- **Pattern to mirror for tasks.json:** `packages/alp-core/src/debug/launchJsonCore.ts` already does
  `createLaunchJsonWritePlan(existingContent, next) → { content, replaced }` (merge-by-name, default version, throws on invalid JSON). The adapter `src/debug/vscodeAdapter.ts` has `readLaunchJson`/`writeLaunchJson`. Follow these.
- **The west plan today** (`packages/alp-core/src/west/models.ts`): `WestCommandPlan = { terminalName, command, westCwd, env }`. Built by `createWestBuildPlan` / `createWestFlashPlan` / `createWestNativeRunPlan` in `west/service.ts`. Run by `src/west/vscodeAdapter.ts` `executeWestPlan` via `terminal.sendText` (this is what we replace).
- **The alp CLI** (`packages/alp-cli/dist/cli/main.js`, bin `alp`) supports `alp generate --all`.

## File Structure

**Create:**
- `packages/alp-core/src/west/buildTarget.ts` — `BuildTarget`, `normalizeBuildTarget`.
- `packages/alp-core/src/west/tasksJsonCore.ts` — `TaskDraft`, `createTasksJsonWritePlan`, `buildAlpWestTasks`.
- `test/west.buildTarget.test.js`, `test/west.tasksJsonCore.test.js`.

**Modify:**
- `packages/alp-core/src/west/models.ts` — add `WestPlanKind` + `kind` to `WestCommandPlan`.
- `packages/alp-core/src/west/service.ts` — set `kind` in the three builders.
- `test/west.service.test.js` — add `kind` to the two `deepEqual` expectations.
- `package.json` — contribute `problemPatterns` + `problemMatchers`; add commands `alp.setBuildTarget`, `alp.generateTasksJson`.
- `src/west/vscodeAdapter.ts` — `executeWestPlan` runs a VS Code Task; add `readTasksJson`/`writeTasksJson`.
- `src/west.ts` — build-target memory, `setBuildTarget`, `generateTasksJson`; `registerWestCommands(context)`.
- `src/extension.ts` — pass `context` to `registerWestCommands`.
- `src/statusBar.ts` — add Build/Flash status-bar items.

---

### Task 1: Add `kind` to the west plan

**Files:**
- Modify: `packages/alp-core/src/west/models.ts`
- Modify: `packages/alp-core/src/west/service.ts`
- Modify: `test/west.service.test.js`

- [ ] **Step 1: Update the failing test first**

In `test/west.service.test.js`, add `kind` to the two `deepEqual` expectations. Change the build-plan expectation (currently ending `env: { EXTRA_ZEPHYR_MODULES: "/workspace/sdk" } }`) to include `kind: "build"`, and the flash-plan expectation to include `kind: "flash"`. The full new expectations:

```js
// in "createWestBuildPlan builds the expected west command"
  assert.deepEqual(plan, {
    terminalName: "alp · west build",
    command: "west build -b alp_e1m_evk_aen examples/gpio-button-led -p auto",
    westCwd: "/workspace/app",
    env: {
      EXTRA_ZEPHYR_MODULES: "/workspace/sdk",
    },
    kind: "build",
  });
```

```js
// in "createWestFlashPlan preserves cwd and uses an empty env without sdkRoot"
  assert.deepEqual(plan, {
    terminalName: "alp · west flash",
    command: "west flash",
    westCwd: "/workspace/app",
    env: {},
    kind: "flash",
  });
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm run compile && node --test test/west.service.test.js`
Expected: FAIL — actual plan has no `kind` field yet.

- [ ] **Step 3: Add the type**

In `packages/alp-core/src/west/models.ts`, add the kind type and field:

```ts
export type WestPlanKind = "build" | "flash" | "run";

export interface WestCommandPlan {
  terminalName: string;
  command: string;
  westCwd: string | null;
  env: Record<string, string>;
  kind: WestPlanKind;
}
```

- [ ] **Step 4: Set `kind` in the builders**

In `packages/alp-core/src/west/service.ts`, give `createWestCommandPlan` a `kind` parameter and pass it through:

```ts
import {
    WestBuildInput,
    WestBuildPreparation,
    WestCommandPlan,
    WestPlanKind,
    WestWorkspaceContext,
} from "./models";

export function createWestBuildPlan(
  context: WestWorkspaceContext,
  input: WestBuildInput,
): WestCommandPlan {
  return createWestCommandPlan(
    context,
    "alp · west build",
    `west build -b ${input.board} ${input.example} -p auto`,
    "build",
  );
}

export function createWestFlashPlan(
  context: WestWorkspaceContext,
): WestCommandPlan {
  return createWestCommandPlan(context, "alp · west flash", "west flash", "flash");
}

export function createWestNativeRunPlan(
  context: WestWorkspaceContext,
): WestCommandPlan {
  return createWestCommandPlan(context, "alp · west run", "west build -t run", "run");
}

function createWestCommandPlan(
  context: WestWorkspaceContext,
  terminalName: string,
  command: string,
  kind: WestPlanKind,
): WestCommandPlan {
  const env: Record<string, string> = {};
  if (context.sdkRoot) {
    env.EXTRA_ZEPHYR_MODULES = context.sdkRoot;
  }

  return {
    terminalName,
    command,
    westCwd: context.westCwd,
    env,
    kind,
  };
}
```

(Leave `createWestBuildPreparation` and `requireBoardYamlPath` unchanged.)

- [ ] **Step 5: Run the test to verify it passes**

Run: `pnpm run compile && node --test test/west.service.test.js`
Expected: PASS — all 5 tests.

- [ ] **Step 6: Commit**

```bash
git add packages/alp-core/src/west/models.ts packages/alp-core/src/west/service.ts test/west.service.test.js
git commit -m "feat(core): tag west command plans with a kind (build/flash/run)"
```

---

### Task 2: Build-target normalizer (pure)

**Files:**
- Create: `packages/alp-core/src/west/buildTarget.ts`
- Test: `test/west.buildTarget.test.js`

- [ ] **Step 1: Write the failing test**

Create `test/west.buildTarget.test.js`:

```js
const test = require("node:test");
const assert = require("node:assert/strict");
const { normalizeBuildTarget } = require("@alp-sdk/core/west/buildTarget");

test("returns a target when both fields are non-empty", () => {
  assert.deepEqual(
    normalizeBuildTarget({ board: "native_sim/native/64", example: "examples/blinky" }),
    { board: "native_sim/native/64", example: "examples/blinky" },
  );
});

test("trims surrounding whitespace", () => {
  assert.deepEqual(
    normalizeBuildTarget({ board: "  b  ", example: "  e  " }),
    { board: "b", example: "e" },
  );
});

test("returns null when input is null/undefined", () => {
  assert.equal(normalizeBuildTarget(null), null);
  assert.equal(normalizeBuildTarget(undefined), null);
});

test("returns null when a field is missing or blank", () => {
  assert.equal(normalizeBuildTarget({ board: "b" }), null);
  assert.equal(normalizeBuildTarget({ board: "b", example: "   " }), null);
  assert.equal(normalizeBuildTarget({ board: "", example: "e" }), null);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm run compile && node --test test/west.buildTarget.test.js`
Expected: FAIL — `Cannot find module '@alp-sdk/core/west/buildTarget'`.

- [ ] **Step 3: Write the implementation**

Create `packages/alp-core/src/west/buildTarget.ts`:

```ts
// SPDX-License-Identifier: Apache-2.0

export interface BuildTarget {
  board: string;
  example: string;
}

/**
 * Returns a usable build target only when both fields are present after
 * trimming; otherwise null. Pure — used to validate remembered/prompted input.
 */
export function normalizeBuildTarget(
  raw: Partial<BuildTarget> | null | undefined,
): BuildTarget | null {
  if (!raw) return null;
  const board = (raw.board ?? "").trim();
  const example = (raw.example ?? "").trim();
  if (!board || !example) return null;
  return { board, example };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm run compile && node --test test/west.buildTarget.test.js`
Expected: PASS — 4 tests.

- [ ] **Step 5: Commit**

```bash
git add packages/alp-core/src/west/buildTarget.ts test/west.buildTarget.test.js
git commit -m "feat(core): build-target normalizer"
```

---

### Task 3: tasks.json content builder (pure)

**Files:**
- Create: `packages/alp-core/src/west/tasksJsonCore.ts`
- Test: `test/west.tasksJsonCore.test.js`

- [ ] **Step 1: Write the failing test**

Create `test/west.tasksJsonCore.test.js`:

```js
const test = require("node:test");
const assert = require("node:assert/strict");
const {
  buildAlpWestTasks,
  createTasksJsonWritePlan,
} = require("@alp-sdk/core/west/tasksJsonCore");

const target = { board: "alp_e1m_evk_aen", example: "examples/blinky" };

test("buildAlpWestTasks produces build + flash tasks", () => {
  const tasks = buildAlpWestTasks(target);
  assert.equal(tasks.length, 2);

  const build = tasks.find((t) => t.label === "alp: west build");
  assert.equal(build.type, "shell");
  assert.equal(
    build.command,
    "alp generate --all && west build -b alp_e1m_evk_aen examples/blinky -p auto",
  );
  assert.deepEqual(build.problemMatcher, ["$alp-west"]);
  assert.deepEqual(build.group, { kind: "build", isDefault: true });

  const flash = tasks.find((t) => t.label === "alp: west flash");
  assert.equal(flash.command, "west flash");
  assert.equal(flash.problemMatcher, undefined);
});

test("createTasksJsonWritePlan creates a new document when none exists", () => {
  const plan = createTasksJsonWritePlan(null, buildAlpWestTasks(target));
  const doc = JSON.parse(plan.content);
  assert.equal(plan.replaced, false);
  assert.equal(doc.version, "2.0.0");
  assert.deepEqual(doc.tasks.map((t) => t.label), ["alp: west build", "alp: west flash"]);
});

test("createTasksJsonWritePlan replaces same-label tasks and preserves others", () => {
  const existing = JSON.stringify({
    version: "2.0.0",
    tasks: [
      { label: "alp: west build", type: "shell", command: "OLD" },
      { label: "my custom task", type: "shell", command: "echo hi" },
    ],
    inputs: [{ id: "x" }],
  });
  const plan = createTasksJsonWritePlan(existing, buildAlpWestTasks(target));
  const doc = JSON.parse(plan.content);
  assert.equal(plan.replaced, true);
  // user task and unknown top-level key preserved
  assert.ok(doc.tasks.some((t) => t.label === "my custom task"));
  assert.deepEqual(doc.inputs, [{ id: "x" }]);
  // our build task replaced (not duplicated, not OLD)
  const builds = doc.tasks.filter((t) => t.label === "alp: west build");
  assert.equal(builds.length, 1);
  assert.notEqual(builds[0].command, "OLD");
});

test("createTasksJsonWritePlan throws on invalid JSON", () => {
  assert.throws(() => createTasksJsonWritePlan("{not json", buildAlpWestTasks(target)), /tasks\.json/);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm run compile && node --test test/west.tasksJsonCore.test.js`
Expected: FAIL — `Cannot find module '@alp-sdk/core/west/tasksJsonCore'`.

- [ ] **Step 3: Write the implementation**

Create `packages/alp-core/src/west/tasksJsonCore.ts`:

```ts
// SPDX-License-Identifier: Apache-2.0

import { BuildTarget } from "./buildTarget";

export interface TaskDraft {
  label: string;
  type: string;
  command: string;
  problemMatcher?: string[];
  group?: { kind: string; isDefault: boolean };
  [key: string]: unknown;
}

interface TasksJsonDocument {
  version: string;
  tasks: TaskDraft[];
  [key: string]: unknown;
}

export interface TasksJsonWritePlan {
  content: string;
  replaced: boolean;
}

/** The two Alp west tasks for a given build target. */
export function buildAlpWestTasks(target: BuildTarget): TaskDraft[] {
  return [
    {
      label: "alp: west build",
      type: "shell",
      command: `alp generate --all && west build -b ${target.board} ${target.example} -p auto`,
      problemMatcher: ["$alp-west"],
      group: { kind: "build", isDefault: true },
    },
    {
      label: "alp: west flash",
      type: "shell",
      command: "west flash",
    },
  ];
}

/**
 * Merge `tasks` into an existing tasks.json document (by label) or create a new
 * one. Mirrors createLaunchJsonWritePlan. `replaced` is true if any incoming
 * task replaced a same-label task already present.
 */
export function createTasksJsonWritePlan(
  existingContent: string | null,
  tasks: TaskDraft[],
): TasksJsonWritePlan {
  const document = parseTasksJsonOrDefault(existingContent);
  let replaced = false;

  for (const next of tasks) {
    const index = document.tasks.findIndex((t) => taskLabel(t) === next.label);
    if (index >= 0) {
      document.tasks[index] = next;
      replaced = true;
    } else {
      document.tasks.push(next);
    }
  }

  return { content: `${JSON.stringify(document, null, 2)}\n`, replaced };
}

function parseTasksJsonOrDefault(content: string | null): TasksJsonDocument {
  if (!content || content.trim().length === 0) {
    return { version: "2.0.0", tasks: [] };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    throw new Error("Alp: .vscode/tasks.json is not valid JSON.");
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Alp: .vscode/tasks.json must be a JSON object.");
  }

  const candidate = parsed as Record<string, unknown>;
  const version =
    typeof candidate.version === "string" && candidate.version.trim().length > 0
      ? candidate.version
      : "2.0.0";
  const tasks = Array.isArray(candidate.tasks)
    ? candidate.tasks.filter(
        (entry): entry is TaskDraft =>
          Boolean(entry) && typeof entry === "object" && !Array.isArray(entry),
      )
    : [];

  return { ...candidate, version, tasks };
}

function taskLabel(task: TaskDraft): string {
  return typeof task.label === "string" ? task.label : "";
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm run compile && node --test test/west.tasksJsonCore.test.js`
Expected: PASS — 4 tests.

- [ ] **Step 5: Commit**

```bash
git add packages/alp-core/src/west/tasksJsonCore.ts test/west.tasksJsonCore.test.js
git commit -m "feat(core): tasks.json content builder (merge-by-label)"
```

---

### Task 4: Contribute the problem matcher

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Add problemPatterns + problemMatchers**

In `package.json`, inside `"contributes"`, add these two keys (anywhere among the contributes children, e.g. after `"snippets"`):

```json
    "problemPatterns": [
      {
        "name": "alp-west-gcc",
        "regexp": "^(.+?):(\\d+):(\\d+):\\s+(warning|error|fatal error):\\s+(.+)$",
        "file": 1,
        "line": 2,
        "column": 3,
        "severity": 4,
        "message": 5
      }
    ],
    "problemMatchers": [
      {
        "name": "alp-west",
        "owner": "alp",
        "source": "west",
        "fileLocation": ["autoDetect", "${workspaceFolder}"],
        "pattern": "alp-west-gcc"
      }
    ],
```

- [ ] **Step 2: Verify JSON + build**

Run: `node -e "JSON.parse(require('fs').readFileSync('package.json','utf8')); console.log('ok')" && pnpm run compile`
Expected: `ok` and EXIT 0.

- [ ] **Step 3: Commit**

```bash
git add package.json
git commit -m "feat(build): contribute \$alp-west problem matcher"
```

---

### Task 5: Run west via the Task API

**Files:**
- Modify: `src/west/vscodeAdapter.ts`

- [ ] **Step 1: Rewrite `executeWestPlan`**

Replace the body of `src/west/vscodeAdapter.ts` `executeWestPlan` (currently uses `terminal.sendText`) so it runs a VS Code Task, attaching the matcher only for build:

```ts
export function executeWestPlan(plan: WestCommandPlan): void {
  const problemMatchers = plan.kind === "build" ? ["$alp-west"] : [];
  const task = new vscode.Task(
    { type: "alp-west", kind: plan.kind },
    vscode.TaskScope.Workspace,
    plan.terminalName,
    "alp",
    new vscode.ShellExecution(plan.command, {
      cwd: plan.westCwd ?? undefined,
      env: plan.env,
    }),
    problemMatchers,
  );
  task.presentationOptions = {
    reveal: vscode.TaskRevealKind.Always,
    panel: vscode.TaskPanelKind.Dedicated,
    clear: true,
  };
  void vscode.tasks.executeTask(task);
}
```

`WestCommandPlan` is already imported in this file. `vscode` is imported. `plan.kind` exists after Task 1.

- [ ] **Step 2: Verify it compiles**

Run: `pnpm run compile`
Expected: EXIT 0.

- [ ] **Step 3: Commit**

```bash
git add src/west/vscodeAdapter.ts
git commit -m "feat(build): run west via the Task API with the problem matcher"
```

---

### Task 6: Build-target memory + `alp.setBuildTarget`

**Files:**
- Modify: `src/west.ts`
- Modify: `src/extension.ts`
- Modify: `package.json`

- [ ] **Step 1: Thread context + add target memory in `src/west.ts`**

At the top of `src/west.ts`, add the import:

```ts
import { normalizeBuildTarget, BuildTarget } from "@alp-sdk/core/west/buildTarget";
```

Add a module constant and helpers (place above `westBuild`):

```ts
const BUILD_TARGET_KEY = "alp.buildTarget";

async function promptBuildTarget(
  initial?: BuildTarget | null,
): Promise<BuildTarget | null> {
  const board = await vscode.window.showInputBox({
    prompt: "Zephyr board target (e.g. native_sim/native/64, alp_e1m_evk_aen)",
    value: initial?.board ?? "native_sim/native/64",
  });
  if (board === undefined) return null;
  const example = await vscode.window.showInputBox({
    prompt: "Path to the application (relative to the west cwd)",
    value: initial?.example ?? "examples/gpio-button-led",
  });
  if (example === undefined) return null;
  return normalizeBuildTarget({ board, example });
}

async function resolveBuildTarget(
  context: vscode.ExtensionContext,
): Promise<BuildTarget | null> {
  const remembered = normalizeBuildTarget(
    context.workspaceState.get<BuildTarget>(BUILD_TARGET_KEY) ?? null,
  );
  if (remembered) return remembered;
  const picked = await promptBuildTarget();
  if (picked) await context.workspaceState.update(BUILD_TARGET_KEY, picked);
  return picked;
}
```

- [ ] **Step 2: Use the remembered target in `westBuild`**

Change `westBuild` to take `context` and use `resolveBuildTarget` instead of `pickBoardAndExamplePath`. Replace the old `pickBoardAndExamplePath` function entirely (delete it) and update the start of `westBuild`:

```ts
async function westBuild(context: vscode.ExtensionContext): Promise<void> {
  const sel = await resolveBuildTarget(context);
  if (!sel) return;
  // ...rest of westBuild unchanged (createWestBuildPreparation(context_ws, sel) etc.)
```

Note: the existing body uses `collectWestWorkspaceContext()` for the west context and `sel` for the board/example — that stays. Only the target acquisition changed. (The `sel` shape `{ board, example }` is unchanged.)

- [ ] **Step 3: Add the `setBuildTarget` command + update registration**

Add a command handler and rewrite `registerWestCommands` to take `context`:

```ts
async function setBuildTarget(context: vscode.ExtensionContext): Promise<void> {
  const current = normalizeBuildTarget(
    context.workspaceState.get<BuildTarget>(BUILD_TARGET_KEY) ?? null,
  );
  const picked = await promptBuildTarget(current);
  if (!picked) return;
  await context.workspaceState.update(BUILD_TARGET_KEY, picked);
  vscode.window.setStatusBarMessage(
    `Alp: build target set to ${picked.board} · ${picked.example}`,
    5000,
  );
}

export function registerWestCommands(
  context: vscode.ExtensionContext,
): vscode.Disposable[] {
  return [
    vscode.commands.registerCommand("alp.westBuild", () => westBuild(context)),
    vscode.commands.registerCommand("alp.westFlash", () => westFlash()),
    vscode.commands.registerCommand("alp.westRunNativeSim", () =>
      westRunNativeSim(),
    ),
    vscode.commands.registerCommand("alp.setBuildTarget", () =>
      setBuildTarget(context),
    ),
  ];
}
```

(`westFlash` and `westRunNativeSim` are unchanged.)

- [ ] **Step 4: Pass context in `src/extension.ts`**

Change the call `...registerWestCommands(),` to `...registerWestCommands(context),`.

- [ ] **Step 5: Add the command to `package.json`**

In `contributes.commands`, after the `alp.connectSdk` entry, add:

```json
      {
        "command": "alp.setBuildTarget",
        "title": "Alp: Set build target (board + app)",
        "category": "Alp"
      }
```

- [ ] **Step 6: Verify it compiles**

Run: `pnpm run compile`
Expected: EXIT 0.

- [ ] **Step 7: Commit**

```bash
git add src/west.ts src/extension.ts package.json
git commit -m "feat(build): remember build target and add Alp: Set build target"
```

---

### Task 7: Status-bar Build/Flash buttons

**Files:**
- Modify: `src/statusBar.ts`

- [ ] **Step 1: Add the two action items**

Rewrite `src/statusBar.ts` so `createStatusBar` also creates Build and Flash items that are shown only when a board.yaml resolves to a sku. Full new file:

```ts
// SPDX-License-Identifier: Apache-2.0

import * as vscode from "vscode";
import { createStatusBarPresentation } from "@alp-sdk/core/boardSummary/service";
import { loadBoardSummary } from "./boardSummary/vscodeAdapter";
import { collectProjectContext } from "./project/vscodeAdapter";

function refresh(
  summaryItem: vscode.StatusBarItem,
  buildItem: vscode.StatusBarItem,
  flashItem: vscode.StatusBarItem,
): void {
  const summary = loadBoardSummary(collectProjectContext().boardYamlPath);
  const presentation = createStatusBarPresentation(summary);
  summaryItem.text = presentation.text;
  summaryItem.tooltip = presentation.tooltip;
  summaryItem.command = presentation.command;
  summaryItem.show();

  if (summary?.sku) {
    buildItem.show();
    flashItem.show();
  } else {
    buildItem.hide();
    flashItem.hide();
  }
}

export function createStatusBar(
  context: vscode.ExtensionContext,
): vscode.Disposable {
  const summaryItem = vscode.window.createStatusBarItem(
    vscode.StatusBarAlignment.Left,
    100,
  );

  const buildItem = vscode.window.createStatusBarItem(
    vscode.StatusBarAlignment.Left,
    99,
  );
  buildItem.text = "$(tools) Build";
  buildItem.tooltip = "Alp: west build";
  buildItem.command = "alp.westBuild";

  const flashItem = vscode.window.createStatusBarItem(
    vscode.StatusBarAlignment.Left,
    98,
  );
  flashItem.text = "$(zap) Flash";
  flashItem.tooltip = "Alp: west flash";
  flashItem.command = "alp.westFlash";

  refresh(summaryItem, buildItem, flashItem);

  const watcher = vscode.workspace.createFileSystemWatcher("**/board.yaml");
  watcher.onDidChange(() => refresh(summaryItem, buildItem, flashItem));
  watcher.onDidCreate(() => refresh(summaryItem, buildItem, flashItem));
  watcher.onDidDelete(() => refresh(summaryItem, buildItem, flashItem));

  context.subscriptions.push(watcher, summaryItem, buildItem, flashItem);

  return summaryItem;
}
```

- [ ] **Step 2: Verify it compiles**

Run: `pnpm run compile`
Expected: EXIT 0.

- [ ] **Step 3: Commit**

```bash
git add src/statusBar.ts
git commit -m "feat(build): status-bar Build and Flash buttons"
```

---

### Task 8: Generate `.vscode/tasks.json`

**Files:**
- Modify: `src/west/vscodeAdapter.ts`
- Modify: `src/west.ts`
- Modify: `src/extension.ts`
- Modify: `package.json`

- [ ] **Step 1: Add tasks.json file I/O to the adapter**

Append to `src/west/vscodeAdapter.ts` (add `fs`/`path` imports at the top if absent):

```ts
import * as fs from "fs";
import * as path from "path";
```

```ts
export function tasksJsonPath(workspaceRoot: string): string {
  return path.join(workspaceRoot, ".vscode", "tasks.json");
}

export function readTasksJson(workspaceRoot: string): string | null {
  const filePath = tasksJsonPath(workspaceRoot);
  if (!fs.existsSync(filePath)) return null;
  return fs.readFileSync(filePath, "utf-8");
}

export function writeTasksJson(workspaceRoot: string, content: string): string {
  const filePath = tasksJsonPath(workspaceRoot);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content, "utf-8");
  return filePath;
}
```

- [ ] **Step 2: Add the `generateTasksJson` command in `src/west.ts`**

Add imports:

```ts
import { buildAlpWestTasks, createTasksJsonWritePlan } from "@alp-sdk/core/west/tasksJsonCore";
import { readTasksJson, writeTasksJson } from "./west/vscodeAdapter";
```

Add the handler:

```ts
async function generateTasksJson(
  context: vscode.ExtensionContext,
): Promise<void> {
  const project = collectWestWorkspaceContext();
  const workspaceRoot = project.workspaceRoot;
  if (!workspaceRoot) {
    await vscode.window.showErrorMessage(
      "Alp: open a workspace folder before generating tasks.json.",
    );
    return;
  }
  const target = await resolveBuildTarget(context);
  if (!target) return;

  try {
    const plan = createTasksJsonWritePlan(
      readTasksJson(workspaceRoot),
      buildAlpWestTasks(target),
    );
    const filePath = writeTasksJson(workspaceRoot, plan.content);
    vscode.window.showInformationMessage(
      `Alp: ${plan.replaced ? "updated" : "wrote"} build/flash tasks in ${filePath}`,
    );
  } catch (error) {
    await vscode.window.showErrorMessage(
      error instanceof Error ? error.message : "Alp: failed to write tasks.json.",
    );
  }
}
```

Register it in `registerWestCommands` (add to the returned array):

```ts
    vscode.commands.registerCommand("alp.generateTasksJson", () =>
      generateTasksJson(context),
    ),
```

(`collectWestWorkspaceContext` is already imported in west.ts.)

- [ ] **Step 3: Add the command to `package.json`**

In `contributes.commands`, after the `alp.setBuildTarget` entry, add:

```json
      {
        "command": "alp.generateTasksJson",
        "title": "Alp: Generate .vscode/tasks.json (build + flash)",
        "category": "Alp"
      }
```

- [ ] **Step 4: Verify it compiles**

Run: `pnpm run compile`
Expected: EXIT 0.

- [ ] **Step 5: Commit**

```bash
git add src/west/vscodeAdapter.ts src/west.ts package.json
git commit -m "feat(build): Alp: Generate .vscode/tasks.json command"
```

---

### Task 9: Full suite + manual verification

**Files:** none (verification only)

- [ ] **Step 1: Run the full suite**

Run: `pnpm run compile && node --test test/*.test.js`
Expected: PASS — all tests including the new `west.buildTarget` (4) and `west.tasksJsonCore` (4), and the updated `west.service` (5). No new failures vs the 185/185 baseline (which now grows by 8 new tests).

- [ ] **Step 2: Manual verification in the Extension Development Host**

Document these checks (adapters/UI aren't unit-tested, per repo convention):
1. With a board.yaml present, the status bar shows **$(tools) Build** and **$(zap) Flash**; both hidden when no board.yaml.
2. Run **Alp: west build** (or the Build button): first run prompts for board + app, remembers it; a second build does **not** re-prompt. Introduce a compile error and confirm it appears in the **Problems panel** (clickable) via `$alp-west`.
3. **Alp: Set build target** re-prompts and changes the remembered target.
4. **Alp: Generate .vscode/tasks.json** writes `.vscode/tasks.json` with `alp: west build` (default build task, `$alp-west`) + `alp: west flash`; running it again **updates** (no duplicate); a pre-existing user task in that file is preserved.

- [ ] **Step 3: (Optional) finish the branch**

Use `superpowers:finishing-a-development-branch` (this rides on `feat/dev-tools` with the other dev tools).

---

## Self-Review

**1. Spec coverage:**
- Contributed `$alp-west` problem matcher → Task 4. ✓
- Build runs via Task API with matcher (build only) → Tasks 1 (`kind`) + 5. ✓
- Status-bar Build/Flash buttons, shown only with board.yaml → Task 7. ✓
- Build-target memory (workspaceState) + `alp.setBuildTarget` → Tasks 2 + 6. ✓
- tasks.json builder (merge-by-label, version default, invalid-JSON throw) + `alp.generateTasksJson` → Tasks 3 + 8. ✓
- Validate/generate stay TS pre-steps (westBuild body unchanged except target acquisition) → Task 6. ✓
- Pure logic unit-tested; adapters/UI manual → Tasks 1–3 tests, Task 9. ✓

**2. Placeholder scan:** No TBD/TODO; every code step shows full code; commands have expected output. The one prose pointer ("rest of westBuild unchanged") is intentional — the task only changes target acquisition and explicitly says not to touch the rest. ✓

**3. Type consistency:** `WestPlanKind`/`kind` defined in Task 1, used in Task 5. `BuildTarget`/`normalizeBuildTarget` defined in Task 2, used in Tasks 3, 6, 8. `TaskDraft`/`buildAlpWestTasks`/`createTasksJsonWritePlan` defined in Task 3, used in Task 8. `readTasksJson`/`writeTasksJson`/`tasksJsonPath` defined in Task 8 Step 1, used in Task 8 Step 2. `resolveBuildTarget` defined in Task 6, used in Task 8. Command ids (`alp.setBuildTarget`, `alp.generateTasksJson`) registered (Tasks 6, 8) and contributed in package.json (Tasks 6, 8). Matcher name `alp-west` contributed (Task 4) and referenced as `$alp-west` (Tasks 3, 5). ✓
