# Generated-config Staleness — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** `Alp: Check generated config` warns when `build/generated/*` are stale vs `board.yaml` (or missing) and offers `Generate all`.

**Architecture:** Pure `analyzeGenerationStaleness(boardMtimeMs, files)` in `@alp-sdk/core/loader/staleness.ts`; thin adapter stats the files and reports.

**Spec:** `docs/superpowers/specs/2026-05-26-generated-config-staleness-design.md`

## Background
- Build before tests: `pnpm run compile`; suite `node --test test/*.test.js` (currently 204/204, keep green). Branch `feat/dev-tools`. No `Co-Authored-By` trailer. Brand "Alp".
- `listGenerationTargetSupport()` from `@alp-sdk/core/loader/service` returns `{ emit, displayName, outputRelativePath, preview }[]` (4 targets under `build/generated/`).
- `collectProjectContext()` (`src/project/vscodeAdapter`) → `{ workspaceRoot, boardYamlPath, ... }`. `log`/`showOutput` from `src/util`.

---

### Task 1: Core — staleness analyzer

**Files:** Create `packages/alp-core/src/loader/staleness.ts`, `test/loader.staleness.test.js`.

- [ ] **Step 1: Write the failing test** — `test/loader.staleness.test.js`:

```js
const test = require("node:test");
const assert = require("node:assert/strict");
const { analyzeGenerationStaleness } = require("@alp-sdk/core/loader/staleness");

const files = (genMtime) => [{ emit: "zephyr-conf", displayName: "Zephyr config", generatedMtimeMs: genMtime }];

test("board newer than generated → stale", () => {
  const r = analyzeGenerationStaleness(200, files(100));
  assert.equal(r.entries[0].status, "stale");
  assert.equal(r.stale, 1);
  assert.equal(r.ok, false);
});

test("generated missing → missing", () => {
  const r = analyzeGenerationStaleness(200, files(null));
  assert.equal(r.entries[0].status, "missing");
  assert.equal(r.missing, 1);
  assert.equal(r.ok, false);
});

test("generated newer than board → current, ok", () => {
  const r = analyzeGenerationStaleness(100, files(200));
  assert.equal(r.entries[0].status, "current");
  assert.equal(r.ok, true);
  assert.equal(r.stale, 0);
  assert.equal(r.missing, 0);
});

test("no board.yaml (null) with an existing file → current", () => {
  const r = analyzeGenerationStaleness(null, files(100));
  assert.equal(r.entries[0].status, "current");
  assert.equal(r.ok, true);
});

test("mixed: counts stale and missing across entries", () => {
  const r = analyzeGenerationStaleness(500, [
    { emit: "a", displayName: "A", generatedMtimeMs: 100 },
    { emit: "b", displayName: "B", generatedMtimeMs: null },
    { emit: "c", displayName: "C", generatedMtimeMs: 900 },
  ]);
  assert.equal(r.stale, 1);
  assert.equal(r.missing, 1);
  assert.equal(r.ok, false);
  assert.equal(r.entries[2].status, "current");
});
```

- [ ] **Step 2: Run to verify it fails** — `pnpm run compile && node --test test/loader.staleness.test.js` → FAIL (module missing).

- [ ] **Step 3: Implement** — Create `packages/alp-core/src/loader/staleness.ts`:

```ts
// SPDX-License-Identifier: Apache-2.0

export type GenerationStatus = "current" | "stale" | "missing";

export interface GenerationStalenessInput {
  emit: string;
  displayName: string;
  generatedMtimeMs: number | null;
}

export interface GenerationStalenessEntry {
  emit: string;
  displayName: string;
  status: GenerationStatus;
}

export interface GenerationStalenessReport {
  entries: GenerationStalenessEntry[];
  stale: number;
  missing: number;
  ok: boolean;
}

/**
 * Classify each generated file against board.yaml's mtime. A null
 * generatedMtimeMs means the file is absent (missing). A file older than
 * board.yaml is stale. When boardMtimeMs is null (no board.yaml) an existing
 * file is treated as current — there's nothing newer to compare against. Pure.
 */
export function analyzeGenerationStaleness(
  boardMtimeMs: number | null,
  files: GenerationStalenessInput[],
): GenerationStalenessReport {
  const entries: GenerationStalenessEntry[] = files.map((file) => {
    let status: GenerationStatus;
    if (file.generatedMtimeMs === null) {
      status = "missing";
    } else if (boardMtimeMs !== null && boardMtimeMs > file.generatedMtimeMs) {
      status = "stale";
    } else {
      status = "current";
    }
    return { emit: file.emit, displayName: file.displayName, status };
  });

  const stale = entries.filter((e) => e.status === "stale").length;
  const missing = entries.filter((e) => e.status === "missing").length;
  return { entries, stale, missing, ok: stale === 0 && missing === 0 };
}
```

