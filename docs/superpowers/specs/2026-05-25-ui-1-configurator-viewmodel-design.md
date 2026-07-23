# Design: UI-1 — Configurator view-model (pure, tested)

**Date:** 2026-05-25
**Status:** Draft (pending review)
**Roadmap:** First slice of the Phase 2a configurator UI (see
`2026-05-25-phase-2a-data-layer-and-configurator-design.md` Part 3). Architecture
decision: **tested view-model in core + thin renderer.**
**Branding:** "Alp", never "ALP", in any text.

## Problem

The redesigned configurator must be SKU-driven across ~11 v0.6 board.yaml sections. If
that logic lives in the webview's imperative JS it is untestable and grows unwieldy. This
slice extracts the hard logic into one pure, unit-tested function — `ConfiguratorViewModel`
— so the later rendering slices (UI-2/UI-3) are thin and the SKU-driven behavior is
covered by `node --test`. **No webview or UI changes in this slice.**

## Scope

- `buildConfiguratorViewModel(board, catalogue): ConfiguratorViewModel` in
  `@alp-sdk/core/configurator/viewModel.ts` (pure).
- The previously-deferred `chipsForSom` + `chipFamilyForSku` (mapping now verified).
- Unit tests against the real-shape board fixtures + a small catalogue fixture.

Out of scope (later slices): the webview shell/styling, rendering, edit/save,
`boardSummary` realignment, `.scratch` migration.

## Verified facts this relies on

- Chip family token = the `e1m_modules/` subdir grouping, derivable from the SKU prefix:
  `E1M-AEN*→aen`, `E1M-NX9*→imx93`, `E1M-V2N*→v2n`, `E1M-V2M*→v2n-m1`. `deepx_dxm1` lists
  only `v2n-m1` (so DeepX is hidden on AEN/V2N — matches "AEN has no DeepX").
- A SoC's cores live in `catalogue.socs` keyed by `ref` == the SoM's `silicon`
  (e.g. `alif:ensemble:e8`).
- Existing reusable pieces: `acceleratorAvailability`, `boardsForSom`, `chipDefaults`
  (`@alp-sdk/core/sdkCatalogue/derive`); `validateBoardConfig`
  (`@alp-sdk/core/board/validate`); models `BoardConfig`, `SdkCatalogue`, `SomPreset`,
  `BoardPreset`, `ChipDef`, `SocSpec`, `AcceleratorAvail`.

## The view-model

`packages/alp-core/src/configurator/viewModel.ts`. The VM carries only **derived /
SKU-driven** data; the renderer reads raw current values (`board.boot`, `board.ota`,
`board.storage`, `board.security`, `board.ipc`, `board.diagnostics`) directly from
`BoardConfig` (single source of truth — no duplicated section state).

```
interface SomOptionGroup { family: string; soms: { sku: string; displayName: string; preliminary: boolean }[]; }

interface HardwareCard {
  sku: string;
  displayName: string;
  silicon: string;
  cores: { id: string; type: string; count: number; freqMhz?: number }[]; // from SocSpec
  preferredBackend?: string;     // read-only, silicon-fixed
  defaultBoard?: string;
  onModule: string[];
  preliminary: boolean;
}

interface CorePanel {
  id: string;                    // canonical core id (topology ∪ board.cores)
  inheritedFromTopology: boolean;// true when the board doesn't override this core
  os?: string;
  app?: string;
  image?: string;
  peripherals: string[];
  libraries: string[];
  iot: { wifi: boolean; mqtt: boolean; ble: boolean; tls: boolean };
  inferenceArenaKib?: number;
}

interface ChipChoice { chipId: string; displayName: string; vendor?: string; bus?: string; driverStatus?: string; enabled: boolean; }

interface ConfiguratorViewModel {
  sdkConnected: boolean;                       // catalogue.soms non-empty
  som: { selected: string; options: SomOptionGroup[] };
  hardware: HardwareCard | null;               // null when the sku isn't in the catalogue
  accelerators: AcceleratorAvail[];
  boardMode: "preset" | "inline";              // inline when board.populated/e1m_routes present
  carriers: { selected?: string; options: BoardPreset[] };  // boardsForSom
  cores: CorePanel[];
  libraries: string[];                         // catalogue library ids (per-core multiselect source)
  chips: ChipChoice[];                         // chipsForSom, enabled = effective populated state
  projectChips: string[];                      // board.chips (project-wide <alp/chips/..> list)
  validation: ValidationResult;
}
```

### Behavior

- **selectedSku** = `board.som.sku`.
- **sdkConnected** = `catalogue.soms.length > 0`. (Renderer shows a "Set `alpSdk.path`"
  call-to-action instead of empty controls — CX: never a dead empty dropdown.)
