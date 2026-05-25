# Phase 2a-3: Board Validation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give board.yaml real validation — vendor the authoritative `board.schema.json` so the YAML editor validates live, and add a pure `validateBoardConfig` that mirrors the SDK's cross-field rules for the configurator's validation panel.

**Architecture:** Vendor a copy of the SDK's `board.schema.json` into the extension and point `package.json` `contributes.yamlValidation` at it (replacing the missing path). Add `validateBoardConfig` in `@alp-sdk/core/board/` (pure) returning `{ errors, warnings }`, unit-tested. Legacy-board migration is intentionally **out of scope** (no real pre-v0.6 boards on the v0.6 SDK; the cores restructuring is lossy).

**Tech Stack:** TypeScript (CommonJS), `node:test`, `js-yaml`. Build: `pnpm run compile`. Pure tests import `../packages/alp-core/dist/board/*.js`; the schema-vendoring test reads files via `fs`.

---

## Reference facts

- Authoritative schema source: `C:\Users\caner\Documents\GitHub\alp-sdk\metadata\schemas\board.schema.json`
  (`$id` ends with `board.schema.json`; top-level `required: ["som", "cores"]`).
- Current `package.json` `contributes.yamlValidation[0]` is
  `{ "fileMatch": "board.yaml", "url": "./alp-sdk-upstream/metadata/schemas/board-config-v1.schema.json" }`
  — the URL points at a file that does not exist. Repoint it to the vendored copy.
- Cross-field rule confirmed from a real example (`examples/connectivity/iot-fleet-ota`):
  a core with `iot.tls: true` must list `mbedtls` (or `bearssl`) in its `libraries`.
- `BoardConfig` model + `parseBoardConfig` already exist in `@alp-sdk/core/board/`
  (merged). Fixtures live in `test/fixtures/board.fixtures.js`
  (`EDGEAI`, `OBJDET`, `PRODUCTION`, `ALLBLOCKS`).

## File Structure

- Create: `schemas/board.schema.json` (vendored copy).
- Modify: `package.json` (`yamlValidation` URL).
- Create: `packages/alp-core/src/board/validate.ts` (`validateBoardConfig`).
- Tests: `test/board.schema.vendored.test.js`, `test/board.validate.test.js`.

---

### Task 1: Vendor `board.schema.json` + wire `yamlValidation`

**Files:**
- Create: `schemas/board.schema.json`
- Modify: `package.json` (lines around 186-190)
- Test: `test/board.schema.vendored.test.js`

- [ ] **Step 1: Write the failing test**

Create `test/board.schema.vendored.test.js`:

```javascript
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

test("board.schema.json is vendored and structurally valid", () => {
  const p = path.join(__dirname, "..", "schemas", "board.schema.json");
  assert.ok(fs.existsSync(p), "schemas/board.schema.json must exist");
  const schema = JSON.parse(fs.readFileSync(p, "utf-8"));
  assert.match(String(schema.$id ?? ""), /board\.schema\.json/);
  assert.deepEqual(schema.required, ["som", "cores"]);
});

test("package.json yamlValidation points at the vendored schema", () => {
  const pkg = JSON.parse(
    fs.readFileSync(path.join(__dirname, "..", "package.json"), "utf-8"),
  );
  const entry = pkg.contributes.yamlValidation.find(
    (e) => e.fileMatch === "board.yaml",
  );
  assert.ok(entry, "a yamlValidation entry for board.yaml is required");
  assert.equal(entry.url, "./schemas/board.schema.json");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/board.schema.vendored.test.js`
Expected: FAIL — `schemas/board.schema.json must exist` (and the URL assertion fails).

- [ ] **Step 3: Vendor the schema**

Copy the authoritative schema into the extension (run from the repo root):

```bash
mkdir -p schemas
cp "/c/Users/caner/Documents/GitHub/alp-sdk/metadata/schemas/board.schema.json" schemas/board.schema.json
```

