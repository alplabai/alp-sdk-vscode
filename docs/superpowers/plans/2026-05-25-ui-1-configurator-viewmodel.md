# UI-1: Configurator View-Model Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A pure, unit-tested `buildConfiguratorViewModel(board, catalogue)` in `@alp-sdk/core` that turns a v0.6 `BoardConfig` + the `SdkCatalogue` into a typed `ConfiguratorViewModel` (SoM options, derived hardware card, accelerator availability, filtered carriers, per-core panels, chip/library lists, validation) — the keystone the webview renderer will consume.

**Architecture:** All logic is pure in `@alp-sdk/core` (no `fs`/`vscode`), composed from the already-merged derivations (`acceleratorAvailability`, `boardsForSom`, `chipDefaults`), the new `chipsForSom`/`chipFamilyForSku`, and `validateBoardConfig`. Unit-tested with `node --test`. No webview/UI changes in this slice.

**Tech Stack:** TypeScript (CommonJS), `node:test`. Build: `pnpm run compile`. Pure tests import `../packages/alp-core/dist/...`.

---

## Reference facts (verified)

- Chip family token derives from the SKU prefix: `E1M-AEN*→aen`, `E1M-NX9*→imx93`,
  `E1M-V2N*→v2n`, `E1M-V2M*→v2n-m1`. `deepx_dxm1.families == ["v2n-m1"]` (hidden on
  AEN/V2N). Tokens match the real chips' `families` lists.
- SoC cores live in `catalogue.socs`, matched by `SocSpec.ref === SomPreset.silicon`.
- Existing pure pieces (merged on `main`): `@alp-sdk/core/sdkCatalogue/derive` exports
  `acceleratorAvailability`, `boardsForSom`, `coreIdsForSom`, `chipDefaults`;
  `@alp-sdk/core/sdkCatalogue/models` exports `SomPreset`, `BoardPreset`, `ChipDef`,
  `SocSpec`, `LibraryProfile`, `SdkCatalogue`, `AcceleratorAvail`;
  `@alp-sdk/core/board/models` exports `BoardConfig`; `@alp-sdk/core/board/validate`
  exports `validateBoardConfig` + `ValidationResult`.
- `@alp-sdk/core` exports `"./*": "./dist/*.js"` (new subpaths resolve automatically).

## File Structure

- Modify: `packages/alp-core/src/sdkCatalogue/derive.ts` (+ `chipFamilyForSku`, `chipsForSom`).
- Create: `packages/alp-core/src/configurator/viewModel.ts` (types + builder).
- Tests: extend `test/sdkCatalogue.derive.test.js`; create `test/configurator.viewModel.test.js`.

---

### Task 1: `chipFamilyForSku` + `chipsForSom`

**Files:**
- Modify: `packages/alp-core/src/sdkCatalogue/derive.ts`
- Test: `test/sdkCatalogue.derive.test.js`

- [ ] **Step 1: Append the failing tests**

Append to `test/sdkCatalogue.derive.test.js`:

```javascript
const { chipFamilyForSku, chipsForSom } = require("../packages/alp-core/dist/sdkCatalogue/derive.js");

test("chipFamilyForSku maps SKU prefixes to chip family tokens", () => {
  assert.equal(chipFamilyForSku("E1M-AEN801"), "aen");
  assert.equal(chipFamilyForSku("E1M-NX9101"), "imx93");
  assert.equal(chipFamilyForSku("E1M-V2N101"), "v2n");
  assert.equal(chipFamilyForSku("E1M-V2M101"), "v2n-m1");
  assert.equal(chipFamilyForSku("E1M-NOPE"), undefined);
  assert.equal(chipFamilyForSku(""), undefined);
});

test("chipsForSom filters chips by the SKU's family token", () => {
  const cat = {
    soms: [], boards: [], libraries: [], socs: [],
    chips: [
      { chipId: "lsm6dso", displayName: "", families: ["aen", "v2n", "v2n-m1"] },
      { chipId: "deepx_dxm1", displayName: "", families: ["v2n-m1"] },
      { chipId: "imx_only", displayName: "", families: ["imx93"] },
    ],
  };
  assert.deepEqual(chipsForSom(cat, "E1M-AEN801").map((c) => c.chipId), ["lsm6dso"]);
  assert.deepEqual(chipsForSom(cat, "E1M-V2M101").map((c) => c.chipId), ["lsm6dso", "deepx_dxm1"]);
  assert.deepEqual(chipsForSom(cat, "E1M-NX9101").map((c) => c.chipId), ["imx_only"]);
  assert.deepEqual(chipsForSom(cat, "E1M-NOPE"), []);
});
```

- [ ] **Step 2: Run to verify FAIL**

