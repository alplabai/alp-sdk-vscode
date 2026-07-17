# Phase 2a-1: SKU-aware Data Layer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Parse the real alp-sdk metadata (SoM/board/chip/SoC presets + library list + SDK version) into a typed, unit-tested `SdkCatalogue`, with SKU-driven derivations — the foundation the v0.6 board model and the redesigned configurator build on.

**Architecture:** Pure parsers + derivations live in `@alp-sdk/core` (no `fs`/`vscode`), unit-tested with `node --test` against inline-YAML fixtures. A thin `fs` adapter in the extension reads the real metadata directory layout into the catalogue and is tested against a temp fixture tree. No UI changes in this plan.

**Tech Stack:** TypeScript (CommonJS), `js-yaml` (already a `@alp-sdk/core` dependency), `node:test` + `node:assert/strict`, pnpm workspace (`tsc --build`).

---

## Reference facts (verified against the real repo)

- Real metadata layout (`C:\Users\caner\Documents\GitHub\alp-sdk\metadata`):
  - SoMs: flat files `e1m_modules/E1M-*.yaml` (11). Fields used: `sku`, `display_name`,
    `family`, `silicon`, `silicon_variant`, `inference.preferred_backend`, `capabilities`
    (bool map), `default_board`, `topology` (keys = core ids), `on_module` (chip ids),
    `memory.{dram_mbit,flash_mbit}`, `status.preliminary`. `TBD` strings mean "unknown".
  - Boards: `boards/*.yaml`. Fields: `name`, `display_name`, `hosts_som_families`,
    `populated` (chip→bool).
  - Chips: `chips/*.yaml` (71). Fields: `chip_id`, `display_name`, `vendor`, `bus`,
    `driver_status`, `families` (string list), `kconfig.{zephyr,baremetal}`.
  - SoCs: `socs/<vendor>/<family>/<part>.json`. Fields: `ref`, `vendor`, `family`,
    `part`, `cores[].{id,type,count,freq_mhz}`.
  - Libraries: `library-profiles/<id>/` directories (ids; ignore `README.md`).
  - Version: `sdk_version.yaml` → `version`.
- `@alp-sdk/core` `package.json` `exports` = `"./*": "./dist/*.js"` (wildcard — new
  subpaths resolve with no package.json edit). Core compiles to `packages/alp-core/dist/`.
- Build: `pnpm run compile`. Pure-core tests import `../packages/alp-core/dist/...`;
  extension-adapter tests import `../out/...`.
- **Not in this plan** (deferred to the configurator plan, where the SoM-family ↔
  chip-family token mapping will be confirmed): `chipsForSom` filtering. Reason: a SoM's
  `family` (`renesas-rzv2n`) does not 1:1 map to a chip's `families` token (`v2n` vs
  `v2n-m1`); the mapping needs confirmation against the SDK before encoding.

## File Structure

- `packages/alp-core/src/sdkCatalogue/models.ts` — types only.
- `packages/alp-core/src/sdkCatalogue/parse.ts` — pure parsers (one per preset kind).
- `packages/alp-core/src/sdkCatalogue/derive.ts` — pure SKU-driven derivations.
- `src/sdkCatalogue/vscodeAdapter.ts` — `fs` adapter assembling the catalogue from a
  metadata root.
- Tests: `test/sdkCatalogue.parse.test.js`, `test/sdkCatalogue.derive.test.js`,
  `test/sdkCatalogue.vscodeAdapter.test.js`.

---

### Task 1: Models + `parseSomPreset`

**Files:**
- Create: `packages/alp-core/src/sdkCatalogue/models.ts`
- Create: `packages/alp-core/src/sdkCatalogue/parse.ts`
- Test: `test/sdkCatalogue.parse.test.js`

- [ ] **Step 1: Write the failing test**

Create `test/sdkCatalogue.parse.test.js`:

```javascript
const test = require("node:test");
const assert = require("node:assert/strict");

const { parseSomPreset } = require("../packages/alp-core/dist/sdkCatalogue/parse.js");

const AEN = `
schema_version: 1
sku: E1M-AEN801
family: alif-ensemble
silicon: alif:ensemble:e8
silicon_variant: AE722F80F55D5LS
display_name: "E1M-AEN801 (Alif Ensemble E8)"
on_module:
  silicon: alif:ensemble:e8
  wifi_ble: cc3501e
  secure_element: optiga_trust_m
