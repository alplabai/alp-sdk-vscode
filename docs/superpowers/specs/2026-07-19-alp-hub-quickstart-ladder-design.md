# Alp Hub — Quickstart Ladder (state-driven sidebar) — Design

Date: 2026-07-19
Branch: `feat/hub-visual-two-modes` (off `origin/dev`)
Status: approved design, pending spec review → writing-plans

## Problem

The hub conflates two independent readiness axes into one "ready":

- **Environment readiness** — Python / West / Alp SDK / west workspace installed.
- **Project readiness** — a valid `board.yaml` (a project) exists.

`OverviewView.isAllReady()` keys only on the environment axis, so with **no project open** the Overview still declares *"Workspace is configured and ready for development / you can now build and flash"*, and project-scoped actions (Board Configurator, Build, Flash, Validate, Preview) stay active with nothing to act on. Three surfaces (Overview, sidebar trees, commands) compute state independently and can contradict each other.

Gray-out was considered and **rejected** — both reference tools (PlatformIO, NXP MCUXpresso) avoid it. PlatformIO's always-live Build button that errors with "no task found" is the documented anti-pattern. NXP MCUXpresso uses progressive disclosure: an ordered, self-checking step ladder in a docked sidebar webview, where the primary CTA demotes (never grays) and project actions are *absent* until a project exists.

## Goal

Replace the flat, always-on hub with a **state-driven Quickstart ladder** in the sidebar (NXP-hybrid model): a compact webview that guides Environment → Project → Board → Build/Flash, backed by a **single `phase` selector** that also drives the native trees and command enablement — so the surfaces can never disagree.

## Design

### Sidebar layout (container `alp-ide`, top → bottom)

1. **QUICKSTART** — NEW webview view (`alp-ide.quickstart`, a `WebviewViewProvider`). The ladder / state machine. Folds in today's SETUP + WORKSPACES trees.
2. **PROJECTS** — native tree (kept): active project row + inline actions.
3. **SDK MANAGER** — native tree (kept): installed SDKs, manage.
4. **BUILD & FLASH** — native tree (kept): build plan / tasks; populates only when project-ready.

Removed as standalone views: `alp-ide.setup`, `alp-ide.workspaces` (their content becomes ladder step ①).

### The ladder — 4 steps, auto-advancing, no gray-out

Each step is a checkbox row. The **current** step is expanded with **one** primary CTA; **completed** steps collapse to ✓; **not-yet-reached** steps are dim labels (progress markers, not disabled buttons).

| # | Step | ✓ condition | CTA(s) |
|---|---|---|---|
| ① | **Environment** | python && west && westInitialized && sdk.readiness == "ready" | Set up environment (Bootstrap) |
| ② | **Project** | `board.yaml` exists | New Project · Open Existing |
| ③ | **Board** | `board.yaml` **valid** (E1M diagnostics clean) | Configure Board (shows warning count if invalid) |
| ④ | **Build & Flash** | reachable after ③ | Build · Flash |

The primary CTA **demotes** as its step completes (NXP "+"-in-toolbar idea) rather than graying.

### State — single source of truth

One selector derives the phase from `AlpIdeState`:

```
type Phase = "no-env" | "no-project" | "invalid-board" | "ready";

envReady = setup.pythonAvailable && setup.westAvailable
         && workspace.westInitialized && sdk.readiness === "ready";

phase =
  !envReady               -> "no-env"        (step ① active)
  !workspace.boardYamlExists -> "no-project"  (step ② active)
  !workspace.boardYamlValid  -> "invalid-board" (step ③ active, warnings shown)
  else                    -> "ready"         (step ④ active)
```

