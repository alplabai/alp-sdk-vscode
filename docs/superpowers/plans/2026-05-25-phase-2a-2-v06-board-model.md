# Phase 2a-2: v0.6 Board Model Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A typed `BoardConfig` model for the real v0.6 `board.yaml` plus `parseBoardConfig` / `serializeBoardConfig` that round-trip the data faithfully — the editing model the redesigned configurator will read and write.

**Architecture:** Pure code in `@alp-sdk/core/board/` (no `fs`/`vscode`), mirroring the authoritative `board.schema.json`. `parseBoardConfig` maps `js-yaml`-loaded YAML to the typed model by picking the schema's known top-level keys; `serializeBoardConfig` emits them in a canonical order via `js-yaml`. Round-trip is data-stable (`parse(serialize(parse(x))) deepEqual parse(x)`), not byte-stable (comments/formatting are not preserved — that is acceptable for a config the SDK normalizes anyway). Validation + legacy migration are a separate later plan.

**Tech Stack:** TypeScript (CommonJS), `js-yaml` (already an `@alp-sdk/core` dependency), `node:test` + `node:assert/strict`. Build: `pnpm run compile`. Pure tests import `../packages/alp-core/dist/board/*.js`.

---

## Reference facts

- Authoritative schema: `metadata/schemas/board.schema.json` in the alp-sdk checkout
  (`C:\Users\caner\Documents\GitHub\alp-sdk`). Top level (`additionalProperties:false`,
  required `som`+`cores`, top-level `os` **forbidden**): `name?`, `description?`,
  `preset?`, `hw_rev?`, `som{sku,hw_rev?}`, `cores{<id>:CoreEntry}`, `populated?`,
  `e1m_routes?`, `pins?`, `ipc?`, `diagnostics?`, `storage?`, `security?`, `boot?`,
  `ota?`, `chips?`, `features?`, `supported_boards?`.
- `CoreEntry`: `os(zephyr|yocto|baremetal|off)?`, `app?`, `image?`, `peripherals?[]`,
  `libraries?[]`, `extra_libraries?[]`, `memory?{stack_kib,heap_kib,isr_stack_kib}`,
  `power?{sleep_mode,wakeup_sources[]}`, `inference?{default_arena_kib}`,
  `iot?{wifi,mqtt,ble,tls}`.
- Real example shapes are the fixtures below (taken from alp-sdk `examples/`).
- `@alp-sdk/core` resolves subpaths via `exports: {"./*": "./dist/*.js"}` — new
  `board/*` subpaths work with no package.json change. Core compiles to
  `packages/alp-core/dist/`.

## File Structure

- `packages/alp-core/src/board/models.ts` — all v0.6 `BoardConfig` interfaces/types.
- `packages/alp-core/src/board/parse.ts` — `parseBoardConfig`.
- `packages/alp-core/src/board/serialize.ts` — `serializeBoardConfig` + canonical key order.
- Tests: `test/board.parse.test.js`, `test/board.serialize.test.js`.

---

### Task 1: Models + `parseBoardConfig`

**Files:**
- Create: `packages/alp-core/src/board/models.ts`
- Create: `packages/alp-core/src/board/parse.ts`
- Test: `test/board.parse.test.js`

- [ ] **Step 1: Write the failing test**

Create `test/board.parse.test.js`:

```javascript
const test = require("node:test");
const assert = require("node:assert/strict");

const { parseBoardConfig } = require("../packages/alp-core/dist/board/parse.js");

const EDGEAI = `
som:
  sku: E1M-AEN701
preset: e1m-evk
pins:
  - { e1m: E1M_I2C0, macro: EVK_I2C_BUS_SENSORS, doc: "Shared sensor bus" }
cores:
  a32_cluster:
    os: "off"
  m55_hp:
    app: ./src
    inference:
      default_arena_kib: 256
diagnostics:
  log_level: info
`;

const OBJDET = `
som:
  sku: E1M-V2M101
preset: e1m-evk
chips:
  - ov5640
  - st7789
cores:
  a55_cluster:
    os: "off"
  m33_sm:
    app: ./src
    libraries:
      - cmsis_dsp
`;

const PRODUCTION = `
som:
  sku: E1M-AEN701
preset: e1m-evk
cores:
  a32_cluster:
    os: "off"
  m55_hp:
    app: ./src
    iot: { wifi: true, mqtt: true, tls: true }
    libraries: [mbedtls]
    memory: { stack_kib: 8, heap_kib: 64, isr_stack_kib: 4 }
    power:
      sleep_mode: standby
      wakeup_sources: [uart, gpio, rtc]
  m55_he:
    os: "off"
chips:
  - optiga_trust_m
  - eeprom_24c128