inference:
  preferred_backend: ethos_u
capabilities:
  optiga_trust_m: true
topology:
  a32_cluster: { app: x }
  m55_hp: { app: y }
  m55_he: { app: z }
default_board: E1M-EVK
status:
  preliminary: false
`;

const V2M = `
sku: E1M-V2M101
family: renesas-rzv2n
silicon: renesas:rzv2n:n44
display_name: "E1M-V2M101 (Renesas RZ/V2N + DEEPX DX-M1)"
memory: { dram_mbit: 32768, flash_mbit: 32768 }
inference:
  preferred_backend: deepx_dxm1
capabilities:
  deepx_dx: true
  optiga_trust_m: true
topology:
  a55_cluster: { app: x }
  m33_sm: { app: y }
default_board: E1M-X-EVK
status:
  preliminary: false
`;

const NX_TBD = `
sku: E1M-NX9101
family: nxp-imx9
silicon: nxp:imx9:imx93
silicon_variant: TBD
display_name: "E1M-NX9101 (NXP i.MX 93 -- exact SKU TBD)"
memory: { dram_mbit: TBD, flash_mbit: TBD }
inference:
  preferred_backend: ethos_u
topology:
  a55_cluster: { app: x }
status:
  preliminary: true
`;

test("parseSomPreset maps an AEN preset", () => {
  const s = parseSomPreset(AEN);
  assert.equal(s.sku, "E1M-AEN801");
  assert.equal(s.family, "alif-ensemble");
  assert.equal(s.silicon, "alif:ensemble:e8");
  assert.equal(s.siliconVariant, "AE722F80F55D5LS");
  assert.equal(s.preferredBackend, "ethos_u");
  assert.equal(s.defaultBoard, "E1M-EVK");
  assert.deepEqual(s.topologyCoreIds, ["a32_cluster", "m55_hp", "m55_he"]);
  assert.equal(s.capabilities.optiga_trust_m, true);
  assert.equal(s.capabilities.deepx_dx ?? false, false);
  assert.equal(s.preliminary, false);
  assert.ok(s.onModule.includes("cc3501e"));
});

test("parseSomPreset maps a V2M preset with deepx + memory", () => {
  const s = parseSomPreset(V2M);
  assert.equal(s.preferredBackend, "deepx_dxm1");
  assert.equal(s.capabilities.deepx_dx, true);
  assert.deepEqual(s.memory, { dramMbit: 32768, flashMbit: 32768 });
  assert.equal(s.defaultBoard, "E1M-X-EVK");
});

test("parseSomPreset treats TBD as unknown", () => {
  const s = parseSomPreset(NX_TBD);
  assert.equal(s.siliconVariant, undefined);
  assert.equal(s.memory, undefined);
  assert.equal(s.preliminary, true);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/sdkCatalogue.parse.test.js`
Expected: FAIL — `Cannot find module '../packages/alp-core/dist/sdkCatalogue/parse.js'`.

- [ ] **Step 3: Write the models**

Create `packages/alp-core/src/sdkCatalogue/models.ts`:

```typescript
// SPDX-License-Identifier: Apache-2.0

export interface SomPreset {
  sku: string;
  displayName: string;
  family: string;
  silicon: string;
  siliconVariant?: string;
  preferredBackend?: string;
  capabilities: Record<string, boolean>;
  defaultBoard?: string;
  topologyCoreIds: string[];
  onModule: string[];
  memory?: { dramMbit?: number; flashMbit?: number };
  preliminary: boolean;
}

export interface BoardPreset {
  name: string;
  displayName: string;
  hostsSomFamilies: string[];
  populated: Record<string, boolean>;
}

export interface ChipDef {
  chipId: string;
  displayName: string;
  vendor?: string;
  bus?: string;
  driverStatus?: string;
  families: string[];
  kconfig?: { zephyr?: string; baremetal?: string };
}

export interface SocCore {
  id: string;
  type: string;
  count: number;
  freqMhz?: number;
}

export interface SocSpec {
  ref: string;
  vendor: string;
  family: string;
  part: string;
  cores: SocCore[];
}

export interface LibraryProfile {
  id: string;
}

export interface SdkCatalogue {
  soms: SomPreset[];
  boards: BoardPreset[];
  chips: ChipDef[];
  libraries: LibraryProfile[];
  socs: SocSpec[];
  sdkVersion?: string;
}

export interface AcceleratorAvail {
  id: string;
  label: string;
  available: boolean;
}
```

