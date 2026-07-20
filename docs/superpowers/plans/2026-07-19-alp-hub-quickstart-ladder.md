# Alp Hub Quickstart Ladder — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the flat, always-on hub with a state-driven Quickstart ladder in the sidebar (Environment → Project → Board → Build/Flash) backed by a single phase selector that also drives the native trees and command enablement.

**Architecture:** A pure `derivePhase(AlpIdeState)` selector is the single source of truth. A new `alp-ide.quickstart` WebviewViewProvider renders the ladder from that phase and launches full-width wizards (New Project, Configurator). The SETUP + WORKSPACES trees fold into the ladder; PROJECTS/SDK/BUILD stay native. Overview's entry point is retired (code kept).

**Tech Stack:** TypeScript, VS Code extension API (`WebviewViewProvider`, `TreeDataProvider`, `setContext`), React webview (`packages/alp-webview`), `node:test`, pnpm.

## Global Constraints (verbatim from spec + repo)

- Brand name "Alp", never "ALP", in UI strings (logo wordmark graphic exempt).
- Thin extension: no build/plan logic in `src/`; delegate to existing commands/CLI.
- NO Claude/AI attribution in commits.
- Gates before done: `pnpm run compile` + `pnpm test` (in the worktree `C:/Users/caner/Documents/GitHub/alp-hub-visual`, branch `feat/hub-visual-two-modes`).
- No gray-out: not-yet-reached steps are dim markers, done steps collapse to ✓, current step shows one CTA that demotes when satisfied.
- Phase drives ALL surfaces (ladder + trees + command enablement) — never computed independently per surface.
- Webview CTAs gated by phase IN the webview (VS Code `enablement` does not reach webview buttons).
- Rich wizards open full-width (editor area); the ladder only launches them.

---

## File structure

- Create `src/ideHub/phase.ts` — pure `derivePhase(state): Phase` + `LADDER_STEPS` defs. No VS Code imports.
- Create `test/phase.test.js` — node:test for `derivePhase`.
- Modify `packages/alp-webview/src/types.ts` + `src/ideHub/messages.ts` — add `boardYamlValid`, `boardIssueCount` to `WorkspaceStatus`; add `Phase` + a `phaseUpdate` message (or fold into `stateUpdate`).
- Modify `src/views/stateManager.ts` — compute `boardYamlValid`/`boardIssueCount`.
- Create `src/ideHub/quickstartProvider.ts` — `WebviewViewProvider` for `alp-ide.quickstart`.
- Create `packages/alp-webview/src/features/quickstart/*` — the ladder React UI.
- Modify `packages/alp-webview/src/App.tsx` — add `quickstart` mode.
- Modify `package.json` — add `alp-ide.quickstart` view (top of container), remove `alp-ide.setup`/`alp-ide.workspaces` views, add build-tree/command enablement, remove `alp.openOverview` contribution.
- Modify `src/views/index.ts` — register quickstart provider; drop setup/workspaces tree registration (keep provider files unused or delete registration only).
- Modify `src/views/build.ts` (or equivalent) — gate on phase == ready.

---

## Task 1: Phase selector (pure logic, TDD)

**Files:**
- Create: `src/ideHub/phase.ts`
- Test: `test/phase.test.js`

**Interfaces:**
- Consumes: `AlpIdeState` from `src/ideHub/messages.ts` (extended in Task 2; for this task use the fields `setup.pythonAvailable`, `setup.westAvailable`, `workspace.westInitialized`, `sdk.readiness`, `workspace.boardYamlExists`, `workspace.boardYamlValid`).
- Produces: `type Phase = "no-env" | "no-project" | "invalid-board" | "ready"`; `derivePhase(state: AlpIdeState): Phase`; `LADDER_STEPS` (id/label/order).

- [ ] **Step 1: Write the failing test** (`test/phase.test.js`)