boot:
  method: mcuboot
  signing: { algorithm: ecdsa_p256, key_file: keys/prod_ecdsa_p256.pub.pem }
  slots:
    primary: { size_kib: 1024 }
    secondary: { size_kib: 1024 }
  swap_algorithm: scratch
  scratch_size_kib: 64
  anti_rollback: true
ota:
  provider: mender
  artifact_name: production-deployment
  server: { url: "https://hosted.mender.io" }
  rollback: { enabled: true, retries: 3, min_version: 1 }
  poll_interval_s: 1800
diagnostics:
  log_level: info
`;

// Export fixtures for the serialize test to reuse.
module.exports = { EDGEAI, OBJDET, PRODUCTION };

test("parseBoardConfig maps the EDGEAI example", () => {
  const c = parseBoardConfig(EDGEAI);
  assert.equal(c.som.sku, "E1M-AEN701");
  assert.equal(c.preset, "e1m-evk");
  assert.deepEqual(Object.keys(c.cores), ["a32_cluster", "m55_hp"]);
  assert.equal(c.cores.a32_cluster.os, "off");
  assert.equal(c.cores.m55_hp.inference.default_arena_kib, 256);
  assert.equal(c.pins.length, 1);
  assert.equal(c.diagnostics.log_level, "info");
});

test("parseBoardConfig maps the OBJDET example (chips + per-core libraries)", () => {
  const c = parseBoardConfig(OBJDET);
  assert.equal(c.som.sku, "E1M-V2M101");
  assert.deepEqual(c.chips, ["ov5640", "st7789"]);
  assert.deepEqual(c.cores.m33_sm.libraries, ["cmsis_dsp"]);
});

test("parseBoardConfig maps the PRODUCTION example (boot/ota/memory/power/iot)", () => {
  const c = parseBoardConfig(PRODUCTION);
  assert.equal(c.cores.m55_hp.iot.wifi, true);
  assert.equal(c.cores.m55_hp.memory.stack_kib, 8);
  assert.equal(c.cores.m55_hp.power.sleep_mode, "standby");
  assert.deepEqual(c.cores.m55_hp.power.wakeup_sources, ["uart", "gpio", "rtc"]);
  assert.equal(c.boot.method, "mcuboot");
  assert.equal(c.boot.signing.algorithm, "ecdsa_p256");
  assert.equal(c.boot.slots.primary.size_kib, 1024);
  assert.equal(c.ota.provider, "mender");
  assert.equal(c.ota.rollback.min_version, 1);
  assert.ok(c.chips.includes("optiga_trust_m"));
});

test("parseBoardConfig defaults missing som/cores rather than throwing", () => {
  const c = parseBoardConfig("name: empty\n");
  assert.equal(c.som.sku, "");
  assert.deepEqual(c.cores, {});
  assert.equal(c.name, "empty");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/board.parse.test.js`
Expected: FAIL — `Cannot find module '../packages/alp-core/dist/board/parse.js'`.

- [ ] **Step 3: Create the models**

Create `packages/alp-core/src/board/models.ts`:

```typescript
// SPDX-License-Identifier: Apache-2.0

export type CoreOs = "zephyr" | "yocto" | "baremetal" | "off";
export type LogLevel = "error" | "warn" | "info" | "debug" | "trace";
export type LogLevelOrOff = LogLevel | "off";

export interface BoardSom {
  sku: string;
  hw_rev?: string;
}

export interface CoreMemory {
  stack_kib?: number;
  heap_kib?: number;
  isr_stack_kib?: number;
}

export interface CorePower {
  sleep_mode?: "disabled" | "idle" | "standby" | "deep";
  wakeup_sources?: string[];
}

export interface CoreInference {
  default_arena_kib?: number;
}

export interface CoreIot {
  wifi?: boolean;
  mqtt?: boolean;
  ble?: boolean;
  tls?: boolean;
}

export interface ExtraLibrary {
  name: string;
  include_path?: string;
  kconfig?: string[];
  profile?: string;
}

export interface CoreEntry {
  os?: CoreOs;
  app?: string;
  image?: string;
  peripherals?: string[];
  libraries?: string[];
  extra_libraries?: ExtraLibrary[];
  memory?: CoreMemory;
  power?: CorePower;
  inference?: CoreInference;
  iot?: CoreIot;
}

export interface Diagnostics {
  last_error?: boolean;
  log_level?: LogLevel;
  modules?: Record<string, LogLevelOrOff>;
}

export interface StoragePartition {
  name: string;
  size_kib: number;
  fs?: "littlefs" | "fat" | "ext4" | "raw";
  mount?: string;
  flash_device?: string;
  offset_kib?: number;
  raw?: boolean;
}

export interface SecurityPsa {
  persistent_slots?: number;
  its_storage?: string;
  ps_storage?: string;
  tfm?: boolean;
  attestation_root?: "optiga_trust_m" | "tfm_internal" | "none";
}

export interface Security {
  psa?: SecurityPsa;
}

export interface BootSigning {
  algorithm: "ecdsa_p256" | "rsa2048" | "rsa3072" | "ed25519";
  key_file: string;
}

export interface BootSlot {
  size_kib: number;
}

export interface Boot {
  method?: "mcuboot" | "none";
  signing?: BootSigning;
  slots?: { primary: BootSlot; secondary: BootSlot };
  swap_algorithm?: "scratch" | "move" | "overwrite";
  scratch_size_kib?: number;
  anti_rollback?: boolean;
  build_type?: "Release" | "Debug" | "MinSizeRel";
}

export interface OtaServer {
  url: string;
  tenant?: string;
  tls_ca_bundle?: string;
}

export interface OtaRollback {
  enabled?: boolean;
  retries?: number;
  min_version?: number;
}

export interface OtaStorage {
  device?: string;
  boot_part_mb?: number;
  rootfs_ab?: boolean;
  total_size_mb?: number;
}

export interface Ota {
  provider: "mender" | "hawkbit" | "mcumgr" | "none";
  artifact_name?: string;
  signing_key?: string;
  server?: OtaServer;
  rollback?: OtaRollback;
  poll_interval_s?: number;
  storage?: OtaStorage;
}

export interface IpcEntry {
  kind: "rpmsg" | "raw_shmem" | "mailbox_only";
  endpoints: string[];
  carve_out_kb: number;
  name: string;
  cacheable?: boolean;
  address?: number;
}

export interface RouteEntry {
  e1m: string;
  macro: string;
  doc?: string;
  active_low?: boolean;
  pull?: "up" | "down" | "none";
  debounce_ms?: number;
  board_alias?: string;
}

export interface E1mRoutes {
  gpio?: RouteEntry[];
  buses?: RouteEntry[];
  pwm?: RouteEntry[];
  adc?: RouteEntry[];
  dac?: RouteEntry[];
  i2s?: RouteEntry[];
  can?: RouteEntry[];
  qenc?: RouteEntry[];
}

export type PinRef = string | { e1m: string; macro?: string; doc?: string };

export interface BoardConfig {
  name?: string;
  description?: string;
  preset?: string;
  hw_rev?: string;
  som: BoardSom;
  cores: Record<string, CoreEntry>;
  populated?: Record<string, boolean>;
  e1m_routes?: E1mRoutes;
  pins?: PinRef[];
  ipc?: IpcEntry[];
  diagnostics?: Diagnostics;
  storage?: StoragePartition[];
  security?: Security;
  boot?: Boot;
  ota?: Ota;
  chips?: string[];
  features?: Record<string, unknown>;
  supported_boards?: string[];
}

/** Top-level key order used by serializeBoardConfig (mirrors board.schema.json). */
export const BOARD_KEY_ORDER: (keyof BoardConfig)[] = [
  "name",
  "description",
  "preset",
  "hw_rev",
  "som",
  "cores",
  "populated",
  "e1m_routes",
  "pins",
  "chips",
  "ipc",
  "diagnostics",
  "storage",
  "security",
  "boot",
  "ota",
  "features",
  "supported_boards",
];
```

- [ ] **Step 4: Create `parseBoardConfig`**

Create `packages/alp-core/src/board/parse.ts`:

```typescript
// SPDX-License-Identifier: Apache-2.0

import * as yaml from "js-yaml";
import { BoardConfig, BOARD_KEY_ORDER, CoreEntry } from "./models";

/**
 * Map a v0.6 board.yaml document onto the typed model. Only schema-known
 * top-level keys are copied (board.schema.json is additionalProperties:false,
 * so a valid file has no others). `som` and `cores` always exist on the result
 * so callers never branch on undefined.
 */
export function parseBoardConfig(text: string): BoardConfig {
  const d = (yaml.load(text) ?? {}) as Record<string, any>;

  const som = (d.som ?? {}) as Record<string, unknown>;
  const cfg: BoardConfig = {
    som: { sku: typeof som.sku === "string" ? som.sku : "" },
    cores: (d.cores ?? {}) as Record<string, CoreEntry>,
  };
  if (typeof som.hw_rev === "string") cfg.som.hw_rev = som.hw_rev;

  for (const key of BOARD_KEY_ORDER) {
    if (key === "som" || key === "cores") continue;
    if (d[key] !== undefined && d[key] !== null) {
      (cfg as Record<string, unknown>)[key] = d[key];
    }
  }
  return cfg;
}
```

- [ ] **Step 5: Compile and run; verify PASS**

Run: `pnpm run compile && node --test test/board.parse.test.js`
Expected: PASS (4/4).

- [ ] **Step 6: Commit**

```bash
git add packages/alp-core/src/board/models.ts packages/alp-core/src/board/parse.ts test/board.parse.test.js
git commit -m "feat(board): v0.6 BoardConfig model + parseBoardConfig with tests"
```

