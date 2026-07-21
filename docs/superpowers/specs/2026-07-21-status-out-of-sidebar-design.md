# Status out of the sidebar — design

**Date:** 2026-07-21
**Repo:** alp-sdk-vscode
**Status:** approved (brainstorm), pending implementation plan

## Problem

The sidebar hub's "Setup" section (`SidebarHubView.tsx`) renders five
`StatusRow`s — Host Tools, Python, West, Alp SDK, Workspace — that are
read-out state, not actions. This makes the action-oriented sidebar read as a
status dashboard, and duplicates state shown elsewhere:

- **Alp SDK** row duplicates the "SDK Manager" section's own status row.
- **Workspace** row duplicates the "Workspace" section's status row.
- The whole set duplicates the full-width Overview page's three status cards
  (Environment / Workspace / Alp SDK).

Separately, the readouts track `python` and `west` but **not `tan`**, even
though `tan` is the actual build executor now (ADR-0020: tan is the sole
executor + whole user command surface). `west` is still required — only
`west update` (Zephyr manifest/module fetch) and `west flash` (vanilla flash)
still shell west directly, and `.west` init is the workspace-ready milestone —
so both `west` and `tan` should be surfaced.

## Goals

1. Remove the five status read-outs from the sidebar's Setup section.
2. Move that readiness state to (a) a new compact VS Code status-bar item
   (glance + tooltip) and (b) the existing full-width Overview page (detail).
3. Surface `tan` alongside `west` everywhere `west` is shown.
4. Preserve the sidebar's first-run repair entry point without a status dot.

## Non-goals / out of scope (tracked separately)

- West Update rendered twice in the sidebar (Workspace section + Build & Flash
  `BUILD_ACTIONS`).
- `alp.bootstrap` vs `alp.installDependencies` — two command ids, one handler,
  asymmetric `lastBootstrapAt` stamping.

Both recorded in the `sidebar-dedup-followups` memory. Not touched here.

- The "Workspace" and "SDK Manager" section status rows **stay** (they are the
  section's own contextual header, not the Setup dashboard).
- `tan` does **not** become a readiness gate (see Decisions).

## Decisions

- **Destination:** status bar + Overview (not a condensed sidebar line, not
  Overview-only).
- **Scope:** strip only the five Setup rows; keep the two contextual rows.
- **First-run:** Setup section keeps the always-visible `Overview` action and
  gains a single conditional `Finish setup` action (visible only when env not
  ready) → `alp.openSetupFlow`. No status dots.
- **`tan` gating:** shown as info (version, or "managed"), not a hard readiness
  gate — it is managed/auto-downloaded on demand, so gating on it would show
  "setup needed" even when a build would fetch it itself. `west` **stays** a
  gate (`.west` init + not auto-fetched).
- **Readiness = ** `pythonAvailable && westAvailable && sdk.readiness ===
  "ready" && workspace.westInitialized` (unchanged from `OverviewView`'s
  `isAllReady`).

## Changes (6 files)

### 1. `src/ideHub/messages.ts`
- `ToolVersions` gains `tan: string | null`.
- `emptyAlpIdeState()` default `toolVersions` gains `tan: null`.
- `PROTOCOL_VERSION` — additive optional-read field; bump only if the webview
  mirror would break on the old shape. It reads `toolVersions.tan` defensively
  (`?? null`), so **no bump required**; confirm during implementation.

### 2. `packages/alp-webview/src/types.ts`
- Mirror `tan: string | null` on the `ToolVersions` type (manual sync per
  CLAUDE.md — the protocol is hand-mirrored).

### 3. `src/ideHub/vscodeAdapter.ts`
- Collect `tan` version into `toolVersions.tan`.
- **Hard constraint — no-download probe.** State refresh runs on window focus /
  save / settings edit; it must NEVER trigger a `tan` network download. Reuse
  the presence check from `ensureTanCliProvisioned`: build the resolve input
  (`buildResolveDeps` → `cliPathSetting/onPath/bundled/local/cached`) and if
  `decideBinarySource(input) === "download"`, set `tan: null` and stop — do not
  resolve, do not fetch.
- When a binary is already present, run `<resolvedPath> --version` and parse the
  **native** version with the alpCli service's native-version extractor (a
  non-native `tan` on PATH must not be misread as the real CLI). Fold this probe
  into the existing `Promise.all` batch alongside python/west/cmake/ninja.