- **som.options** = catalogue soms grouped by `family`, preserving catalogue sort.
- **hardware** = for the selected `SomPreset`: copy fields; resolve `cores` from the
  `SocSpec` whose `ref === som.silicon` (empty array if no matching SoC spec — never
  invented). `null` if the sku isn't in the catalogue.
- **accelerators** = `acceleratorAvailability(som)`; `[]` if sku unknown.
- **boardMode** = `"inline"` if `board.populated` or `board.e1m_routes` is set, else
  `"preset"`. **carriers.options** = `boardsForSom(catalogue, sku)`; `selected` =
  `board.preset`.
- **cores** = the union of the SoM's `topologyCoreIds` and `Object.keys(board.cores)`,
  ordered topology-first. For each: if present in `board.cores`, surface its values and
  `inheritedFromTopology=false`; otherwise `inheritedFromTopology=true` with empty/false
  defaults. `iot` flags default to `false`; `peripherals`/`libraries` default to `[]`.
  (CX: the renderer can ghost inherited cores so users see the topology default without
  having to edit it.)
- **libraries** = `catalogue.libraries.map(l => l.id)`.
- **chips** = `chipsForSom(catalogue, sku)` mapped to `ChipChoice`; `enabled` = the
  effective populated state — `chipDefaults(selectedBoardPreset)` overlaid with
  `board.populated` (inline mode) — i.e. the chip is on if the board/preset says so.
  `projectChips` = `board.chips ?? []`.
- **validation** = `validateBoardConfig(board)`.

### New derivations (in `@alp-sdk/core/sdkCatalogue/derive.ts`)

- `chipFamilyForSku(sku: string): string | undefined` — prefix map above.
- `chipsForSom(catalogue, sku): ChipDef[]` — chips whose `families` includes
  `chipFamilyForSku(sku)`; `[]` if the sku has no known family token.

## CX rationale (what the VM enables downstream)

- `sdkConnected` → an explicit "connect your SDK" state, never empty dropdowns.
- `hardware` (read-only) + `accelerators` (struck-through when unavailable) → users see
  *why* the backend is fixed and that e.g. AEN has no DeepX, without trial and error.
- `inheritedFromTopology` → progressive disclosure: ghost inherited core defaults so a
  minimal board.yaml stays minimal but the effective config is visible.
- `preliminary` on SoMs → the renderer can warn when a SoM is preliminary silicon.
- `validation` always present → live feedback in the footer.

## Architecture / data flow

```
BoardConfig (project board.yaml)  ─┐
SdkCatalogue (alp-sdk metadata)   ─┼─→ buildConfiguratorViewModel ─→ ConfiguratorViewModel
                                   │        (pure, @alp-sdk/core)        (consumed by UI-2/UI-3
                                   │                                      renderer + BoardConfig)
```

## Error handling

- Unknown/empty sku → `hardware: null`, `accelerators: []`, `chips: []`, `carriers:
  { options: [] }`; `validation` still reports the missing `som.sku` error.
- Missing SoC spec for a silicon ref → `hardware.cores: []` (degrade, don't invent).
- Empty catalogue → `sdkConnected:false` and all catalogue-derived lists empty.

## Testing

`node --test`, importing `../packages/alp-core/dist/configurator/viewModel.js` and reusing
`test/fixtures/board.fixtures.js` + a small inline `SdkCatalogue` fixture:

- `chipFamilyForSku`: AEN→aen, NX9→imx93, V2N→v2n, V2M→v2n-m1, unknown→undefined.
- `chipsForSom`: a `v2n-m1`-only chip (deepx_dxm1) appears for a V2M sku, not for AEN.
- VM for an AEN board (EDGEAI): `hardware.preferredBackend === "ethos_u"`,
  DeepX accelerator `available:false`, cores from the SoC spec, carriers filtered,
  `cores` includes the topology ids with `inheritedFromTopology` correct.
- VM for a V2M board: DeepX `available:true`; a deepx chip present in `chips`.
- Empty catalogue → `sdkConnected:false`, `hardware:null`, lists empty.
- `validation` reflects `validateBoardConfig` (e.g. a tls-without-mbedtls board surfaces
  the error in `vm.validation.errors`).

## Files

- Create: `packages/alp-core/src/configurator/viewModel.ts` (+ its types, or a
  `viewModel.types.ts` if cleaner).
- Modify: `packages/alp-core/src/sdkCatalogue/derive.ts` (add `chipFamilyForSku`,
  `chipsForSom`).
- Tests: `test/configurator.viewModel.test.js`, extend `test/sdkCatalogue.derive.test.js`
  for the two new derivations.
