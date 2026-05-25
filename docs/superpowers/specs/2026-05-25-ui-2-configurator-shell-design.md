# Design: UI-2 — Configurator shell + Project/Hardware/Cores

**Date:** 2026-05-25
**Status:** Draft (approved in brainstorm; pending spec review)
**Roadmap:** Second configurator slice (after UI-1 view-model). Part of Phase 2a.
**Branding:** "Alp", never "ALP", in text. The wordmark graphic is used as-is.

## Problem

UI-1 built the tested `ConfiguratorViewModel`. UI-2 makes it visible: replace the
pre-v0.6 configurator webview with a site-styled, SKU-driven UI that edits a real v0.6
`board.yaml`, and realign the status-bar/tree board summary so the extension is
consistent on v0.6.

## Scope (this slice)

- **Message protocol + panel rewrite** (`configuratorPanel.ts`, `configurator/vscodeAdapter.ts`).
- **Site-styled shell** (`panelHtml.ts` + `media/configurator.css`): header (white
  wordmark, hairline, blur), left sidebar + search, footer (validation + Save/Reload/
  Preview).
- **Render + edit** for **Project & Hardware** and **Cores** (`media/configurator.js`),
  including the **searchable library selector** (approved pattern).
- **`boardSummary` realignment** to v0.6 (`@alp-sdk/core/boardSummary`, `statusBar.ts`,
  `projectView/model.ts`) + rewrite `.scratch/board.yaml` to v0.6.

**Deferred to UI-3:** Chips & Libraries (project-wide), Diagnostics, Storage, Security,
Boot, OTA, IPC, Review/effective-config preview. The sidebar lists only the implemented
sections this slice; UI-3 adds the rest.

## Architecture — where the logic lives

The view-model is Node/core code, so **the panel computes it; the webview renders it.**

- The panel (`ConfiguratorPanel`, Node) on open/reload:
  `board = parseBoardConfig(read(boardPath))`, `catalogue = loadSdkCatalogue(sdkRoot)`,
  `vm = buildConfiguratorViewModel(board, catalogue)`, then posts `render { viewModel,
  board, boardPath }`. It keeps `this.board` as the working copy.
- The webview renders the VM + raw `board`, and on edits mutates its local `board` copy
  and posts `update { board }`. The panel replaces `this.board`, recomputes the VM, and
  posts a fresh `render`.
- Save: `save` → panel writes `serializeBoardConfig(this.board)` and posts `saved`.
  Reload: re-read disk. Preview: run `alp.previewEffectiveConfig`.

### Message protocol (`@alp-sdk/core/configurator/models`)

```
// extension → webview
{ type: "render"; viewModel: ConfiguratorViewModel; board: BoardConfig; boardPath: string; sdkConnected: boolean }
{ type: "saved"; boardPath: string }
// webview → extension
{ type: "update"; board: BoardConfig }
{ type: "save" }
{ type: "reload" }
{ type: "previewEffectiveConfig" }
```

(The old `init`/`{model,catalogue}` messages and the pre-v0.6 `BoardModel` save path are
replaced. The legacy `@alp-sdk/core/configurator/service` + `BoardModel` and the old
`loadPresetCatalogue`/`loadBoardModel`/`saveBoardModel` are removed or superseded.)

### Re-render without losing focus (implementation requirement)

The webview owns the in-progress `board`. **Structural edits** (SoM change, carrier
change, preset↔inline, add/remove a core override, add/remove a library or chip) trigger
an immediate `update`→`render` round-trip (the derived panels — hardware card,
accelerators, carriers, chips, validation — must refresh). **Scalar text/number edits**
(name, description, app dir, arena KiB) update `board` + post `update` debounced (~150 ms);
on the returned `render`, the webview refreshes the derived panels + footer validation but
must **not** rebuild the input element the user is editing (preserve focus/caret). The
renderer keys re-renders by section so the active field is left intact.

## Components

- **`panelHtml.ts`** — emits the static shell: `<head>` CSP + fonts + css link; header with
  the embedded white wordmark SVG; the sidebar nav (Project & Hardware · Cores) + search
  box; an empty `#main` mount; the footer. Pure string builder → testable for required
  element ids/structure.
- **`media/configurator.css`** — the site tokens (Indigo-dark), Inter/Roboto Mono
  `@font-face` (bundled woff2 in `media/fonts/`), header/sidebar/footer, core cards, the
  selector widget. Theme is brand-fixed (not VS Code theme).
- **`media/configurator.js`** — thin renderer: handles `render` messages, builds the
  active section's DOM from `viewModel`+`board`, wires edit handlers that mutate the local
  `board` and post `update`/`save`/`reload`. Includes the reusable **searchable selector**
  widget (selected chips + filter input + keyboard-navigable dropdown) used for per-core
  `libraries`. Renders the SDK-disconnected empty state when `!sdkConnected`.
- **`configuratorPanel.ts`** — computes the VM (via `buildConfiguratorViewModel` +
  `loadSdkCatalogue` + `parseBoardConfig`), holds the working board, handles the protocol.
- **`configurator/vscodeAdapter.ts`** — `loadBoardConfigFromFile(path)` (parse) +
  `saveBoardConfigToFile(path, cfg)` (serialize) + `loadSdkCatalogue` wiring (pass
  `log` from `../util` as the injected logger).