Run: `node --test test/sdkCatalogue.derive.test.js`
Expected: FAIL — `chipFamilyForSku is not a function`.

- [ ] **Step 3: Implement**

In `packages/alp-core/src/sdkCatalogue/derive.ts`:
1. Add `ChipDef` to the models import (it currently imports
   `AcceleratorAvail, BoardPreset, SdkCatalogue, SomPreset`):
   `import { AcceleratorAvail, BoardPreset, ChipDef, SdkCatalogue, SomPreset } from "./models";`
2. Append:

```typescript
const SKU_FAMILY_PREFIXES: { re: RegExp; family: string }[] = [
  { re: /^E1M-AEN/, family: "aen" },
  { re: /^E1M-NX9/, family: "imx93" },
  { re: /^E1M-V2M/, family: "v2n-m1" },
  { re: /^E1M-V2N/, family: "v2n" },
];

/** The chip `families` token for a SoM SKU (matches metadata/e1m_modules/<token>/). */
export function chipFamilyForSku(sku: string): string | undefined {
  for (const { re, family } of SKU_FAMILY_PREFIXES) {
    if (re.test(sku)) return family;
  }
  return undefined;
}

export function chipsForSom(catalogue: SdkCatalogue, sku: string): ChipDef[] {
  const family = chipFamilyForSku(sku);
  if (!family) return [];
  return catalogue.chips.filter((chip) => chip.families.includes(family));
}
```

- [ ] **Step 4: Compile + run; verify PASS**

Run: `pnpm run compile && node --test test/sdkCatalogue.derive.test.js`
Expected: PASS (all derive tests, including the 2 new ones).

- [ ] **Step 5: Commit**

```bash
git add packages/alp-core/src/sdkCatalogue/derive.ts test/sdkCatalogue.derive.test.js
git commit -m "feat(catalogue): chipFamilyForSku + chipsForSom with tests"
```

---

### Task 2: `ConfiguratorViewModel` + `buildConfiguratorViewModel`

**Files:**
- Create: `packages/alp-core/src/configurator/viewModel.ts`
- Test: `test/configurator.viewModel.test.js`

- [ ] **Step 1: Write the failing test**

Create `test/configurator.viewModel.test.js`:

```javascript
const test = require("node:test");
const assert = require("node:assert/strict");

const { parseBoardConfig } = require("../packages/alp-core/dist/board/parse.js");
const { buildConfiguratorViewModel } = require("../packages/alp-core/dist/configurator/viewModel.js");
const { EDGEAI, OBJDET } = require("./fixtures/board.fixtures.js");

function catalogue() {
  return {
    soms: [
      {
        sku: "E1M-AEN801", displayName: "E1M-AEN801 (Alif Ensemble E8)",
        family: "alif-ensemble", silicon: "alif:ensemble:e8",
        preferredBackend: "ethos_u", capabilities: {}, defaultBoard: "E1M-EVK",
        topologyCoreIds: ["a32_cluster", "m55_hp", "m55_he"],
        onModule: ["cc3501e"], preliminary: false,
      },
      {
        sku: "E1M-V2M101", displayName: "E1M-V2M101 (RZ/V2N + DEEPX)",
        family: "renesas-rzv2n", silicon: "renesas:rzv2n:n44",
        preferredBackend: "deepx_dxm1", capabilities: { deepx_dx: true },
        defaultBoard: "E1M-X-EVK", topologyCoreIds: ["a55_cluster", "m33_sm"],
        onModule: [], preliminary: false,
      },
    ],
    boards: [
      { name: "e1m-evk", displayName: "EVK", hostsSomFamilies: ["alif-ensemble"], populated: { lsm6dso: true } },
      { name: "e1m-x-evk", displayName: "X-EVK", hostsSomFamilies: ["renesas-rzv2n"], populated: {} },
    ],
    chips: [
      { chipId: "lsm6dso", displayName: "LSM6DSO", families: ["aen", "v2n", "v2n-m1"] },
      { chipId: "deepx_dxm1", displayName: "DEEPX DX-M1", families: ["v2n-m1"] },
    ],
    libraries: [{ id: "etl" }, { id: "mbedtls" }],
    socs: [
      { ref: "alif:ensemble:e8", vendor: "Alif", family: "Ensemble", part: "E7",
        cores: [{ id: "m55_hp", type: "cortex-m55", count: 1, freqMhz: 400 }] },
    ],
    sdkVersion: "0.6.0",
  };
}

test("VM for an AEN board derives hardware, accelerators, carriers, cores", () => {
  const vm = buildConfiguratorViewModel(parseBoardConfig(EDGEAI), catalogue());
  assert.equal(vm.sdkConnected, true);
  assert.equal(vm.som.selected, "E1M-AEN801");
  assert.equal(vm.hardware.preferredBackend, "ethos_u");
  assert.deepEqual(vm.hardware.cores.map((c) => c.id), ["m55_hp"]); // from the SoC spec
  assert.equal(vm.hardware.defaultBoard, "E1M-EVK");
  const acc = Object.fromEntries(vm.accelerators.map((a) => [a.id, a.available]));
  assert.equal(acc.ethos_u, true);
  assert.equal(acc.deepx_dxm1, false);
  assert.equal(vm.boardMode, "preset");
  assert.equal(vm.carriers.selected, "e1m-evk");
  assert.deepEqual(vm.carriers.options.map((b) => b.name), ["e1m-evk"]);
  // cores: topology order a32_cluster, m55_hp, m55_he; EDGEAI overrides a32_cluster + m55_hp
  assert.deepEqual(vm.cores.map((c) => c.id), ["a32_cluster", "m55_hp", "m55_he"]);
  assert.equal(vm.cores.find((c) => c.id === "m55_he").inheritedFromTopology, true);
  assert.equal(vm.cores.find((c) => c.id === "m55_hp").inferenceArenaKib, 256);
  // chips filtered to aen: lsm6dso present, deepx hidden; enabled from preset populated
  assert.deepEqual(vm.chips.map((c) => c.chipId), ["lsm6dso"]);
  assert.equal(vm.chips[0].enabled, true);
  assert.deepEqual(vm.libraries, ["etl", "mbedtls"]);
  assert.deepEqual(vm.validation.errors, []);
});

test("VM for a V2M board lights DeepX and offers the deepx chip", () => {
  const vm = buildConfiguratorViewModel(parseBoardConfig(OBJDET), catalogue());
  const acc = Object.fromEntries(vm.accelerators.map((a) => [a.id, a.available]));
  assert.equal(acc.deepx_dxm1, true);
  assert.ok(vm.chips.some((c) => c.chipId === "deepx_dxm1"));
});

test("VM with an empty catalogue reports disconnected and null hardware", () => {
  const empty = { soms: [], boards: [], chips: [], libraries: [], socs: [], sdkVersion: undefined };
  const vm = buildConfiguratorViewModel(parseBoardConfig(EDGEAI), empty);
  assert.equal(vm.sdkConnected, false);
  assert.equal(vm.hardware, null);
  assert.deepEqual(vm.accelerators, []);
  assert.deepEqual(vm.chips, []);
  assert.deepEqual(vm.carriers.options, []);
});
```

