# Design: Alp activity-bar view (Phase 1)

**Date:** 2026-05-24
**Status:** Approved (pending spec review)
**Roadmap:** Phase 1 of `2026-05-24-alp-studio-roadmap.md`.
**Scope:** Activity-bar UI only. Publishing / `.vsix` / CHANGELOG work is deferred.
This phase is the **discoverable home** for the extension; the board configurator
(Phase 2) is the centerpiece it surfaces, so **"Configure board (GUI)" is the
featured action** here. No SDK-catalogue dependency — board summary only parses
`board.yaml`.

## Problem

The extension contributes commands, snippets, YAML validation, and webview panels
(Configurator, Troubleshooting), but has **no presence in the activity bar**. Users
have no at-a-glance home for the extension and must discover everything through the
Command Palette. We want a bolt icon in the activity bar that opens an Alp side panel
showing the current project's state plus one-click actions.

## Branding

Use **"Alp"** (not "ALP") in all UI strings introduced by this feature. Existing
`displayName`/marketplace strings are out of scope and remain unchanged.

## Goals

- A bolt icon in the activity-bar rail, correctly theme-tinted.
- A "Project" tree view showing board summary + grouped action buttons.
- A welcome view (with primary actions) when no `board.yaml` is present.
- Live refresh when `board.yaml` changes.
- Reuse existing commands and data-loading; add no new command behaviour.

## Non-goals

- No publishing, `.vsix`, CHANGELOG, or `.vscodeignore` work this round.
- No new generation/build logic — the panel only wires existing `alp.*` commands.
- No `backend` display (not exposed by `BoardSummary`; can be added later).

## Architecture

Follows the codebase's existing split of pure logic vs. `vscode` adapter, mirroring
`statusBar.ts` + `boardSummary/`.

### 1. Icon asset — `media/bolt.svg`

Single-color bolt silhouette extracted from the existing logo, drawn with
`currentColor` (or `fill="#fff"` mask) so VS Code tints it per theme/active state.
`media/icon.png` (the full "ALP LAB" marketplace logo) is unchanged.

### 2. `package.json` contributions

- `contributes.viewsContainers.activitybar`:
  `{ "id": "alpSdk", "title": "Alp SDK", "icon": "media/bolt.svg" }`
- `contributes.views.alpSdk`:
  `[{ "id": "alpSdk.projectView", "name": "Project" }]`
- `contributes.viewsWelcome`: content for `alpSdk.projectView`, shown
  `"when": "!alpSdk.hasBoard"`. Primary button **"Configure board"**
  (`alp.openConfigurator`), secondary **"New project wizard"**
  (`alp.newProjectWizard`).
- `contributes.menus."view/title"`: a refresh button (`alp.refreshProjectView`)
  bound to `"when": "view == alpSdk.projectView"`, group `navigation`,
  icon `$(refresh)`.
- `contributes.commands`: add `alp.refreshProjectView` ("Alp: Refresh project view").
- `activationEvents`: add `"onView:alpSdk.projectView"`.

### 3. Pure node model — `buildProjectNodes(summary: BoardSummary | null): AlpNode[]`

A pure function (no `vscode` import) that returns the tree structure. This is the
unit-tested core. It lives in `src/projectView/model.ts`, which **must not import
`vscode`** — the `node --test` suite imports the compiled `out/projectView/model.js`
directly, and `vscode` is not resolvable in plain Node. This mirrors the existing
`@alp-sdk/core` pure-logic / vscode-adapter split.

`AlpNode` shape (plain data, mapped to `TreeItem` by the provider):
```
type AlpNode = {
  label: string;
  description?: string;      // e.g. the SoM value
  contextValue?: string;
  icon?: string;             // ThemeIcon id, e.g. "circuit-board"
  command?: string;          // existing alp.* command id
  children?: AlpNode[];
  collapsible?: boolean;
};
```