- A small no-download resolve helper may be needed (return the resolved command
  path when source !== "download", else null); keep it in `src/alpCli/`.

### 4. `src/statusBar.ts`
- Add a fifth left-aligned `StatusBarItem`, priority `102` (leftmost of the Alp
  group, reads first).
- Text: `$(check) Alp` when ready; `$(warning) Alp: setup` otherwise, where
  "ready" is the readiness expression above.
- `command = "alp.openOverview"`.
- Tooltip (multi-line, verbatim detail — this is where the removed rows' data
  lands): `Python <ver>` · `west <ver>` · `tan <ver | "managed">` ·
  `Alp SDK v<ver>` · `Workspace: Initialized | Not initialized`. Use `null` →
  a "not found" / "—" marker, don't drop the line.
- Always visible; re-renders off the same `StateManager` as the other four
  items (never disagrees).

### 5. `packages/alp-webview/src/features/sidebar-hub/SidebarHubView.tsx`
- Remove the five `StatusRow`s in the Setup section (Host Tools, Python, West,
  Alp SDK, Workspace).
- Setup section becomes: `ActionRow` "Overview" (always) + `ActionRow`
  "Finish setup" (`alp.openSetupFlow`) rendered only when NOT ready.
- Drop the now-unused `toolsReady` local and the `setup` destructure if it
  becomes unused (tsc `noUnused*` will flag). `sdkValue` stays (used by the SDK
  Manager section row).
- Readiness for the conditional: reuse the same expression (python + west + sdk
  ready + westInitialized). Consider a shared helper so sidebar and status bar
  agree; a duplicated inline expression is acceptable if kept identical.

### 6. `packages/alp-webview/src/features/overview/OverviewView.tsx`
- `envMeta()` includes `tan` in the "all available" branch:
  `Python x · west y · tan z`. Keep the "Missing: …" branch as-is (tan is not a
  gate, so it never appears in "missing").

## Testing

- Node-native tests (`node --test`), no framework. `pnpm run compile` first.
- **`envMeta` / status-bar presentation** are the pure/testable seams. If a
  status-bar presentation helper is extracted (mirroring
  `createStatusBarPresentation` for the board target), unit-test its text +
  tooltip for: all-ready, missing python, missing west, tan present vs null.
- Webview render: the existing headless UI render (`test/webview/ui-render.tsx`)
  should show the Setup section with no status dots and the conditional
  "Finish setup" row toggling on readiness.
- Keep `test/golden/*` deterministic — no loader-plan drift from this change.

## Acceptance criteria

1. Sidebar Setup section shows no status dots / version read-outs — only
   "Overview" and (when not ready) "Finish setup".
2. Status bar shows `$(check) Alp` / `$(warning) Alp: setup`; clicking opens the
   Overview; tooltip lists Python/west/tan/SDK/Workspace verbatim.
3. `tan` version appears in the status-bar tooltip and the Overview Environment
   card when a `tan` binary is present; shows "managed"/"—" when absent.
4. State refresh triggers **no** `tan` download (verified: focus/save with no
   local tan does not hit the network).
5. Full local gate set green: `pnpm test` + `pnpm run compile` +
   `pnpm run package` path. (Run `bash scripts/test-all.sh` equivalent gates for
   this repo before PR.)
6. Readiness gate unchanged (tan not gating).

## Rollout

- One PR, feature branch off `dev` (per repo convention — never commit to `dev`
  directly on first commit).
- Reviewer pass (alp-reviewer): CLI-envelope-contract lens N/A (no envelope
  change); focus on the no-download probe and the manual protocol mirror sync.