- [ ] **Step 4: Run to verify it passes** — `pnpm run compile && node --test test/loader.staleness.test.js` → PASS (5).
- [ ] **Step 5: Commit**
```bash
git add packages/alp-core/src/loader/staleness.ts test/loader.staleness.test.js
git commit -m "feat(core): generated-config staleness analyzer"
```

---

### Task 2: Adapter — `Alp: Check generated config` command

**Files:** Create `src/generatedConfig.ts`. Modify `src/extension.ts`, `package.json`.

- [ ] **Step 1: Create `src/generatedConfig.ts`**

```ts
// SPDX-License-Identifier: Apache-2.0

import * as fs from "fs";
import * as path from "path";
import * as vscode from "vscode";
import { listGenerationTargetSupport } from "@alp-sdk/core/loader/service";
import {
  analyzeGenerationStaleness,
  GenerationStalenessInput,
} from "@alp-sdk/core/loader/staleness";
import { collectProjectContext } from "./project/vscodeAdapter";
import { log, showOutput } from "./util";

function mtimeMs(filePath: string): number | null {
  try {
    return fs.statSync(filePath).mtimeMs;
  } catch {
    return null;
  }
}

function statusGlyph(status: string): string {
  return status === "current" ? "OK " : status === "stale" ? "~~ " : "!! ";
}

async function checkGeneratedConfig(): Promise<void> {
  const project = collectProjectContext();
  if (!project.workspaceRoot || !project.boardYamlPath) {
    await vscode.window.showErrorMessage("Alp: open a workspace folder with a board.yaml first.");
    return;
  }

  const boardMtimeMs = mtimeMs(project.boardYamlPath);
  const files: GenerationStalenessInput[] = listGenerationTargetSupport().map((target) => ({
    emit: target.emit,
    displayName: target.displayName,
    generatedMtimeMs: mtimeMs(path.join(project.workspaceRoot as string, target.outputRelativePath)),
  }));

  const report = analyzeGenerationStaleness(boardMtimeMs, files);

  log("── Alp generated-config check ──");
  for (const e of report.entries) log(`  ${statusGlyph(e.status)}${e.displayName}: ${e.status}`);

  if (report.ok) {
    void vscode.window.showInformationMessage("Alp: generated config is up to date.");
    return;
  }

  const pick = await vscode.window.showWarningMessage(
    `Alp: generated config — ${report.stale} stale, ${report.missing} missing.`,
    "Generate all",
    "Show report",
  );
  if (pick === "Generate all") void vscode.commands.executeCommand("alp.generateAll");
  else if (pick === "Show report") showOutput();
}

export function registerGeneratedConfigCommands(): vscode.Disposable[] {
  return [vscode.commands.registerCommand("alp.checkGeneratedConfig", () => checkGeneratedConfig())];
}
```

- [ ] **Step 2: Register in `src/extension.ts`** — add `import { registerGeneratedConfigCommands } from "./generatedConfig";` and `...registerGeneratedConfigCommands(),` in `context.subscriptions.push(...)`.

- [ ] **Step 3: Add the command to `package.json`** — in `contributes.commands`, after `alp.newBoardFromSku`:
```json
      {
        "command": "alp.checkGeneratedConfig",
        "title": "Alp: Check generated config",
        "category": "Alp"
      }
```

- [ ] **Step 4: Verify** — `node -e "JSON.parse(require('fs').readFileSync('package.json','utf8'));console.log('ok')" && pnpm run compile` → ok + EXIT 0.
- [ ] **Step 5: Commit**
```bash
git add src/generatedConfig.ts src/extension.ts package.json
git commit -m "feat(generate): Alp: Check generated config (staleness)"
```

---

### Task 3: Full suite

- [ ] **Step 1:** `pnpm run compile && node --test test/*.test.js` → all pass (204 + 5 = 209), no new failures.
- [ ] **Step 2: Manual notes** — edit board.yaml after generating → `Alp: Check generated config` reports stale + offers Generate all; with no `build/generated` → all missing; right after Generate all → up to date.

---

## Self-Review

**1. Spec coverage:** analyzer (Task 1) with the null-board rule + mixed counts; command stats the four targets, reports, offers Generate all / Show report (Task 2). ✓
**2. Placeholder scan:** complete code; exact commands. ✓
**3. Type consistency:** `analyzeGenerationStaleness(boardMtimeMs, files)` + `GenerationStalenessInput` defined Task 1, used Task 2. `listGenerationTargetSupport` existing export. Command id `alp.checkGeneratedConfig` registered + contributed (Task 2). `project.workspaceRoot` cast to string only where already guarded non-null. ✓