This phase drives **all three** surfaces:
- **Quickstart ladder** — which step is active/done/dim.
- **Native trees** — Build & Flash tree is empty until `ready` (PlatformIO per-env pattern); Projects tree shows New/Open welcome until a project exists (already implemented via `alp-ide.projectsState`).
- **Command enablement** — project-scoped commands (`alp.openConfigurator`, `alp.westBuild`, `alp.westFlash`, `alp.validateBoardYaml`, `alp.previewEffectiveConfig`) gated on `alp-ide.projectsState == ready` (palette/menus). NOTE: webview CTAs are gated by the phase in the webview itself; VS Code `enablement` does not reach webview buttons.

### New state field: board validity

`AlpIdeState.workspace` currently has `boardYamlExists: boolean` only. Add:

- `boardYamlValid: boolean` — computed host-side from the board.yaml validator / E1M diagnostics (the LSP already publishes these).
- Optional `boardIssueCount: number` — for the "N warnings" display on step ③.

Wire it into the existing `StateManager` refresh so the ladder and step ③ react to edits (a `board.yaml` FileSystemWatcher already triggers refresh).

### Overview — retire as primary, keep the code

- **Retire the entry point:** remove/hide the `alp.openOverview` command contribution + any menu that surfaces it as the primary hub, so the ladder is the spine.
- **Keep the code:** `overviewPanel.ts` + `OverviewView.tsx` stay in the tree, unwired, ready to re-enable later as a secondary rich "dashboard" (user may enable it again). Do NOT delete.

### Components (isolation / boundaries)

- `phase.ts` (new, host + mirrored to webview): the pure `derivePhase(state): Phase` selector + step definitions. Unit-testable in isolation, no VS Code deps.
- `quickstartProvider.ts` (new): `WebviewViewProvider` for `alp-ide.quickstart`; renders the ladder HTML, posts `phase`/state, handles the step CTAs (delegating to existing commands: bootstrap, newProjectWizard, openExistingProject, openConfigurator, westBuild/Flash). Re-renders on `StateManager` change.
- Quickstart webview UI (new, in `packages/alp-webview`): the ladder component consuming `phase` + step state. Reuses the existing two-color-mode tokens.
- Native trees: `projects.ts` (already phase-aware), `sdk`, `build` — Build tree gated on `ready`.
- `StateManager`: extend to compute `boardYamlValid`.

### Data flow

`board.yaml` / tool changes → `StateManager.refresh()` → `AlpIdeState` (now incl. `boardYamlValid`) → `derivePhase()` → (a) Quickstart webview `postMessage(phase,state)`, (b) native trees re-read, (c) `setContext('alp-ide.projectsState', ...)` for command enablement.

### Error / empty states

- `no-env`: ladder step ① expanded; trees below show their own empty/welcome; no project/build talk.
- `no-project`: step ② expanded with New/Open; Projects tree welcome (done); Build tree empty.
- `invalid-board`: step ③ expanded, shows E1M warning count + Configure Board CTA; not an error toast — a first-class actionable state.
- `ready`: step ④; Build & Flash tree populated.

### Testing

- `phase.test.js` (node:test): `derivePhase` across all four states + boundary (env ready but board invalid, etc.). Pure function, no fixtures.
- Manual: F5 the Extension Development Host, walk no-folder → open folder (no board) → add board.yaml (invalid) → fix → build; confirm the ladder + trees + command enablement stay consistent.
- Gates: `pnpm run compile` + `pnpm test`.

### Out of scope (future)

- Re-enabling the Overview as a secondary dashboard.
- The two color modes (already implemented on this branch — VS Code theme default, `data-alp-theme="brand"`).
- Rebuilding SDK/Build operational logic (kept native, unchanged).

## Reference basis

- NXP MCUXpresso Quickstart Panel — docked sidebar webview, ordered self-checking steps, demoting CTA, project actions absent until a project row exists.
- PlatformIO — rich webview + native task trees; its always-live-Build-that-errors is the anti-pattern being avoided.
- Both reject gray-out; both key hub state off the config artifact (`platformio.ini` / imported repo). Alp keys off `board.yaml` presence + validity.
