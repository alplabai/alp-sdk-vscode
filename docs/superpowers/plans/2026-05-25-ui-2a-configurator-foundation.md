# UI-2a: Configurator Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The testable foundation for the redesigned configurator — v0.6 board summary (status bar + tree), the new view-model message protocol, board load/save via the v0.6 model, and the site-styled webview shell — without the section renderer (that's UI-2b, same branch).

**Architecture:** Pure/core + fs-adapter work is TDD'd with `node --test`; the `panelHtml` shell is a pure string (structure-tested); `configuratorPanel.ts` wiring is compile-gated (manual dev-host check comes in UI-2b once the renderer exists). Do NOT merge this branch until UI-2b lands — the configurator is mid-rewrite in between.

**Tech Stack:** TypeScript (CommonJS), `js-yaml`, `node:test`. Build: `pnpm run compile`. Core tests import `../packages/alp-core/dist/...`; fs-adapter tests use temp files.

---

## Reference facts

- Branch: `feat/configurator-ui` (already checked out).
- Available core APIs (merged): `parseBoardConfig`/`serializeBoardConfig`
  (`@alp-sdk/core/board/{parse,serialize}`), `buildConfiguratorViewModel`
  (`@alp-sdk/core/configurator/viewModel`), `loadSdkCatalogue`
  (`src/sdkCatalogue/vscodeAdapter`, takes an optional `logError`), `validateBoardConfig`.
- `boardSummary` today: `BoardSummary = {sku?,carrier?,os?}`; `parseBoardSummary` reads
  `som.sku`/`carrier.name`/`os`; consumed by `src/statusBar.ts` and
  `src/projectView/model.ts` (PROJECT rows SoM/Carrier/OS). v0.6 has no top-level `os` and
  no `carrier` — it has `preset`.
- The existing `test/boardSummary.*.test.js` import `../out/boardSummary/...` (broken:
  core compiles to `packages/alp-core/dist`). This plan rewrites them to the correct dist
  path + v0.6 shape (fixing 2 of the ~20 stale failures as a side effect).
- `projectView/model.ts` `buildProjectNodes(summary)` builds the PROJECT rows; it is pure
  and unit-tested in `test/projectView.model.test.js`.

---

### Task 1: v0.6 board summary (core)

**Files:**
- Modify: `packages/alp-core/src/boardSummary/models.ts`
- Modify: `packages/alp-core/src/boardSummary/service.ts`
- Test: `test/boardSummary.service.test.js` (rewrite)

- [ ] **Step 1: Rewrite the test for v0.6 + correct dist import**

Replace `test/boardSummary.service.test.js` with EXACTLY:

```javascript
const test = require("node:test");
const assert = require("node:assert/strict");

const {
  parseBoardSummary,
  createStatusBarPresentation,
} = require("../packages/alp-core/dist/boardSummary/service.js");

test("parseBoardSummary reads sku + preset from a v0.6 board.yaml", () => {
  const s = parseBoardSummary("som:\n  sku: E1M-AEN801\npreset: e1m-evk\ncores:\n  m55_hp: { app: ./src }\n");
  assert.deepEqual(s, { sku: "E1M-AEN801", preset: "e1m-evk" });
});

test("parseBoardSummary omits preset in inline mode", () => {
  const s = parseBoardSummary("som:\n  sku: E1M-V2N101\npopulated:\n  lsm6dso: true\ncores:\n  m33_sm: {}\n");
  assert.deepEqual(s, { sku: "E1M-V2N101", preset: undefined });
});

test("parseBoardSummary returns null for non-object yaml", () => {
  assert.equal(parseBoardSummary("42"), null);
});

test("createStatusBarPresentation renders empty state", () => {
  const p = createStatusBarPresentation(null);
  assert.equal(p.text, "$(circuit-board) Alp: no board.yaml");
  assert.equal(p.command, "alp.openConfigurator");
});

test("createStatusBarPresentation renders sku + preset", () => {
  const p = createStatusBarPresentation({ sku: "E1M-AEN801", preset: "e1m-evk" });
  assert.equal(p.text, "$(circuit-board) E1M-AEN801 · e1m-evk");
  assert.equal(p.command, "alp.openConfigurator");
});

test("createStatusBarPresentation renders sku alone when no preset", () => {
  const p = createStatusBarPresentation({ sku: "E1M-V2N101" });
  assert.equal(p.text, "$(circuit-board) E1M-V2N101");
});
```

- [ ] **Step 2: Run to verify FAIL**

