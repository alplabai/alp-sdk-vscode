# Auto-connect SDK Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the extension find an existing `alp-sdk` checkout (or clone the public repo) and set `alpSdk.path` automatically, removing the manual "NOT CONNECTED" dead end.

**Architecture:** Pure, unit-tested detection logic lives in `@alp-sdk/core/sdkConnect/detect.ts` (path candidates + an `isSdkRoot` predicate that takes an injected `pathExists`). A thin VS Code adapter `src/sdkConnect/index.ts` does the filesystem probing, QuickPick/folder-picker/notification UI, the `git clone` task, and writes the setting. UI surfaces (project view node, configurator button, one-time prompt) call the new `alp.connectSdk` command.

**Tech Stack:** TypeScript, VS Code extension API, pnpm workspace (`@alp-sdk/core` → `packages/alp-core/dist`, extension → `out`), `node:test` + `node:assert/strict`.

**Spec:** `docs/superpowers/specs/2026-05-26-auto-connect-sdk-design.md`

---

## Background the implementer needs

- **Build:** `pnpm run compile` (runs `tsc --build` then the alp-cli compile). Tests: `node --test test/*.test.js` — but tests import **compiled** JS, so you must `pnpm run compile` before running them.
- **Core import path convention:** the extension imports core modules as `@alp-sdk/core/<area>/<file>` (no `.js`), e.g. `@alp-sdk/core/sdkConnect/detect`. Source lives at `packages/alp-core/src/sdkConnect/detect.ts` and compiles to `packages/alp-core/dist/sdkConnect/detect.js`. Tests import the **dist** path: `require("@alp-sdk/core/sdkConnect/detect")` resolves via the package `exports` map (`"./*": "./dist/*.js"`).
- **Test style in this repo:** plain `node:test`. Example header used by existing tests:
  ```js
  const test = require("node:test");
  const assert = require("node:assert/strict");
  ```
- **The real "connected" gate:** `packages/alp-core/src/project/service.ts` → `resolveSdkRoot` returns a configured `alpSdk.path` only if it contains `scripts/alp_project.py` (`containsLoaderScript`). So our `isSdkRoot` MUST use that same marker, or we'd set a path the resolver rejects.
- **`collectProjectContext()`** (`src/project/vscodeAdapter.ts`) returns `{ workspaceRoot, sdkRoot, boardYamlPath, westCwd, pythonBinary }`. `sdkRoot !== null` is the definition of "connected".
- **Branch:** work on the existing `feat/dev-tools` branch (do NOT start on main).
- **No `Co-Authored-By: Claude` / generated-by trailer** in any commit (project rule).
- **Brand string is "Alp", never "ALP"** in user-facing strings.

## File Structure

**Create:**
- `packages/alp-core/src/sdkConnect/detect.ts` — pure detection: `SDK_MARKER`, `candidateSdkPaths`, `isSdkRoot`, `detectSdkRoots`.
- `test/sdkConnect.detect.test.js` — unit tests for the above.
- `src/sdkConnect/index.ts` — VS Code adapter: `isSdkConnected`, `registerSdkConnectCommand`, `maybeOfferSdkConnect`, internal clone/quickpick flow.

