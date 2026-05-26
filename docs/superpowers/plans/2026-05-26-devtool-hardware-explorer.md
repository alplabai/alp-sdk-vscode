# Dev Tool: Hardware & Pin-Route Explorer Implementation Plan

> **For agentic workers:** subagent-driven for the testable data layer; the webview is built + verified via headless capture (no jsdom).

**Goal:** A read-only "Hardware explorer" panel for the selected SoM — cores (from the SoC spec), on-module chips, the **pad-route table** (E1M pad → dispatch chip/pin), and the on-module **I2C device map** — opened via `Alp: Open hardware explorer`.

**Architecture:** Extend the pure catalogue parser to capture `pad_routes` + `i2c_devices` (TDD). A Node panel resolves `{ SomPreset (with routes/i2c), cores from SocSpec }` and posts it to a thin webview that renders searchable tables, reusing `media/configurator.css` tokens. Lives on branch `feat/dev-tools`.

**Tech Stack:** TS + `node:test` for the parser; vanilla webview. Build `pnpm run compile`.

## Verified data shapes (alp-sdk)
- `pad_routes: [{ e1m, dispatch, dispatch_pin?, doc? }]`
- `on_module.i2c_devices: { <bus>: { bus_master, devices: [{ chip, role?, address_7bit?, assembled? }] } }`

## Tasks

### Task 1 — Extend the catalogue parser (TDD)
**Files:** `packages/alp-core/src/sdkCatalogue/models.ts`, `parse.ts`; `test/sdkCatalogue.parse.test.js`.
- Add types `PadRoute { e1m; dispatch; dispatchPin?; doc? }`, `I2cDevice { bus; chip; role?; address? }`.
- Add to `SomPreset`: `padRoutes: PadRoute[]`, `i2cDevices: I2cDevice[]`.
- `parseSomPreset` maps `d.pad_routes` (skip entries without `e1m`) and flattens `on_module.i2c_devices.<bus>.devices` (carrying the bus name + `address_7bit`→`address`).
- Tests: an AEN fixture (cc3501e pad routes) yields padRoutes with `dispatch:"cc3501e"`; a V2N fixture yields i2cDevices incl. `{bus:"brd_i2c",chip:"rv3028c7",role:"rtc",address:"0x52"}`.

### Task 2 — Explorer panel + webview + command
**Files:** create `packages/alp-core/src/devtools/hardwareExplorerHtml.ts` (shell), `media/hardwareExplorer.js` (renderer), `media/hardwareExplorer.css` (or reuse configurator.css tokens via a shared file); create `src/hardwareExplorerPanel.ts`; register `alp.openHardwareExplorer` in `src/extension.ts` + `package.json` `contributes.commands`.
- Panel: resolve current board's `som.sku` (via `collectProjectContext` + `loadBoardConfigFromFile`) or default; load catalogue; find the `SomPreset`; resolve cores from the `SocSpec` whose `ref===silicon`; post `{ som, cores }`.
- Webview: header (reuse wordmark + chrome), sections — **Compute** (cores table), **On-module** (chips), **Pad routes** (searchable table: pad · dispatch · pin · doc), **I2C devices** (table: bus · chip · role · address). Empty state when no SDK/SoM.
- Verify via headless capture with a mock `{som, cores}`.

## Notes
- Reuse the site tokens; this is a read-only reference (no edits → no save).
- No Claude trailer in commits.
