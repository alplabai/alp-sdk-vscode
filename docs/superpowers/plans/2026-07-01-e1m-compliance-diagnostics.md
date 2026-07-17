# E1M Compliance Diagnostics (F1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** LSP diagnostics that check board.yaml E1M pad references against the selected SoM family's pinmux capability table — flagging functions that don't exist on the family and pads claimed twice.

**Architecture:** Pure domain logic lands in `@alp-sdk/core` (a pinmux parser + a compliance rule engine), a thin fs-backed loader lands in `src/pinmux/`, and the existing LSP server (`src/lsp/server.ts`) merges compliance diagnostics with the Python-validator diagnostics it already publishes. All new logic is pure-function-first and tested with `node:test`, matching the repo's existing pattern (pure functions in alp-core / `src/lsp/service.ts`, adapters injected with fs).

**Tech Stack:** TypeScript 6 (`tsc --build`), js-yaml (already an alp-core dependency), vscode-languageserver, node:test.

## Global Constraints

- Brand name is "Alp" in every user-visible string — never all-caps "ALP".
- Package manager is pnpm v11; run scripts with `pnpm run <script>` from the repo root.
- Tests are plain `.js` files in `test/` using `node:test`, importing compiled output (`@alp-sdk/core/<path>` resolves to `packages/alp-core/dist/<path>.js`; extension code from `../out/...`). You MUST run `pnpm run compile` after editing TS and before running tests.
- Run all tests with `pnpm test`. Run one file with `node --test test/<file>.test.js`.
- Commit messages: conventional commits, no Co-Authored-By or generated-by trailers.
- Diagnostics degrade gracefully: missing SDK root, missing pinmux table, or unparseable board.yaml → no compliance diagnostics, never an error surfaced to the user.

## Domain background (read before Task 1)