---

### Task 2: `serializeBoardConfig` + round-trip

**Files:**
- Create: `packages/alp-core/src/board/serialize.ts`
- Test: `test/board.serialize.test.js`

- [ ] **Step 1: Write the failing test**

Create `test/board.serialize.test.js`:

```javascript
const test = require("node:test");
const assert = require("node:assert/strict");

const { parseBoardConfig } = require("../packages/alp-core/dist/board/parse.js");
const { serializeBoardConfig } = require("../packages/alp-core/dist/board/serialize.js");
const { EDGEAI, OBJDET, PRODUCTION } = require("./board.parse.test.js");

for (const [name, text] of [["EDGEAI", EDGEAI], ["OBJDET", OBJDET], ["PRODUCTION", PRODUCTION]]) {
  test(`serializeBoardConfig round-trips ${name} (data-stable)`, () => {
    const parsed = parseBoardConfig(text);
    const reparsed = parseBoardConfig(serializeBoardConfig(parsed));
    assert.deepEqual(reparsed, parsed);
  });
}

test("serializeBoardConfig emits canonical top-level order (name, then som before cores)", () => {
  const yamlText = serializeBoardConfig({
    name: "demo",
    som: { sku: "E1M-AEN701" },
    cores: { m55_hp: { app: "./src" } },
    chips: ["lsm6dso"],
  });
  assert.ok(yamlText.startsWith("name: demo"));
  assert.ok(yamlText.indexOf("som:") < yamlText.indexOf("cores:"));
  // undefined optional blocks are not emitted
  assert.equal(yamlText.includes("boot:"), false);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/board.serialize.test.js`
Expected: FAIL — `Cannot find module '../packages/alp-core/dist/board/serialize.js'`.

- [ ] **Step 3: Implement `serializeBoardConfig`**

Create `packages/alp-core/src/board/serialize.ts`:

```typescript
// SPDX-License-Identifier: Apache-2.0

import * as yaml from "js-yaml";
import { BoardConfig, BOARD_KEY_ORDER } from "./models";

/**
 * Emit a board.yaml document. Keys are written in the canonical
 * board.schema.json order; keys whose value is undefined are omitted. Comments
 * and original formatting are not preserved (the SDK normalizes board.yaml on
 * load), but the data round-trips: parseBoardConfig(serializeBoardConfig(cfg))
 * deep-equals cfg.
 */
export function serializeBoardConfig(cfg: BoardConfig): string {
  const ordered: Record<string, unknown> = {};
  for (const key of BOARD_KEY_ORDER) {
    const value = (cfg as Record<string, unknown>)[key];
    if (value !== undefined) {
      ordered[key] = value;
    }
  }
  return yaml.dump(ordered, { lineWidth: 100, noRefs: true });
}
```

- [ ] **Step 4: Compile and run; verify PASS**

Run: `pnpm run compile && node --test test/board.serialize.test.js`
Expected: PASS (4/4 — 3 round-trips + 1 canonical-order).

- [ ] **Step 5: Run both board suites + commit**

Run: `node --test test/board.parse.test.js test/board.serialize.test.js`
Expected: all PASS (8 total).

```bash
git add packages/alp-core/src/board/serialize.ts test/board.serialize.test.js
git commit -m "feat(board): serializeBoardConfig with round-trip tests"
```

---

## Self-review notes

- **Spec coverage (design Part 1, model + parse/serialize):** all v0.6 blocks typed in
  `models.ts` (Task 1) · `parseBoardConfig` picks schema-known top-level keys, guarantees
  `som`/`cores` present (Task 1) · `serializeBoardConfig` canonical order + omit-undefined
  (Task 2) · data-stable round-trip proven against 3 real examples (Task 2). **Validation
  (vendored schema + cross-field rules like tls⇒mbedtls) and legacy-board migration are
  intentionally NOT in this plan** — they are Phase 2a-3.
- **Round-trip definition:** data-stable (`parse∘serialize∘parse == parse`), not
  byte-stable; nested blocks (`boot`/`ota`/`security`/`storage`/`ipc`/`e1m_routes`) are
  carried through as parsed structures, so they round-trip without per-field code.
- **Type consistency:** `BoardConfig`, `CoreEntry`, `BOARD_KEY_ORDER` defined once in
  `models.ts`; `parse.ts` and `serialize.ts` both import `BOARD_KEY_ORDER` so the key set
  cannot drift between read and write.
- **No Claude co-author trailer** in any commit (user preference).
- Imports: `parse.ts` imports `CoreEntry` (used in the `cores` cast) + `BoardConfig` +
  `BOARD_KEY_ORDER`; `serialize.ts` imports `BoardConfig` + `BOARD_KEY_ORDER`. No unused
  imports (strict `noUnusedLocals`).