- [ ] **Step 4: Write `parseSomPreset` + shared helpers**

Create `packages/alp-core/src/sdkCatalogue/parse.ts`:

```typescript
// SPDX-License-Identifier: Apache-2.0

import * as yaml from "js-yaml";
import { BoardPreset, ChipDef, SocSpec, SomPreset } from "./models";

function isTbd(v: unknown): boolean {
  return typeof v === "string" && v.trim() === "TBD";
}

function str(v: unknown): string | undefined {
  if (typeof v === "string" && !isTbd(v)) return v;
  return undefined;
}

function num(v: unknown): number | undefined {
  return typeof v === "number" ? v : undefined;
}

function boolMap(v: unknown): Record<string, boolean> {
  const out: Record<string, boolean> = {};
  if (v && typeof v === "object") {
    for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
      out[k] = Boolean(val);
    }
  }
  return out;
}

export function parseSomPreset(text: string): SomPreset {
  const d = (yaml.load(text) ?? {}) as Record<string, any>;
  const inference = (d.inference ?? {}) as Record<string, unknown>;
  const topology = (d.topology ?? {}) as Record<string, unknown>;
  const onModuleRaw = (d.on_module ?? {}) as Record<string, unknown>;
  const memory = (d.memory ?? {}) as Record<string, unknown>;
  const status = (d.status ?? {}) as Record<string, unknown>;

  const dramMbit = num(memory.dram_mbit);
  const flashMbit = num(memory.flash_mbit);
  const hasMemory = dramMbit !== undefined || flashMbit !== undefined;

  return {
    sku: str(d.sku) ?? "",
    displayName: str(d.display_name) ?? str(d.sku) ?? "",
    family: str(d.family) ?? "",
    silicon: str(d.silicon) ?? "",
    siliconVariant: str(d.silicon_variant),
    preferredBackend: str(inference.preferred_backend),
    capabilities: boolMap(d.capabilities),
    defaultBoard: str(d.default_board),
    topologyCoreIds: Object.keys(topology),
    onModule: Object.entries(onModuleRaw)
      .filter(([, val]) => typeof val === "string" && !isTbd(val))
      .map(([, val]) => val as string),
    memory: hasMemory ? { dramMbit, flashMbit } : undefined,
    preliminary: Boolean(status.preliminary),
  };
}
```

- [ ] **Step 5: Compile and run the test to verify it passes**

Run: `pnpm run compile && node --test test/sdkCatalogue.parse.test.js`
Expected: PASS — 3/3 tests pass.

- [ ] **Step 6: Commit**

```bash
git add packages/alp-core/src/sdkCatalogue/models.ts packages/alp-core/src/sdkCatalogue/parse.ts test/sdkCatalogue.parse.test.js
git commit -m "feat(catalogue): SomPreset model + parseSomPreset with tests"
```

---

### Task 2: `parseBoardPreset`

**Files:**
- Modify: `packages/alp-core/src/sdkCatalogue/parse.ts`
- Test: `test/sdkCatalogue.parse.test.js`

- [ ] **Step 1: Add the failing test**

Append to `test/sdkCatalogue.parse.test.js`:

```javascript
const { parseBoardPreset } = require("../packages/alp-core/dist/sdkCatalogue/parse.js");

const BOARD = `
name: e1m-evk
display_name: "E1M-EVK reference board"
hosts_som_families: [alif-ensemble, nxp-imx9]
populated:
  lsm6dso: true
  ssd1306: true
  ov5640: false
`;

test("parseBoardPreset maps name, families, and populated", () => {
  const b = parseBoardPreset(BOARD);
  assert.equal(b.name, "e1m-evk");
  assert.equal(b.displayName, "E1M-EVK reference board");
  assert.deepEqual(b.hostsSomFamilies, ["alif-ensemble", "nxp-imx9"]);
  assert.deepEqual(b.populated, { lsm6dso: true, ssd1306: true, ov5640: false });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/sdkCatalogue.parse.test.js`