**Modify:**
- `packages/alp-core/src/configurator/models.ts` — add `"connectSdk"` to `CommandMessage`.
- `src/projectView/model.ts` — `buildProjectNodes(summary, sdkConnected)` prepends a "Setup → Connect SDK" node when not connected.
- `test/projectView.model.test.js` — extend/Create tests for the `sdkConnected` param. (Create if it doesn't exist.)
- `src/projectView/index.ts` — compute `sdkConnected`, set context key `alpSdk.sdkConnected`, pass to `buildProjectNodes`.
- `src/configuratorPanel.ts` — handle inbound `connectSdk`; refresh on `alpSdk.path` config change.
- `media/configurator.js` — add a "Connect SDK" button to `renderDisconnected()`.
- `src/extension.ts` — register `alp.connectSdk`; call `maybeOfferSdkConnect(context)`.
- `package.json` — add the `alp.connectSdk` command + a `viewsWelcome` entry for the not-connected state.

---

### Task 1: Pure detection module

**Files:**
- Create: `packages/alp-core/src/sdkConnect/detect.ts`
- Test: `test/sdkConnect.detect.test.js`

- [ ] **Step 1: Write the failing test**

Create `test/sdkConnect.detect.test.js`:

```js
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const {
  SDK_MARKER,
  candidateSdkPaths,
  isSdkRoot,
  detectSdkRoots,
} = require("@alp-sdk/core/sdkConnect/detect");

test("SDK_MARKER is the loader script path", () => {
  assert.equal(SDK_MARKER, path.join("scripts", "alp_project.py"));
});

test("candidateSdkPaths: workspace, siblings, then common dev roots, in order", () => {
  const ws = path.join("C:", "repos", "alp-sdk-vscode");
  const home = path.join("C:", "Users", "dev");
  const got = candidateSdkPaths(ws, home);
  assert.deepEqual(got, [
    ws,
    path.join("C:", "repos", "alp-sdk"),
    path.join("C:", "repos", "alp_sdk"),
    path.join(home, "Documents", "GitHub", "alp-sdk"),
    path.join(home, "GitHub", "alp-sdk"),
    path.join(home, "src", "alp-sdk"),
  ]);
});

test("candidateSdkPaths: null workspace yields only home roots", () => {
  const home = path.join("C:", "Users", "dev");
  assert.deepEqual(candidateSdkPaths(null, home), [
    path.join(home, "Documents", "GitHub", "alp-sdk"),
    path.join(home, "GitHub", "alp-sdk"),
    path.join(home, "src", "alp-sdk"),
  ]);
});

test("isSdkRoot: true only when the loader script exists", () => {
  const root = path.join("x", "alp-sdk");
  const present = (p) => p === path.join(root, SDK_MARKER);
  assert.equal(isSdkRoot(root, present), true);
  assert.equal(isSdkRoot(root, () => false), false);
  // near-miss: a scripts/ dir but not the file
  const onlyDir = (p) => p === path.join(root, "scripts");
  assert.equal(isSdkRoot(root, onlyDir), false);
});

test("detectSdkRoots: keeps only valid candidates, preserving order", () => {
  const a = path.join("a", "alp-sdk");
  const b = path.join("b", "alp-sdk");
  const valid = new Set([path.join(b, SDK_MARKER)]);
  assert.deepEqual(detectSdkRoots([a, b], (p) => valid.has(p)), [b]);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm run compile && node --test test/sdkConnect.detect.test.js`
Expected: FAIL — `Cannot find module '@alp-sdk/core/sdkConnect/detect'`.

- [ ] **Step 3: Write the implementation**

Create `packages/alp-core/src/sdkConnect/detect.ts`:

```ts
// SPDX-License-Identifier: Apache-2.0

import * as path from "path";

/**
 * Relative marker that identifies an Alp SDK checkout. Must match the marker
 * used by resolveSdkRoot() in ../project/service.ts — that resolver is the gate
 * that turns a configured alpSdk.path into a live sdkRoot, so detecting on a
 * different marker could "connect" to a path the resolver then rejects.
 */
export const SDK_MARKER = path.join("scripts", "alp_project.py");

/**
 * Ordered list of absolute paths to probe for an SDK checkout. The first that
 * passes isSdkRoot() wins. De-duplicated, order preserved.
 */
export function candidateSdkPaths(
  workspaceRoot: string | null,
  homeDir: string,
): string[] {
  const out: string[] = [];
  if (workspaceRoot) {
    out.push(workspaceRoot);
    const parent = path.resolve(workspaceRoot, "..");
    out.push(path.join(parent, "alp-sdk"));
    out.push(path.join(parent, "alp_sdk"));
  }
  out.push(path.join(homeDir, "Documents", "GitHub", "alp-sdk"));
  out.push(path.join(homeDir, "GitHub", "alp-sdk"));
  out.push(path.join(homeDir, "src", "alp-sdk"));
  return [...new Set(out)];
}

/** True when `root` contains the SDK marker file. */
export function isSdkRoot(
  root: string,
  pathExists: (candidate: string) => boolean,
): boolean {
  return pathExists(path.join(root, SDK_MARKER));
}

/** Filters `candidates` down to those that are valid SDK roots, in order. */
export function detectSdkRoots(
  candidates: string[],
  pathExists: (candidate: string) => boolean,
): string[] {
  return candidates.filter((root) => isSdkRoot(root, pathExists));
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm run compile && node --test test/sdkConnect.detect.test.js`
Expected: PASS — 5 tests.

Note on `candidateSdkPaths` step-2 expectation: `path.resolve(workspaceRoot, "..")` of `C:\repos\alp-sdk-vscode` is `C:\repos`, so the siblings are `C:\repos\alp-sdk` and `C:\repos\alp_sdk`. The test uses `path.join("C:", "repos", ...)` to stay platform-correct.

- [ ] **Step 5: Commit**

```bash
git add packages/alp-core/src/sdkConnect/detect.ts test/sdkConnect.detect.test.js
git commit -m "feat(core): SDK checkout detection (pure)"
```

---

### Task 2: Add `connectSdk` to the configurator message protocol

**Files:**
- Modify: `packages/alp-core/src/configurator/models.ts:27-29`

- [ ] **Step 1: Make the change**

In `packages/alp-core/src/configurator/models.ts`, change `CommandMessage` from:

```ts
export interface CommandMessage {
  type: "save" | "reload" | "previewEffectiveConfig";
}
```

to:

```ts
export interface CommandMessage {
  type: "save" | "reload" | "previewEffectiveConfig" | "connectSdk";
}
```

- [ ] **Step 2: Verify it compiles**

Run: `pnpm run compile`
Expected: EXIT 0 (no type errors).

- [ ] **Step 3: Commit**

```bash
git add packages/alp-core/src/configurator/models.ts
git commit -m "feat(core): add connectSdk to configurator inbound messages"
```

---

### Task 3: Project view shows "Connect SDK" when not connected

**Files:**
- Modify: `src/projectView/model.ts`
- Test: `test/projectView.model.test.js` (create)

- [ ] **Step 1: Write the failing test**

Create `test/projectView.model.test.js`:

```js
const test = require("node:test");
const assert = require("node:assert/strict");
const { buildProjectNodes } = require("../out/projectView/model.js");

test("not connected + no board: only the Setup node", () => {
  const nodes = buildProjectNodes(null, false);
  assert.deepEqual(nodes.map((n) => n.id), ["setup"]);
  assert.equal(nodes[0].children[0].id, "setup.connect");
  assert.equal(nodes[0].children[0].command, "alp.connectSdk");
});

test("connected + no board: empty (welcome view takes over)", () => {
  assert.deepEqual(buildProjectNodes(null, true), []);
});

test("connected + board: project/actions/debug, no setup node", () => {
  const nodes = buildProjectNodes({ sku: "E1M-AEN701", preset: "e1m-evk" }, true);
  assert.deepEqual(nodes.map((n) => n.id), ["project", "actions", "debug"]);
});

test("not connected + board: setup node prepended", () => {
  const nodes = buildProjectNodes({ sku: "E1M-AEN701", preset: "e1m-evk" }, false);
  assert.deepEqual(nodes.map((n) => n.id), ["setup", "project", "actions", "debug"]);
});
```

Note: this test imports the **extension** build output (`../out/projectView/model.js`), not the core dist, because `model.ts` lives in `src/`.

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm run compile && node --test test/projectView.model.test.js`
Expected: FAIL — current `buildProjectNodes` ignores the second arg and returns `[]` for `null` summary, so the first test fails on `["setup"]`.

- [ ] **Step 3: Write the implementation**

Replace the body of `buildProjectNodes` in `src/projectView/model.ts`. New full function:

```ts
export function buildProjectNodes(
  summary: BoardSummary | null,
  sdkConnected: boolean,
): AlpNode[] {
  const nodes: AlpNode[] = [];

  if (!sdkConnected) {
    nodes.push({
      id: "setup",
      label: "Setup",
      collapsible: true,
      children: [
        { id: "setup.connect", label: "Connect SDK", icon: "plug", command: "alp.connectSdk" },
      ],
    });
  }

  if (summary?.sku) {
    nodes.push(
      {
        id: "project",
        label: "Project",
        collapsible: true,
        children: [
          { id: "project.som", label: "SoM", description: summary.sku, icon: "circuit-board" },
          { id: "project.preset", label: "Preset", description: summary.preset ?? DASH, icon: "primitive-square" },
        ],
      },
      {
        id: "actions",
        label: "Actions",
        collapsible: true,
        children: [
          { id: "actions.configure", label: "Configure board", icon: "settings-gear", command: "alp.openConfigurator" },
          { id: "actions.validate", label: "Validate board.yaml", icon: "check", command: "alp.validateBoardYaml" },
          { id: "actions.generate", label: "Generate all", icon: "file-code", command: "alp.generateAll" },
          { id: "actions.build", label: "West build", icon: "tools", command: "alp.westBuild" },
          { id: "actions.flash", label: "West flash", icon: "zap", command: "alp.westFlash" },
        ],
      },
      {
        id: "debug",
        label: "Debug",
        collapsible: true,
        children: [
          { id: "debug.doctor", label: "Doctor", icon: "pulse", command: "alp.debugDoctor" },
          { id: "debug.troubleshoot", label: "Troubleshooting panel", icon: "question", command: "alp.openDebugTroubleshootingPanel" },
        ],
      },
    );
  }

  return nodes;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm run compile && node --test test/projectView.model.test.js`
Expected: PASS — 4 tests.

- [ ] **Step 5: Commit**

```bash
git add src/projectView/model.ts test/projectView.model.test.js
git commit -m "feat(view): show Connect SDK node when SDK not connected"
```

---

### Task 4: Project view passes connection state + sets context key

**Files:**
- Modify: `src/projectView/index.ts`

- [ ] **Step 1: Update the import and refresh()**

In `src/projectView/index.ts`, the `refresh()` method currently computes the board summary and sets `alpSdk.hasBoard`. Update it to also compute SDK connection and set `alpSdk.sdkConnected`, and store it for `getChildren`.

Add a field to the class (next to `private summary`):

```ts
  private sdkConnected = false;
```

Replace `refresh()` with:

```ts
  async refresh(): Promise<void> {
    const project = collectProjectContext();
    this.summary = loadBoardSummary(project.boardYamlPath);
    this.sdkConnected = project.sdkRoot !== null;
    await vscode.commands.executeCommand(
      "setContext",
      "alpSdk.hasBoard",
      Boolean(this.summary?.sku),
    );
    await vscode.commands.executeCommand(
      "setContext",
      "alpSdk.sdkConnected",
      this.sdkConnected,
    );
    this.emitter.fire();
  }
```

And update `getChildren`'s root branch to pass the flag:

```ts
  getChildren(node?: AlpNode): AlpNode[] {
    if (node) {
      return node.children ?? [];
    }
    return buildProjectNodes(this.summary, this.sdkConnected);
  }
```

(`collectProjectContext` is already imported at the top of this file.)

- [ ] **Step 2: Verify it compiles**

Run: `pnpm run compile`
Expected: EXIT 0.

- [ ] **Step 3: Commit**

```bash
git add src/projectView/index.ts
git commit -m "feat(view): wire sdkConnected context key and tree state"
```

---

### Task 5: SDK-connect VS Code adapter (command + clone flow)

**Files:**
- Create: `src/sdkConnect/index.ts`

- [ ] **Step 1: Write the adapter**

Create `src/sdkConnect/index.ts`:

```ts
// SPDX-License-Identifier: Apache-2.0

import { execFileSync } from "child_process";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import * as vscode from "vscode";
import {
  candidateSdkPaths,
  detectSdkRoots,
  isSdkRoot,
} from "@alp-sdk/core/sdkConnect/detect";
import { collectProjectContext } from "../project/vscodeAdapter";

const CLONE_URL = "https://github.com/alplabai/alp-sdk";
const PROMPT_DISMISSED_KEY = "alp.sdkConnectPromptDismissed";

/** Connected == the resolver turns the configured path into a live sdkRoot. */
export function isSdkConnected(): boolean {
  return collectProjectContext().sdkRoot !== null;
}

function workspaceRoot(): string | null {
  return vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? null;
}

async function setSdkPath(sdkPath: string): Promise<void> {
  await vscode.workspace
    .getConfiguration("alpSdk")
    .update("path", sdkPath, vscode.ConfigurationTarget.Global);
  await vscode.commands.executeCommand("setContext", "alpSdk.sdkConnected", true);
  await vscode.commands.executeCommand("alp.refreshProjectView");
  vscode.window.showInformationMessage(`Alp SDK connected: ${sdkPath}`);
}

function gitAvailable(): boolean {
  try {
    execFileSync("git", ["--version"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

async function cloneSdk(): Promise<void> {
  if (!gitAvailable()) {
    const install = "Install git";
    const choice = await vscode.window.showErrorMessage(
      "git was not found on PATH. Install git to clone the Alp SDK.",
      install,
    );
    if (choice === install) {
      void vscode.env.openExternal(vscode.Uri.parse("https://git-scm.com/downloads"));
    }
    return;
  }

  const defaultDir = workspaceRoot()
    ? path.resolve(workspaceRoot()!, "..")
    : os.homedir();
  const picked = await vscode.window.showOpenDialog({
    canSelectFiles: false,
    canSelectFolders: true,
    canSelectMany: false,
    defaultUri: vscode.Uri.file(defaultDir),
    openLabel: "Clone Alp SDK here",
    title: "Choose a parent folder for the alp-sdk clone",
  });
  if (!picked || picked.length === 0) return;

  const parent = picked[0]!.fsPath;
  const dest = path.join(parent, "alp-sdk");

  // Idempotent: a valid checkout already at the destination → just use it.
  if (isSdkRoot(dest, fs.existsSync)) {
    await setSdkPath(dest);
    return;
  }

  const task = new vscode.Task(
    { type: "alp-sdk-clone" },
    vscode.TaskScope.Workspace,
    "Clone Alp SDK",
    "alp",
    new vscode.ShellExecution("git", ["clone", CLONE_URL, dest]),
  );

  const endListener = vscode.tasks.onDidEndTaskProcess(async (e) => {
    if (e.execution.task.name !== "Clone Alp SDK") return;
    endListener.dispose();
    if (e.exitCode === 0 && isSdkRoot(dest, fs.existsSync)) {
      await setSdkPath(dest);
    } else {
      vscode.window.showErrorMessage(
        `Alp: clone failed (exit ${e.exitCode}). See the terminal for details.`,
      );
    }
  });

  await vscode.tasks.executeTask(task);
}

async function connectSdk(): Promise<void> {
  if (isSdkConnected()) {
    vscode.window.showInformationMessage(
      `Alp SDK already connected: ${collectProjectContext().sdkRoot}`,
    );
    return;
  }

  const found = detectSdkRoots(
    candidateSdkPaths(workspaceRoot(), os.homedir()),
    fs.existsSync,
  );
  const CLONE = "Clone a fresh copy…";

  if (found.length > 0) {
    const pick = await vscode.window.showQuickPick([...found, CLONE], {
      placeHolder: "Select an Alp SDK checkout to connect",
    });
    if (!pick) return;
    if (pick !== CLONE) {
      await setSdkPath(pick);
      return;
    }
    await cloneSdk();
    return;
  }

  const CONFIRM = "Clone";
  const choice = await vscode.window.showInformationMessage(
    "No Alp SDK checkout found. Clone alplabai/alp-sdk?",
    CONFIRM,
    "Cancel",
  );
  if (choice === CONFIRM) await cloneSdk();
}

export function registerSdkConnectCommand(): vscode.Disposable {
  return vscode.commands.registerCommand("alp.connectSdk", () => connectSdk());
}

/** One-time activation prompt; also seeds the alpSdk.sdkConnected context key. */
export async function maybeOfferSdkConnect(
  context: vscode.ExtensionContext,
): Promise<void> {
  const connected = isSdkConnected();
  await vscode.commands.executeCommand(
    "setContext",
    "alpSdk.sdkConnected",
    connected,
  );
  if (connected) return;
  if (context.globalState.get<boolean>(PROMPT_DISMISSED_KEY)) return;

  const CONNECT = "Connect SDK";
  const LATER = "Later";
  const NEVER = "Don't ask again";
  const choice = await vscode.window.showInformationMessage(
    "No Alp SDK connected. Connect it to load SoMs, boards, chips and libraries.",
    CONNECT,
    LATER,
    NEVER,
  );
  if (choice === CONNECT) {
    await vscode.commands.executeCommand("alp.connectSdk");
  } else if (choice === NEVER) {
    await context.globalState.update(PROMPT_DISMISSED_KEY, true);
  }
}
```

- [ ] **Step 2: Verify it compiles**

Run: `pnpm run compile`
Expected: EXIT 0.

- [ ] **Step 3: Commit**

```bash
git add src/sdkConnect/index.ts
git commit -m "feat(sdk): connect command with detect + clone flow"
```

---

### Task 6: Register the command + one-time prompt in activation

**Files:**
- Modify: `src/extension.ts`

- [ ] **Step 1: Make the change**

In `src/extension.ts`, add the import (next to the other `register*` imports):

```ts
import { registerSdkConnectCommand, maybeOfferSdkConnect } from "./sdkConnect";
```

Add `registerSdkConnectCommand()` to the `context.subscriptions.push(...)` list (e.g. right after `...registerSdkStatusCommands(),`):

```ts
    ...registerSdkStatusCommands(),
    registerSdkConnectCommand(),
```

And at the end of `activate`, alongside the existing first-run wizard call:

```ts
  void maybeOfferFirstRunWizard(context);
  void maybeOfferSdkConnect(context);
```

- [ ] **Step 2: Verify it compiles**

Run: `pnpm run compile`
Expected: EXIT 0.

- [ ] **Step 3: Commit**

```bash
git add src/extension.ts
git commit -m "feat(sdk): register connect command and one-time prompt"
```

---

### Task 7: Configurator handles `connectSdk` and refreshes on path change

**Files:**
- Modify: `src/configuratorPanel.ts`

- [ ] **Step 1: Handle the inbound message**

In `src/configuratorPanel.ts`, inside `onMessage`, add a branch (after the `previewEffectiveConfig` branch, before `setTheme`):

```ts
    } else if (msg.type === "connectSdk") {
      void vscode.commands.executeCommand("alp.connectSdk");
    } else if (msg.type === "setTheme") {
```

- [ ] **Step 2: Auto-refresh when the SDK path changes**

In the `ConfiguratorPanel` constructor, after the `onDidReceiveMessage` registration, add a configuration listener so connecting the SDK (which writes `alpSdk.path`) re-renders the open panel to the CONNECTED state:

```ts
    vscode.workspace.onDidChangeConfiguration(
      (e) => {
        if (e.affectsConfiguration("alpSdk.path")) this.refresh();
      },
      null,
      this.disposables,
    );
```

- [ ] **Step 3: Verify it compiles**

Run: `pnpm run compile`
Expected: EXIT 0.

- [ ] **Step 4: Commit**

```bash
git add src/configuratorPanel.ts
git commit -m "feat(configurator): handle connectSdk + refresh on path change"
```

---

### Task 8: Connect SDK button in the configurator's disconnected panel

**Files:**
- Modify: `media/configurator.js:126-131` (`renderDisconnected`)

- [ ] **Step 1: Add the button**

Replace `renderDisconnected()` in `media/configurator.js` with:

```js
  function renderDisconnected() {
    const connect = el("button", { class: "alp-btn primary", text: "Connect SDK" });
    connect.addEventListener("click", () => vscode.postMessage({ type: "connectSdk" }));
    return el("div", { class: "alp-section" }, [
      el("p", { class: "alp-seclabel", text: "§ Not connected" }),
      el("p", { class: "alp-help", text: "No Alp SDK connected. Connect a local alp-sdk checkout (or clone it) to load SoMs, boards, chips and libraries." }),
      connect,
    ]);
  }
```

- [ ] **Step 2: Verify (no compile needed for media JS)**

`media/configurator.js` is not compiled. Confirm the file parses by running the existing test suite once (it must still be green):

Run: `pnpm run compile && node --test test/*.test.js`
Expected: PASS (no regressions).

- [ ] **Step 3: Commit**

```bash
git add media/configurator.js
git commit -m "feat(configurator): Connect SDK button in disconnected panel"
```

---

### Task 9: Manifest — command + welcome entry

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Add the command**

In `package.json` → `contributes.commands`, add (after the `alp.openSomDocs` entry):

```json
      {
        "command": "alp.connectSdk",
        "title": "Alp: Connect SDK",
        "category": "Alp"
      }
```

- [ ] **Step 2: Add a not-connected welcome entry**

In `package.json` → `contributes.viewsWelcome`, add a second entry (the array currently has one entry for `!alpSdk.hasBoard`):

```json
      {
        "view": "alpSdk.projectView",
        "when": "!alpSdk.sdkConnected",
        "contents": "No Alp SDK connected.\n\n[Connect SDK](command:alp.connectSdk)"
      }
```

The existing `!alpSdk.hasBoard` entry stays. When both conditions hold (first run: no SDK, no board) VS Code concatenates both welcomes; when only one holds, only that one shows.

- [ ] **Step 3: Verify JSON is valid + build**

Run: `pnpm run compile`
Expected: EXIT 0 (and no JSON parse error from the manifest).

- [ ] **Step 4: Commit**

```bash
git add package.json
git commit -m "feat(sdk): contribute alp.connectSdk command and welcome entry"
```

---

### Task 10: Full suite + manual dev-host verification

**Files:** none (verification only)

- [ ] **Step 1: Run the full test suite**

Run: `pnpm run compile && node --test test/*.test.js`
Expected: PASS — all tests, including the two new files (`sdkConnect.detect.test.js`, `projectView.model.test.js`). Note: the repo has some pre-existing failing tests unrelated to this work (npm→pnpm path drift); record the baseline before this plan and confirm you add no *new* failures.

- [ ] **Step 2: Manual verification in the Extension Development Host**

Document these checks (the adapter is not unit-tested, per the spec):
1. With `alpSdk.path` unset and an `alp-sdk` checkout present under `~/Documents/GitHub`: run **Alp: Connect SDK** → it offers the detected path → selecting it sets the setting and the project view / configurator flip to CONNECTED.
2. Open the configurator while disconnected → the **Connect SDK** button appears and triggers the same flow; after connecting, the panel re-renders to CONNECTED without manual reload.
3. Fresh profile (no SDK): on activation the one-time notification appears; **Don't ask again** suppresses it on the next reload.
4. Project view shows the **Setup → Connect SDK** node while disconnected and hides it once connected.

- [ ] **Step 3: (Optional) Final review + finish the branch**

Use `superpowers:finishing-a-development-branch` to verify tests and choose merge/PR. (This plan's work rides on the existing `feat/dev-tools` branch alongside the other dev tools.)

---

## Self-Review

**1. Spec coverage:**
- Pure core `detect.ts` (candidates + `isSdkRoot`) → Task 1. ✓
- Marker = `scripts/alp_project.py` matching resolver → Task 1 (`SDK_MARKER`). ✓
- Detection order (workspace, siblings, common roots) → Task 1 test + impl. ✓
- Global setting scope → Task 5 (`setSdkPath` uses `ConfigurationTarget.Global`). ✓
- Command flow: QuickPick on found, clone fallback, idempotent re-clone → Task 5. ✓
- git-missing + clone-fail handling → Task 5 (`gitAvailable`, `onDidEndTaskProcess`). ✓
- Context key `alpSdk.sdkConnected` → Tasks 4 (refresh) + 5 (`maybeOfferSdkConnect`/`setSdkPath`). ✓
- Project view Connect node → Tasks 3 + 4. ✓
- Configurator NOT-CONNECTED button + auto-refresh → Tasks 2, 7, 8. ✓
- One-time prompt with [Connect][Later][Don't ask again] → Tasks 5 + 6. ✓
- Welcome entry → Task 9. ✓
- Testing (pure core unit tests; adapter manual) → Tasks 1, 3, 10. ✓

**2. Placeholder scan:** No TBD/TODO; every code step shows full code; commands have expected output. ✓

**3. Type consistency:** `buildProjectNodes(summary, sdkConnected)` signature is consistent across Tasks 3 and 4. `isSdkRoot(root, pathExists)`, `detectSdkRoots(candidates, pathExists)`, `candidateSdkPaths(workspaceRoot, homeDir)` consistent across Tasks 1 and 5. `CommandMessage` `"connectSdk"` added (Task 2) before it's used (Tasks 7, 8). `setContext alpSdk.sdkConnected` written in Tasks 4, 5 and read by the welcome `when` (Task 9). ✓