If that source path does not exist on this machine, STOP and report NEEDS_CONTEXT
(the controller will supply the correct alp-sdk checkout path) — do NOT hand-write or
invent the schema.

Then verify it is valid JSON:
Run: `node -e "JSON.parse(require('fs').readFileSync('schemas/board.schema.json','utf8')); console.log('schema OK')"`
Expected: prints `schema OK`.

- [ ] **Step 4: Repoint `yamlValidation`**

In `package.json`, change the `contributes.yamlValidation` entry's `url` from
`./alp-sdk-upstream/metadata/schemas/board-config-v1.schema.json` to
`./schemas/board.schema.json`. The block becomes:

```json
    "yamlValidation": [
      {
        "fileMatch": "board.yaml",
        "url": "./schemas/board.schema.json"
      }
    ],
```

Verify `package.json` is still valid JSON:
Run: `node -e "JSON.parse(require('fs').readFileSync('package.json','utf8')); console.log('package.json OK')"`
Expected: prints `package.json OK`.

- [ ] **Step 5: Run the test to verify it passes**

Run: `node --test test/board.schema.vendored.test.js`
Expected: PASS (2/2).

- [ ] **Step 6: Commit**

```bash
git add schemas/board.schema.json package.json test/board.schema.vendored.test.js
git commit -m "feat(board): vendor board.schema.json and wire yamlValidation"
```

---

### Task 2: `validateBoardConfig`

**Files:**
- Create: `packages/alp-core/src/board/validate.ts`
- Test: `test/board.validate.test.js`

- [ ] **Step 1: Write the failing test**

Create `test/board.validate.test.js`:

```javascript
const test = require("node:test");
const assert = require("node:assert/strict");

const { parseBoardConfig } = require("../packages/alp-core/dist/board/parse.js");
const { validateBoardConfig } = require("../packages/alp-core/dist/board/validate.js");
const { PRODUCTION, ALLBLOCKS } = require("./fixtures/board.fixtures.js");

test("a valid real board has no errors", () => {
  // PRODUCTION uses preset + tls with mbedtls + mcuboot with signing.
  const r = validateBoardConfig(parseBoardConfig(PRODUCTION));
  assert.deepEqual(r.errors, []);
});

test("ALLBLOCKS (inline populated, no preset) is also error-free", () => {
  const r = validateBoardConfig(parseBoardConfig(ALLBLOCKS));
  assert.deepEqual(r.errors, []);
});

test("missing som.sku and empty cores are errors", () => {
  const r = validateBoardConfig({ som: { sku: "" }, cores: {} });
  assert.ok(r.errors.some((e) => /som\.sku/.test(e)));
  assert.ok(r.errors.some((e) => /cores/.test(e)));
});

test("preset is mutually exclusive with inline populated", () => {
  const r = validateBoardConfig({
    som: { sku: "E1M-AEN701" },
    cores: { m55_hp: { app: "./src" } },
    preset: "e1m-evk",
    populated: { lsm6dso: true },
  });
  assert.ok(r.errors.some((e) => /preset.*mutually exclusive|mutually exclusive.*inline/i.test(e)));
});

test("iot.tls without mbedtls/bearssl on the same core is an error", () => {
  const r = validateBoardConfig({
    som: { sku: "E1M-AEN701" },
    cores: { m55_hp: { app: "./src", iot: { tls: true }, libraries: ["fmt"] } },
  });
  assert.ok(r.errors.some((e) => /m55_hp.*tls.*mbedtls|tls.*requires/i.test(e)));
});

test("iot.tls with mbedtls present is fine", () => {
  const r = validateBoardConfig({
    som: { sku: "E1M-AEN701" },
    cores: { m55_hp: { app: "./src", iot: { tls: true }, libraries: ["mbedtls"] } },
  });
  assert.deepEqual(r.errors, []);
});

test("mcuboot without signing is an error", () => {
  const r = validateBoardConfig({
    som: { sku: "E1M-AEN701" },
    cores: { m55_hp: { app: "./src" } },
    boot: { method: "mcuboot" },
  });
  assert.ok(r.errors.some((e) => /mcuboot.*signing|signing.*required/i.test(e)));
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/board.validate.test.js`
Expected: FAIL — `Cannot find module '../packages/alp-core/dist/board/validate.js'`.

