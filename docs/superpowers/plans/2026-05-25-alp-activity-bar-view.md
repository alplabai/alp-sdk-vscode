# Alp Activity-Bar View (Phase 1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a bolt icon to the VS Code activity bar that opens an "Alp" side panel showing the current project's board summary plus grouped action buttons, with a welcome-view fallback when no `board.yaml` is present.

**Architecture:** A pure, `vscode`-free function (`buildProjectNodes`) computes the tree structure from a `BoardSummary` and is unit-tested with `node --test`. A thin `vscode` provider (`AlpProjectTreeProvider`) renders those nodes and refreshes on `board.yaml` changes via a `FileSystemWatcher` (same pattern as `src/statusBar.ts`). `package.json` contributes the activity-bar container, the tree view, a welcome view, and a refresh command. All actions wire to existing `alp.*` commands — no new command behaviour.

**Tech Stack:** TypeScript (CommonJS, `tsc --build`), VS Code Extension API (`TreeDataProvider`, `viewsContainers`, `viewsWelcome`), `node:test` + `node:assert/strict`, pnpm workspace.

---

## Reference: existing facts this plan relies on

- Build: `pnpm run compile` compiles `src/**` → `out/**` (mirrors structure) and the CLI.
- Tests: `node --test test/<file>.test.js`, importing compiled JS from `../out/...`
  (see `test/boardSummary.service.test.js`).
- `loadBoardSummary(path: string | null): BoardSummary | null` lives in
  `src/boardSummary/vscodeAdapter.ts`. `BoardSummary` is `{ sku?, carrier?, os? }`
  from `@alp-sdk/core/boardSummary/models`.
- `collectProjectContext().boardYamlPath` (string | null) lives in
  `src/project/vscodeAdapter.ts`. The status bar already does
  `loadBoardSummary(collectProjectContext().boardYamlPath)`.
- Existing command ids used as actions (verified in `package.json`):
  `alp.openConfigurator`, `alp.validateBoardYaml`, `alp.generateAll`,
  `alp.westBuild`, `alp.westFlash`, `alp.debugDoctor`,
  `alp.openDebugTroubleshootingPanel`, `alp.newProjectWizard`.
- `tsconfig.json` is strict with `noUnusedLocals`/`noUnusedParameters` — no unused
  symbols allowed; the compile step is the gate for the `vscode`-coupled code.

## File Structure

- **Create** `media/bolt.svg` — single-color bolt for the activity-bar icon.
- **Create** `src/projectView/model.ts` — pure `buildProjectNodes` + `AlpNode` type
  (MUST NOT import `vscode`; type-only import of `BoardSummary`).
- **Create** `src/projectView/index.ts` — `AlpProjectTreeProvider` + `registerProjectView`.
- **Create** `test/projectView.model.test.js` — unit tests for `buildProjectNodes`.
- **Modify** `src/extension.ts` — call `registerProjectView()` in `activate`.
- **Modify** `package.json` — `viewsContainers`, `views`, `viewsWelcome`, `menus`,
  the `alp.refreshProjectView` command, and the `onView` activation event.

---

### Task 1: Activity-bar icon asset

**Files:**
- Create: `media/bolt.svg`

- [ ] **Step 1: Create the bolt SVG**

Create `media/bolt.svg` with a single-color bolt silhouette. VS Code masks
activity-bar icons to the theme color, so `currentColor` is correct; a 24×24
viewBox is the recommended size.

```svg
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="24" height="24">
  <path fill="currentColor" d="M13.5 2 4.5 13.5h5l-1 8.5 9-12h-5z"/>
</svg>
```

- [ ] **Step 2: Commit**

```bash
git add media/bolt.svg
git commit -m "feat(view): add bolt activity-bar icon asset

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: Pure node model (TDD)

**Files:**
- Test: `test/projectView.model.test.js`
- Create: `src/projectView/model.ts`

- [ ] **Step 1: Write the failing test**

Create `test/projectView.model.test.js`:

```javascript
const test = require("node:test");
const assert = require("node:assert/strict");

const { buildProjectNodes } = require("../out/projectView/model.js");

