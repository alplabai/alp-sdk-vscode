# New board.yaml from SKU — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** `Alp: New board.yaml from SKU` writes a valid v0.6 board.yaml for a chosen SoM and opens it.

**Architecture:** Pure `buildStarterBoardConfig(sku, coreIds)` in `@alp-sdk/core/board/starter.ts` (validated by the existing `validateBoardConfig`); thin adapter command picks the SKU, derives core ids, serializes, writes, opens.

**Tech Stack:** TypeScript, VS Code API, pnpm workspace, node:test.

**Spec:** `docs/superpowers/specs/2026-05-26-new-board-from-sku-design.md`

## Background
- Build before tests: `pnpm run compile`; suite `node --test test/*.test.js` (currently 202/202, keep green). Branch `feat/dev-tools`. No `Co-Authored-By` trailer. Brand "Alp".
- Core imports: `@alp-sdk/core/board/starter`, `@alp-sdk/core/board/serialize` (`serializeBoardConfig(cfg)`), `@alp-sdk/core/board/validate` (`validateBoardConfig(cfg) → {errors,warnings}`), `@alp-sdk/core/sdkCatalogue/derive` (`coreIdsForSom(catalogue, sku) → string[]`).
- Adapter helpers: `loadSdkCatalogue(sdkRoot, log)` (`src/sdkCatalogue/vscodeAdapter`), `collectProjectContext()` (`src/project/vscodeAdapter`) → `{ workspaceRoot, sdkRoot, ... }`, `log` (`src/util`).

---

### Task 1: Core — starter board config

**Files:** Create `packages/alp-core/src/board/starter.ts`, `test/board.starter.test.js`.

- [ ] **Step 1: Write the failing test** — `test/board.starter.test.js`:

```js
const test = require("node:test");
const assert = require("node:assert/strict");
const { buildStarterBoardConfig } = require("@alp-sdk/core/board/starter");
const { validateBoardConfig } = require("@alp-sdk/core/board/validate");

test("builds a valid multi-core starter from core ids", () => {
  const cfg = buildStarterBoardConfig("E1M-AEN701", ["a32_cluster", "m55_hp"]);
  assert.equal(cfg.som.sku, "E1M-AEN701");
  assert.match(cfg.name, /E1M-AEN701/);
  assert.equal(cfg.cores.a32_cluster.os, "zephyr");
  assert.equal(cfg.cores.a32_cluster.app, "app");
  assert.equal(cfg.cores.m55_hp.os, "off");
  assert.equal(cfg.preset, undefined);
  assert.deepEqual(validateBoardConfig(cfg).errors, []);
});

test("falls back to a single app core when no core ids", () => {
  const cfg = buildStarterBoardConfig("X", []);
  assert.deepEqual(Object.keys(cfg.cores), ["app"]);
  assert.equal(cfg.cores.app.os, "zephyr");
  assert.deepEqual(validateBoardConfig(cfg).errors, []);
});
```

- [ ] **Step 2: Run to verify it fails** — `pnpm run compile && node --test test/board.starter.test.js` → FAIL (module missing).

- [ ] **Step 3: Implement** — Create `packages/alp-core/src/board/starter.ts`:

```ts
// SPDX-License-Identifier: Apache-2.0

import { BoardConfig, CoreEntry } from "./models";

/**
 * Build a minimal but valid v0.6 board.yaml config for a SoM SKU. The first
 * core id runs Zephyr with a placeholder app; the rest are off. When no core
 * ids are known (SDK not connected) a single "app" core is used. No preset /
 * inline routing is set, so the result passes validateBoardConfig and the user
 * picks a preset afterward in the configurator.
 */
export function buildStarterBoardConfig(sku: string, coreIds: string[]): BoardConfig {
  const ids = coreIds.length > 0 ? coreIds : ["app"];
  const cores: Record<string, CoreEntry> = {};
  ids.forEach((id, index) => {
    cores[id] = index === 0 ? { os: "zephyr", app: "app" } : { os: "off" };
  });
  return {
    name: `${sku} project`,
    som: { sku },
    cores,
  };
}
```

- [ ] **Step 4: Run to verify it passes** — `pnpm run compile && node --test test/board.starter.test.js` → PASS (2).
- [ ] **Step 5: Commit**
```bash
git add packages/alp-core/src/board/starter.ts test/board.starter.test.js
git commit -m "feat(core): starter v0.6 board config from SKU"
```

---

### Task 2: Adapter — `Alp: New board.yaml from SKU` command

**Files:** Create `src/onboarding.ts`. Modify `src/extension.ts`, `package.json`.

- [ ] **Step 1: Create `src/onboarding.ts`**