```js
const test = require("node:test");
const assert = require("node:assert");
const { derivePhase } = require("../out/ideHub/phase.js");

const base = {
  sdk: { readiness: "ready", activePath: null, version: null, localEntries: [] },
  setup: { pythonAvailable: true, westAvailable: true, lastBootstrapAt: null,
    toolVersions: { python: null, west: null, cmake: null, ninja: null } },
  workspace: { workspaceRoot: "/w", boardYamlExists: true, boardYamlValid: true,
    boardIssueCount: 0, westInitialized: true },
};
const s = (over) => ({ ...base, ...over,
  setup: { ...base.setup, ...(over.setup || {}) },
  sdk: { ...base.sdk, ...(over.sdk || {}) },
  workspace: { ...base.workspace, ...(over.workspace || {}) } });

test("no-env when python missing", () => {
  assert.equal(derivePhase(s({ setup: { pythonAvailable: false } })), "no-env");
});
test("no-env when sdk not ready", () => {
  assert.equal(derivePhase(s({ sdk: { readiness: "missing" } })), "no-env");
});
test("no-project when env ready but no board.yaml", () => {
  assert.equal(derivePhase(s({ workspace: { boardYamlExists: false } })), "no-project");
});
test("invalid-board when board present but not valid", () => {
  assert.equal(derivePhase(s({ workspace: { boardYamlValid: false } })), "invalid-board");
});
test("ready when env + valid board", () => {
  assert.equal(derivePhase(base), "ready");
});
```

- [ ] **Step 2: Run test, verify it fails** — `cd C:/Users/caner/Documents/GitHub/alp-hub-visual && pnpm run compile && node --test test/phase.test.js` → FAIL (module not found).

- [ ] **Step 3: Implement** (`src/ideHub/phase.ts`)

```ts
// SPDX-License-Identifier: Apache-2.0
import type { AlpIdeState } from "./messages";

export type Phase = "no-env" | "no-project" | "invalid-board" | "ready";

export function derivePhase(state: AlpIdeState): Phase {
  const { setup, sdk, workspace } = state;
  const envReady =
    setup.pythonAvailable &&
    setup.westAvailable &&
    workspace.westInitialized &&
    sdk.readiness === "ready";
  if (!envReady) return "no-env";
  if (!workspace.boardYamlExists) return "no-project";
  if (!workspace.boardYamlValid) return "invalid-board";
  return "ready";
}

export const LADDER_STEPS = [
  { id: "environment", label: "Environment", phase: "no-env" },
  { id: "project", label: "Project", phase: "no-project" },
  { id: "board", label: "Board", phase: "invalid-board" },
  { id: "build", label: "Build & Flash", phase: "ready" },
] as const;
```

- [ ] **Step 4: Run test, verify PASS** — same command → all pass.

- [ ] **Step 5: Commit** — `git add src/ideHub/phase.ts test/phase.test.js && git commit -m "feat(hub): add derivePhase state selector"`

---

## Task 2: Board validity in AlpIdeState

**Files:**
- Modify: `src/ideHub/messages.ts` (add fields to `WorkspaceStatus`)
- Modify: `packages/alp-webview/src/types.ts` (mirror — keep in sync by hand)
- Modify: `src/views/stateManager.ts` (compute the fields)
- Test: extend `test/phase.test.js` already covers consumption; add a stateManager unit test if the validity computation is pure-extractable.

**Interfaces:**
- Produces: `WorkspaceStatus.boardYamlValid: boolean`, `WorkspaceStatus.boardIssueCount: number`.

- [ ] **Step 1:** Add `boardYamlValid: boolean;` and `boardIssueCount: number;` to `WorkspaceStatus` in BOTH `src/ideHub/messages.ts` and `packages/alp-webview/src/types.ts` (they are hand-mirrored — the file header says so). Bump nothing else.

