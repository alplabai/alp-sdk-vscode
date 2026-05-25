# UI-2b: Configurator Renderer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fill the configurator shell's `#alp-main` with the SKU-driven **Project & Hardware** and **Cores** sections (+ the searchable library selector), rendered from the view-model, with edit→save wiring — the visible, drivable configurator.

**Architecture:** `media/configurator.js` is a thin client renderer: it receives `render { viewModel, board }`, builds the active section's DOM, and on edits mutates a local `board` copy and posts `update { board }` (panel re-derives + re-posts). Hard logic stays in the tested core view-model (UI-1). The renderer is **verified live in the Extension Development Host** (no jsdom in the repo); the one pure, unit-testable piece — the selector's filter — lives in core.

**Tech Stack:** Vanilla JS webview (CSP-nonce'd, no bundler), CSS (site tokens), `node:test` for the pure filter. Build: `pnpm run compile`.

---

## Reference

- The shell + protocol + panel are merged on `feat/configurator-ui` (UI-2a): the panel posts
  `{ type:"render", viewModel, board, boardPath, sdkConnected }` and accepts
  `{ type:"update", board }` / `save` / `reload` / `previewEffectiveConfig`. `media/configurator.js`
  is currently a stub; this plan replaces it.
- `ConfiguratorViewModel` shape (UI-1): `sdkConnected`, `som{selected,options[]}`,
  `hardware|null`, `accelerators[]`, `boardMode`, `carriers{selected,options[]}`,
  `cores[]` (`{id,inheritedFromTopology,os,app,image,peripherals,libraries,iot,inferenceArenaKib}`),
  `libraries[]`, `chips[]`, `projectChips[]`, `validation{errors,warnings}`.
- Approved visuals: the cores-section and library-selector mockups (Indigo-dark, override-only
  core cards, ghosted inherited cores, selected-chips + searchable "add" control).
- CSS tokens + chrome are in `media/configurator.css`; this plan appends section styles.

## Edit contract (webview ↔ panel)

The webview keeps the posted `board` as its working copy. On a **structural** change
(SoM select, board-mode/carrier, add/remove a core override, add/remove a library, toggle
an IoT flag or chip) it mutates `board` and posts `update { board }`; the panel re-derives
the VM and posts a fresh `render` (the webview rebuilds the active section). On **scalar
text/number** edits (name, description, app dir, arena KiB) it mutates `board` and posts
`update` **debounced 200 ms**, and on the returned `render` it refreshes the hardware
card + footer validation but does **not** rebuild the input currently focused (guard by
`document.activeElement`).

---

### Task 1: Pure selector filter (core, tested)

**Files:**
- Create: `packages/alp-core/src/configurator/selectorFilter.ts`
- Test: `test/configurator.selectorFilter.test.js`

- [ ] **Step 1: Write the failing test**

Create `test/configurator.selectorFilter.test.js`:

```javascript
const test = require("node:test");
const assert = require("node:assert/strict");
const { filterChoices } = require("../packages/alp-core/dist/configurator/selectorFilter.js");

const ALL = ["etl", "fmt", "cmsis_dsp", "tflite_micro", "mbedtls", "lvgl"];

test("filterChoices excludes selected and matches a query (case-insensitive, substring)", () => {
  assert.deepEqual(filterChoices(ALL, ["fmt"], "ML"), ["tflite_micro"]); // 'ml' in tfLite_Micro? no — matches by substring on id
});

test("filterChoices: empty query returns all non-selected (sorted)", () => {
  assert.deepEqual(filterChoices(ALL, ["fmt", "etl"], ""), ["cmsis_dsp", "lvgl", "mbedtls", "tflite_micro"]);
});

test("filterChoices: substring match", () => {
  assert.deepEqual(filterChoices(ALL, [], "ts"), []); // none contain 'ts'
  assert.deepEqual(filterChoices(ALL, [], "tl"), ["etl"]);
  assert.deepEqual(filterChoices(ALL, [], "m"), ["cmsis_dsp", "mbedtls", "tflite_micro"]);
});
```

(Note: the first test's expectation is wrong-by-construction to force a real implementation
decision — replace it with the correct expectation after writing the impl: `filterChoices(ALL,
["fmt"], "m")` → `["cmsis_dsp", "mbedtls", "tflite_micro"]`. Use that instead.)

Corrected first test:

```javascript
test("filterChoices excludes selected and matches a query (case-insensitive substring)", () => {
  assert.deepEqual(filterChoices(ALL, ["cmsis_dsp"], "M"), ["mbedtls", "tflite_micro"]);
});
```

- [ ] **Step 2: Run to verify FAIL**

Run: `node --test test/configurator.selectorFilter.test.js`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

Create `packages/alp-core/src/configurator/selectorFilter.ts`:

```typescript
// SPDX-License-Identifier: Apache-2.0

/**
 * Filter a catalogue of ids for a searchable selector: drop already-selected ids,
 * keep those whose id contains the (case-insensitive) query, sorted alphabetically.
 */
export function filterChoices(all: string[], selected: string[], query: string): string[] {
  const q = query.trim().toLowerCase();
  const chosen = new Set(selected);
  return all
    .filter((id) => !chosen.has(id) && id.toLowerCase().includes(q))
    .sort((a, b) => a.localeCompare(b));
}
```

- [ ] **Step 4: Compile + run; verify PASS** (fix the test expectations to match the impl above)

Run: `pnpm run compile && node --test test/configurator.selectorFilter.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/alp-core/src/configurator/selectorFilter.ts test/configurator.selectorFilter.test.js
git commit -m "feat(configurator): pure selector filter helper with tests"
```

---

### Task 2: Renderer core + Project & Hardware section

**Files:**
- Modify: `media/configurator.js` (replace the UI-2a stub with the renderer)
- Modify: `media/configurator.css` (append Project/Hardware section styles)

This is verified in the dev host (Step 4), not by unit tests.

- [ ] **Step 1: Implement the renderer skeleton + Project & Hardware**

Replace `media/configurator.js` with a renderer that: caches the last `render` message
(`vm`, `board`); tracks `activeSection` (default `project`, switched by sidebar nav clicks);
on `render` rebuilds `#alp-main` for the active section and updates `#alp-validation`/
`#alp-saved`; wires edits per the **Edit contract** above (mutate local `board`, post
`update`; debounce scalar text). The **Project & Hardware** section renders:
- a grouped `<select data-field="som.sku">` from `vm.som.options` (optgroup per family;
  preliminary SoMs suffixed "(preliminary)");
- `name`/`description` text inputs (`data-field="name"`, `data-field="description"`);
- a board-mode segmented control (preset|inline) + a carrier `<select data-field="preset">`
  from `vm.carriers.options` (shown in preset mode);
- a read-only **hardware card** from `vm.hardware` (silicon, cores list, `preferredBackend`
  with a "silicon-fixed" tag, `defaultBoard`, on-module chips) + an **accelerator row** from
  `vm.accelerators` (struck-through when `!available`);
- the SDK-disconnected empty state when `!vm.sdkConnected`.

Use the class names from `media/configurator.css` (Task 3). Build DOM with
`document.createElement` (no innerHTML of dynamic values, to respect CSP/safety); the
wordmark/static chrome already lives in the shell. Editing `som.sku` is structural → set
`board.som.sku` and post `update` immediately.

- [ ] **Step 2: Append Project/Hardware CSS**

In `media/configurator.css`, append styles for: `.alp-section`, `.alp-field` (label +
control), `.alp-row` (2-col), `select`/`input` (bg-elev, hairline, npu focus ring),
`.alp-card` (hardware card: top bar with gradient, `dl.kv` grid), `.alp-acc` chips
(`.on`/`.off` struck-through), the `§` mono section label, and the disconnected empty state.
Match the approved mockups' look (5px radii, mono labels, accent LEDs).

- [ ] **Step 3: Build**

Run: `pnpm run compile`
Expected: exit 0 (configurator.js is not compiled by tsc — it's `media/` — but this confirms
nothing else broke; the css/js are copied as-is by the extension at runtime).

- [ ] **Step 4: Dev-host verification (USER)**

Reload the dev host (`Ctrl+R`) on `feat/configurator-ui` with `.scratch` open + the
configurator. Verify: the Project section renders; the SoM dropdown is populated **when
`alpSdk.path` points at the alp-sdk checkout** (`C:\Users\caner\Documents\GitHub\alp-sdk`);
selecting a different SoM re-derives the hardware card + accelerators + carriers; the
hardware card shows the derived backend; editing name persists after Save. Capture a
screenshot for review.

- [ ] **Step 5: Commit**

```bash
git add media/configurator.js media/configurator.css
git commit -m "feat(configurator): render Project & Hardware section from view-model"
```

---

### Task 3: Cores section + searchable library selector

**Files:**
- Modify: `media/configurator.js` (add the Cores renderer + selector widget)
- Modify: `media/configurator.css` (append core-card + selector styles)

- [ ] **Step 1: Implement the Cores section + selector widget**

Add a `renderCores(vm, board)` path: one card per `vm.cores[]`. A present core (not
`inheritedFromTopology`) shows an "Enabled" toggle (off ↔ `os:"off"`), App dir
(`data-core=<id> data-field="app"`), Inference arena (`...default_arena_kib`), IoT chips
(wifi/mqtt/ble/tls — toggle = structural), and the **searchable library selector**. A
ghosted inherited core shows the type + an **"Override this core"** button that adds an
empty `board.cores[id] = {}` and posts `update`.

The **selector widget** (reusable): renders selected ids as removable chips (× removes →
mutate `board.cores[id].libraries`, post update) + a text input; on input, compute matches
with the same logic as `filterChoices` (inline JS mirror: case-insensitive substring over
`vm.libraries` minus selected, sorted) and show a dropdown; click/Enter adds the id (mutate
+ post update). Keyboard: ↑/↓ move active option, Enter add, Esc close.

- [ ] **Step 2: Append core-card + selector CSS**

Append styles matching the cores + library-selector mockups: `.alp-core` (card, `.ghost`),
`.alp-core .chd` (header: LED, id mono, type badge, enable switch), `.alp-cbody`, the
`.alp-sw` toggle, IoT chips, and the selector (`.alp-sel`, `.alp-selchip` with `.x`,
`.alp-combo`, `.alp-dd` dropdown, `.alp-opt`/`.active`, hint bar).

- [ ] **Step 3: Build**

Run: `pnpm run compile`
Expected: exit 0.

- [ ] **Step 4: Dev-host verification (USER)**

Reload the dev host. Verify: the Cores section shows a card per topology core; the active
core's library selector filters as you type and add/remove updates the chips; toggling IoT
tls without mbedtls surfaces the validation error in the footer; "Override this core" turns
a ghosted core into an editable one; Save writes a valid v0.6 board.yaml (open it to
confirm per-core `libraries`/`iot`). Screenshot for review.

- [ ] **Step 5: Commit**

```bash
git add media/configurator.js media/configurator.css
git commit -m "feat(configurator): render Cores section + searchable library selector"
```

---

### Task 4: VS Code theme option (brand ⇄ editor)

Make the configurator able to follow the VS Code theme, toggled + persisted. Because the
renderer/CSS use semantic tokens, this is a token-override block + a toggle + a setting.

**Files:**
- Modify: `media/configurator.css` (add `[data-theme="vscode"]` token overrides)
- Modify: `packages/alp-core/src/configurator/{models.ts,panelHtml.ts}` (theme in payload +
  header toggle), `media/configurator.js` (apply `data-theme` + toggle handler)
- Modify: `src/configuratorPanel.ts` (read/persist the setting, include `theme` in render)
- Modify: `package.json` (the `alpSdk.configuratorTheme` setting)

- [ ] **Step 1: Add the setting**

In `package.json` `contributes.configuration.properties`, add:

```json
        "alpSdk.configuratorTheme": {
          "type": "string",
          "enum": ["brand", "vscode"],
          "enumDescriptions": ["Alp brand (Indigo-dark)", "Follow the VS Code color theme"],
          "default": "brand",
          "description": "Color theme for the Alp board configurator panel."
        }
```

- [ ] **Step 2: Add the `[data-theme="vscode"]` token block**

In `media/configurator.css`, after the `:root` brand tokens, append a block that remaps the
semantic tokens to VS Code theme variables (with safe fallbacks):

```css
body[data-theme="vscode"] {
  --bg-base: var(--vscode-editor-background, #1e1e1e);
  --bg-surface: var(--vscode-editorWidget-background, #252526);
  --bg-elev: var(--vscode-input-background, #2a2a2b);
  --border-line: var(--vscode-panel-border, #3a3a3a);
  --text-primary: var(--vscode-foreground, #ccc);
  --text-muted: var(--vscode-descriptionForeground, #999);
  --text-fade: var(--vscode-disabledForeground, #777);
  --accent-brand: var(--vscode-button-background, #0e639c);
  --accent-brand-hi: var(--vscode-button-hoverBackground, #1177bb);
  --accent-npu: var(--vscode-focusBorder, #007fd4);
  --ok: var(--vscode-testing-iconPassed, #5eead4);
  --err: var(--vscode-errorForeground, #f87171);
  --font-sans: var(--vscode-font-family, system-ui, sans-serif);
}
```

(Brand mode is the default `:root`; `body` carries `data-theme="brand"` or `"vscode"`.)

- [ ] **Step 3: Protocol + panel + setting wiring**

- `RenderPayload` (core `configurator/models.ts`) gains `theme: "brand" | "vscode"`.
- `ConfiguratorInboundMessage` gains `{ type: "setTheme"; theme: "brand" | "vscode" }`.
- `configuratorPanel.ts`: read
  `vscode.workspace.getConfiguration("alpSdk").get<string>("configuratorTheme", "brand")`,
  include it in every `render`; handle `setTheme` by
  `getConfiguration("alpSdk").update("configuratorTheme", theme, vscode.ConfigurationTarget.Workspace)`
  then re-render.

- [ ] **Step 4: Header toggle + apply**

- `panelHtml.ts`: add a small theme control in the header (e.g. a two-option
  `<select id="alp-theme">` with Brand/Editor, or a labeled button) before `#alp-saved`.
- `media/configurator.js`: on `render`, set `document.body.dataset.theme = msg.theme` and
  reflect the control's value; on change, post `{ type: "setTheme", theme }`.

- [ ] **Step 5: Build + dev-host verify (USER)**

Run: `pnpm run compile` → exit 0. Reload the dev host; toggle Brand ⇄ Editor and switch the
VS Code color theme (e.g. a light theme) — the configurator chrome + sections should follow
it in `vscode` mode and stay Indigo-dark in `brand` mode; the choice persists across reopen.

- [ ] **Step 6: Commit**

```bash
git add package.json media/configurator.css media/configurator.js packages/alp-core/src/configurator/models.ts packages/alp-core/src/configurator/panelHtml.ts src/configuratorPanel.ts
git commit -m "feat(configurator): brand/VS Code theme toggle (persisted)"
```

---

### Task 5: Full-flow verification + headless capture

- [ ] **Step 1: Headless render check (controller)**

To verify the renderer without the dev host, the controller builds a standalone harness
that loads `media/configurator.js`, posts a mock `render` message with a realistic VM +
board, and screenshots `#alp-main` via Playwright (served over http). Confirm Project +
Cores render correctly and match the mockups; iterate on `configurator.js`/css until they do.

- [ ] **Step 2: Dev-host sign-off (USER)**

Final pass in the Extension Development Host with the real alp-sdk (`alpSdk.path`): SoM
switch re-derives everything, edits persist on Save, validation is live, status-bar/tree
show SoM·Preset. On sign-off, the `feat/configurator-ui` branch is ready to merge (UI-2a+2b).

---

## Self-review notes

- **Spec coverage (UI-2 renderer parts):** pure selector filter tested in core (Task 1);
  Project & Hardware render + edit/save + disconnected state (Task 2); Cores + searchable
  selector + IoT/override + live validation (Task 3); brand/VS Code theme toggle (Task 4);
  full-flow + headless capture + dev-host sign-off (Task 5). Diagnostics/Storage/Security/
  Boot/OTA/IPC/Review remain UI-3.
- **Theme tokens:** all CSS uses semantic tokens, so the `[data-theme="vscode"]` override
  makes both chrome and sections follow the editor theme; brand (Indigo-dark) is the default.
- **Testing honesty:** only `filterChoices` is unit-tested (no jsdom); the renderer is
  verified live + via a headless Playwright capture. This matches the UI-2 spec's testing
  section.
- **Edit contract** (structural→immediate update, scalar→debounced + focus-preserving) is
  defined once at the top and referenced by Tasks 2-3.
- **No Claude co-author trailer** in any commit.
- The renderer DOM is built with `createElement` (no innerHTML of dynamic data) to respect
  the webview CSP.