Run: `node --test test/boardSummary.service.test.js`
Expected: FAIL (old `service.js` still exports the carrier/os shape, and/or the assertions differ).

- [ ] **Step 3: Update the models**

Replace the `BoardSummary` interface in `packages/alp-core/src/boardSummary/models.ts` with:

```typescript
export interface BoardSummary {
  sku?: string;
  preset?: string;
}
```

(Leave `StatusBarPresentation` unchanged.)

- [ ] **Step 4: Update the service**

In `packages/alp-core/src/boardSummary/service.ts`, replace `parseBoardSummary` and the
populated branch of `createStatusBarPresentation`:

```typescript
export function parseBoardSummary(text: string): BoardSummary | null {
  const parsed = yaml.load(text);
  if (!parsed || typeof parsed !== "object") {
    return null;
  }
  const record = parsed as Record<string, unknown>;
  const som = record.som as Record<string, unknown> | undefined;
  return {
    sku: (som?.sku as string | undefined) ?? undefined,
    preset: (record.preset as string | undefined) ?? undefined,
  };
}
```

And in `createStatusBarPresentation`, the populated branch builds parts from sku + preset:

```typescript
  const parts = [summary.sku];
  if (summary.preset) parts.push(summary.preset);

  return {
    text: `$(circuit-board) ${parts.join(" · ")}`,
    tooltip: "Click to open the Alp board configurator.",
    command: "alp.openConfigurator",
  };
```

(The empty-state branch — `!summary?.sku` → `"$(circuit-board) Alp: no board.yaml"` — is unchanged.)

- [ ] **Step 5: Compile + run; verify PASS**

Run: `pnpm run compile && node --test test/boardSummary.service.test.js`
Expected: PASS (6/6).

- [ ] **Step 6: Commit**

```bash
git add packages/alp-core/src/boardSummary/models.ts packages/alp-core/src/boardSummary/service.ts test/boardSummary.service.test.js
git commit -m "feat(summary): v0.6 board summary (sku + preset)"
```

---

### Task 2: Tree + status bar + `.scratch` realignment

**Files:**
- Modify: `packages/alp-core/src/.../projectView` — NO. Actual: `src/projectView/model.ts`
- Test: `test/projectView.model.test.js`
- Modify: `.scratch/board.yaml`

- [ ] **Step 1: Update the projectView model test**

In `test/projectView.model.test.js`, the PROJECT section currently asserts SoM/Carrier/OS.
Replace the test "buildProjectNodes maps sku/carrier/os to the Project section" and the
em-dash test with these (matching the new summary shape `{sku, preset}`):

```javascript
test("buildProjectNodes maps sku + preset to the Project section", () => {
  const [project] = buildProjectNodes({ sku: "E1M-AEN801", preset: "e1m-evk" });
  assert.deepEqual(
    project.children.map((child) => [child.label, child.description]),
    [
      ["SoM", "E1M-AEN801"],
      ["Preset", "e1m-evk"],
    ],
  );
});

test("buildProjectNodes renders an em dash for a missing preset", () => {
  const [project] = buildProjectNodes({ sku: "E1M-AEN801" });
  assert.deepEqual(
    project.children.map((child) => child.description),
    ["E1M-AEN801", "—"],
  );
});
```

(Other tests in the file — empty cases, sections list, actions/debug commands — stay; the
empty-board case `buildProjectNodes(null)`/`{}` still returns `[]`.)

- [ ] **Step 2: Run to verify FAIL**

Run: `pnpm run compile && node --test test/projectView.model.test.js`
Expected: FAIL (current model emits SoM/Carrier/OS).

- [ ] **Step 3: Update `buildProjectNodes`**

In `src/projectView/model.ts`, the PROJECT section children currently are SoM/Carrier/OS.
Replace them with SoM + Preset (the type import `BoardSummary` now has `sku`/`preset`):

```typescript
      children: [
        { id: "project.som", label: "SoM", description: summary.sku, icon: "circuit-board" },
        { id: "project.preset", label: "Preset", description: summary.preset ?? DASH, icon: "primitive-square" },
      ],
```

(Keep the `if (!summary?.sku) return [];` guard and everything else unchanged.)

- [ ] **Step 4: Compile + run; verify PASS**

Run: `pnpm run compile && node --test test/projectView.model.test.js`
Expected: PASS.

- [ ] **Step 5: Rewrite `.scratch/board.yaml` to v0.6**

Replace `.scratch/board.yaml` with EXACTLY:

```yaml
som:
  sku: E1M-AEN801
preset: e1m-evk
cores:
  a32_cluster:
    os: "off"
  m55_hp:
    app: ./src
    inference:
      default_arena_kib: 256
diagnostics:
  log_level: info
```

- [ ] **Step 6: Confirm the full feature suite still compiles + passes, then commit**

Run: `pnpm run compile && node --test test/projectView.model.test.js test/boardSummary.service.test.js`
Expected: PASS. (`src/statusBar.ts` + `src/boardSummary/vscodeAdapter.ts` consume the new
shape via `loadBoardSummary`/`createStatusBarPresentation` — they compile unchanged since
the function signatures are stable; if the compiler flags a removed `carrier`/`os`
reference anywhere, fix that reference to use `preset`.)

```bash
git add src/projectView/model.ts test/projectView.model.test.js .scratch/board.yaml
git commit -m "feat(view): board summary rows SoM + Preset; .scratch to v0.6"
```

---

### Task 3: Configurator message-protocol types

**Files:**
- Modify: `packages/alp-core/src/configurator/models.ts`
- Test: `test/configurator.models.test.js` (new, light type/shape guard)

- [ ] **Step 1: Write a light shape test**

Create `test/configurator.models.test.js`:

```javascript
const test = require("node:test");
const assert = require("node:assert/strict");

// The module exports only types (erased at runtime); requiring it must succeed
// and export an (empty) object — this guards against accidental runtime code.
const mod = require("../packages/alp-core/dist/configurator/models.js");

test("configurator/models is types-only (no runtime exports leak)", () => {
  assert.equal(typeof mod, "object");
});
```

- [ ] **Step 2: Run to verify FAIL**

Run: `node --test test/configurator.models.test.js`
Expected: FAIL — the current `models.js` exports runtime values? It is types-only already,
so this may PASS immediately; if so, that is acceptable — proceed (the real change is the
type rewrite in Step 3, validated by the compile in later tasks). If it errors on missing
module, run `pnpm run compile` first.

- [ ] **Step 3: Replace the message types**

Replace the contents of `packages/alp-core/src/configurator/models.ts` with EXACTLY:

```typescript
// SPDX-License-Identifier: Apache-2.0

import { BoardConfig } from "../board/models";
import { ConfiguratorViewModel } from "./viewModel";

export interface RenderPayload {
  type: "render";
  viewModel: ConfiguratorViewModel;
  board: BoardConfig;
  boardPath: string;
  sdkConnected: boolean;
}

export interface SavedPayload {
  type: "saved";
  boardPath: string;
}

export type ConfiguratorOutboundMessage = RenderPayload | SavedPayload;

export interface UpdateMessage {
  type: "update";
  board: BoardConfig;
}

export interface CommandMessage {
  type: "save" | "reload" | "previewEffectiveConfig";
}

export type ConfiguratorInboundMessage = UpdateMessage | CommandMessage;
```

- [ ] **Step 4: Compile + run; verify PASS**

Run: `pnpm run compile && node --test test/configurator.models.test.js`
Expected: PASS. NOTE: the compile will now FAIL in `src/configuratorPanel.ts` and the old
`panelHtml.ts`/`configurator.js` because they reference the old `BoardModel`/`init`
messages — that is expected and fixed in Tasks 5-6 (and UI-2b). To keep this task's commit
compiling, this task ALSO stubs the panel: see Task 5 which lands in the same sequence.
**Do not commit Task 3 alone if compile is red — proceed straight into Task 4/5 and commit
once green, or temporarily comment the panel registration.** (The controller runs these
sequentially; the green checkpoint is at Task 5.)

- [ ] **Step 5: Commit (after Task 5 makes compile green) — see Task 5.**

---

### Task 4: Board load/save adapter (v0.6)

**Files:**
- Create: `src/configurator/vscodeAdapter.ts` additions — actually MODIFY existing
- Test: `test/configurator.boardIo.test.js` (new, temp-file round-trip)

- [ ] **Step 1: Write the failing test**

Create `test/configurator.boardIo.test.js`:

```javascript
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const {
  loadBoardConfigFromFile,
  saveBoardConfigToFile,
} = require("../out/configurator/boardIo.js");

test("save then load round-trips a v0.6 board", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "alpio-"));
  try {
    const file = path.join(dir, "board.yaml");
    const cfg = { som: { sku: "E1M-AEN801" }, cores: { m55_hp: { app: "./src" } }, preset: "e1m-evk" };
    saveBoardConfigToFile(file, cfg);
    const loaded = loadBoardConfigFromFile(file);
    assert.equal(loaded.som.sku, "E1M-AEN801");
    assert.equal(loaded.preset, "e1m-evk");
    assert.deepEqual(Object.keys(loaded.cores), ["m55_hp"]);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("loadBoardConfigFromFile returns a default board for a missing file", () => {
  const cfg = loadBoardConfigFromFile(path.join(os.tmpdir(), "does-not-exist-12345.yaml"));
  assert.equal(cfg.som.sku, "");
  assert.deepEqual(cfg.cores, {});
});
```

- [ ] **Step 2: Run to verify FAIL**

Run: `node --test test/configurator.boardIo.test.js`
Expected: FAIL — `Cannot find module '../out/configurator/boardIo.js'`.

- [ ] **Step 3: Implement**

Create `src/configurator/boardIo.ts`:

```typescript
// SPDX-License-Identifier: Apache-2.0

import * as fs from "fs";
import * as path from "path";
import { BoardConfig } from "@alp-sdk/core/board/models";
import { parseBoardConfig } from "@alp-sdk/core/board/parse";
import { serializeBoardConfig } from "@alp-sdk/core/board/serialize";

export function loadBoardConfigFromFile(boardPath: string): BoardConfig {
  if (!fs.existsSync(boardPath)) {
    return { som: { sku: "" }, cores: {} };
  }
  return parseBoardConfig(fs.readFileSync(boardPath, "utf-8"));
}

export function saveBoardConfigToFile(boardPath: string, cfg: BoardConfig): void {
  fs.mkdirSync(path.dirname(boardPath), { recursive: true });
  fs.writeFileSync(boardPath, serializeBoardConfig(cfg), "utf-8");
}
```

- [ ] **Step 4: Compile + run; verify PASS**

Run: `pnpm run compile && node --test test/configurator.boardIo.test.js`
Expected: PASS (2/2). (This module imports only `@alp-sdk/core/board/*` — no `vscode` — so
the test loads under plain node.)

- [ ] **Step 5: Commit**

```bash
git add src/configurator/boardIo.ts test/configurator.boardIo.test.js
git commit -m "feat(configurator): v0.6 board load/save adapter with tests"
```

---

### Task 5: Shell HTML + panel VM wiring

**Files:**
- Modify: `packages/alp-core/src/configurator/panelHtml.ts`
- Modify: `src/configuratorPanel.ts`
- Add: `media/alplab-logo-white.svg`
- Test: `test/configurator.panelHtml.test.js` (update)

