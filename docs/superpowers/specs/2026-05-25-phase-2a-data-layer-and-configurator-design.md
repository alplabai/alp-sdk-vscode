# Design: Phase 2a — SKU-aware data layer + redesigned configurator

**Date:** 2026-05-25
**Status:** Draft (pending review)
**Roadmap:** Phase 2a of `2026-05-24-alp-studio-roadmap.md`.
**Branding:** Use **"Alp"**, never "ALP", in all text strings.

## Problem

Two gaps make the current configurator weak:

1. **The data layer is wrong.** `src/configurator/vscodeAdapter.ts` reads SoM SKUs from
   `e1m_modules/<sku>/som.yaml` and carriers from `metadata/carriers/<name>/board.yaml`,
   but the real alp-sdk has flat `e1m_modules/E1M-*.yaml` files and
   `metadata/boards/*.yaml`. Result: empty dropdowns even with an SDK checkout. It also
   does not read the SKU's silicon-determined settings at all.
2. **The UI is a flat, generic form** that lets the user pick `inference.backend` — but
   v0.6 made the backend **silicon-fixed** (derived from the SoM), so the picker is wrong.

## Goals

- Parse the **real** alp-sdk metadata into a rich, unit-tested model.
- Make the configurator **SKU-driven**: choosing a SoM derives the backend (read-only),
  a hardware summary, accelerator availability, and the default board.
- Restyle the configurator to **match alplab-website** (Indigo-dark tokens, Inter/Roboto
  Mono, hairline header with the real white wordmark, left sidebar + search, brand CTA).
- Fix the `package.json` `yamlValidation` schema path to the real schema.

## Non-goals (later phases)

- The eight developer tools (hardware/pin-route explorer, serial monitor, memory report,
  topology build, toolchain status, probe manager, generated-config viewer, docs links)
  — Phases 2b/2c/3.
- The visual peripheral/`populated` map — Phase 4.
- Multi-core build orchestration — Phase 3.

## Pre-work (confirm before coding — no guessing)

- Read `metadata/schemas/board.schema.json` (real schema) to confirm the **current
  customer field set** of `board.yaml` (esp. whether `inference.backend` /
  `inference.default_arena_kib` are still customer fields). The UI must match the schema,
  not the extension's stale `BoardModel`.
- Read one `metadata/socs/<vendor>/<family>/<part>.json` to see whether cores/memory are
  structured (for the hardware card). If present, surface them; if not, the card shows
  silicon id + derived fields only (no invented core counts).

---

## Part 1 — SKU-aware data layer

Lives in `@alp-sdk/core` (pure, no `fs`/`vscode`) + a thin `vscode`/`fs` adapter, matching
the repo's existing core/adapter split. Pure parsers are unit-tested with `node --test`.

### Model types (`packages/alp-core/src/sdkCatalogue/models.ts`)

```
interface SomPreset {
  sku: string;
  displayName: string;
  family: string;                 // alif-ensemble | nxp-imx9 | renesas-rzv2n | …
  silicon: string;                // e.g. "alif:ensemble:e7"
  siliconVariant?: string;
  preferredBackend: string;       // ethos_u | drpai | deepx_dxm1 | cpu  (silicon-fixed)
  capabilities: Record<string, boolean>;  // deepx_dx, optiga_trust_m, tmu_*, …
  defaultBoard?: string;          // e.g. "E1M-EVK"
  onModule: string[];             // chip ids present on the module (keys of on_module)
  memory?: { dramMbit?: number; flashMbit?: number };
  preliminary: boolean;           // status.preliminary
}

interface BoardPreset {
  name: string;
  displayName: string;
  hostsSomFamilies: string[];     // constrains which SoMs may use this carrier
  populated: Record<string, boolean>;
}

interface ChipDef {               // from metadata/chips/<id>.yaml (71 of them)
  chipId: string;                 // e.g. "lsm6dso"  → carrier.populated key
  displayName: string;            // "STMicroelectronics LSM6DSO 6-axis IMU"
  vendor?: string;                // st | deepx | …
  bus?: string;                   // i2c | spi | pcie + i2c | …
  driverStatus?: string;          // full | partial | untested  (maturity badge)
  families: string[];             // aen | v2n | v2n-m1 | …  (which SoMs support it)
  kconfig?: { zephyr?: string; baremetal?: string };  // CONFIG flipped when enabled
}

interface LibraryProfile {        // from metadata/library-profiles/<id>/
  id: string;                     // dir name → board.yaml libraries[] entry
  displayName?: string;           // if a manifest provides one; else prettified id
}

interface SdkCatalogue {
  soms: SomPreset[];              // sorted by sku
  boards: BoardPreset[];          // sorted by name
  chips: ChipDef[];               // sorted by chipId
  libraries: LibraryProfile[];    // sorted by id
  sdkVersion?: string;            // metadata/sdk_version.yaml `version` (compat banner)
}
```