test("buildProjectNodes returns no roots when there is no board (welcome view shows)", () => {
  assert.deepEqual(buildProjectNodes(null), []);
  assert.deepEqual(buildProjectNodes({}), []);
});

test("buildProjectNodes returns Project / Actions / Debug sections for a board", () => {
  const roots = buildProjectNodes({
    sku: "E1M-AEN701",
    carrier: "E1M-EVK",
    os: "zephyr",
  });

  assert.deepEqual(
    roots.map((node) => node.label),
    ["Project", "Actions", "Debug"],
  );
  assert.ok(roots.every((node) => node.collapsible === true));
});

test("buildProjectNodes maps sku/carrier/os to the Project section", () => {
  const [project] = buildProjectNodes({
    sku: "E1M-AEN701",
    carrier: "E1M-EVK",
    os: "zephyr",
  });

  assert.deepEqual(
    project.children.map((child) => [child.label, child.description]),
    [
      ["SoM", "E1M-AEN701"],
      ["Carrier", "E1M-EVK"],
      ["OS", "zephyr"],
    ],
  );
});

test("buildProjectNodes renders an em dash for missing carrier/os", () => {
  const [project] = buildProjectNodes({ sku: "E1M-AEN701" });

  assert.deepEqual(
    project.children.map((child) => child.description),
    ["E1M-AEN701", "—", "—"],
  );
});