Expected: FAIL — `parseBoardPreset is not a function`.

- [ ] **Step 3: Implement `parseBoardPreset`**

Append to `packages/alp-core/src/sdkCatalogue/parse.ts`:

```typescript
function strList(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
}

export function parseBoardPreset(text: string): BoardPreset {
  const d = (yaml.load(text) ?? {}) as Record<string, any>;
  return {
    name: str(d.name) ?? "",
    displayName: str(d.display_name) ?? str(d.name) ?? "",
    hostsSomFamilies: strList(d.hosts_som_families),
    populated: boolMap(d.populated),
  };
}
```

- [ ] **Step 4: Compile and run the test to verify it passes**

Run: `pnpm run compile && node --test test/sdkCatalogue.parse.test.js`
Expected: PASS — all tests pass.

- [ ] **Step 5: Commit**

```bash
git add packages/alp-core/src/sdkCatalogue/parse.ts test/sdkCatalogue.parse.test.js
git commit -m "feat(catalogue): parseBoardPreset with tests"
```

---

### Task 3: `parseChipDef`

**Files:**
- Modify: `packages/alp-core/src/sdkCatalogue/parse.ts`
- Test: `test/sdkCatalogue.parse.test.js`

- [ ] **Step 1: Add the failing test**

Append to `test/sdkCatalogue.parse.test.js`:

```javascript
const { parseChipDef } = require("../packages/alp-core/dist/sdkCatalogue/parse.js");

const CHIP = `
schema_version: 1
chip_id: lsm6dso
driver_status: partial
display_name: "STMicroelectronics LSM6DSO 6-axis IMU"
vendor: st
bus: i2c
kconfig:
  zephyr: ALP_SDK_CHIP_LSM6DSO
  baremetal: ALP_SDK_CHIP_LSM6DSO
families:
  - aen
  - v2n
  - v2n-m1
`;

test("parseChipDef maps chip fields including families + kconfig", () => {
  const c = parseChipDef(CHIP);
  assert.equal(c.chipId, "lsm6dso");
  assert.equal(c.displayName, "STMicroelectronics LSM6DSO 6-axis IMU");
  assert.equal(c.vendor, "st");
  assert.equal(c.bus, "i2c");
  assert.equal(c.driverStatus, "partial");
  assert.deepEqual(c.families, ["aen", "v2n", "v2n-m1"]);
  assert.deepEqual(c.kconfig, { zephyr: "ALP_SDK_CHIP_LSM6DSO", baremetal: "ALP_SDK_CHIP_LSM6DSO" });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/sdkCatalogue.parse.test.js`
Expected: FAIL — `parseChipDef is not a function`.

- [ ] **Step 3: Implement `parseChipDef`**

Append to `packages/alp-core/src/sdkCatalogue/parse.ts`:

```typescript
export function parseChipDef(text: string): ChipDef {
  const d = (yaml.load(text) ?? {}) as Record<string, any>;
  const kc = (d.kconfig ?? {}) as Record<string, unknown>;
  const zephyr = str(kc.zephyr);
  const baremetal = str(kc.baremetal);
  const hasKconfig = zephyr !== undefined || baremetal !== undefined;
  return {
    chipId: str(d.chip_id) ?? "",
    displayName: str(d.display_name) ?? str(d.chip_id) ?? "",
    vendor: str(d.vendor),
    bus: str(d.bus),
    driverStatus: str(d.driver_status),
    families: strList(d.families),
    kconfig: hasKconfig ? { zephyr, baremetal } : undefined,
  };
}
```

- [ ] **Step 4: Compile and run the test to verify it passes**

Run: `pnpm run compile && node --test test/sdkCatalogue.parse.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/alp-core/src/sdkCatalogue/parse.ts test/sdkCatalogue.parse.test.js
git commit -m "feat(catalogue): parseChipDef with tests"
```

---

### Task 4: `parseSocSpec`

**Files:**
- Modify: `packages/alp-core/src/sdkCatalogue/parse.ts`
- Test: `test/sdkCatalogue.parse.test.js`