- [ ] **Step 2:** In `src/views/stateManager.ts`, where `boardYamlExists` is computed, also compute validity. Reuse the existing board.yaml validator (the same one behind `alp.validateBoardYaml` / the LSP E1M diagnostics). Read how `alp.validateBoardYaml` validates (`packages/alp-core` board validate) and call it host-side; set `boardYamlValid = issues.length === 0`, `boardIssueCount = issues.length`. If validity is expensive, gate it behind `boardYamlExists`. Default to `boardYamlValid: false, boardIssueCount: 0` when no board.

- [ ] **Step 3:** Ensure the existing `board.yaml` FileSystemWatcher refresh recomputes validity (it calls `stateManager.refresh` already).

- [ ] **Step 4:** `pnpm run compile && pnpm test` → green.

- [ ] **Step 5: Commit** — `git commit -am "feat(hub): compute board.yaml validity into AlpIdeState"`

---

## Task 3: Quickstart WebviewViewProvider + view registration

**Files:**
- Create: `src/ideHub/quickstartProvider.ts`
- Modify: `package.json` (add `alp-ide.quickstart` webview view FIRST in the `alp-ide` container `views`; remove `alp-ide.setup` and `alp-ide.workspaces` view entries)
- Modify: `src/views/index.ts` (register the provider; stop registering the setup + workspaces TreeViews)
- Modify: `packages/alp-webview/src/App.tsx` (add `alpMode === "quickstart"` → `<QuickstartView/>`)

**Interfaces:**
- Consumes: `derivePhase` (Task 1), `AlpIdeState` (Task 2), `StateManager`.
- Produces: `class QuickstartViewProvider implements vscode.WebviewViewProvider` (viewType `alp-ide.quickstart`); `registerQuickstart(context, stateMgr): vscode.Disposable[]`.

- [ ] **Step 1:** `package.json` — in `contributes.views["alp-ide"]`, put `{ "id": "alp-ide.quickstart", "name": "Quickstart", "type": "webview" }` as the FIRST entry; delete the `alp-ide.setup` and `alp-ide.workspaces` entries.

- [ ] **Step 2:** Create `src/ideHub/quickstartProvider.ts` — mirror the existing hub webview pattern (CSP nonce via `randomBytes`, `asWebviewUri` for `packages/alp-webview/dist/main.js`, `localResourceRoots` = that dist, body `data-alp-mode="quickstart"` + `data-alp-theme` from `brandThemeEnabled()`). On resolve: subscribe to `stateMgr.onStateChange`, post `{ type: "stateUpdate", _v: PROTOCOL_VERSION, state }`; the webview derives the phase (or post `phase` alongside). Handle CTA messages via `runCommand` using the existing allowlisted handler pattern (bootstrap → `alp.installDependencies`, project → `alp.openNewProjectWizard`/full-width panel, board → `alp.openConfigurator`, build → `alp.westBuild`, flash → `alp.westFlash`).

- [ ] **Step 3:** `src/views/index.ts` — remove `setupProvider`/`workspacesProvider` `createTreeView` calls and their providers from the disposables; add `...registerQuickstart(context, stateMgr)`.

- [ ] **Step 4:** `App.tsx` — add the `quickstart` mode branch rendering a new `QuickstartView` (Task 4).

- [ ] **Step 5:** `pnpm run compile` green; commit `feat(hub): register Quickstart sidebar webview, fold setup+workspaces`.

---

## Task 4: Quickstart ladder UI (React webview)

**Files:**
- Create: `packages/alp-webview/src/features/quickstart/QuickstartView.tsx` + `.module.css` + `index.ts`
- Uses: `useAppContext()` state, `derivePhase` (mirror the pure fn into the webview or import a shared copy), `postMessage`.

**Interfaces:**
- Consumes: `AlpIdeState` via context; `LADDER_STEPS`.
- Produces: `<QuickstartView/>`.