The E1M standard fixes the SoM edge-connector pinout. Each E1M pad carries a fixed standard function (e.g. `PWM6`) or is plain GPIO (`IO3`). Per the e1m-spec, every digital pad also has a universal GPIO secondary — using `E1M_GPIO_PWM6` (PWM6's pad as plain GPIO) is standard-compliant, NOT a deviation.

**Data source:** `{sdkRoot}/metadata/pinmux/<family>.yaml` (generated capability tables). Example (`aen.yaml`):

```yaml
schemaVersion: pinmux-capability-v1
family: aen
display_name: "E1M-AEN (Alif Ensemble)"
pads:
  - { e1m_pad: "A3",  e1m_function: "PWM6",   owner: "alif", silicon_peripheral: "UT3_T1_C", silicon_pad: "P10_7" }
  - { e1m_pad: "AG2", e1m_function: "IO3",    owner: "alif", silicon_peripheral: "GPIO",     silicon_pad: "P3.2" }
  - { e1m_pad: "A14", e1m_function: "ANA_S2", owner: "alif", silicon_peripheral: "ANA_S2",   silicon_pad: "P0_2" }
```

Today only `aen.yaml` exists; `imx93`, `v2n`, `v2n-m1` have TSV sources but no generated YAML yet — the loader must return null for those without complaining.

**board.yaml references** E1M names in two places (see `packages/alp-core/src/board/models.ts:149-181`):
- `e1m_routes.{gpio,buses,pwm,adc,dac,i2s,can,qenc}[].e1m` — e.g. `E1M_PWM6`, `E1M_GPIO_IO3`, `E1M_X_UART2`
- `pins[]` — bare string `"E1M_PWM6"` or object `{ e1m: "E1M_PWM6", macro?, doc? }`

**Name mapping** board.yaml → pinmux table:
- Strip `E1M_` or `E1M_X_` prefix; a following `GPIO_` marks the GPIO secondary (strip it too): `E1M_GPIO_PWM6` → function `PWM6`.
- `ADC<N>` maps to pinmux function `ANA_S<N>` (`E1M_ADC2` → `ANA_S2`).
- A function name claims every pad whose `e1m_function` equals it OR starts with it + `_` (so `E1M_ENC3` claims `ENC3_X` and `ENC3_Y`; `E1M_I2C0` claims `I2C0_SDA` and `I2C0_SCL`).

**Rules (v1):**
- R1 (error): referenced function resolves to zero pads in the family table → "not available on this SoM family".
- R2 (error): two different references claim the same physical pad (e.g. `E1M_PWM6` in `pwm:` and `E1M_GPIO_PWM6` in `gpio:`) → "one owner per pad".
- Malformed names (not matching the `E1M_*` grammar) are ignored — the JSON schema (`schemas/board.schema.json`) already rejects those.

Why LSP and not schema: the JSON schema is static and SKU-blind. It validates name *shape*; only these diagnostics can validate names against the *selected SoM family's* actual capability table.

---

### Task 1: Pinmux table model + parser (alp-core)

**Files:**
- Create: `packages/alp-core/src/pinmux/models.ts`
- Create: `packages/alp-core/src/pinmux/parse.ts`
- Test: `test/pinmux.parse.test.js`

**Interfaces:**
- Consumes: nothing new (js-yaml already in alp-core deps).
- Produces: `PinmuxPad`, `PinmuxTable` interfaces; `parsePinmuxTable(text: string): PinmuxTable`. Tasks 2, 3 import these.

- [ ] **Step 1: Write the failing test**

Create `test/pinmux.parse.test.js`:

```js
// SPDX-License-Identifier: Apache-2.0
const test = require("node:test");
const assert = require("node:assert");
const { parsePinmuxTable } = require("@alp-sdk/core/pinmux/parse");

const SAMPLE = `
schemaVersion: pinmux-capability-v1
family: aen
display_name: "E1M-AEN (Alif Ensemble)"
pads:
  - { e1m_pad: "A3",  e1m_function: "PWM6",   owner: "alif", silicon_peripheral: "UT3_T1_C", silicon_pad: "P10_7" }
  - { e1m_pad: "AG2", e1m_function: "IO3",    owner: "alif", silicon_peripheral: "GPIO",     silicon_pad: "P3.2" }
  - { e1m_pad: "AG18", e1m_function: "IO6",   owner: "alif", silicon_peripheral: "",         silicon_pad: "P9.7" }
`;

test("parsePinmuxTable reads family, display name and pads", () => {
  const table = parsePinmuxTable(SAMPLE);
  assert.strictEqual(table.family, "aen");
  assert.strictEqual(table.displayName, "E1M-AEN (Alif Ensemble)");
  assert.strictEqual(table.pads.length, 3);
  assert.deepStrictEqual(table.pads[0], {
    e1mPad: "A3",
    e1mFunction: "PWM6",
    owner: "alif",
    siliconPeripheral: "UT3_T1_C",
    siliconPad: "P10_7",
  });
});

test("parsePinmuxTable keeps GPIO-only pads with empty silicon_peripheral", () => {
  const table = parsePinmuxTable(SAMPLE);
  assert.strictEqual(table.pads[2].siliconPeripheral, "");
});

test("parsePinmuxTable tolerates empty or malformed input", () => {
  assert.deepStrictEqual(parsePinmuxTable(""), { family: "", displayName: undefined, pads: [] });
  assert.deepStrictEqual(parsePinmuxTable("family: 3\npads: nope"), {
    family: "",
    displayName: undefined,
    pads: [],
  });
  const missingKeys = parsePinmuxTable("family: aen\npads:\n  - { e1m_pad: \"A3\" }");
  assert.strictEqual(missingKeys.pads.length, 0);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm run compile && node --test test/pinmux.parse.test.js`
Expected: FAIL with `Cannot find module '@alp-sdk/core/pinmux/parse'`

- [ ] **Step 3: Write the implementation**

Create `packages/alp-core/src/pinmux/models.ts`:

```typescript
// SPDX-License-Identifier: Apache-2.0

/** One row of a pinmux capability table: an E1M edge pad and the silicon function backing it. */
export interface PinmuxPad {
  e1mPad: string;
  e1mFunction: string;
  owner: string;
  /** Empty string when the pad is plain GPIO (no dedicated peripheral mux). */
  siliconPeripheral: string;
  siliconPad: string;
}

/** Parsed metadata/pinmux/<family>.yaml (pinmux-capability-v1). */
export interface PinmuxTable {
  family: string;
  displayName?: string;
  pads: PinmuxPad[];
}
```

Create `packages/alp-core/src/pinmux/parse.ts`:

```typescript
// SPDX-License-Identifier: Apache-2.0

import * as yaml from "js-yaml";
import { PinmuxPad, PinmuxTable } from "./models";

/** Parse a metadata/pinmux/<family>.yaml capability table. Malformed input yields an empty table. */
export function parsePinmuxTable(text: string): PinmuxTable {
  let raw: unknown;
  try {
    raw = yaml.load(text);
  } catch {
    raw = null;
  }

  if (!raw || typeof raw !== "object") {
    return { family: "", displayName: undefined, pads: [] };
  }

  const doc = raw as Record<string, unknown>;
  const family = typeof doc.family === "string" ? doc.family : "";
  const displayName =
    typeof doc.display_name === "string" ? doc.display_name : undefined;

  const pads: PinmuxPad[] = [];
  if (Array.isArray(doc.pads)) {
    for (const entry of doc.pads) {
      if (!entry || typeof entry !== "object") {
        continue;
      }

      const pad = entry as Record<string, unknown>;
      if (typeof pad.e1m_pad !== "string" || typeof pad.e1m_function !== "string") {
        continue;
      }

      pads.push({
        e1mPad: pad.e1m_pad,
        e1mFunction: pad.e1m_function,
        owner: typeof pad.owner === "string" ? pad.owner : "",
        siliconPeripheral:
          typeof pad.silicon_peripheral === "string" ? pad.silicon_peripheral : "",
        siliconPad: typeof pad.silicon_pad === "string" ? pad.silicon_pad : "",
      });
    }
  }

  return { family, displayName, pads };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm run compile && node --test test/pinmux.parse.test.js`
Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
git add packages/alp-core/src/pinmux/models.ts packages/alp-core/src/pinmux/parse.ts test/pinmux.parse.test.js
git commit -m "feat(alp-core): add pinmux capability table model and parser"
```

---

### Task 2: E1M compliance rule engine (alp-core)

**Files:**
- Create: `packages/alp-core/src/board/e1mCompliance.ts`
- Test: `test/board.e1mCompliance.test.js`

**Interfaces:**
- Consumes: `BoardConfig`, `E1mRoutes` from `packages/alp-core/src/board/models.ts` (existing); `PinmuxTable`, `PinmuxPad` from Task 1.
- Produces (Task 5 imports these):

```typescript
export interface E1mComplianceIssue {
  message: string;
  severity: "error" | "warning";
  /** The offending board.yaml token, verbatim — used to locate the diagnostic range. */
  token: string;
}
export interface NormalizedE1mName { fn: string; gpioSecondary: boolean; }
export function normalizeE1mName(name: string): NormalizedE1mName | null;
export function checkE1mCompliance(cfg: BoardConfig, table: PinmuxTable): E1mComplianceIssue[];
```

- [ ] **Step 1: Write the failing test**

Create `test/board.e1mCompliance.test.js`:

```js
// SPDX-License-Identifier: Apache-2.0
const test = require("node:test");
const assert = require("node:assert");
const {
  normalizeE1mName,
  checkE1mCompliance,
} = require("@alp-sdk/core/board/e1mCompliance");

const TABLE = {
  family: "aen",
  displayName: "E1M-AEN (Alif Ensemble)",
  pads: [
    { e1mPad: "A3", e1mFunction: "PWM6", owner: "alif", siliconPeripheral: "UT3_T1_C", siliconPad: "P10_7" },
    { e1mPad: "AG2", e1mFunction: "IO3", owner: "alif", siliconPeripheral: "GPIO", siliconPad: "P3.2" },
    { e1mPad: "A14", e1mFunction: "ANA_S2", owner: "alif", siliconPeripheral: "ANA_S2", siliconPad: "P0_2" },
    { e1mPad: "A7", e1mFunction: "ENC3_X", owner: "alif", siliconPeripheral: "QEC3_X_A", siliconPad: "P4_1" },
    { e1mPad: "B7", e1mFunction: "ENC3_Y", owner: "alif", siliconPeripheral: "QEC3_Y_A", siliconPad: "P4_2" },
  ],
};

function boardWith(routes, pins) {
  return { som: { sku: "E1M-AEN801" }, cores: {}, e1m_routes: routes, pins };
}

test("normalizeE1mName handles primary, GPIO-secondary, X-connector and ADC forms", () => {
  assert.deepStrictEqual(normalizeE1mName("E1M_PWM6"), { fn: "PWM6", gpioSecondary: false });
  assert.deepStrictEqual(normalizeE1mName("E1M_GPIO_PWM6"), { fn: "PWM6", gpioSecondary: true });
  assert.deepStrictEqual(normalizeE1mName("E1M_X_UART2"), { fn: "UART2", gpioSecondary: false });
  assert.deepStrictEqual(normalizeE1mName("E1M_ADC2"), { fn: "ANA_S2", gpioSecondary: false });
  assert.strictEqual(normalizeE1mName("not-a-pad"), null);
});

test("valid references produce no issues", () => {
  const cfg = boardWith(
    { pwm: [{ e1m: "E1M_PWM6", macro: "LED" }], gpio: [{ e1m: "E1M_GPIO_IO3", macro: "BTN" }] },
    ["E1M_ADC2"],
  );
  assert.deepStrictEqual(checkE1mCompliance(cfg, TABLE), []);
});

test("unknown function on the family is an error", () => {
  const cfg = boardWith({ pwm: [{ e1m: "E1M_PWM9", macro: "LED" }] }, undefined);
  const issues = checkE1mCompliance(cfg, TABLE);
  assert.strictEqual(issues.length, 1);
  assert.strictEqual(issues[0].severity, "error");
  assert.strictEqual(issues[0].token, "E1M_PWM9");
  assert.match(issues[0].message, /not available/);
  assert.match(issues[0].message, /aen/);
});

test("two references claiming the same pad is an error", () => {
  const cfg = boardWith(
    { pwm: [{ e1m: "E1M_PWM6", macro: "LED" }], gpio: [{ e1m: "E1M_GPIO_PWM6", macro: "BTN" }] },
    undefined,
  );
  const issues = checkE1mCompliance(cfg, TABLE);
  assert.strictEqual(issues.length, 1);
  assert.strictEqual(issues[0].severity, "error");
  // gpio section is collected before pwm, so the pwm entry is the second claimer.
  assert.strictEqual(issues[0].token, "E1M_PWM6");
  assert.match(issues[0].message, /A3/);
  assert.match(issues[0].message, /E1M_GPIO_PWM6/);
  assert.match(issues[0].message, /one owner per pad/);
});

test("prefix functions claim all matching pads (ENC3 takes X and Y)", () => {
  const cfg = boardWith(
    { qenc: [{ e1m: "E1M_ENC3", macro: "WHEEL" }], gpio: [{ e1m: "E1M_GPIO_ENC3_X", macro: "BTN" }] },
    undefined,
  );
  const issues = checkE1mCompliance(cfg, TABLE);
  assert.strictEqual(issues.length, 1);
  assert.match(issues[0].message, /A7/);
});

test("pins accepts bare strings and objects", () => {
  const cfg = boardWith(undefined, ["E1M_PWM9", { e1m: "E1M_GPIO_IO3" }]);
  const issues = checkE1mCompliance(cfg, TABLE);
  assert.strictEqual(issues.length, 1);
  assert.strictEqual(issues[0].token, "E1M_PWM9");
});

test("malformed names and empty config are ignored", () => {
  const cfg = boardWith({ gpio: [{ e1m: "TOTALLY_WRONG", macro: "X" }] }, undefined);
  assert.deepStrictEqual(checkE1mCompliance(cfg, TABLE), []);
  assert.deepStrictEqual(
    checkE1mCompliance({ som: { sku: "E1M-AEN801" }, cores: {} }, TABLE),
    [],
  );
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm run compile && node --test test/board.e1mCompliance.test.js`
Expected: FAIL with `Cannot find module '@alp-sdk/core/board/e1mCompliance'`

- [ ] **Step 3: Write the implementation**

Create `packages/alp-core/src/board/e1mCompliance.ts`:

```typescript
// SPDX-License-Identifier: Apache-2.0

import { PinmuxPad, PinmuxTable } from "../pinmux/models";
import { BoardConfig, E1mRoutes } from "./models";

/** One E1M-standard compliance finding against a board.yaml. */
export interface E1mComplianceIssue {
  message: string;
  severity: "error" | "warning";
  /** The offending board.yaml token, verbatim — used to locate the diagnostic range. */
  token: string;
}

export interface NormalizedE1mName {
  /** Pinmux-table function name (e.g. "PWM6", "IO3", "ANA_S2"). */
  fn: string;
  /** True for E1M_GPIO_<PAD> secondary usage (standard-compliant per the e1m-spec). */
  gpioSecondary: boolean;
}

const E1M_NAME = /^E1M(_X)?_(GPIO_)?([A-Z0-9_]+)$/;

/**
 * Map a board.yaml E1M reference to its pinmux-table function name.
 * Returns null for names outside the E1M grammar (the JSON schema rejects those).
 */
export function normalizeE1mName(name: string): NormalizedE1mName | null {
  const match = E1M_NAME.exec(name);
  if (!match) {
    return null;
  }

  const gpioSecondary = Boolean(match[2]);
  let fn = match[3];

  const adc = /^ADC(\d+)$/.exec(fn);
  if (adc) {
    fn = `ANA_S${adc[1]}`;
  }

  return { fn, gpioSecondary };
}

/** A function claims every pad it matches exactly or as a prefix (E1M_ENC3 -> ENC3_X + ENC3_Y). */
function padsForFunction(table: PinmuxTable, fn: string): PinmuxPad[] {
  return table.pads.filter(
    (pad) => pad.e1mFunction === fn || pad.e1mFunction.startsWith(`${fn}_`),
  );
}

const ROUTE_SECTIONS: (keyof E1mRoutes)[] = [
  "gpio",
  "buses",
  "pwm",
  "adc",
  "dac",
  "i2s",
  "can",
  "qenc",
];

interface E1mRef {
  name: string;
}

function collectE1mRefs(cfg: BoardConfig): E1mRef[] {
  const refs: E1mRef[] = [];

  if (cfg.e1m_routes) {
    for (const section of ROUTE_SECTIONS) {
      for (const entry of cfg.e1m_routes[section] ?? []) {
        if (entry && typeof entry.e1m === "string") {
          refs.push({ name: entry.e1m });
        }
      }
    }
  }

  for (const pin of cfg.pins ?? []) {
    if (typeof pin === "string") {
      refs.push({ name: pin });
    } else if (pin && typeof pin.e1m === "string") {
      refs.push({ name: pin.e1m });
    }
  }

  return refs;
}

/**
 * Check every E1M pad reference in the board config against the SoM family's
 * pinmux capability table.  Rules:
 *   R1 (error): the referenced function does not exist on this family.
 *   R2 (error): two different references claim the same physical pad.
 */
export function checkE1mCompliance(
  cfg: BoardConfig,
  table: PinmuxTable,
): E1mComplianceIssue[] {
  const issues: E1mComplianceIssue[] = [];
  const claims = new Map<string, string>();

  for (const ref of collectE1mRefs(cfg)) {
    const normalized = normalizeE1mName(ref.name);
    if (!normalized) {
      continue;
    }

    const pads = padsForFunction(table, normalized.fn);
    if (pads.length === 0) {
      issues.push({
        message: `${ref.name}: E1M function "${normalized.fn}" is not available on the ${table.family} SoM family.`,
        severity: "error",
        token: ref.name,
      });
      continue;
    }

    for (const pad of pads) {
      const existing = claims.get(pad.e1mPad);
      if (existing && existing !== ref.name) {
        issues.push({
          message: `${ref.name}: E1M pad ${pad.e1mPad} is already claimed by ${existing} — the E1M standard allows one owner per pad.`,
          severity: "error",
          token: ref.name,
        });
      } else {
        claims.set(pad.e1mPad, ref.name);
      }
    }
  }

  return issues;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm run compile && node --test test/board.e1mCompliance.test.js`
Expected: PASS (6 tests)

- [ ] **Step 5: Run the full suite to check for regressions**

Run: `pnpm test`
Expected: all tests PASS

- [ ] **Step 6: Commit**

```bash
git add packages/alp-core/src/board/e1mCompliance.ts test/board.e1mCompliance.test.js
git commit -m "feat(alp-core): add E1M compliance rule engine for board.yaml pad references"
```

---

### Task 3: Pinmux loader with SKU→family mapping (extension)

**Files:**
- Create: `src/pinmux/loader.ts`
- Test: `test/pinmux.loader.test.js`

**Interfaces:**
- Consumes: `parsePinmuxTable`, `PinmuxTable` from Task 1.
- Produces (Task 5 imports these):

```typescript
export type ReadFileFn = (filePath: string) => string;
export function pinmuxFamilyForSku(sku: string): string | null;
export function loadPinmuxTable(sdkRoot: string, sku: string, readFile?: ReadFileFn): PinmuxTable | null;
export function clearPinmuxTableCache(): void;
```

- [ ] **Step 1: Write the failing test**

Create `test/pinmux.loader.test.js`:

```js
// SPDX-License-Identifier: Apache-2.0
const test = require("node:test");
const assert = require("node:assert");
const path = require("node:path");
const {
  pinmuxFamilyForSku,
  loadPinmuxTable,
  clearPinmuxTableCache,
} = require("../out/pinmux/loader.js");

const SAMPLE = 'family: aen\npads:\n  - { e1m_pad: "A3", e1m_function: "PWM6", owner: "alif", silicon_peripheral: "UT3_T1_C", silicon_pad: "P10_7" }\n';

test("pinmuxFamilyForSku maps known SKU prefixes", () => {
  assert.strictEqual(pinmuxFamilyForSku("E1M-AEN801"), "aen");
  assert.strictEqual(pinmuxFamilyForSku("E1M-NX9101"), "imx93");
  assert.strictEqual(pinmuxFamilyForSku("E1M-V2N101"), "v2n");
  assert.strictEqual(pinmuxFamilyForSku("E1M-V2M102"), "v2n-m1");
  assert.strictEqual(pinmuxFamilyForSku("UNKNOWN-1"), null);
});

test("loadPinmuxTable reads metadata/pinmux/<family>.yaml under the SDK root", () => {
  clearPinmuxTableCache();
  const seen = [];
  const table = loadPinmuxTable("/sdk", "E1M-AEN801", (filePath) => {
    seen.push(filePath);
    return SAMPLE;
  });
  assert.strictEqual(seen.length, 1);
  assert.strictEqual(seen[0], path.join("/sdk", "metadata", "pinmux", "aen.yaml"));
  assert.strictEqual(table.family, "aen");
  assert.strictEqual(table.pads.length, 1);
});

test("loadPinmuxTable returns null when the table file is missing", () => {
  clearPinmuxTableCache();
  const table = loadPinmuxTable("/sdk", "E1M-V2N101", () => {
    throw new Error("ENOENT");
  });
  assert.strictEqual(table, null);
});

test("loadPinmuxTable returns null for unknown SKUs without touching the filesystem", () => {
  clearPinmuxTableCache();
  const table = loadPinmuxTable("/sdk", "BOGUS", () => {
    throw new Error("should not be called");
  });
  assert.strictEqual(table, null);
});

test("loadPinmuxTable caches per sdkRoot + family", () => {
  clearPinmuxTableCache();
  let reads = 0;
  const readFile = () => {
    reads += 1;
    return SAMPLE;
  };
  loadPinmuxTable("/sdk", "E1M-AEN801", readFile);
  loadPinmuxTable("/sdk", "E1M-AEN301", readFile); // same family -> cached
  assert.strictEqual(reads, 1);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm run compile && node --test test/pinmux.loader.test.js`
Expected: FAIL with `Cannot find module '../out/pinmux/loader.js'`

- [ ] **Step 3: Write the implementation**

Create `src/pinmux/loader.ts`:

```typescript
// SPDX-License-Identifier: Apache-2.0

import * as fs from "fs";
import * as path from "path";
import { PinmuxTable } from "@alp-sdk/core/pinmux/models";
import { parsePinmuxTable } from "@alp-sdk/core/pinmux/parse";

export type ReadFileFn = (filePath: string) => string;

/**
 * SKU prefix -> metadata/pinmux/<family>.yaml file stem.  Only families with a
 * generated capability table resolve to data; the rest fail soft in
 * loadPinmuxTable (today only aen.yaml is generated upstream).
 */
const SKU_PINMUX_FAMILY: ReadonlyArray<readonly [RegExp, string]> = [
  [/^E1M-AEN/, "aen"],
  [/^E1M-NX9/, "imx93"],
  [/^E1M-V2N/, "v2n"],
  [/^E1M-V2M/, "v2n-m1"],
];

export function pinmuxFamilyForSku(sku: string): string | null {
  for (const [pattern, family] of SKU_PINMUX_FAMILY) {
    if (pattern.test(sku)) {
      return family;
    }
  }

  return null;
}

const tableCache = new Map<string, PinmuxTable | null>();

/** Load (and cache) the pinmux capability table for a SoM SKU.  Null when unknown or unreadable. */
export function loadPinmuxTable(
  sdkRoot: string,
  sku: string,
  readFile: ReadFileFn = (filePath) => fs.readFileSync(filePath, "utf8"),
): PinmuxTable | null {
  const family = pinmuxFamilyForSku(sku);
  if (!family) {
    return null;
  }

  const cacheKey = `${sdkRoot}::${family}`;
  const cached = tableCache.get(cacheKey);
  if (cached !== undefined) {
    return cached;
  }

  let table: PinmuxTable | null = null;
  try {
    const filePath = path.join(sdkRoot, "metadata", "pinmux", `${family}.yaml`);
    table = parsePinmuxTable(readFile(filePath));
  } catch {
    table = null;
  }

  tableCache.set(cacheKey, table);
  return table;
}

export function clearPinmuxTableCache(): void {
  tableCache.clear();
}
```

Note: the cache never invalidates within a server lifetime — pinmux tables are generated SDK artifacts that change only with an SDK update, and the LSP server restarts on window reload. Good enough for v1.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm run compile && node --test test/pinmux.loader.test.js`
Expected: PASS (5 tests)

- [ ] **Step 5: Commit**

```bash
git add src/pinmux/loader.ts test/pinmux.loader.test.js
git commit -m "feat(lsp): add pinmux table loader with SKU to family mapping"
```

---

### Task 4: Token range locator (LSP service)

**Files:**
- Modify: `src/lsp/service.ts` (append to end of file)
- Test: `test/lsp.service.test.js` (append new tests)

**Interfaces:**
- Consumes: nothing.
- Produces (Task 5 imports this):

```typescript
export interface TokenRange {
  start: { line: number; character: number };
  end: { line: number; character: number };
}
export function findTokenRange(documentText: string, token: string): TokenRange;
```

- [ ] **Step 1: Write the failing test**

Append to `test/lsp.service.test.js`:

```js
test("findTokenRange locates the first occurrence of a token", () => {
  const { findTokenRange } = require("../out/lsp/service.js");
  const doc = "som:\n  sku: E1M-AEN801\ne1m_routes:\n  pwm:\n    - e1m: E1M_PWM9\n";
  const range = findTokenRange(doc, "E1M_PWM9");
  assert.deepStrictEqual(range, {
    start: { line: 4, character: 11 },
    end: { line: 4, character: 19 },
  });
});

test("findTokenRange falls back to document start when the token is absent", () => {
  const { findTokenRange } = require("../out/lsp/service.js");
  const fallback = { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } };
  assert.deepStrictEqual(findTokenRange("som:\n", "E1M_PWM9"), fallback);
  assert.deepStrictEqual(findTokenRange("anything", ""), fallback);
});
```

(Use the same `require`/`assert` style already present at the top of `test/lsp.service.test.js` — if the file imports `../out/lsp/service.js` once at the top, reuse that binding instead of re-requiring.)

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm run compile && node --test test/lsp.service.test.js`
Expected: FAIL with `findTokenRange is not a function`

- [ ] **Step 3: Write the implementation**

Append to `src/lsp/service.ts`:

```typescript
export interface TokenRange {
  start: { line: number; character: number };
  end: { line: number; character: number };
}

/** Locate the first occurrence of a token in the document; document start when absent. */
export function findTokenRange(documentText: string, token: string): TokenRange {
  if (token) {
    const lines = documentText.split(/\r?\n/);
    for (let line = 0; line < lines.length; line += 1) {
      const character = lines[line].indexOf(token);
      if (character >= 0) {
        return {
          start: { line, character },
          end: { line, character: character + token.length },
        };
      }
    }
  }

  return { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm run compile && node --test test/lsp.service.test.js`
Expected: PASS (all existing + 2 new tests)

- [ ] **Step 5: Commit**

```bash
git add src/lsp/service.ts test/lsp.service.test.js
git commit -m "feat(lsp): add findTokenRange for locating diagnostic tokens"
```

---

### Task 5: Wire compliance diagnostics into the LSP server

**Files:**
- Modify: `src/lsp/server.ts`

**Interfaces:**
- Consumes: `checkE1mCompliance` (Task 2), `loadPinmuxTable` (Task 3), `findTokenRange` (Task 4), existing `parseBoardConfig` from `@alp-sdk/core/board/parse`.
- Produces: no new exports — behavior change only. Compliance diagnostics are published alongside Python-validator diagnostics with `source: "alp-sdk"`.

The server itself has no unit tests (it is connection-bound); all logic it calls was tested in Tasks 1-4. Verification here is compile + full suite + bundle + manual smoke.

- [ ] **Step 1: Add imports**

In `src/lsp/server.ts`, after the existing `@alp-sdk/core` imports (below line 32, `} from "@alp-sdk/core/validation/service";`), add:

```typescript
import { checkE1mCompliance } from "@alp-sdk/core/board/e1mCompliance";
import { parseBoardConfig } from "@alp-sdk/core/board/parse";
import { loadPinmuxTable } from "../pinmux/loader";
```

And add `findTokenRange` to the existing `./service` import list (the block ending `} from "./service";` around line 46):

```typescript
  createIssueRange,
  findTokenRange,
  normalizeProjectSettings,
```

- [ ] **Step 2: Add the compliance diagnostics helper**

Add this function directly below `createDiagnostics` (after `src/lsp/server.ts:328`):

```typescript
function createComplianceDiagnostics(
  documentText: string,
  sdkRoot: string | null | undefined,
): Diagnostic[] {
  if (!sdkRoot) {
    return [];
  }

  let boardConfig;
  try {
    boardConfig = parseBoardConfig(documentText);
  } catch {
    return [];
  }

  const sku = boardConfig?.som?.sku;
  if (typeof sku !== "string" || !sku) {
    return [];
  }

  const table = loadPinmuxTable(sdkRoot, sku);
  if (!table) {
    return [];
  }

  return checkE1mCompliance(boardConfig, table).map((issue) => ({
    range: findTokenRange(documentText, issue.token),
    message: issue.message,
    severity:
      issue.severity === "error"
        ? DiagnosticSeverity.Error
        : DiagnosticSeverity.Warning,
    source: "alp-sdk",
  }));
}
```

- [ ] **Step 3: Merge compliance diagnostics in validateDocument**

In `validateDocument` (`src/lsp/server.ts:275-313`), replace the tail of the function — everything from `const plan = createValidatorPlan(context, filePath);` to the end — with:

```typescript
  const complianceDiagnostics = createComplianceDiagnostics(
    documentText,
    context.sdkRoot,
  );

  const plan = createValidatorPlan(context, filePath);
  const execution = executeValidatorPlanWithSpawn(context, plan, cp.spawnSync);
  connection.console.log(`$ ${plan.commandLine} (rv=${execution.status})`);

  const validation = analyzeValidationResult(execution);
  if (validation.outcome === "clean") {
    connection.sendDiagnostics({ uri, diagnostics: complianceDiagnostics });
    return;
  }

  const diagnostics = [
    ...createDiagnostics(documentText, validation.issues),
    ...complianceDiagnostics,
  ];
  connection.sendDiagnostics({ uri, diagnostics });
```

(The only changes: compute `complianceDiagnostics` first, publish them on the previously-empty "clean" path, and concat them on the issue path.)

- [ ] **Step 4: Compile, run full suite, bundle**

Run: `pnpm run compile && pnpm test && pnpm run bundle`
Expected: compile clean, all tests PASS, bundle emits `out/extension.js` + `out/lsp/server.js` without errors.

- [ ] **Step 5: Manual smoke test**

1. Open this repo in VS Code, press F5 (Extension Development Host).
2. In the dev host, open a workspace containing the alp-sdk checkout and a `board.yaml` with `som: { sku: E1M-AEN801 }`.
3. Add under `e1m_routes:` → `pwm:` an entry `- { e1m: E1M_PWM9, macro: LED }` — expect an error diagnostic on `E1M_PWM9`: `E1M function "PWM9" is not available on the aen SoM family.`
4. Change it to `E1M_PWM6` and add a `gpio:` entry `- { e1m: E1M_GPIO_PWM6, macro: BTN }` — expect a one-owner-per-pad error on `E1M_GPIO_PWM6` naming pad `A3`.
5. Remove the gpio entry — expect all compliance diagnostics to clear.

(If the dev host is flaky per project memory, the compile + test + bundle gate in Step 4 is the required bar; note smoke-test results either way.)

- [ ] **Step 6: Commit**

```bash
git add src/lsp/server.ts
git commit -m "feat(lsp): publish E1M compliance diagnostics for board.yaml"
```

---

## Out of scope (future tasks, not this plan)

- Quick fixes for compliance issues (e.g. "replace with nearest available function").
- Deviation *warnings* for silicon-level remapping — board.yaml cannot express those today.
- Generating pinmux YAML for imx93/v2n/v2n-m1 families (upstream alp-sdk work).
- Hover/pinout UI (F2) and provenance trace (F3) — separate plans.