Sections (matching the approved mockup):
- **PROJECT** (collapsed-expanded): `SoM` → `summary.sku`, `Carrier` →
  `summary.carrier`, `OS` → `summary.os`. Missing values render as `—`.
- **ACTIONS** (Configure board listed first as the featured action):
  Configure board (`alp.openConfigurator`), Validate board.yaml
  (`alp.validateBoardYaml`), Generate all (`alp.generateAll`), West build
  (`alp.westBuild`), West flash (`alp.westFlash`).
- **DEBUG**: Doctor (`alp.debugDoctor`), Troubleshooting panel
  (`alp.openDebugTroubleshootingPanel`).

When `summary` is `null`/has no `sku`, the provider relies on the welcome view; the
tree returns an empty PROJECT or no roots (welcome view covers the UI).

### 4. Provider — `AlpProjectTreeProvider implements vscode.TreeDataProvider<AlpNode>`

Thin `vscode` shell over `buildProjectNodes`:
- `getChildren(node?)` → `node ? node.children : buildProjectNodes(currentSummary())`.
- `getTreeItem(node)` → maps `AlpNode` to `TreeItem` (label, description,
  `ThemeIcon(icon)`, `collapsibleState`, and `command` →
  `{ command, title: label }`).
- `currentSummary()` → `loadBoardSummary(collectProjectContext().boardYamlPath)`
  (same call the status bar uses).
- `refresh()` → recompute summary, fire `onDidChangeTreeData`, and
  `setContext('alpSdk.hasBoard', Boolean(summary?.sku))` to toggle the welcome view.

### 5. Registration — `registerProjectView(context): vscode.Disposable[]`

- Create provider, `vscode.window.createTreeView('alpSdk.projectView', {...})`.
- Register `alp.refreshProjectView` → `provider.refresh()`.
- Create a `**/board.yaml` `FileSystemWatcher`; on change/create/delete →
  `provider.refresh()` (mirrors `statusBar.ts`).
- Call `provider.refresh()` once on startup to seed the `alpSdk.hasBoard` key.
- Returned disposables are spread into the existing `context.subscriptions.push(...)`
  in `extension.ts`.

## Data flow

```
board.yaml on disk
  └─ collectProjectContext().boardYamlPath
       └─ loadBoardSummary(path)  → BoardSummary | null
            └─ buildProjectNodes(summary) → AlpNode[]
                 └─ AlpProjectTreeProvider.getTreeItem → VS Code renders tree
FileSystemWatcher(**/board.yaml) → provider.refresh() → re-runs the chain
                                  + setContext(alpSdk.hasBoard) → welcome view toggles
```

## Error handling

- `loadBoardSummary` already returns `null` on missing/unparseable files (logs via
  `util.log`). The provider treats `null` / missing `sku` as "no board" → welcome
  view. No new error surfaces are introduced.
- Action nodes only invoke existing commands; their own error handling is unchanged.

## Testing

- **Unit (node --test, like `boardSummary` tests):** `buildProjectNodes`
  - returns the three sections with a populated `BoardSummary`,
  - maps `sku`/`carrier`/`os` to the right PROJECT descriptions,
  - renders `—` for missing fields,
  - wires the correct `command` ids on ACTIONS/DEBUG leaves.
- **Manual (Extension Development Host):** open `.scratch` (has `board.yaml`),
  confirm bolt icon appears, tree populates, actions run, edit/delete `board.yaml`
  toggles welcome view live.

## Files

- `media/bolt.svg` — new icon asset.
- `package.json` — contributions + activation event + command.
- `src/projectView/model.ts` — pure `buildProjectNodes` + `AlpNode` type (no `vscode`).
- `src/projectView/index.ts` — `AlpProjectTreeProvider` + `registerProjectView` (vscode).
- `src/extension.ts` — one `registerProjectView(context)` call, spread into the
  existing `context.subscriptions.push(...)`.
- `test/projectView.test.js` — unit tests importing `out/projectView/model.js`.