### Sections rendered this slice

- **Project & Hardware:** grouped SoM `<select>` (from `vm.som.options`); `name` /
  `description` text; **board mode** preset|inline toggle; carrier `<select>` (from
  `vm.carriers`, filtered); the read-only **hardware card** (`vm.hardware` — silicon,
  cores, derived backend with a "silicon-fixed" note, default board, on-module chips) and
  the **accelerator availability** row (`vm.accelerators`, struck-through when
  unavailable). `preliminary` SoMs show a warning chip.
- **Cores:** one card per `vm.cores[]` (topology∪board). Present cores show App dir,
  Inference arena (KiB), IoT toggles, and the searchable **Libraries** selector. Cores
  with `inheritedFromTopology` render ghosted with an **"Override this core"** button that
  adds an empty `cores.<id>` entry to `board`. An "Enabled" toggle maps to `os: "off"`.

## `boardSummary` realignment (v0.6)

- `BoardSummary` → `{ sku?: string; preset?: string; osSummary?: string }`.
- `parseBoardSummary` reads `som.sku`, top-level `preset`, and derives `osSummary` from the
  distinct `cores.<id>.os` values (e.g. `"zephyr"`, or `"zephyr+yocto"`, or `undefined`).
- `createStatusBarPresentation` text → `$(circuit-board) <sku> · <preset> · <osSummary>`;
  empty state unchanged (command `alp.openConfigurator`).
- `projectView/model.ts`: the PROJECT section rows become **SoM / Preset / OS** (was
  SoM/Carrier/OS), reading the new summary fields.
- Rewrite `.scratch/board.yaml` to a valid v0.6 example (preset `e1m-evk`, one active core)
  so the live extension reads/validates a real board.

## Data flow

```
board.yaml ─parseBoardConfig→ BoardConfig ─┐
alp-sdk    ─loadSdkCatalogue→ SdkCatalogue ┼→ buildConfiguratorViewModel → VM
                                            │        (panel, Node)
panel ─render{vm,board}→ webview renders → user edits → update{board} → panel
panel ─(save)→ serializeBoardConfig → board.yaml
```

## Error handling

- `!sdkConnected` (no `alpSdk.path`/checkout) → the webview shows a "Connect your alp-sdk
  (set `alpSdk.path`)" state instead of empty dropdowns; Save still works on the raw board.
- No workspace folder → existing guard message (unchanged).
- Parse failure on the project board.yaml → show the YAML error + offer the configurator
  on a default board (don't crash the panel).

## Testing

- **Already covered (UI-1):** the VM logic (`buildConfiguratorViewModel`) unit tests.
- **New unit tests (core, `node --test`):**
  - `parseBoardSummary` v0.6: extracts `sku`/`preset`/`osSummary` (incl. `os: off` and
    multi-OS cores); `createStatusBarPresentation` text for populated + empty.
  - `panelHtml`: the emitted shell contains the required mount ids (`#main`, sidebar nav,
    footer buttons) and the CSP/nonce + font/css links (string assertions, like the
    existing `configurator.panelHtml` test).
  - message-protocol model types compile and round-trip (type-level).
- **Manual (dev host, you):** open `.scratch` in the Extension Development Host, run
  **Alp: Open board configurator** — verify the styling matches the site, the SoM dropdown
  is populated (with `alpSdk.path` → the real alp-sdk), switching SoM re-derives the
  hardware card / accelerators / carriers, Cores render with the library selector, edits
  persist on Save, and the status-bar/tree summary shows SoM/Preset/OS. The webview DOM/CSS
  is verified here (no jsdom in the repo).

## Files

- Modify: `packages/alp-core/src/configurator/models.ts` (new message + payload types),
  `panelHtml.ts` (new shell), `boardSummary/{models,service}.ts` (v0.6 summary).
- Modify: `media/configurator.css` (rewrite to site tokens + new layout),
  `media/configurator.js` (rewrite as VM renderer + selector widget).
- Add: `media/fonts/*` (Inter + Roboto Mono woff2), `media/alplab-logo-white.svg`.
- Modify: `src/configuratorPanel.ts`, `src/configurator/vscodeAdapter.ts`,
  `src/statusBar.ts`, `src/projectView/model.ts`, `src/boardSummary/vscodeAdapter.ts`.
- Rewrite: `.scratch/board.yaml` → v0.6.
- Remove/supersede: pre-v0.6 `BoardModel` paths once unused (`configurator/service`'s
  board-model helpers, old catalogue loader). Keep removals minimal + compile-clean.
- Tests: `test/boardSummary.*` updates, `test/configurator.panelHtml.test.js` update.

## Build order (for the plan)

1. `boardSummary` v0.6 (core parse + presentation) + status-bar/tree + `.scratch` — small,
   testable, keeps the extension consistent.
2. Message-protocol types + `configurator/vscodeAdapter` (load/save via board model) +
   panel VM wiring.
3. `panelHtml` shell + css (site styling) + the disconnected empty state.
4. `configurator.js` renderer: Project & Hardware section.
5. `configurator.js` renderer: Cores section + the searchable library selector widget.
6. Manual dev-host verification pass.