test("buildProjectNodes wires actions to existing commands, Configure board first", () => {
  const roots = buildProjectNodes({ sku: "E1M-AEN701" });
  const actions = roots.find((node) => node.label === "Actions");
  const debug = roots.find((node) => node.label === "Debug");

  assert.deepEqual(
    actions.children.map((child) => [child.label, child.command]),
    [
      ["Configure board", "alp.openConfigurator"],
      ["Validate board.yaml", "alp.validateBoardYaml"],
      ["Generate all", "alp.generateAll"],
      ["West build", "alp.westBuild"],
      ["West flash", "alp.westFlash"],
    ],
  );
  assert.deepEqual(
    debug.children.map((child) => child.command),
    ["alp.debugDoctor", "alp.openDebugTroubleshootingPanel"],
  );
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/projectView.model.test.js`
Expected: FAIL — `Cannot find module '../out/projectView/model.js'`.

- [ ] **Step 3: Write minimal implementation**

Create `src/projectView/model.ts`:

```typescript
// SPDX-License-Identifier: Apache-2.0

import type { BoardSummary } from "@alp-sdk/core/boardSummary/models";

export interface AlpNode {
  id: string;
  label: string;
  description?: string;
  icon?: string;
  command?: string;
  collapsible?: boolean;
  children?: AlpNode[];
}

const DASH = "—";

export function buildProjectNodes(summary: BoardSummary | null): AlpNode[] {
  if (!summary?.sku) {
    return [];
  }

  return [
    {
      id: "project",
      label: "Project",
      collapsible: true,
      children: [
        { id: "project.som", label: "SoM", description: summary.sku, icon: "circuit-board" },
        { id: "project.carrier", label: "Carrier", description: summary.carrier ?? DASH, icon: "primitive-square" },
        { id: "project.os", label: "OS", description: summary.os ?? DASH, icon: "server-environment" },
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
  ];
}
```

- [ ] **Step 4: Compile and run the test to verify it passes**

Run: `pnpm run compile && node --test test/projectView.model.test.js`
Expected: PASS — all 5 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/projectView/model.ts test/projectView.model.test.js
git commit -m "feat(view): pure buildProjectNodes model with tests

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: Tree provider + registration + extension wiring

No unit test (it imports `vscode`, which is unavailable in `node --test`); the
TypeScript compile is the gate, and Task 5 verifies behaviour in the dev host.

**Files:**
- Create: `src/projectView/index.ts`
- Modify: `src/extension.ts`

- [ ] **Step 1: Create the provider + registration**

Create `src/projectView/index.ts`:

```typescript
// SPDX-License-Identifier: Apache-2.0

import * as vscode from "vscode";
import { loadBoardSummary } from "../boardSummary/vscodeAdapter";
import { collectProjectContext } from "../project/vscodeAdapter";
import { AlpNode, buildProjectNodes } from "./model";

class AlpProjectTreeProvider implements vscode.TreeDataProvider<AlpNode> {
  private readonly emitter = new vscode.EventEmitter<void>();
  readonly onDidChangeTreeData = this.emitter.event;

  getTreeItem(node: AlpNode): vscode.TreeItem {
    const item = new vscode.TreeItem(
      node.label,
      node.collapsible
        ? vscode.TreeItemCollapsibleState.Expanded
        : vscode.TreeItemCollapsibleState.None,
    );
    item.id = node.id;
    if (node.description !== undefined) {
      item.description = node.description;
    }
    if (node.icon) {
      item.iconPath = new vscode.ThemeIcon(node.icon);
    }
    if (node.command) {
      item.command = { command: node.command, title: node.label };
    }
    return item;
  }

  getChildren(node?: AlpNode): AlpNode[] {
    if (node) {
      return node.children ?? [];
    }
    return buildProjectNodes(this.currentSummary());
  }

  refresh(): void {
    const summary = this.currentSummary();
    void vscode.commands.executeCommand(
      "setContext",
      "alpSdk.hasBoard",
      Boolean(summary?.sku),
    );
    this.emitter.fire();
  }

  private currentSummary() {
    return loadBoardSummary(collectProjectContext().boardYamlPath);
  }
}

export function registerProjectView(): vscode.Disposable[] {
  const provider = new AlpProjectTreeProvider();
  const treeView = vscode.window.createTreeView("alpSdk.projectView", {
    treeDataProvider: provider,
  });

  const refreshCommand = vscode.commands.registerCommand(
    "alp.refreshProjectView",
    () => provider.refresh(),
  );

  const watcher = vscode.workspace.createFileSystemWatcher("**/board.yaml");
  watcher.onDidChange(() => provider.refresh());
  watcher.onDidCreate(() => provider.refresh());
  watcher.onDidDelete(() => provider.refresh());

  // Seed the alpSdk.hasBoard context key for the welcome view.
  provider.refresh();

  return [treeView, refreshCommand, watcher];
}
```

- [ ] **Step 2: Wire it into `activate`**

In `src/extension.ts`, add the import alongside the other imports:

```typescript
import { registerProjectView } from "./projectView";
```

Then add `...registerProjectView()` to the `context.subscriptions.push(...)` call
so the block reads:

```typescript
  context.subscriptions.push(
    ...registerLoaderCommands(),
    ...registerWestCommands(),
    registerBootstrapCommand(),
    createStatusBar(context),
    registerConfiguratorCommand(context),
    registerProjectWizardCommand(),
    ...registerLspCommands(),
    ...registerDebugCommands(),
    ...registerProjectView(),
  );
```

- [ ] **Step 3: Compile to verify it builds**

Run: `pnpm run compile`
Expected: PASS — no TypeScript errors (in particular, no `noUnusedLocals`/
`noUnusedParameters` errors).

- [ ] **Step 4: Run the full test suite to confirm nothing regressed**

Run: `node --test test/*.test.js`
Expected: PASS — existing suites plus `projectView.model` all pass.

- [ ] **Step 5: Commit**

```bash
git add src/projectView/index.ts src/extension.ts
git commit -m "feat(view): Alp project tree provider + registration

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: package.json contributions

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Add the activation event**

In `package.json`, change the `activationEvents` array to include the view:

```json
  "activationEvents": [
    "onLanguage:yaml",
    "workspaceContains:**/board.yaml",
    "onView:alpSdk.projectView"
  ],
```

- [ ] **Step 2: Add the refresh command**

Append this entry to the `contributes.commands` array (after the last command
object, `alp.openDebugTroubleshootingPanel`):

```json
      {
        "command": "alp.refreshProjectView",
        "title": "Alp: Refresh project view",
        "category": "Alp",
        "icon": "$(refresh)"
      }
```

- [ ] **Step 3: Add the view container, view, welcome view, and menu**

Inside `contributes` (sibling of `commands`, `yamlValidation`, `snippets`,
`configuration`), add these four blocks:

```json
    "viewsContainers": {
      "activitybar": [
        {
          "id": "alpSdk",
          "title": "Alp SDK",
          "icon": "media/bolt.svg"
        }
      ]
    },
    "views": {
      "alpSdk": [
        {
          "id": "alpSdk.projectView",
          "name": "Project"
        }
      ]
    },
    "viewsWelcome": [
      {
        "view": "alpSdk.projectView",
        "when": "!alpSdk.hasBoard",
        "contents": "No board.yaml found in this workspace.\n\n[Configure board](command:alp.openConfigurator)\n[New project wizard](command:alp.newProjectWizard)"
      }
    ],
    "menus": {
      "view/title": [
        {
          "command": "alp.refreshProjectView",
          "when": "view == alpSdk.projectView",
          "group": "navigation"
        }
      ]
    },
```

- [ ] **Step 4: Validate the JSON compiles and packages cleanly**

Run: `pnpm run compile`
Expected: PASS (compile does not parse `package.json` contributions, but this
confirms nothing else broke). Then sanity-check the JSON is well-formed:

Run: `node -e "JSON.parse(require('fs').readFileSync('package.json','utf8')); console.log('package.json OK')"`
Expected: prints `package.json OK` (no `SyntaxError`).

- [ ] **Step 5: Commit**

```bash
git add package.json
git commit -m "feat(view): contribute Alp activity-bar container, view, welcome, refresh

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: Manual verification in the Extension Development Host

No code changes expected. This validates the user-visible behaviour. (`.vscode/launch.json`
and a `watch` task already exist; `.scratch/board.yaml` already exists as a test project.)

- [ ] **Step 1: Launch the dev host**

In VS Code with this folder open, press `F5` (runs the `watch` task, opens the
Extension Development Host). Alternatively from a terminal:
`code --extensionDevelopmentPath=. --new-window .scratch`

- [ ] **Step 2: Verify the empty/welcome state**

In the dev host, open a folder with **no** `board.yaml` (e.g. a fresh temp folder),
click the **bolt icon** in the activity bar.
Expected: the "Alp SDK" container opens a "Project" view showing the welcome
content with **Configure board** and **New project wizard** buttons.

- [ ] **Step 3: Verify the populated state**

Open the `.scratch` folder (**File → Open Folder → `.scratch`**), click the bolt icon.
Expected: the "Project" view shows three expandable sections —
**Project** (SoM `E1M-AEN301`, Carrier `E1M-EVK`, OS `zephyr`), **Actions**
(Configure board, Validate, Generate all, West build, West flash), **Debug**
(Doctor, Troubleshooting panel).

- [ ] **Step 4: Verify actions and live refresh**

Click **Configure board** → the ALP Board Configurator webview opens.
Then delete (or rename) `.scratch/board.yaml`.
Expected: the view switches to the welcome content within a moment (the watcher
fired). Recreate/restore `board.yaml` → the tree repopulates. The title-bar
**refresh** button also forces a refresh.

- [ ] **Step 5: Record the result**

If all steps pass, the phase is complete — no further commit needed. If any step
fails, capture the exact symptom (and any Extension Host console error from
**Help → Toggle Developer Tools**) and fix before closing the phase.

---

## Self-review notes

- **Spec coverage:** icon asset (Task 1), `viewsContainers`/`views`/`viewsWelcome`/
  `menus`/command/activation (Task 4), pure `buildProjectNodes` + tests (Task 2),
  provider + `registerProjectView` + `extension.ts` wiring + live `board.yaml`
  watcher + `alpSdk.hasBoard` context key (Task 3), manual verification (Task 5) —
  all spec sections mapped.
- **Welcome-view correctness:** `buildProjectNodes` returns `[]` when there is no
  board so the tree is empty and the welcome view renders; `refresh()` sets
  `alpSdk.hasBoard` from the same `summary?.sku` test, keeping the two consistent.
- **Type consistency:** `AlpNode` fields (`id`, `label`, `description`, `icon`,
  `command`, `collapsible`, `children`) are used identically in `model.ts`, the
  provider's `getTreeItem`/`getChildren`, and the tests. Command ids match
  `package.json`. `registerProjectView()` takes no args (avoids the strict
  unused-parameter error) and returns `vscode.Disposable[]`.