**Library id canonicalization (confirm, don't guess):** profile dirs use hyphens
(`cmsis-dsp`) while `board.yaml` examples use underscores (`cmsis_dsp`). During pre-work,
confirm the canonical form against `board.schema.json` / a real `libraries:` example and
normalize one way in `parse`.

### Pure parsers (`packages/alp-core/src/sdkCatalogue/parse.ts`)

- `parseSomPreset(yamlText): SomPreset` — maps the SoM yaml fields above; missing/`TBD`
  values become `undefined`/empty (never invented).
- `parseBoardPreset(yamlText): BoardPreset`.
- `parseChipDef(yamlText): ChipDef` — maps chip_id/display_name/vendor/bus/driver_status/
  families/kconfig.
- `boardsForSom(catalogue, sku): BoardPreset[]` — filter boards whose `hostsSomFamilies`
  includes the SoM's `family`.
- `chipsForSom(catalogue, sku): ChipDef[]` — filter chips whose `families` includes the
  SoM's family (e.g. `lsm6dso` → aen/v2n/v2n-m1).
- `chipDefaults(board): Record<string, boolean>` — the board preset's `populated` map =
  default enable state; the configurator writes only user **overrides** to
  `carrier.populated` (diff vs. this default).
- `acceleratorAvailability(som): { id: string; label: string; available: boolean }[]`
  — derived purely: the `preferredBackend` is available; `deepx_dxm1` available iff
  `capabilities.deepx_dx === true`; CPU fallback always available. (This encodes
  "AEN has no DeepX".)

### vscode/fs adapter (`src/sdkCatalogue/vscodeAdapter.ts`)

- `loadSdkCatalogue(sdkRoot): SdkCatalogue`
  - SoMs: read **flat** files `metadata/e1m_modules/E1M-*.yaml` (glob the `E1M-*.yaml`
    pattern; ignore subdirs and `README.md`), `parseSomPreset` each.
  - Boards: read `metadata/boards/*.yaml`, `parseBoardPreset` each.
  - Chips: read `metadata/chips/*.yaml` (71 files), `parseChipDef` each.
  - Libraries: list `metadata/library-profiles/*/` directories (skip `README.md`) → ids.
  - Version: read `metadata/sdk_version.yaml` `version`.
  - Returns empty arrays (not throw) when `sdkRoot` is null or dirs are missing; logs via
    `util.log` (mirrors existing adapters). A single malformed file is logged and skipped.

### Replace the old loader

`loadPresetCatalogue` in `src/configurator/vscodeAdapter.ts` is rewritten to build the
init payload from `loadSdkCatalogue` (or a thin compatibility shim is kept that maps the
new model onto the existing `PresetCatalogue` shape plus the new derived fields). The old
`loadSomSkus`/`loadCarrierPresets` (wrong paths) are removed.

### package.json schema fix

`contributes.yamlValidation[0].url` → the real schema. Since the schema lives in the SDK
checkout (`metadata/schemas/board.schema.json`), and the in-repo `alp-sdk-upstream/` is
empty, the implementer will either (a) point at a vendored copy committed under the
extension, or (b) register the schema dynamically from the resolved `sdkRoot` via the
YAML extension API. **Decision to confirm in review:** vendor a copy (simplest, offline)
vs. dynamic from sdkRoot. Default: **vendor a copy** at `schemas/board.schema.json` and
point `yamlValidation` there.

### Testing (data layer)

`node --test` against committed fixtures (copied real yamls) under `test/fixtures/sdk/`:
- `parseSomPreset` extracts sku/family/silicon/preferredBackend/capabilities/defaultBoard
  for an AEN, a V2N, and a V2M fixture; `TBD` memory → undefined.
- `acceleratorAvailability`: AEN → ethos_u available, deepx **not** available; V2M →
  deepx available.
- `boardsForSom`: an alif-ensemble SoM yields E1M-EVK; filters out boards whose
  `hostsSomFamilies` excludes it.
- `parseBoardPreset` extracts `populated` + `hostsSomFamilies`.
- `parseChipDef` extracts chipId/displayName/vendor/bus/driverStatus/families/kconfig
  (lsm6dso fixture).
- `chipsForSom`: lsm6dso appears for an aen SoM; a v2n-only chip is excluded for an aen
  SoM. `chipDefaults` returns the board's `populated` map.

---

## Part 2 — Redesigned configurator (SKU-driven, site-styled)

Reworks the existing webview (`packages/alp-core/src/configurator/panelHtml.ts`,
`media/configurator.css`, `media/configurator.js`, `src/configuratorPanel.ts`) — keep the
message-passing architecture and the save/validate/preview behavior; replace the layout
and styling, and make it SKU-driven.

### Visual system (from `alplab-website/src/styles/tokens.css`, default Indigo-dark)

- Tokens copied into the webview CSS: `--bg-base #06070d`, `--bg-surface #0f1424`,
  `--bg-elev #161b2e`, `--border-line #2a2f36`, text primary/muted/fade, accents
  cpu/npu/flux/brand(+hi), ok/warn/err, easing `cubic-bezier(0.2,0.8,0.2,1)`.
- Fonts **Inter** + **Roboto Mono**. Bundle the variable woff2 from the website
  (`public/fonts/{inter,roboto-mono}`) into `media/fonts/` and `@font-face` them (webview
  CSP `font-src ${cspSource}`), with system fallbacks.
- Header matches the site TopNav: `background: rgba(6,7,13,.85); backdrop-filter: blur;
  border-bottom: 1px solid var(--border-line)`. Use the **real white wordmark**
  (`alplab-logo-white.svg`, embedded/asset) **as-is — never recolor it**. Title text
  "Board Configurator" (note: "Alp", not "ALP").
- 5px radii, mono-uppercase `§` section labels, brand-indigo primary CTA
  (`Save board.yaml`), accent-npu focus ring (`0 0 0 3px rgba(125,211,252,.16)`).

### Layout

- **Left sidebar** (confirmed direction) with search field + two groups:
  - **§ Configure:** Project & Hardware · Compute · Connectivity · Libraries ·
    Diagnostics · Review. (Peripheral map + the dev-tool rail are later phases — the
    sidebar is built to accept additional groups.)
  - The dev-tools group is **out of scope here** but the sidebar component must support
    multiple labeled groups so 2b can add it without restructuring.
- Search filters the visible settings/sections (client-side over labels).
- Footer: validation summary (✓/errors/warnings, from existing
  `createWizardValidationSummary`) + `Preview effective config` · `Reload` · `Save board.yaml`.

### SKU-driven behavior (the core change)

The init payload gains the new catalogue + derived data. When the SoM `<select>` changes:

- **Backend is derived & read-only** — no free picker. Show the SoM's `preferredBackend`
  as a labeled, non-editable value ("derived from SoM").
- **Hardware card** renders from the `SomPreset`: silicon, derived backend, default board,
  on-module chips, and an **accelerator availability** row from `acceleratorAvailability`
  (lit = available; struck-through = absent — DeepX struck through for AEN/NX/V2N).
- **Carrier list** is filtered by `boardsForSom`; default selection = the SoM's
  `defaultBoard` when the current value isn't valid for the new SoM.
- Cores/memory shown **only if** resolved from the socs spec / present fields (no invented
  values; degrade to silicon id).

### Libraries & chips (sourced from the SDK, user enable/disable)

Both lists come from the catalogue, **not hardcoded**:

- **Libraries** section — a searchable checklist of every `library-profiles/` entry
  (~25, e.g. etl, fmt, cmsis-dsp, lvgl, mbedtls, tflite_micro, nanopb, modbus, …). A
  checked library is present in `board.yaml` `libraries:[]`. Saved list stays sorted +
  de-duped (existing behavior).
- **Chips** section — the chips applicable to the selected SoM (`chipsForSom`), each with
  an enable/disable toggle, a `driver_status` maturity badge (full / partial / untested)
  and vendor·bus metadata. The **default** state is the selected board preset's
  `populated` (`chipDefaults`); a toggle that differs from the default is written to
  `carrier.populated{<chipId>}`, and toggles matching the default are omitted (existing
  normalization). Searchable; the list re-filters when the SoM changes (a chip not in the
  new SoM's families disappears).

This makes the Compute/Connectivity/Libraries/Peripherals sidebar sections concrete and
SDK-driven rather than fixed dropdowns.

### Message protocol

Extend `ConfiguratorInitPayload` (`@alp-sdk/core/configurator/models`) with the richer
catalogue (or add a parallel `sdk: SdkCatalogue` field). `BoardModel` save path is
unchanged except the UI no longer writes `inference.backend` (pending the
`board.schema.json` confirmation in pre-work — if the schema still permits it for
back-compat, preserve any existing value on load but don't expose an editor for it).

### Files

- Create `packages/alp-core/src/sdkCatalogue/{models.ts,parse.ts}` (pure).
- Create `src/sdkCatalogue/vscodeAdapter.ts` (fs).
- Modify `src/configurator/vscodeAdapter.ts` (use the new loader; drop wrong-path code).
- Modify `packages/alp-core/src/configurator/{models.ts,panelHtml.ts}` (init payload +
  new markup), `media/configurator.css` (site tokens + layout), `media/configurator.js`
  (SKU-driven rendering, search, derived backend), `src/configuratorPanel.ts` (feed the
  richer payload).
- Add `media/fonts/*` (Inter + Roboto Mono woff2) and `media/alplab-logo-white.svg`.
- Modify `package.json` `yamlValidation` → vendored `schemas/board.schema.json`.
- Tests: `test/sdkCatalogue.parse.test.js`, `test/sdkCatalogue.vscodeAdapter.test.js`
  (+ fixtures under `test/fixtures/sdk/`).

## Architecture / data flow

```
alp-sdk checkout (sdkRoot, from alpSdk.path or workspace autodetect)
  └─ metadata/e1m_modules/E1M-*.yaml ─ parseSomPreset ─┐
  └─ metadata/boards/*.yaml         ─ parseBoardPreset ┤→ SdkCatalogue
                                                        │
configuratorPanel → init payload {BoardModel, SdkCatalogue, derived} → webview
  webview: SoM <select> change → derive backend/card/accelerators/carriers (pure JS
           over the payload) → user edits → Save → BoardModel → existing save path
```

## Error handling

- No `sdkRoot` resolved → empty catalogue → the configurator shows a clear
  "Connect your alp-sdk (set `alpSdk.path`)" state instead of empty dropdowns.
- Malformed/`TBD` SoM fields → parsed as undefined; the card omits those rows (never
  invents). A SoM that fails to parse is logged and skipped, not fatal.

## Testing

- Pure parsers + derivations: `node --test` with fixtures (above).
- Manual (dev host) against the real `C:\Users\caner\Documents\GitHub\alp-sdk` via
  `alpSdk.path`: dropdowns populate with 11 SKUs; selecting AEN vs V2M flips the derived
  backend and the DeepX availability; carrier list filters by family; styling matches the
  site.