```ts
// SPDX-License-Identifier: Apache-2.0

import * as fs from "fs";
import * as vscode from "vscode";
import { buildStarterBoardConfig } from "@alp-sdk/core/board/starter";
import { serializeBoardConfig } from "@alp-sdk/core/board/serialize";
import { coreIdsForSom } from "@alp-sdk/core/sdkCatalogue/derive";
import { collectProjectContext } from "./project/vscodeAdapter";
import { loadSdkCatalogue } from "./sdkCatalogue/vscodeAdapter";
import { log } from "./util";

async function pickSku(sdkRoot: string | null): Promise<string | null> {
  const catalogue = loadSdkCatalogue(sdkRoot, log);
  if (catalogue.soms.length > 0) {
    const pick = await vscode.window.showQuickPick(
      catalogue.soms.map((s) => s.sku),
      { title: "Alp: New board.yaml — pick a SoM SKU", ignoreFocusOut: true },
    );
    return pick ?? null;
  }
  const typed = await vscode.window.showInputBox({
    title: "Alp: New board.yaml — SoM SKU",
    prompt: "No SDK catalogue found. Enter the SoM SKU.",
    value: "E1M-AEN701",
    ignoreFocusOut: true,
  });
  return typed ? typed.trim() || null : null;
}

async function newBoardFromSku(): Promise<void> {
  const project = collectProjectContext();
  if (!project.workspaceRoot) {
    await vscode.window.showErrorMessage("Alp: open a workspace folder before creating a board.yaml.");
    return;
  }

  const sku = await pickSku(project.sdkRoot ?? null);
  if (!sku) return;

  const catalogue = loadSdkCatalogue(project.sdkRoot ?? null, log);
  const coreIds = coreIdsForSom(catalogue, sku);
  const content = serializeBoardConfig(buildStarterBoardConfig(sku, coreIds));

  const target = vscode.Uri.joinPath(vscode.Uri.file(project.workspaceRoot), "board.yaml");
  if (fs.existsSync(target.fsPath)) {
    const overwrite = await vscode.window.showWarningMessage(
      "Alp: board.yaml already exists. Overwrite it?",
      { modal: true },
      "Overwrite",
    );
    if (overwrite !== "Overwrite") return;
  }

  try {
    fs.writeFileSync(target.fsPath, content, "utf-8");
  } catch (error) {
    await vscode.window.showErrorMessage(`Alp: failed to write board.yaml: ${error}`);
    return;
  }

  const doc = await vscode.workspace.openTextDocument(target);
  await vscode.window.showTextDocument(doc, { preview: false });
  const action = await vscode.window.showInformationMessage(
    `Alp: created board.yaml for ${sku}.`,
    "Open configurator",
  );
  if (action === "Open configurator") {
    void vscode.commands.executeCommand("alp.openConfigurator");
  }
}

export function registerOnboardingCommands(): vscode.Disposable[] {
  return [vscode.commands.registerCommand("alp.newBoardFromSku", () => newBoardFromSku())];
}
```

- [ ] **Step 2: Register in `src/extension.ts`** — add `import { registerOnboardingCommands } from "./onboarding";` and `...registerOnboardingCommands(),` in the `context.subscriptions.push(...)` list.

- [ ] **Step 3: Add the command to `package.json`** — in `contributes.commands`, after `alp.toolchainDoctor`:
```json
      {
        "command": "alp.newBoardFromSku",
        "title": "Alp: New board.yaml from SKU",
        "category": "Alp"
      }
```

- [ ] **Step 4: Verify** — `node -e "JSON.parse(require('fs').readFileSync('package.json','utf8'));console.log('ok')" && pnpm run compile` → ok + EXIT 0.
- [ ] **Step 5: Commit**
```bash
git add src/onboarding.ts src/extension.ts package.json
git commit -m "feat(onboarding): Alp: New board.yaml from SKU command"
```

---

### Task 3: Full suite + manual notes

- [ ] **Step 1: Full suite** — `pnpm run compile && node --test test/*.test.js` → all pass (202 + 2 = 204), no new failures.
- [ ] **Step 2: Manual dev-host notes** — run **Alp: New board.yaml from SKU**: with the SDK connected, the SoM SKUs appear in a QuickPick; picking one writes a valid `board.yaml` (first core `os: zephyr`, others `off`), opens it, and offers "Open configurator". With no SDK, an input box defaults to `E1M-AEN701`. Re-running prompts to overwrite.

---

## Self-Review

**1. Spec coverage:** generator (Task 1), command with SKU pick + catalogue/derive + serialize + write + open + overwrite guard + input fallback (Task 2), validity asserted via `validateBoardConfig` (Task 1 test). ✓
**2. Placeholder scan:** complete code in every step; exact commands. ✓
**3. Type consistency:** `buildStarterBoardConfig(sku, coreIds)` defined Task 1, used Task 2. `coreIdsForSom`/`serializeBoardConfig` are existing core exports. `registerOnboardingCommands` defined Task 2, registered Task 2 Step 2. Command id `alp.newBoardFromSku` registered + contributed (Task 2). ✓