- [ ] **Step 2: Run to verify FAIL**

Run: `node --test test/configurator.viewModel.test.js`
Expected: FAIL — `Cannot find module '../packages/alp-core/dist/configurator/viewModel.js'`.

- [ ] **Step 3: Implement**

Create `packages/alp-core/src/configurator/viewModel.ts`:

```typescript
// SPDX-License-Identifier: Apache-2.0

import { BoardConfig } from "../board/models";
import { validateBoardConfig, ValidationResult } from "../board/validate";
import {
  acceleratorAvailability,
  boardsForSom,
  chipDefaults,
  chipsForSom,
} from "../sdkCatalogue/derive";
import {
  AcceleratorAvail,
  BoardPreset,
  SdkCatalogue,
} from "../sdkCatalogue/models";

export interface SomOptionGroup {
  family: string;
  soms: { sku: string; displayName: string; preliminary: boolean }[];
}

export interface HardwareCard {
  sku: string;
  displayName: string;
  silicon: string;
  cores: { id: string; type: string; count: number; freqMhz?: number }[];
  preferredBackend?: string;
  defaultBoard?: string;
  onModule: string[];
  preliminary: boolean;
}

export interface CorePanel {
  id: string;
  inheritedFromTopology: boolean;
  os?: string;
  app?: string;
  image?: string;
  peripherals: string[];
  libraries: string[];
  iot: { wifi: boolean; mqtt: boolean; ble: boolean; tls: boolean };
  inferenceArenaKib?: number;
}

export interface ChipChoice {
  chipId: string;
  displayName: string;
  vendor?: string;
  bus?: string;
  driverStatus?: string;
  enabled: boolean;
}

export interface ConfiguratorViewModel {
  sdkConnected: boolean;
  som: { selected: string; options: SomOptionGroup[] };
  hardware: HardwareCard | null;
  accelerators: AcceleratorAvail[];
  boardMode: "preset" | "inline";
  carriers: { selected?: string; options: BoardPreset[] };
  cores: CorePanel[];
  libraries: string[];
  chips: ChipChoice[];
  projectChips: string[];
  validation: ValidationResult;
}

export function buildConfiguratorViewModel(
  board: BoardConfig,
  catalogue: SdkCatalogue,
): ConfiguratorViewModel {
  const selected = board.som?.sku ?? "";
  const som = catalogue.soms.find((s) => s.sku === selected);

  const groups = new Map<string, SomOptionGroup>();
  for (const s of catalogue.soms) {
    let group = groups.get(s.family);
    if (!group) {
      group = { family: s.family, soms: [] };
      groups.set(s.family, group);
    }
    group.soms.push({ sku: s.sku, displayName: s.displayName, preliminary: s.preliminary });
  }

  let hardware: HardwareCard | null = null;
  if (som) {
    const soc = catalogue.socs.find((sp) => sp.ref === som.silicon);
    hardware = {
      sku: som.sku,
      displayName: som.displayName,
      silicon: som.silicon,
      cores: soc ? soc.cores.map((c) => ({ id: c.id, type: c.type, count: c.count, freqMhz: c.freqMhz })) : [],
      preferredBackend: som.preferredBackend,
      defaultBoard: som.defaultBoard,
      onModule: som.onModule,
      preliminary: som.preliminary,
    };
  }

  const topoIds = som?.topologyCoreIds ?? [];
  const boardCoreIds = Object.keys(board.cores ?? {});
  const orderedIds = [...topoIds, ...boardCoreIds.filter((id) => !topoIds.includes(id))];
  const cores: CorePanel[] = orderedIds.map((id) => {
    const core = board.cores?.[id];
    const iot = core?.iot ?? {};
    return {
      id,
      inheritedFromTopology: core === undefined,
      os: core?.os,
      app: core?.app,
      image: core?.image,
      peripherals: core?.peripherals ?? [],
      libraries: core?.libraries ?? [],
      iot: {
        wifi: Boolean(iot.wifi),
        mqtt: Boolean(iot.mqtt),
        ble: Boolean(iot.ble),
        tls: Boolean(iot.tls),
      },
      inferenceArenaKib: core?.inference?.default_arena_kib,
    };
  });

  const selectedPreset = catalogue.boards.find((b) => b.name === board.preset);
  const effectivePopulated = {
    ...(selectedPreset ? chipDefaults(selectedPreset) : {}),
    ...(board.populated ?? {}),
  };
  const chips: ChipChoice[] = chipsForSom(catalogue, selected).map((chip) => ({
    chipId: chip.chipId,
    displayName: chip.displayName,
    vendor: chip.vendor,
    bus: chip.bus,
    driverStatus: chip.driverStatus,
    enabled: effectivePopulated[chip.chipId] === true,
  }));

  return {
    sdkConnected: catalogue.soms.length > 0,
    som: { selected, options: [...groups.values()] },
    hardware,
    accelerators: som ? acceleratorAvailability(som) : [],
    boardMode: board.populated !== undefined || board.e1m_routes !== undefined ? "inline" : "preset",
    carriers: { selected: board.preset, options: boardsForSom(catalogue, selected) },
    cores,
    libraries: catalogue.libraries.map((l) => l.id),
    chips,
    projectChips: board.chips ?? [],
    validation: validateBoardConfig(board),
  };
}
```