This task makes the project compile again (closing Task 3's expected red) by switching the
panel to the new protocol + VM and emitting the new shell. The webview section RENDERER
(`media/configurator.js`) + full CSS are UI-2b; for now `media/configurator.js` is reduced
to a stub that posts `reload` on load so the shell renders without errors.

- [ ] **Step 1: Update the panelHtml structure test**

In `test/configurator.panelHtml.test.js`, assert the new shell mount points. Replace its
body with:

```javascript
const test = require("node:test");
const assert = require("node:assert/strict");
const { createConfiguratorPanelHtml } = require("../packages/alp-core/dist/configurator/panelHtml.js");

test("shell html exposes the sidebar, main mount, and footer actions", () => {
  const html = createConfiguratorPanelHtml({ nonce: "n0", cspSource: "vscode-resource:", cssUri: "c.css", jsUri: "j.js", logoUri: "logo.svg" });
  assert.match(html, /Content-Security-Policy/);
  assert.match(html, /nonce="n0"/);
  assert.match(html, /id="alp-sidebar"/);
  assert.match(html, /id="alp-main"/);
  assert.match(html, /id="alp-save"/);
  assert.match(html, /id="alp-reload"/);
});
```

- [ ] **Step 2: Run to verify FAIL**

Run: `node --test test/configurator.panelHtml.test.js`
Expected: FAIL (current html lacks these ids + the new `logoUri` input).

- [ ] **Step 3: Rewrite `panelHtml.ts` as the shell**

Replace `packages/alp-core/src/configurator/panelHtml.ts` with the shell builder. It takes
`{ nonce, cspSource, cssUri, jsUri, logoUri }` and emits: CSP (style/font/img from
`cspSource`, script nonce), the css link, a header (img `logoUri` + "Board Configurator"),
`<aside id="alp-sidebar">` with the search box + nav (Project & Hardware, Cores),
`<main id="alp-main"></main>` (renderer mount), and a footer with `#alp-validation` +
buttons `#alp-preview`, `#alp-reload`, `#alp-save`, then the nonce'd script tag for `jsUri`:

```typescript
// SPDX-License-Identifier: Apache-2.0

export interface ConfiguratorPanelHtmlInput {
  nonce: string;
  cspSource: string;
  cssUri: string;
  jsUri: string;
  logoUri: string;
}

export function createConfiguratorPanelHtml(input: ConfiguratorPanelHtmlInput): string {
  const csp =
    `default-src 'none'; ` +
    `style-src ${input.cspSource}; ` +
    `img-src ${input.cspSource}; ` +
    `font-src ${input.cspSource}; ` +
    `script-src 'nonce-${input.nonce}';`;

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy" content="${csp}">
  <link rel="stylesheet" href="${input.cssUri}">
  <title>Alp Board Configurator</title>
</head>
<body>
  <header class="alp-hd">
    <img class="alp-logo" src="${input.logoUri}" alt="Alp Lab">
    <span class="alp-div"></span>
    <h1>Board Configurator</h1>
    <span class="alp-spacer"></span>
    <span id="alp-saved" class="alp-saved"></span>
  </header>
  <div class="alp-grid">
    <aside id="alp-sidebar" class="alp-side">
      <input id="alp-search" class="alp-search" placeholder="Search settings…">
      <nav class="alp-nav">
        <a class="active" data-section="project" href="#">Project &amp; Hardware</a>
        <a data-section="cores" href="#">Cores</a>
      </nav>
    </aside>
    <main id="alp-main" class="alp-main"></main>
  </div>
  <footer class="alp-ft">
    <span id="alp-validation" class="alp-valid"></span>
    <span class="alp-spacer"></span>
    <button id="alp-preview" class="alp-btn">Preview effective config</button>
    <button id="alp-reload" class="alp-btn">Reload</button>
    <button id="alp-save" class="alp-btn primary">Save board.yaml</button>
  </footer>
  <script nonce="${input.nonce}" src="${input.jsUri}"></script>
</body>
</html>`;
}
```

- [ ] **Step 4: Reduce `media/configurator.js` to a shell stub**

Replace `media/configurator.js` with a minimal stub (UI-2b implements the real renderer):

```javascript
// SPDX-License-Identifier: Apache-2.0
// UI-2a stub: the shell renders; the section renderer lands in UI-2b.
(function () {
  const vscode = acquireVsCodeApi();
  window.addEventListener("message", (event) => {
    const msg = event.data;
    if (msg && msg.type === "render") {
      const main = document.getElementById("alp-main");
      if (main) main.textContent = msg.sdkConnected
        ? `Loaded ${msg.boardPath}`
        : "Connect your alp-sdk (set alpSdk.path) to configure.";
      const v = document.getElementById("alp-validation");
      if (v) v.textContent = (msg.viewModel.validation.errors.length === 0)
        ? "✓ Valid"
        : `${msg.viewModel.validation.errors.length} error(s)`;
    }
  });
  const save = document.getElementById("alp-save");
  if (save) save.addEventListener("click", () => vscode.postMessage({ type: "save" }));
  const reload = document.getElementById("alp-reload");
  if (reload) reload.addEventListener("click", () => vscode.postMessage({ type: "reload" }));
})();
```

- [ ] **Step 5: Add the wordmark asset**

Copy the white wordmark into `media/`:

```bash
cp "/c/Users/caner/Documents/GitHub/alplab-website/public/logos/alplab-logo-white.svg" media/alplab-logo-white.svg
```

If that path is unavailable, STOP and report NEEDS_CONTEXT for the logo source.

- [ ] **Step 6: Rewrite `configuratorPanel.ts` for the new protocol**

Replace the panel's HTML call, `refresh`, and `onMessage` to: build the VM and post
`render`; keep `this.board`; handle `update`/`save`/`reload`/`previewEffectiveConfig`.
Concretely:

- `panelHtml(...)` call now passes `logoUri` (a webview URI for `media/alplab-logo-white.svg`).
- Add a private `board: BoardConfig` field and import the new pieces:

```typescript
import { buildConfiguratorViewModel } from "@alp-sdk/core/configurator/viewModel";
import { loadBoardConfigFromFile, saveBoardConfigToFile } from "./configurator/boardIo";
import { loadSdkCatalogue } from "./sdkCatalogue/vscodeAdapter";
import { collectProjectContext } from "./project/vscodeAdapter";
import { log } from "./util";
import { BoardConfig } from "@alp-sdk/core/board/models";
import { ConfiguratorInboundMessage, ConfiguratorOutboundMessage } from "@alp-sdk/core/configurator/models";
```

- `refresh()`:

```typescript
  private board: BoardConfig = { som: { sku: "" }, cores: {} };

  private refresh(): void {
    const project = collectProjectContext();
    const boardPath = project.boardYamlPath;
    if (!boardPath) {
      vscode.window.showErrorMessage("Alp: open a workspace folder before launching the configurator.");
      return;
    }
    this.board = loadBoardConfigFromFile(boardPath);
    this.postRender(boardPath, project.sdkRoot ?? null);
  }

  private postRender(boardPath: string, sdkRoot: string | null): void {
    const catalogue = loadSdkCatalogue(sdkRoot, log);
    const message: ConfiguratorOutboundMessage = {
      type: "render",
      viewModel: buildConfiguratorViewModel(this.board, catalogue),
      board: this.board,
      boardPath,
      sdkConnected: catalogue.soms.length > 0,
    };
    this.panel.webview.postMessage(message);
  }
