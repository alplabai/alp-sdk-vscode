# Hub consolidation — status out of the sidebar, Overview→Hub, SDK Manager folded in

**Date:** 2026-07-21
**Repo:** alp-sdk-vscode
**Status:** approved (brainstorm), pending implementation plan

## Problem

Three related IA issues in the extension's GUI:

1. The sidebar hub's "Setup" section (`SidebarHubView.tsx`) renders five
   `StatusRow`s — Host Tools, Python, West, Alp SDK, Workspace — that are
   read-out state, not actions, making the action-oriented sidebar read as a
   status dashboard and duplicating state shown on the full-width page and in
   the Workspace / SDK Manager sections below.
2. The readouts track `python` and `west` but **not `tan`**, though `tan` is
   the build executor now (ADR-0020). `west` is still required (`.west` init is
   the workspace milestone; `west update`/`west flash` still shell west with no
   tan equivalent yet), so both should be surfaced.
3. The full-width "Overview" page and the "SDK Manager" are two separate
   webview panels. They should be one command center: rename Overview → **Hub**
   and fold SDK Manager into it as a section.

## Goals

1. Remove the five status read-outs from the sidebar's Setup section; move that
   readiness state to a new status-bar item (glance + tooltip) + the Hub page.
2. Surface `tan` alongside `west` everywhere `west` is shown.
3. Preserve the sidebar's first-run repair entry point without a status dot.
4. Rename the full-width Overview page to **Hub**, including the command id.
5. Fold the SDK Manager into the Hub as a section; retire the standalone panel.

## Non-goals / out of scope (tracked in `sidebar-dedup-followups` memory)

- West Update rendered twice in the sidebar.
- `alp.bootstrap` vs `alp.installDependencies` — two ids, one handler,
  asymmetric `lastBootstrapAt` stamping.
- The "Workspace" section status row stays (contextual header).

## Decisions

- **Status destination:** status bar + Hub (not a condensed sidebar line).
- **Sidebar strip scope:** the five Setup rows only.
- **First-run:** Setup section keeps `Overview`→`Hub` action (always) + a
  conditional `Finish setup` action (visible only when env not ready) →
  `alp.openSetupFlow`. No status dots.
- **`tan` gating:** info only (version, or "managed"), not a readiness gate — it
  is auto-downloaded on demand. `west` stays a gate.
- **Readiness =** `pythonAvailable && westAvailable && sdk.readiness ===
  "ready" && workspace.westInitialized` (unchanged from `OverviewView`'s
  `isAllReady`).
- **Rename depth:** user-facing labels **and** the command id
  `alp.openOverview` → `alp.openHub`; keep `alp.openOverview` as a thin
  deprecated alias delegating to the same handler (cheap insurance against
  stale keybindings/refs). Internal identifiers (`OverviewPanel`,
  `OverviewView`, the `"overview"` webview mode string) MAY stay as-is to bound
  the diff — user-facing text is what changes.
- **SDK fold shape:** reuse the existing `<SdkView>` React feature, rendered as
  a section inside `<OverviewView>` below Quick Actions. Retire
  `SdkManagerPanel`; `alp.openSdkManager` re-points to `OverviewPanel.open` and
  best-effort scrolls to the SDK section. SDK message handlers move out of
  `SdkManagerPanel` into a shared module consumed by `OverviewPanel`.

## Changes

### Part A — status readouts + `tan`

1. **`src/ideHub/messages.ts`** — `ToolVersions` += `tan: string | null`;
   `emptyAlpIdeState()` default += `tan: null`. Reads `toolVersions.tan`
   defensively (`?? null`), so no `PROTOCOL_VERSION` bump; confirm in impl.
2. **`packages/alp-webview/src/types.ts`** — mirror `tan: string | null`
   (manual protocol sync per CLAUDE.md).
3. **`src/ideHub/vscodeAdapter.ts`** — collect `tan` into `toolVersions.tan`.
   **Hard constraint — no-download probe.** State refresh runs on focus / save /
   settings edit; it must NEVER trigger a `tan` download. Reuse the presence
   check from `ensureTanCliProvisioned`: build the resolve input, and if
   `decideBinarySource(input) === "download"`, set `tan: null` and stop — do not
   fetch. When present, run `<resolvedPath> --version` and parse with the alpCli
   service's **native**-version extractor (a non-native `tan` on PATH must not be
   misread). Fold into the existing `Promise.all`.
4. **`src/statusBar.ts`** — add a fifth left-aligned item, priority `102`
   (leftmost). Text `$(check) Alp` when ready else `$(warning) Alp: setup`;
   `command = "alp.openHub"`; tooltip (verbatim): `Python <ver>` · `west <ver>`
   · `tan <ver | "managed">` · `Alp SDK v<ver>` ·
   `Workspace: Initialized | Not initialized` (null → a "—"/"not found" marker,
   never drop a line). Re-renders off the same `StateManager`.
5. **`.../features/overview/OverviewView.tsx`** — `envMeta()` "all available"
   branch += `tan`: `Python x · west y · tan z`. "Missing:" branch unchanged
   (tan not a gate). (Also gains the SDK section + subtitle rename in Part C.)