- [ ] **Step 4: Compile + run; verify PASS**

Run: `pnpm run compile && node --test test/configurator.viewModel.test.js`
Expected: PASS (3/3).

- [ ] **Step 5: Run the broad suite (catalogue + board + viewModel) + commit**

Run: `node --test test/sdkCatalogue.derive.test.js test/configurator.viewModel.test.js test/board.parse.test.js test/board.validate.test.js`
Expected: all PASS.

```bash
git add packages/alp-core/src/configurator/viewModel.ts test/configurator.viewModel.test.js
git commit -m "feat(configurator): buildConfiguratorViewModel with tests"
```

---

## Self-review notes

- **Spec coverage:** `chipFamilyForSku`/`chipsForSom` (Task 1) · the full
  `ConfiguratorViewModel` — sdkConnected, grouped SoM options, derived hardware card from
  SoC spec, accelerators, boardMode + filtered carriers, cores (topology∪board with
  `inheritedFromTopology`), libraries, chips (filtered + effective populated), projectChips,
  validation (Task 2). Empty-catalogue/unknown-sku degradation covered by tests. Raw
  section values (boot/ota/storage/security/ipc/diagnostics) are intentionally NOT in the
  VM — the renderer reads them from `BoardConfig` (per the spec).
- **Type consistency:** VM types defined once in `viewModel.ts`; it consumes
  `BoardConfig`, `SdkCatalogue`, `BoardPreset`, `AcceleratorAvail`, `ValidationResult`,
  and the derive functions by their existing signatures. `chipsForSom`/`chipFamilyForSku`
  defined in Task 1 and used in Task 2.
- **No Claude co-author trailer** in any commit.
- Pure/core only — no webview, no fs, no vscode. `node --test` covers it end-to-end.