- [ ] **Step 1:** Render the 4 `LADDER_STEPS`. Compute `phase` from state. For each step: `done` if its order < current, `active` if == current, `upcoming` if > current. `done` → collapsed row with ✓; `active` → expanded with its one CTA; `upcoming` → dim label, NO button.
- [ ] **Step 2:** CTAs per active step: environment → `runCommand alp.installDependencies`; project → `runCommand` the full-width New Project wizard command (Task 5) + secondary "Open Existing"; board → `runCommand alp.openConfigurator` (+ show `boardIssueCount` warnings when `invalid-board`); build → `runCommand alp.westBuild` + `alp.westFlash`.
- [ ] **Step 3:** Style with existing tokens (two color modes already work). Keep it narrow-friendly (single column, checkbox rows). No gray-out — upcoming steps are dim text only.
- [ ] **Step 4:** `pnpm run compile` green; manual F5 sanity (do not claim render without it).
- [ ] **Step 5:** Commit `feat(hub): Quickstart ladder UI`.

---

## Task 5: Full-width New Project wizard as step-② target

**Files:**
- Modify: `package.json` (ensure a command opens the full-width `newProjectFlowPanel`; e.g. `alp.openNewProjectWizard`)
- Modify: `src/ideHub/index.ts` or wherever panels register (wire the command → `newProjectFlowPanel` open)

**Interfaces:** Consumes dev's existing `newProjectFlowPanel` / `NewProjectFlowView`.

- [ ] **Step 1:** Verify dev's `newProjectFlowPanel.ts` opens a full-width `WebviewPanel` with the New Project GUI and that its `createNewProject` handler scaffolds (via `projectScaffold.ts`). If a command already opens it, reuse it; else add `alp.openNewProjectWizard` → `NewProjectFlowPanel.show(context)`.
- [ ] **Step 2:** Point the ladder step-② CTA at that command. Keep the QuickPick `alp.newProjectWizard` as a palette fallback only.
- [ ] **Step 3:** `pnpm run compile` + `pnpm test` green.
- [ ] **Step 4:** Commit `feat(hub): launch full-width New Project wizard from ladder`.

---

## Task 6: Command enablement + Build tree gating + retire Overview entry

**Files:**
- Modify: `package.json` (command `enablement`, remove `alp.openOverview` contribution)
- Modify: `src/views/build.ts` (gate on phase)

- [ ] **Step 1:** Add `"enablement": "alp-ide.projectsState == ready"` to `alp.openConfigurator`, `alp.validateBoardYaml`, `alp.previewEffectiveConfig`, `alp.westBuild`, `alp.westFlash` (palette/menu cleanup).
- [ ] **Step 2:** Build & Flash tree returns no operational items unless phase == ready (mirror the projects-tree empty pattern); a `viewsWelcome` line pointing to the ladder when not ready.
- [ ] **Step 3:** Remove the `alp.openOverview` command + any menu entry from `package.json` (retire the entry point). Do NOT delete `overviewPanel.ts` / `OverviewView.tsx` — leave the code for later re-enable.
- [ ] **Step 4:** `pnpm run compile` + `pnpm test` green; manual F5 walk of all four phases.
- [ ] **Step 5:** Commit `feat(hub): gate project commands + build tree on readiness; retire Overview entry`.

---

## Self-review

- **Spec coverage:** ladder (T3/T4), fold setup+workspaces (T3), keep projects/sdk/build native (T3/T6), phase single-source (T1) driving ladder+trees+enablement (T4/T6), `boardYamlValid` field (T2), full-width wizards (T5), retire Overview keep code (T6), no gray-out (T4 constraint). Covered.
- **Placeholders:** none — pure-logic tasks carry full code; webview tasks carry exact CTA→command mappings.
- **Type consistency:** `Phase`, `derivePhase`, `boardYamlValid`, `boardIssueCount`, `alp-ide.quickstart`, `alp-ide.projectsState` used consistently across tasks.
- **Known follow-up:** Task 2's validity call must reuse the existing validator (confirm the exact `@alp-core` entry during T2); if webview needs its own `derivePhase`, keep it byte-identical to `src/ideHub/phase.ts` (same manual-mirror discipline as messages/types).