- [ ] **Step 1: Add the failing test**

Append to `test/sdkCatalogue.parse.test.js`:

```javascript
const { parseSocSpec } = require("../packages/alp-core/dist/sdkCatalogue/parse.js");

const SOC = JSON.stringify({
  soc_spec_version: 1,
  ref: "alif:ensemble:e8",
  vendor: "Alif Semiconductor",
  family: "Ensemble",
  part: "E7",
  cores: [
    { id: "a32_cluster", type: "cortex-a32", count: 2, freq_mhz: 800 },
    { id: "m55_hp", type: "cortex-m55", count: 1, freq_mhz: 400 },
  ],
});

test("parseSocSpec maps ref + cores", () => {
  const s = parseSocSpec(SOC);
  assert.equal(s.ref, "alif:ensemble:e8");
  assert.equal(s.part, "E7");
  assert.deepEqual(s.cores, [
    { id: "a32_cluster", type: "cortex-a32", count: 2, freqMhz: 800 },
    { id: "m55_hp", type: "cortex-m55", count: 1, freqMhz: 400 },
  ]);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/sdkCatalogue.parse.test.js`
Expected: FAIL — `parseSocSpec is not a function`.

- [ ] **Step 3: Implement `parseSocSpec`**

Append to `packages/alp-core/src/sdkCatalogue/parse.ts` (JSON is valid YAML, but parse as
JSON for clarity):

```typescript
import { SocCore } from "./models";

export function parseSocSpec(text: string): SocSpec {
  const d = JSON.parse(text) as Record<string, any>;
  const cores: SocCore[] = Array.isArray(d.cores)
    ? d.cores.map((c: Record<string, unknown>) => ({
        id: String(c.id ?? ""),
        type: String(c.type ?? ""),
        count: typeof c.count === "number" ? c.count : 1,
        freqMhz: num(c.freq_mhz),
      }))
    : [];
  return {
    ref: String(d.ref ?? ""),
    vendor: String(d.vendor ?? ""),
    family: String(d.family ?? ""),
    part: String(d.part ?? ""),
    cores,
  };
}
```

(Move the `import { SocCore }` onto the existing first import line from `./models` rather
than adding a second import statement — combine to
`import { BoardPreset, ChipDef, SocCore, SocSpec, SomPreset } from "./models";`.)

- [ ] **Step 4: Compile and run the test to verify it passes**

Run: `pnpm run compile && node --test test/sdkCatalogue.parse.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/alp-core/src/sdkCatalogue/parse.ts test/sdkCatalogue.parse.test.js
git commit -m "feat(catalogue): parseSocSpec with tests"
```

---

### Task 5: Derivations (`derive.ts`)

**Files:**
- Create: `packages/alp-core/src/sdkCatalogue/derive.ts`
- Test: `test/sdkCatalogue.derive.test.js`

- [ ] **Step 1: Write the failing test**

Create `test/sdkCatalogue.derive.test.js`:

```javascript
const test = require("node:test");
const assert = require("node:assert/strict");

const {
  boardsForSom,
  acceleratorAvailability,
  chipDefaults,
  coreIdsForSom,
} = require("../packages/alp-core/dist/sdkCatalogue/derive.js");

function som(partial) {
  return {
    sku: "E1M-AEN801", displayName: "", family: "alif-ensemble", silicon: "",
    capabilities: {}, topologyCoreIds: ["m55_hp", "m55_he"], onModule: [],
    preliminary: false, ...partial,
  };
}

const catalogue = {
  soms: [som({ sku: "E1M-AEN801", family: "alif-ensemble" })],
  boards: [
    { name: "e1m-evk", displayName: "", hostsSomFamilies: ["alif-ensemble", "nxp-imx9"], populated: { lsm6dso: true } },
    { name: "e1m-x-evk", displayName: "", hostsSomFamilies: ["renesas-rzv2n"], populated: {} },
  ],
  chips: [], libraries: [], socs: [],
};

test("boardsForSom filters boards by the SoM family", () => {
  const boards = boardsForSom(catalogue, "E1M-AEN801");
  assert.deepEqual(boards.map((b) => b.name), ["e1m-evk"]);
});

test("boardsForSom returns [] for an unknown sku", () => {
  assert.deepEqual(boardsForSom(catalogue, "E1M-NOPE"), []);
});

test("acceleratorAvailability lights ethos_u for AEN, not deepx", () => {
  const a = acceleratorAvailability(som({ preferredBackend: "ethos_u", capabilities: {} }));
  const by = Object.fromEntries(a.map((x) => [x.id, x.available]));
  assert.equal(by.ethos_u, true);
  assert.equal(by.deepx_dxm1, false);
  assert.equal(by.cpu, true);
});

test("acceleratorAvailability lights deepx for a V2M SoM", () => {
  const a = acceleratorAvailability(som({ preferredBackend: "deepx_dxm1", capabilities: { deepx_dx: true } }));
  const by = Object.fromEntries(a.map((x) => [x.id, x.available]));
  assert.equal(by.deepx_dxm1, true);
  assert.equal(by.ethos_u, false);
});

test("chipDefaults returns the board populated map; coreIdsForSom returns topology ids", () => {
  assert.deepEqual(chipDefaults(catalogue.boards[0]), { lsm6dso: true });
  assert.deepEqual(coreIdsForSom(catalogue, "E1M-AEN801"), ["m55_hp", "m55_he"]);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/sdkCatalogue.derive.test.js`
Expected: FAIL — `Cannot find module '../packages/alp-core/dist/sdkCatalogue/derive.js'`.

- [ ] **Step 3: Implement `derive.ts`**

Create `packages/alp-core/src/sdkCatalogue/derive.ts`:

```typescript
// SPDX-License-Identifier: Apache-2.0

import {
  AcceleratorAvail,
  BoardPreset,
  SdkCatalogue,
  SomPreset,
} from "./models";

function somBySku(catalogue: SdkCatalogue, sku: string): SomPreset | undefined {
  return catalogue.soms.find((s) => s.sku === sku);
}

export function boardsForSom(catalogue: SdkCatalogue, sku: string): BoardPreset[] {
  const som = somBySku(catalogue, sku);
  if (!som) return [];
  return catalogue.boards.filter((b) => b.hostsSomFamilies.includes(som.family));
}

export function coreIdsForSom(catalogue: SdkCatalogue, sku: string): string[] {
  return somBySku(catalogue, sku)?.topologyCoreIds ?? [];
}

export function chipDefaults(board: BoardPreset): Record<string, boolean> {
  return board.populated;
}

export function acceleratorAvailability(som: SomPreset): AcceleratorAvail[] {
  const pb = som.preferredBackend;
  const hasDeepx = som.capabilities.deepx_dx === true;
  return [
    { id: "ethos_u", label: "Ethos-U", available: pb === "ethos_u" },
    { id: "drpai", label: "DRP-AI", available: pb === "drpai" },
    { id: "deepx_dxm1", label: "DeepX DX-M1", available: hasDeepx || pb === "deepx_dxm1" },
    { id: "cpu", label: "CPU fallback", available: true },
  ];
}
```

- [ ] **Step 4: Compile and run the test to verify it passes**

Run: `pnpm run compile && node --test test/sdkCatalogue.derive.test.js`
Expected: PASS — 5/5.

- [ ] **Step 5: Commit**

```bash
git add packages/alp-core/src/sdkCatalogue/derive.ts test/sdkCatalogue.derive.test.js
git commit -m "feat(catalogue): SKU-driven derivations with tests"
```

---

### Task 6: `loadSdkCatalogue` fs adapter

**Files:**
- Create: `src/sdkCatalogue/vscodeAdapter.ts`
- Test: `test/sdkCatalogue.vscodeAdapter.test.js`

- [ ] **Step 1: Write the failing test (builds a temp metadata tree)**

Create `test/sdkCatalogue.vscodeAdapter.test.js`:

```javascript
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { loadSdkCatalogue } = require("../out/sdkCatalogue/vscodeAdapter.js");

function writeTree(root) {
  const m = path.join(root, "metadata");
  fs.mkdirSync(path.join(m, "e1m_modules"), { recursive: true });
  fs.mkdirSync(path.join(m, "boards"), { recursive: true });
  fs.mkdirSync(path.join(m, "chips"), { recursive: true });
  fs.mkdirSync(path.join(m, "socs", "alif", "ensemble"), { recursive: true });
  fs.mkdirSync(path.join(m, "library-profiles", "etl"), { recursive: true });
  fs.mkdirSync(path.join(m, "library-profiles", "fmt"), { recursive: true });

  fs.writeFileSync(path.join(m, "e1m_modules", "E1M-AEN801.yaml"),
    "sku: E1M-AEN801\nfamily: alif-ensemble\nsilicon: alif:ensemble:e8\ndisplay_name: AEN801\ninference:\n  preferred_backend: ethos_u\ntopology:\n  m55_hp: { app: x }\ndefault_board: E1M-EVK\nstatus: { preliminary: false }\n");
  fs.writeFileSync(path.join(m, "e1m_modules", "README.md"), "# not a sku\n");
  fs.writeFileSync(path.join(m, "boards", "e1m-evk.yaml"),
    "name: e1m-evk\ndisplay_name: EVK\nhosts_som_families: [alif-ensemble]\npopulated: { lsm6dso: true }\n");
  fs.writeFileSync(path.join(m, "chips", "lsm6dso.yaml"),
    "chip_id: lsm6dso\ndisplay_name: LSM6DSO\nvendor: st\nbus: i2c\nfamilies: [aen]\n");
  fs.writeFileSync(path.join(m, "socs", "alif", "ensemble", "e7.json"),
    JSON.stringify({ ref: "alif:ensemble:e8", vendor: "Alif", family: "Ensemble", part: "E7", cores: [] }));
  fs.writeFileSync(path.join(m, "sdk_version.yaml"), 'version: "0.6.0"\nstatus: development\n');
}

test("loadSdkCatalogue reads the real metadata layout", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "alpsdk-"));
  try {
    writeTree(root);
    const cat = loadSdkCatalogue(root);
    assert.deepEqual(cat.soms.map((s) => s.sku), ["E1M-AEN801"]); // README.md ignored
    assert.deepEqual(cat.boards.map((b) => b.name), ["e1m-evk"]);
    assert.deepEqual(cat.chips.map((c) => c.chipId), ["lsm6dso"]);
    assert.deepEqual(cat.libraries.map((l) => l.id).sort(), ["etl", "fmt"]);
    assert.equal(cat.socs.length, 1);
    assert.equal(cat.sdkVersion, "0.6.0");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("loadSdkCatalogue returns empty catalogue for a missing root", () => {
  const cat = loadSdkCatalogue(null);
  assert.deepEqual(cat, { soms: [], boards: [], chips: [], libraries: [], socs: [], sdkVersion: undefined });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/sdkCatalogue.vscodeAdapter.test.js`
Expected: FAIL — `Cannot find module '../out/sdkCatalogue/vscodeAdapter.js'`.

- [ ] **Step 3: Implement the adapter**

Create `src/sdkCatalogue/vscodeAdapter.ts`:

```typescript
// SPDX-License-Identifier: Apache-2.0

import * as fs from "fs";
import * as path from "path";
import * as yaml from "js-yaml";
import {
  parseBoardPreset,
  parseChipDef,
  parseSocSpec,
  parseSomPreset,
} from "@alp-sdk/core/sdkCatalogue/parse";
import {
  BoardPreset,
  ChipDef,
  LibraryProfile,
  SdkCatalogue,
  SocSpec,
  SomPreset,
} from "@alp-sdk/core/sdkCatalogue/models";
import { log } from "../util";

function emptyCatalogue(): SdkCatalogue {
  return { soms: [], boards: [], chips: [], libraries: [], socs: [], sdkVersion: undefined };
}

function readUtf8(file: string): string {
  return fs.readFileSync(file, "utf-8");
}

function listFiles(dir: string, predicate: (name: string) => boolean): string[] {
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter(predicate)
    .map((name) => path.join(dir, name));
}

function parseEach<T>(files: string[], parse: (text: string) => T): T[] {
  const out: T[] = [];
  for (const file of files) {
    try {
      out.push(parse(readUtf8(file)));
    } catch (error) {
      log(`sdkCatalogue: failed to parse ${file}: ${error}`);
    }
  }
  return out;
}

function findJsonFiles(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...findJsonFiles(full));
    else if (entry.name.endsWith(".json")) out.push(full);
  }
  return out;
}

export function loadSdkCatalogue(sdkRoot: string | null): SdkCatalogue {
  if (!sdkRoot) return emptyCatalogue();
  const meta = path.join(sdkRoot, "metadata");
  if (!fs.existsSync(meta)) return emptyCatalogue();

  const soms: SomPreset[] = parseEach(
    listFiles(path.join(meta, "e1m_modules"), (n) => /^E1M-.*\.yaml$/.test(n)),
    parseSomPreset,
  ).sort((a, b) => a.sku.localeCompare(b.sku));

  const boards: BoardPreset[] = parseEach(
    listFiles(path.join(meta, "boards"), (n) => n.endsWith(".yaml")),
    parseBoardPreset,
  ).sort((a, b) => a.name.localeCompare(b.name));

  const chips: ChipDef[] = parseEach(
    listFiles(path.join(meta, "chips"), (n) => n.endsWith(".yaml")),
    parseChipDef,
  ).sort((a, b) => a.chipId.localeCompare(b.chipId));

  const socs: SocSpec[] = parseEach(findJsonFiles(path.join(meta, "socs")), parseSocSpec);

  const libDir = path.join(meta, "library-profiles");
  const libraries: LibraryProfile[] = fs.existsSync(libDir)
    ? fs
        .readdirSync(libDir, { withFileTypes: true })
        .filter((e) => e.isDirectory())
        .map((e) => ({ id: e.name }))
        .sort((a, b) => a.id.localeCompare(b.id))
    : [];

  let sdkVersion: string | undefined;
  const versionFile = path.join(meta, "sdk_version.yaml");
  if (fs.existsSync(versionFile)) {
    try {
      const v = (yaml.load(readUtf8(versionFile)) ?? {}) as Record<string, unknown>;
      if (typeof v.version === "string") sdkVersion = v.version;
    } catch (error) {
      log(`sdkCatalogue: failed to read sdk_version.yaml: ${error}`);
    }
  }

  return { soms, boards, chips, libraries, socs, sdkVersion };
}
```

- [ ] **Step 4: Compile and run the test to verify it passes**

Run: `pnpm run compile && node --test test/sdkCatalogue.vscodeAdapter.test.js`
Expected: PASS — 2/2.

- [ ] **Step 5: Run the new suites together + commit**

Run: `node --test test/sdkCatalogue.parse.test.js test/sdkCatalogue.derive.test.js test/sdkCatalogue.vscodeAdapter.test.js`
Expected: all PASS.

```bash
git add src/sdkCatalogue/vscodeAdapter.ts test/sdkCatalogue.vscodeAdapter.test.js
git commit -m "feat(catalogue): loadSdkCatalogue fs adapter with tests"
```

---

## Self-review notes

- **Spec coverage (Part 2 of the design):** models (Task 1) · parseSomPreset (1) ·
  parseBoardPreset (2) · parseChipDef (3) · parseSocSpec (4) · derivations
  boardsForSom/acceleratorAvailability/chipDefaults/coreIdsForSom (5) · fs adapter reading
  the real paths incl. library-profiles + socs + sdk_version (6). `chipsForSom` is
  explicitly deferred (documented above) pending the SoM-family↔chip-family token mapping.
- **Paths:** pure-core tests import `../packages/alp-core/dist/sdkCatalogue/*.js`
  (verified resolvable); the adapter test imports `../out/sdkCatalogue/vscodeAdapter.js`;
  `@alp-sdk/core/sdkCatalogue/*` resolves via the wildcard `exports`.
- **Type consistency:** `SomPreset`/`BoardPreset`/`ChipDef`/`SocSpec`/`SocCore`/
  `LibraryProfile`/`SdkCatalogue`/`AcceleratorAvail` defined once in `models.ts` and used
  identically by `parse.ts`, `derive.ts`, and the adapter.
- **No Claude co-author trailer** in any commit (per user preference).
- This plan changes no user-facing behavior; it is foundation tested via `node --test`.
  The v0.6 board model and the configurator UI follow as their own plans.
