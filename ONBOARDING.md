# Alp Studio (alp-sdk-vscode) — Status & Handoff

A VS Code extension ("Alp Studio") that gives first-class IDE support for the **Alp SDK**:
a v0.6 `board.yaml` configurator plus a set of developer tools, styled to match the alplab
website. This doc is the handoff: where things are, what's done, what's next, and how to continue.

_Last updated: 2026-05-26._

---

## 1. How the project is built (read this first)

- **Monorepo, pnpm workspace.** Three layers:
  - `@alp-sdk/core` — **pure, unit-tested logic**. Source `packages/alp-core/src/**`, compiles to
    `packages/alp-core/dist/**`. Imported as `@alp-sdk/core/<area>/<file>` (no `.js`). No `vscode` import.
  - `packages/alp-cli` — the `alp` CLI (`bin` → `packages/alp-cli/dist/cli/main.js`).
  - **The extension** — `src/**` → `out/**`. Thin VS Code adapters + webview renderers.
- **Architecture rule:** hard logic lives in `@alp-sdk/core` and is unit-tested; VS Code adapters are
  thin glue; webviews (`media/*.js`) are dumb renderers of a tested view-model. Keep new logic in core.
- **Build:** `pnpm run compile` (`tsc --build` + the alp-cli compile). Run it before tests.
- **Test:** `pnpm run compile && node --test test/*.test.js`. Tests are `node:test` + `node:assert/strict`,
  importing the compiled `dist`/`out`. **Suite is currently 185/185 green and cross-platform (Win + Linux).**
- **The SDK catalogue** (SoMs/boards/chips/libraries/socs) is read **at runtime** from a separate
  `alp-sdk` checkout via the `alpSdk.path` setting. Without it the UI shows "NOT CONNECTED".

## 2. Conventions (please keep)

- Brand string is **"Alp"**, never all-caps "ALP", in every user-facing string.
- **No `Co-Authored-By` / "Generated with" trailers** on commits or PRs.
- Webviews can't be unit-tested (no jsdom) and the dev host has been flaky — verify hard logic in core
  unit tests; verify UI by pressing **F5** (Extension Development Host) or a headless render harness.
- Design: match the alplab website tokens; show only *relevant/available* options; searchable selectors
  for big lists; brand⇄Editor theme toggle; reuse existing VS Code extensions for hardware-dependent tools.

## 3. Workflow we use (superpowers)

Each feature is its own cycle: **brainstorm → spec → plan → build**.
- Specs live in `docs/superpowers/specs/YYYY-MM-DD-<topic>-design.md`.
- Plans live in `docs/superpowers/plans/YYYY-MM-DD-<feature>.md` (bite-sized TDD tasks).
- Build follows the plan task-by-task (TDD, frequent commits, review between tasks).
- The auto-connect SDK spec + plan are good **worked examples** to copy the format from:
  - `docs/superpowers/specs/2026-05-26-auto-connect-sdk-design.md`
  - `docs/superpowers/plans/2026-05-26-auto-connect-sdk.md`

## 4. Branches

- **`main`** — the complete v0.6 **board configurator**.
- **`feat/dev-tools`** — everything below, 30+ commits ahead of main, **all tests green (193/193), pushed to origin.**
  Kept separate until live dev-host testing is signed off.

## 5. What's DONE

On `main`:
- ✅ v0.6 **board configurator** (SKU-driven, per-core config, validation, save/load).

On `feat/dev-tools`:
- ✅ **Auto-connect SDK** — `Alp: Connect SDK` command: detects a local `alp-sdk` checkout (sibling/common
  dev roots) or clones the public `alplabai/alp-sdk`, sets `alpSdk.path` (Global). Surfaces via a project-view
  node, the configurator's NOT-CONNECTED button, and a one-time activation prompt.
  Key files: `packages/alp-core/src/sdkConnect/detect.ts` (pure), `src/sdkConnect/index.ts` (adapter).
- ✅ **Hardware explorer + Topology**, **SDK status**, **SoM docs** commands.
- ✅ Theme toggle fix (instant) + smaller activity-bar bolt icon.
- ✅ Test suite repaired & made cross-platform (was ~15 files broken by the npm→pnpm migration + Windows
  path separators + stale v0.6 expectations). Now 193/193.
- ✅ **Build/flash/debug ergonomics** — `west build` runs via the VS Code Task API with a contributed
  `$alp-west` problem matcher (errors → Problems panel); status-bar Build/Flash buttons; remembered build
  target (`Alp: Set build target`); `Alp: Generate .vscode/tasks.json`. Specs/plans dated 2026-05-26.
- ✅ **Toolchain bootstrap + doctor** — `Alp: Toolchain doctor` probes the Zephyr build toolchain
  (python/west/cmake/ninja/dtc/gdb + Zephyr SDK env + python deps + alp CLI), reports it in the output
  channel **and** a webview panel with per-row non-destructive Fix actions. Pure analyzer/plan in
  `@alp-sdk/core/toolchain/*` (tested); `bootstrap.ts` + `sdkStatus.ts` refactored onto the shared core.
- ✅ **Onboarding — New board.yaml from SKU** — `Alp: New board.yaml from SKU` picks a SoM (catalogue
  QuickPick or input fallback), derives core ids, and writes a **valid v0.6** `board.yaml` (first core
  Zephyr, rest off), opens it, offers the configurator. Pure `buildStarterBoardConfig` in
  `@alp-sdk/core/board/starter.ts` (validated by `validateBoardConfig`).
  **Finding:** the legacy `Alp: New project wizard` (`src/wizard.ts`) still uses the **pre-v0.6 BoardModel**
  (carrier/os/iot) and emits a non-v0.6 board.yaml — recommend modernizing or retiring it (not done here).

## 6. What's PENDING (pick up here)

All three chosen "developer speedup" areas are now done. Remaining queued tools — most need real
hardware/a build to verify, so do them when you can test on a board. **Two are NOT hardware-dependent**
and are good next pick-ups:
- ⬜ **Generated-config viewer + diff** (not hardware-dependent) — view/diff the generated `alp.conf` /
  `alp.overlay` / `alp-cmake-args.txt` against the current board.yaml. Pure diff logic is testable.
- ⬜ **Peripheral map** (catalogue-driven, not hardware-dependent) — visualize pad routes / pin usage.
- ⬜ Serial monitor / probe delegation (reuse `ms-vscode.vscode-serial-monitor` / `marus25.cortex-debug`),
  memory-flash report — need a device / build artifact to verify.

## 7. One open verification item

A **live dev-host check** of the auto-connect flow hasn't been signed off yet (it's the one thing automated
tests can't cover): press F5, unset `alpSdk.path`, run **Alp: Connect SDK**, confirm it finds the local
`alp-sdk` checkout and the configurator flips to CONNECTED. Theme toggle should apply on first click; bolt
icon should look a bit smaller.

## 8. To continue (suggested first move)

1. `git checkout feat/dev-tools && pnpm install && pnpm run compile && node --test test/*.test.js` (expect 185/185).
2. Press F5 to launch the Extension Development Host; do the §7 live check.
3. Start the next feature with a brainstorm → spec → plan, using the auto-connect spec/plan in
   `docs/superpowers/` as the template. Recommended: **Build/flash/debug ergonomics**.