```

- `onMessage(msg: ConfiguratorInboundMessage)`:

```typescript
  private onMessage(msg: ConfiguratorInboundMessage): void {
    const project = collectProjectContext();
    const boardPath = project.boardYamlPath;
    if (!boardPath) return;
    if (msg.type === "update") {
      this.board = msg.board;
      this.postRender(boardPath, project.sdkRoot ?? null);
    } else if (msg.type === "save") {
      try {
        saveBoardConfigToFile(boardPath, this.board);
        const saved: ConfiguratorOutboundMessage = { type: "saved", boardPath };
        this.panel.webview.postMessage(saved);
        vscode.window.setStatusBarMessage(`Alp: saved ${boardPath}`, 5000);
      } catch (e) {
        vscode.window.showErrorMessage(`Alp: save failed: ${e}`);
      }
    } else if (msg.type === "reload") {
      this.refresh();
    } else if (msg.type === "previewEffectiveConfig") {
      void vscode.commands.executeCommand("alp.previewEffectiveConfig");
    }
  }
```

Verify `collectProjectContext()` exposes `sdkRoot` (it is used by the old
`loadPresetCatalogue`); if the property name differs, use the correct one (read
`src/project/models.ts`). Remove the now-unused old imports (`loadBoardModel`,
`saveBoardModel`, `loadPresetCatalogue`, old message types).

- [ ] **Step 7: Compile + run the foundation suites; verify GREEN**

Run: `pnpm run compile`
Expected: exit 0 (the old `BoardModel`/`init` references are gone; everything compiles).
Run: `node --test test/configurator.panelHtml.test.js test/configurator.boardIo.test.js test/configurator.models.test.js test/boardSummary.service.test.js test/projectView.model.test.js`
Expected: all PASS.

- [ ] **Step 8: Commit (closes Tasks 3 + 5)**

```bash
git add packages/alp-core/src/configurator/models.ts packages/alp-core/src/configurator/panelHtml.ts media/alplab-logo-white.svg media/configurator.js src/configuratorPanel.ts test/configurator.models.test.js test/configurator.panelHtml.test.js
git commit -m "feat(configurator): view-model protocol, shell html, panel wiring"
```

---

## Self-review notes

- **Spec coverage (UI-2 spec, foundation parts):** v0.6 board summary + status bar/tree +
  `.scratch` (Tasks 1-2) · message-protocol types (Task 3) · board load/save adapter
  (Task 4) · shell html + panel VM wiring + disconnected empty state (Task 5). The section
  **renderer + full CSS** (Project/Hardware/Cores + library selector) is UI-2b.
- **Compile-red window:** Task 3 intentionally leaves the build red (panel still references
  old types); Tasks 4-5 close it. The single green checkpoint + commit is at Task 5 Step 7-8,
  and Task 3 has no standalone commit. The controller executes 3→4→5 in order.
- **Type consistency:** the message types (`RenderPayload`/`UpdateMessage`/…) are defined
  in `configurator/models.ts` (Task 3) and consumed by `configuratorPanel.ts` (Task 5);
  `loadBoardConfigFromFile`/`saveBoardConfigToFile` (Task 4) are consumed by the panel
  (Task 5); `BoardSummary` `{sku,preset}` (Task 1) is consumed by `buildProjectNodes`
  (Task 2).
- **No Claude co-author trailer** in any commit.
- **Do not merge `feat/configurator-ui` after UI-2a alone** — the configurator only shows
  a shell stub until UI-2b adds the renderer.