- [ ] **Step 3: Implement `validateBoardConfig`**

Create `packages/alp-core/src/board/validate.ts`:

```typescript
// SPDX-License-Identifier: Apache-2.0

import { BoardConfig } from "./models";

export interface ValidationResult {
  errors: string[];
  warnings: string[];
}

/** Libraries that satisfy a core's `iot.tls: true` requirement. */
const TLS_LIBRARIES = ["mbedtls", "bearssl"];

/**
 * Cross-field validation that mirrors the rules the SDK's
 * validate_board_yaml.py enforces beyond the JSON schema. Structural
 * validation (types, enums, required leaf fields) is handled by the vendored
 * board.schema.json in the YAML editor; this covers the relational rules the
 * configurator surfaces in its validation panel.
 */
export function validateBoardConfig(cfg: BoardConfig): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (!cfg.som || !cfg.som.sku) {
    errors.push("som.sku is required.");
  }

  if (!cfg.cores || Object.keys(cfg.cores).length === 0) {
    errors.push("cores must declare at least one core.");
  }

  const hasInline = cfg.populated !== undefined || cfg.e1m_routes !== undefined;
  if (cfg.preset !== undefined && hasInline) {
    errors.push(
      "preset is mutually exclusive with inline populated / e1m_routes.",
    );
  }

  for (const [coreId, core] of Object.entries(cfg.cores ?? {})) {
    if (core.iot?.tls) {
      const libraries = core.libraries ?? [];
      const hasTlsLib = TLS_LIBRARIES.some((lib) => libraries.includes(lib));
      if (!hasTlsLib) {
        errors.push(
          `core ${coreId}: iot.tls requires 'mbedtls' or 'bearssl' in libraries.`,
        );
      }
    }
  }

  if (cfg.boot?.method === "mcuboot" && !cfg.boot.signing) {
    errors.push("boot.method 'mcuboot' requires boot.signing.");
  }

  return { errors, warnings };
}
```

- [ ] **Step 4: Compile and run; verify PASS**

Run: `pnpm run compile && node --test test/board.validate.test.js`
Expected: PASS (7/7).

- [ ] **Step 5: Run all board suites + commit**

Run: `node --test test/board.parse.test.js test/board.serialize.test.js test/board.validate.test.js test/board.schema.vendored.test.js`
Expected: all PASS.

```bash
git add packages/alp-core/src/board/validate.ts test/board.validate.test.js
git commit -m "feat(board): validateBoardConfig cross-field rules with tests"
```

---

## Self-review notes

- **Spec coverage (design Part 1, validation):** vendored schema + `yamlValidation`
  rewire (Task 1) · pure `validateBoardConfig` with the cross-field rules — som.sku/cores
  required, preset-xor-inline, per-core tls⇒mbedtls/bearssl, mcuboot⇒signing (Task 2).
- **Out of scope (documented decision):** legacy pre-v0.6 board.yaml migration — no real
  legacy boards exist on the v0.6 SDK and the cores restructuring is lossy; the only
  old-shape file (`.scratch/board.yaml`) will be rewritten to v0.6 with the configurator
  work, not via a migration engine. Structural JSON-schema validation in code is also out
  of scope — the vendored schema covers it in the editor (YAGNI to re-implement here).
- **Type consistency:** `validateBoardConfig(cfg: BoardConfig): ValidationResult` uses the
  existing `BoardConfig` model; `ValidationResult` is the new return type defined in
  `validate.ts`. Fixtures reused from `test/fixtures/board.fixtures.js`.
- **No Claude co-author trailer** in any commit.
- Tasks are independent: Task 1 (schema/manifest, no core code) and Task 2 (pure core
  function) can be executed and reviewed separately.