### Part B — sidebar

6. **`.../features/sidebar-hub/SidebarHubView.tsx`**
   - Remove the five Setup `StatusRow`s.
   - Setup section: `ActionRow` "Hub" (`alp.openHub`, always) + `ActionRow`
     "Finish setup" (`alp.openSetupFlow`, only when NOT ready).
   - Drop unused `toolsReady` / `setup` destructure (tsc `noUnused*` flags).
     `sdkValue` stays (SDK Manager section row still uses it).
   - The "SDK Manager" section's "Manage SDKs" action + status row keep
     `alp.openSdkManager` (now → the Hub's SDK section). No structural change.
   - Reuse one shared readiness helper so sidebar + status bar agree (or keep an
     identical inline expression).

### Part C — Hub rename + SDK Manager fold

7. **`src/ideHub/sdkManagerMessages.ts`** (new) — extract the SDK message
   handlers currently in `SdkManagerPanel`: `selectSdkPath`,
   `requestSdkReleases`, `requestSdkInstall`, `switchSdk`, `uninstallSdk`,
   `deactivateSdk`. Shape them as functions taking `(context, webview, refresh)`
   so `OverviewPanel` can delegate. **⚠️ Data-loss path:** `uninstallSdk` does
   `fs.rmSync(target, { recursive: true, force: true })`. The modal warning
   confirm, the Alp-managed-vs-external path check, and the active-pointer clear
   must move **verbatim** — no behavior change, no dropped confirmation.
8. **`src/ideHub/overviewPanel.ts`** — `handleMessage` gains the six SDK message
   cases, delegating to `sdkManagerMessages`. `open(context, focus?)` gains an
   optional focus hint; when `focus === "sdk"`, post a message so the webview
   scrolls to the SDK section (best-effort). Existing reactivity already covers
   the `alpSdk` config + view-state refresh SdkManagerPanel had.
9. **`src/ideHub/sdkManagerPanel.ts`** — **retire.** Remove the class + its
   `index.ts` export. (`test/e2e` refs, if any, updated.)
10. **`src/extension.ts`** — register `alp.openHub` → `OverviewPanel.open`;
    keep `alp.openOverview` as a deprecated alias → same handler. Re-point
    `alp.openSdkManager` → `OverviewPanel.open(context, "sdk")`. Drop the
    `SdkManagerPanel` import.
11. **`.../features/overview/OverviewView.tsx`** — render `<SdkView>` (or its
    inner list/install components) as a new "SDK Manager" section with an anchor
    the focus-scroll targets. Page subtitle "Overview" → "Hub".
12. **`src/ideHub/webviewHtml.ts`** — the `runCommand` allowlist references
    `alp.openOverview` (line ~89); add `alp.openHub` (keep the old id if the
    alias stays).
13. **`package.json`** — `contributes.commands` title for the Hub command
    ("Alp: Open Overview" → "Alp: Open Hub"), command id → `alp.openHub`;
    walkthrough steps / any `command:alp.openOverview` links updated. Keep the
    alias command declared or mark it hidden.
14. **`src/views/setup.ts`** (dead tree provider, e2e-only) — update the
    `alp.openOverview` ref for consistency if the e2e suite exercises it.

## Testing

- Node-native (`node --test`); `pnpm run compile` first.
- Pure seams to unit-test: `envMeta` (tan present/absent), and a status-bar
  presentation helper if extracted (all-ready / missing python / missing west /
  tan present vs null).
- Webview render (`test/webview/ui-render.tsx`): Setup section shows no status
  dots; "Finish setup" toggles on readiness; the Hub renders the SDK Manager
  section.
- SDK message handlers: keep any existing SdkManagerPanel coverage green after
  the extract; the `uninstallSdk` confirm + managed-path branches must retain
  their tests (or gain them) given the data-loss risk.
- Golden snapshots (`test/golden/*`) stay deterministic.

## Acceptance criteria

1. Sidebar Setup section: no status dots — only "Hub" and (when not ready)
   "Finish setup".
2. Status bar: `$(check) Alp` / `$(warning) Alp: setup`; click opens the Hub;
   tooltip lists Python/west/tan/SDK/Workspace verbatim.
3. `tan` version shows in the tooltip and the Hub Environment card when present;
   "managed"/"—" when absent. State refresh triggers **no** `tan` download.
4. `alp.openHub` opens the renamed Hub; `alp.openOverview` still works (alias).
5. `alp.openSdkManager` opens the Hub focused on the SDK section; the standalone
   SDK Manager panel no longer exists.
6. SDK install / switch / uninstall / deactivate all work from the Hub section,
   with the uninstall modal confirm intact (no unconfirmed disk delete).
7. Readiness gate unchanged (tan not gating).
8. Full local gate set green (`pnpm test`, `pnpm run compile`, package path).

## Rollout

- One feature branch off `dev` (`feat/status-out-of-sidebar`), never committing
  to `dev` directly.
- Implementation fans out to file-disjoint batches (Part A / Part B / Part C)
  across alp-implementor, each with an alp-reviewer pass. Part C (panel fold +
  data-loss path) is the highest-stakes batch — review focus there.
