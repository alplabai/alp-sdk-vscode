# Memory Tab Restructure Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild the Build Plan panel's Memory tab around an address-ordered table with a narrow piecewise rail beside it, so a reader answers "where does my image land, does anything overlap, may I write here, why was this refused" without holding anything in working memory across the screen.

**Architecture:** Two new React-free modules carry the arithmetic — `authorityTier.ts` (six authority classes to three visible tiers) and `railScale.ts` (piecewise address-to-pixel layout with compressed gaps). One new `MemoryTable.tsx` replaces both the placed-extent list and the region table with a single address-ordered table. `MemoryChart.tsx` loses its second rail and its fixed width; `MemoryRegions.tsx` loses its scale modes and promotes blocking findings above the picture.

**Tech Stack:** TypeScript, React 18 (webview), d3-scale, CSS Modules + Vite, `node:test`, esbuild + jsdom render harness.

**Spec:** `docs/superpowers/specs/2026-09-12-memory-tab-restructure-design.md`

**Predecessor:** `docs/superpowers/plans/2026-09-11-memory-regions-backdrop.md` built #484 phase 2 — the region backdrop this plan's Task 5 deletes. Read it only to understand why a rule exists before removing it.

## Global Constraints

Every task's requirements implicitly include this section. Values are copied verbatim from the spec, `DESIGN.md`, and the gates.

- **Read-only.** No write path may reach the manifest. `test/memoryRegions.readOnly.test.js`'s `VIEW_FILES` covers every view file; a new view file must be added to that list, not excluded from it.
- **The Borrowed Palette Rule.** No literal `#hex`, `rgb()` or `hsl()` as a property value — literals are allowed only as the second argument of `var()`. Gated by `test/webview.cssTokens.test.js`.
- **The Status-Only Color Rule.** Colour appears only where something reports state. Write authority is not a state: all swatch tiers derive from `var(--text-primary)` and differ by density/hatch, never hue.
- **The No-Breakpoint Rule.** Zero width-based `@media` queries. The only `@media` blocks in the codebase are `prefers-reduced-motion: reduce`. Reflow comes from `auto-fit` grids, `flex-wrap`, and measured layout.
- **The Workbench Anchor Rule.** Every type size is a `calc()` offset from `--vscode-font-size`. Gated by `test/buildPlan.typeScale.test.js`; its `CHROME` allowlist and `SANCTIONED` list are updated in the same change that moves a size.
- **No emoji** anywhere, including `✓ ✗ ⚠`. Use the 27-icon stroke set.
- **File size cap: 800 lines.** `MemoryChart.tsx` is at 751, `BuildPlanView.tsx` at 625, `packages/alp-core/src/systemManifest/memoryView.ts` at 787. Splitting happens in the task that would otherwise cross the cap, never afterwards.
- **Contrast gates cover shipping themes.** Dark Modern and Light Modern (VS Code's actual defaults), High Contrast Dark and High Contrast Light. Dark+/Light+ may be kept as legacy arms. Every arm resolves colours from the declared tokens and composites alpha against the real backdrop.
- **A test asserting a CSS rule exists must read the built `packages/alp-webview/dist/main.css`**, never the source text. CSS Modules hash local class names; a rule targeting a host-set class such as `body.vscode-high-contrast` needs `:global(...)` or it compiles to something that can never match.
- **Commits:** conventional subject; stage with `git add <paths>` as its own command, then a bare `git commit -q -m "..."` (the hook blocks chained and `--amend` forms). **No `Claude-Session:` trailer, no `Co-Authored-By`, no AI attribution, no session links** — public repo. Verify with `git log --grep` before finishing.
- **No local absolute paths or scratchpad paths** in anything committed.
- **Full local gate set before any PR:** `pnpm run format:check`, `pnpm run compile`, `pnpm test`, `pnpm exec vsce package --no-dependencies --out alp-sdk.vsix`, `bash scripts/check-vsix-allowlist.sh`. (`pnpm run cli:smoke` does not exist in this repo.)

## File Structure

**Create:**
- `packages/alp-webview/src/features/build-plan/authorityTier.ts` — the six `MemoryAuthorityClass` values to three visible tiers, plus the writable-first group order. React-free.
- `packages/alp-webview/src/features/build-plan/railScale.ts` — piecewise segment construction and height allocation. React-free, no d3 import.
- `packages/alp-webview/src/features/build-plan/MemoryTable.tsx` + `MemoryTable.module.css` — the unified address-ordered table.
- `packages/alp-webview/src/features/build-plan/AuthoritySwatch.tsx` + `AuthoritySwatch.module.css` — the three-tier swatch and the legend row, used by both the table and the rail gutter.
- `test/webview/esbuildImport.mjs` — bundles one webview TS module to a temp ESM file and imports it, so a pure module can carry real unit tests. esbuild is already a dev dependency, used by `test/webview/run.mjs`.
- `test/authorityTier.test.js`, `test/railScale.test.js` — unit tests via that importer.
- `test/buildPlan.swatchContrast.test.js` — the swatch tier contrast and distinguishability gate.

**Modify:**
- `packages/alp-webview/src/features/build-plan/MemoryChart.tsx` — single rail, piecewise scale, no focusable descendants, measured width.
- `packages/alp-webview/src/features/build-plan/MemoryChart.module.css` — region frames deleted, gutter and zigzag added.
- `packages/alp-webview/src/features/build-plan/MemoryRegions.tsx` — scale modes removed, findings promoted, table swapped in.
- `packages/alp-webview/src/features/build-plan/MemoryRegions.module.css` — scale-toggle rules removed, layout grid added.
- `packages/alp-webview/src/features/build-plan/BuildPlanView.tsx` — tablist keyboard model and `tabpanel`.
- `src/ideHub/buildPlanPanel.ts` and the webview message types — two new host messages.
- `DESIGN.md` — the Region-Frame Rule replaced.
- `test/webview/ui-render.tsx` — the four memory passes rewritten.
- `test/buildPlan.typeScale.test.js`, `test/memoryRegions.readOnly.test.js` — allowlists and file lists updated.
- `CHANGELOG.md` — one `## Unreleased` entry.

**Delete:**
- `packages/alp-webview/src/features/build-plan/MemoryRegionTable.tsx` and `MemoryRegionTable.module.css` — absorbed by `MemoryTable.tsx`.

---

### Task 1: Authority tiers and writable-first ordering

**Files:**
- Create: `packages/alp-webview/src/features/build-plan/authorityTier.ts`
- Create: `test/webview/esbuildImport.mjs`
- Create: `test/authorityTier.test.js`

**Interfaces:**
- Consumes: `MemoryAuthorityClass` from `packages/alp-webview/src/types.ts` — the closed union `"customer_runtime" | "customer_image" | "locked" | "reserved" | "composite" | "unstated"`.
- Produces: `type AuthorityTier = "yours" | "locked" | "unproven"`; `tierOf(cls: MemoryAuthorityClass): AuthorityTier`; `TIER_LABEL: Record<AuthorityTier, string>`; `TIER_ORDER: Record<AuthorityTier, number>`; `compareByTierThenAddress(a, b)` where both arguments are `{ authorityClass: MemoryAuthorityClass; base: number | null; name: string }`.

- [ ] **Step 1: Write the esbuild importer**

`test/webview/esbuildImport.mjs`:

```js
// SPDX-License-Identifier: Apache-2.0
//
// Imports one webview TypeScript module into a node:test file. The webview's
// modules are TS and are only otherwise exercised through the jsdom render
// harness, so pure arithmetic had no unit tests at all (#664 recorded that
// gap for regionWindow.ts). esbuild is already a dev dependency here.
import { build } from "esbuild";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

export async function importWebviewModule(relPath) {
  const dir = await mkdtemp(join(tmpdir(), "alp-webview-unit-"));
  const outfile = join(dir, "module.mjs");
  await build({
    entryPoints: [join(process.cwd(), "packages/alp-webview/src", relPath)],
    outfile,
    bundle: true,
    format: "esm",
    platform: "neutral",
    logLevel: "silent",
  });
  const mod = await import(pathToFileURL(outfile).href);
  await rm(dir, { recursive: true, force: true });
  return mod;
}
```

- [ ] **Step 2: Write the failing test**

`test/authorityTier.test.js`:

```js
// SPDX-License-Identifier: Apache-2.0
const test = require("node:test");
const assert = require("node:assert/strict");

const load = async () =>
  (await import("./webview/esbuildImport.mjs")).importWebviewModule(
    "features/build-plan/authorityTier.ts",
  );

test("every authority class maps to exactly one of three tiers", async () => {
  const { tierOf } = await load();
  assert.equal(tierOf("customer_runtime"), "yours");
  assert.equal(tierOf("customer_image"), "yours");
  assert.equal(tierOf("locked"), "locked");
  assert.equal(tierOf("reserved"), "unproven");
  assert.equal(tierOf("composite"), "unproven");
  assert.equal(tierOf("unstated"), "unproven");
});

test("the writable group sorts first, then locked, then unproven", async () => {
  const { compareByTierThenAddress } = await load();
  const rows = [
    { authorityClass: "locked", base: 0x80000000, name: "mcuboot" },
    { authorityClass: "unstated", base: 0x80600000, name: "odd" },
    { authorityClass: "customer_image", base: 0x80010000, name: "he_slot0" },
    { authorityClass: "customer_runtime", base: 0x80560000, name: "storage" },
  ];
  const names = [...rows].sort(compareByTierThenAddress).map((r) => r.name);
  assert.deepEqual(names, ["he_slot0", "storage", "mcuboot", "odd"]);
});

test("a null base sorts after every resolved base inside its own tier", async () => {
  const { compareByTierThenAddress } = await load();
  const rows = [
    { authorityClass: "composite", base: null, name: "mram_main" },
    { authorityClass: "reserved", base: 0x80000000, name: "placed" },
  ];
  const names = [...rows].sort(compareByTierThenAddress).map((r) => r.name);
  assert.deepEqual(names, ["placed", "mram_main"]);
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `node --test test/authorityTier.test.js`
Expected: FAIL — `Could not resolve "…/features/build-plan/authorityTier.ts"`.

- [ ] **Step 4: Write the module**

`packages/alp-webview/src/features/build-plan/authorityTier.ts`:

```ts
// SPDX-License-Identifier: Apache-2.0
//
// Six authority classes, three visible tiers. The six are NOT collapsed
// away: every row still carries its exact class name in its accessible name
// and in its expanded detail, so a declared `reserved` and a fail-closed
// `unstated` never claim to be the same thing. What the tier collapses is
// the FIRST GLANCE, where a six-item key is past the four-item limit a
// reader can hold, and where the one question being asked is "may I write
// here" — for which `reserved`, `composite` and `unstated` all answer the
// same way, because that is exactly what the fail-closed rule already does.

import type { MemoryAuthorityClass } from "../../types";

export type AuthorityTier = "yours" | "locked" | "unproven";

const TIER_OF: Record<MemoryAuthorityClass, AuthorityTier> = {
  customer_runtime: "yours",
  customer_image: "yours",
  locked: "locked",
  reserved: "unproven",
  composite: "unproven",
  unstated: "unproven",
};

export function tierOf(cls: MemoryAuthorityClass): AuthorityTier {
  return TIER_OF[cls];
}

/** Group headings. "Not yours or not proven" states both halves rather than
 *  picking one: `reserved` IS declared, `unstated` is not, and a heading
 *  claiming either for both would assert something the manifest did not. */
export const TIER_LABEL: Record<AuthorityTier, string> = {
  yours: "Yours to write",
  locked: "Locked",
  unproven: "Not yours or not proven",
};

/** Writable first. The old GROUP_ORDER led with `locked` — the rows a
 *  customer can do nothing about — on a tab whose purpose is the opposite. */
export const TIER_ORDER: Record<AuthorityTier, number> = {
  yours: 0,
  locked: 1,
  unproven: 2,
};

interface Sortable {
  authorityClass: MemoryAuthorityClass;
  base: number | null;
  name: string;
}

export function compareByTierThenAddress(a: Sortable, b: Sortable): number {
  const t =
    TIER_ORDER[tierOf(a.authorityClass)] - TIER_ORDER[tierOf(b.authorityClass)];
  if (t !== 0) return t;
  if (a.base === null && b.base === null) return a.name.localeCompare(b.name);
  if (a.base === null) return 1;
  if (b.base === null) return -1;
  if (a.base !== b.base) return a.base - b.base;
  return a.name.localeCompare(b.name);
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `node --test test/authorityTier.test.js`
Expected: PASS, 3 tests.

- [ ] **Step 6: Commit**

```bash
git add packages/alp-webview/src/features/build-plan/authorityTier.ts test/webview/esbuildImport.mjs test/authorityTier.test.js
```

```bash
git commit -q -m "feat(build-plan): map six authority classes to three visible tiers (#484)"
```

---

### Task 2: The three-tier swatch, its legend, and its contrast gate

**Files:**
- Create: `packages/alp-webview/src/features/build-plan/AuthoritySwatch.tsx`, `AuthoritySwatch.module.css`
- Create: `test/helpers/vscodeThemes.js` — extracted from `test/buildPlan.chartContrast.test.js`
- Create: `test/buildPlan.swatchContrast.test.js`
- Modify: `test/buildPlan.chartContrast.test.js` — import the extracted helpers instead of declaring them
- Modify: `test/memoryRegions.readOnly.test.js` — add `AuthoritySwatch.tsx` to `VIEW_FILES`

**Interfaces:**
- Consumes: `AuthorityTier`, `TIER_LABEL` from Task 1.
- Produces: `<AuthoritySwatch tier={t} />` rendering `<span class={styles.swatch} data-tier={t} aria-hidden="true" />`; `<AuthorityLegend />` rendering a three-item row, each item a swatch plus its `TIER_LABEL`.

- [ ] **Step 1: Extract the theme table**

Move `VSCODE_DEFAULTS`, `THEMES`, `resolvedOpaqueRgb`, `contrast`, `relLum` and `parseColor` from `test/buildPlan.chartContrast.test.js` into `test/helpers/vscodeThemes.js` and import them back. Do not copy them — two theme tables drift, which is the failure this whole area already shipped once.

Run: `node --test test/buildPlan.chartContrast.test.js`
Expected: PASS, unchanged count.

- [ ] **Step 2: Write the failing contrast gate**

`test/buildPlan.swatchContrast.test.js`:

```js
// SPDX-License-Identifier: Apache-2.0
const test = require("node:test");
const assert = require("node:assert/strict");
const { THEMES, resolvedOpaqueRgb, contrast } = require("./helpers/vscodeThemes");
const { swatchInkRgb } = require("./helpers/swatchInk");

test("each swatch tier clears 3:1 against the panel ground in every covered theme", () => {
  for (const theme of THEMES) {
    const ground = resolvedOpaqueRgb(theme, "--surface-bg", null);
    for (const tier of ["yours", "locked", "unproven"]) {
      const ratio = contrast(swatchInkRgb(theme, tier), ground);
      assert.ok(
        ratio >= 3,
        `swatch tier ${tier} vs panel ground in ${theme}: ${ratio.toFixed(2)}:1, need >= 3:1`,
      );
    }
  }
});

// CORRECTED DURING EXECUTION. This assertion was first written as a plain
// contrast ratio between the two tiers' inks, which could never pass: `yours`
// and `unproven` are deliberately the SAME colour — both var(--text-primary)
// at full strength — and are told apart by PATTERN, solid against hatch. Two
// identical colours contrast at exactly 1.00:1, so the original form measured
// a channel in which the difference was never encoded. The rule below is what
// it always meant: two tiers must differ in at least one channel.
test("the three tiers are pairwise distinguishable in every covered theme", () => {
  for (const theme of THEMES) {
    // `swatchInk` reads the declared CSS, so a future edit that flattens the
    // hatch into a solid fill collapses a pair and fails here, rather than
    // sliding past a hardcoded tier-to-pattern table.
    const inks = {
      yours: swatchInk(theme, "yours"),
      locked: swatchInk(theme, "locked"),
      unproven: swatchInk(theme, "unproven"),
    };
    for (const [a, b] of [
      ["yours", "locked"],
      ["yours", "unproven"],
      ["locked", "unproven"],
    ]) {
      if (inks[a].pattern !== inks[b].pattern) continue; // distinguishable by shape
      const ratio = contrast(inks[a].rgb, inks[b].rgb);
      assert.ok(
        ratio >= 1.5,
        `swatch tiers ${a} and ${b} in ${theme} are both "${inks[a].pattern}" and contrast at ` +
          `${ratio.toFixed(2)}:1 — two tiers may share a colour only when their patterns differ`,
      );
    }
  }
});
```

`test/helpers/swatchInk.js` reads `AuthoritySwatch.module.css`, resolves each tier's declared value through `tokens.css`, and composites any `color-mix` percentage against the theme's own `--surface-bg`. The hatch tier is measured at its stroke colour, not its average.

- [ ] **Step 3: Run it to verify it fails**

Run: `node --test test/buildPlan.swatchContrast.test.js`
Expected: FAIL — `AuthoritySwatch.module.css` does not exist.

- [ ] **Step 4: Write the swatch and legend**

`AuthoritySwatch.module.css`:

```css
.swatch {
  display: inline-block;
  width: 6px;
  height: 14px;
  border-radius: var(--radius-sm);
  flex: none;
}

/* Yours: solid. The reader's own rows carry full ink. */
.swatch[data-tier="yours"] {
  background: var(--text-primary);
}

/* Locked: half-tone. Present and definite, but not the reader's. */
.swatch[data-tier="locked"] {
  background: color-mix(in srgb, var(--text-primary) 55%, transparent);
}

/* Not yours or not proven: a hatch, so the difference survives a greyscale
   display and does not rest on lightness alone. */
.swatch[data-tier="unproven"] {
  background: repeating-linear-gradient(
    -45deg,
    var(--text-primary) 0 2px,
    transparent 2px 4px
  );
}

.legend {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-5);
  margin: 0 0 var(--space-4);
  color: var(--text-secondary);
}

.legendItem {
  display: inline-flex;
  align-items: center;
  gap: var(--space-2);
}
```

`AuthoritySwatch.tsx`:

```tsx
// SPDX-License-Identifier: Apache-2.0
//
// READ-ONLY, same gate as the other view files.
import { type AuthorityTier, TIER_LABEL } from "./authorityTier";
import styles from "./AuthoritySwatch.module.css";

/** Decorative: every row states its tier in text as well, so the swatch is
 *  `aria-hidden` rather than carrying a second, competing announcement. */
export function AuthoritySwatch({ tier }: { tier: AuthorityTier }) {
  return <span className={styles.swatch} data-tier={tier} aria-hidden="true" />;
}

export function AuthorityLegend() {
  return (
    <p className={styles.legend}>
      {(["yours", "locked", "unproven"] as AuthorityTier[]).map((tier) => (
        <span key={tier} className={styles.legendItem}>
          <AuthoritySwatch tier={tier} />
          {TIER_LABEL[tier]}
        </span>
      ))}
    </p>
  );
}
```

- [ ] **Step 5: Run the gate to verify it passes**

Run: `node --test test/buildPlan.swatchContrast.test.js`
Expected: PASS. If `locked` at 55% fails 3:1 in any theme, raise the percentage until it clears — never lower the threshold.

- [ ] **Step 6: Add the file to the read-only tripwire**

Add `AuthoritySwatch.tsx` to `VIEW_FILES` in `test/memoryRegions.readOnly.test.js`.

- [ ] **Step 7: Commit**

```bash
git add packages/alp-webview/src/features/build-plan/AuthoritySwatch.tsx packages/alp-webview/src/features/build-plan/AuthoritySwatch.module.css test/helpers/vscodeThemes.js test/helpers/swatchInk.js test/buildPlan.swatchContrast.test.js test/buildPlan.chartContrast.test.js test/memoryRegions.readOnly.test.js
```

```bash
git commit -q -m "feat(build-plan): add the three-tier authority swatch and its contrast gate (#484)"
```

---

### Task 3: Piecewise rail scale

**Files:**
- Create: `packages/alp-webview/src/features/build-plan/railScale.ts`
- Create: `test/railScale.test.js`

**Interfaces:**
- Consumes: `Window` from `./regionWindow`.
- Produces: `Segment`, `RailLayout`, `layoutRail`, `GAP_PX`, `MIN_EXTENT_PX` — signatures in Step 4.

**Constants and why:** `GAP_PX = 12` is the fixed height an empty run compresses to. `MIN_EXTENT_PX = 8` is the floor every extent-bearing segment gets before proportional distribution, because on `rpmsg-aen` the 64 KiB `mcuboot` is 1.2% of the ~5.5 MiB remaining *after* gaps compress — 3.5px on a 300px rail, still an invisible sliver.

- [ ] **Step 1: Write the failing test**

`test/railScale.test.js`:

```js
// SPDX-License-Identifier: Apache-2.0
const test = require("node:test");
const assert = require("node:assert/strict");

const load = async () =>
  (await import("./webview/esbuildImport.mjs")).importWebviewModule(
    "features/build-plan/railScale.ts",
  );

test("an empty run between two extents compresses to exactly GAP_PX", async () => {
  const { layoutRail, GAP_PX } = await load();
  const layout = layoutRail(
    { lo: 0x80000000, hi: 0x80120000 },
    [0x80000000, 0x80010000, 0x80110000, 0x80120000],
    0,
    300,
    [
      { lo: 0x80000000, hi: 0x80010000 },
      { lo: 0x80110000, hi: 0x80120000 },
    ],
  );
  const gaps = layout.segments.filter((s) => s.kind === "gap");
  assert.equal(gaps.length, 1);
  assert.equal(gaps[0].height, GAP_PX);
  assert.equal(gaps[0].lo, 0x80010000);
  assert.equal(gaps[0].hi, 0x80110000);
});

test("every extent segment clears the floor even when its share is tiny", async () => {
  const { layoutRail, MIN_EXTENT_PX } = await load();
  const layout = layoutRail(
    { lo: 0x80000000, hi: 0x80580000 },
    [0x80000000, 0x80010000, 0x80580000],
    0,
    300,
  );
  for (const seg of layout.segments.filter((s) => s.kind === "extent")) {
    assert.ok(
      seg.height >= MIN_EXTENT_PX,
      `segment 0x${seg.lo.toString(16)} is ${seg.height}px, under the ${MIN_EXTENT_PX}px floor`,
    );
  }
});

test("segment heights sum to the plot height exactly", async () => {
  const { layoutRail } = await load();
  const layout = layoutRail(
    { lo: 0x80000000, hi: 0x80580000 },
    [0x80000000, 0x80010000, 0x802b0000, 0x80550000, 0x80580000],
    18,
    258,
  );
  const total = layout.segments.reduce((n, s) => n + s.height, 0);
  assert.equal(Math.round(total), 258 - 18);
});

test("yOf is monotonic and inverts through addressAt", async () => {
  const { layoutRail } = await load();
  const layout = layoutRail(
    { lo: 0x80000000, hi: 0x80580000 },
    [0x80000000, 0x80010000, 0x802b0000, 0x80580000],
    18,
    258,
  );
  assert.ok(layout.yOf(0x80000000) > layout.yOf(0x80580000));
  for (const addr of [0x80000000, 0x80010000, 0x802b0000, 0x80580000]) {
    assert.ok(Math.abs(layout.addressAt(layout.yOf(addr)) - addr) <= 1);
  }
});

test("a window with no interior boundary is one extent segment, no gaps", async () => {
  const { layoutRail } = await load();
  const layout = layoutRail({ lo: 0, hi: 0x1000 }, [0, 0x1000], 0, 100);
  assert.equal(layout.segments.length, 1);
  assert.equal(layout.segments[0].kind, "extent");
  assert.equal(layout.segments[0].height, 100);
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `node --test test/railScale.test.js`
Expected: FAIL — `Could not resolve "…/features/build-plan/railScale.ts"`.

- [ ] **Step 3: Write the module**

`packages/alp-webview/src/features/build-plan/railScale.ts`:

```ts
// SPDX-License-Identifier: Apache-2.0
//
// The rail's piecewise address-to-pixel layout.
//
// A linear rail cannot show a 32 KiB region and a 4 GiB one at once, which
// is the problem the old fixed 22x second rail was invented for and did not
// solve — it drew an empty box on one SoM and a copy of the main rail on
// another. Here the rail stays one picture and the SCALE breaks instead:
// runs of address space nothing occupies compress to a fixed height and are
// marked, so the compression is announced rather than silent.
//
// The honest cost, stated here and repeated in the legend: this rail is no
// longer a proportional ruler. Its ORDER and its BOUNDARIES are exact; its
// heights are not. Exact sizes live in the table, digit by digit.

import type { Window } from "./regionWindow";

/** An empty run compresses to this many CSS pixels. */
export const GAP_PX = 12;

/** Every extent-bearing segment gets at least this many CSS pixels before
 *  the remaining height is shared out in proportion to bytes. */
export const MIN_EXTENT_PX = 8;

export interface Segment {
  lo: number;
  hi: number;
  kind: "extent" | "gap";
  /** Pixel top, in the same origin as `plotTop`. */
  top: number;
  height: number;
}

export interface RailLayout {
  segments: Segment[];
  /** Pixel y of an address. High addresses sit at the top. */
  yOf(address: number): number;
  /** The address at a pixel y — the piecewise inverse, for the readout. */
  addressAt(y: number): number;
}

/**
 * `boundaries` are the declared addresses this rail must land on exactly:
 * every extent's base and end, every budget end, and the window's own two
 * ends. They are sorted and de-duplicated here.
 *
 * `occupied` are the intervals something actually occupies. A segment no
 * interval covers is a `gap`. Passing none means "treat everything as
 * occupied", which is what a rail with a single extent wants.
 */
export function layoutRail(
  win: Window,
  boundaries: number[],
  plotTop: number,
  plotBottom: number,
  occupied: Array<{ lo: number; hi: number }> = [],
): RailLayout {
  const marks = [...new Set([win.lo, win.hi, ...boundaries])]
    .filter((a) => a >= win.lo && a <= win.hi)
    .sort((a, b) => a - b);

  const raw: Array<{ lo: number; hi: number; kind: "extent" | "gap" }> = [];
  for (let i = 0; i + 1 < marks.length; i++) {
    const lo = marks[i];
    const hi = marks[i + 1];
    if (hi <= lo) continue;
    const isOccupied =
      occupied.length === 0
        ? true
        : occupied.some((o) => o.lo <= lo && o.hi >= hi);
    raw.push({ lo, hi, kind: isOccupied ? "extent" : "gap" });
  }
  if (raw.length === 0) raw.push({ lo: win.lo, hi: win.hi, kind: "extent" });

  const plotHeight = plotBottom - plotTop;
  const gapCount = raw.filter((s) => s.kind === "gap").length;
  const extents = raw.filter((s) => s.kind === "extent");
  const fixed = gapCount * GAP_PX + extents.length * MIN_EXTENT_PX;
  const shareable = Math.max(plotHeight - fixed, 0);
  const byteTotal = extents.reduce((n, s) => n + (s.hi - s.lo), 0) || 1;

  // Laid out from the BOTTOM up: the lowest address sits lowest.
  const segments: Segment[] = [];
  let cursor = plotBottom;
  for (const s of raw) {
    const height =
      s.kind === "gap"
        ? GAP_PX
        : MIN_EXTENT_PX + (shareable * (s.hi - s.lo)) / byteTotal;
    cursor -= height;
    segments.push({ ...s, top: cursor, height });
  }

  const find = (address: number): Segment =>
    segments.find((s) => address >= s.lo && address <= s.hi) ??
    (address < win.lo ? segments[0] : segments[segments.length - 1]);

  return {
    segments,
    yOf(address: number): number {
      const clamped = Math.min(Math.max(address, win.lo), win.hi);
      const seg = find(clamped);
      const span = seg.hi - seg.lo || 1;
      return seg.top + seg.height * (1 - (clamped - seg.lo) / span);
    },
    addressAt(y: number): number {
      const clamped = Math.min(Math.max(y, plotTop), plotBottom);
      const seg =
        segments.find((s) => clamped >= s.top && clamped <= s.top + s.height) ??
        segments[segments.length - 1];
      const ratio = 1 - (clamped - seg.top) / (seg.height || 1);
      return Math.round(seg.lo + (seg.hi - seg.lo) * ratio);
    },
  };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --test test/railScale.test.js`
Expected: PASS, 5 tests.

- [ ] **Step 5: Commit**

```bash
git add packages/alp-webview/src/features/build-plan/railScale.ts test/railScale.test.js
```

```bash
git commit -q -m "feat(build-plan): add the rail's piecewise scale with announced gaps (#484)"
```

---

### Task 4: The unified address-ordered table

**Files:**
- Create: `packages/alp-webview/src/features/build-plan/MemoryTable.tsx`, `MemoryTable.module.css`
- Delete: `packages/alp-webview/src/features/build-plan/MemoryRegionTable.tsx`, `MemoryRegionTable.module.css`
- Modify: `test/memoryRegions.readOnly.test.js`, `test/webview/ui-render.tsx`

**Interfaces:**
- Consumes: `tierOf`, `TIER_LABEL`, `compareByTierThenAddress` (Task 1); `AuthoritySwatch` (Task 2); `duplicatedNames`, `endOf`, `budgetEnd`, `Window` (`./regionWindow`); `formatAddress`, `formatBytes` (`./format`); `MemoryRegion`, `MemorySpan`, `SliceSize` (`../../types`).
- Produces: `<MemoryTable regions spans budgets window selected onSelect />`.
- Carried over verbatim from the deleted file — these strings do not change: `authorityLabel`, `kindLabel`, `usersOf`, `devicesWithNoRegion`, and their outputs `"vendor image · locked"`, `"customer · written at flash time"`, `"customer · writable at runtime"`, `"no writer · reserved"`, `"Secure Enclave · locked"`, `"composite · see the contained regions"`, `"not authored · SoC-derived table"`, `"authority not declared"`, `` `${writeAuthority} · unrecognised` ``, `"class not proven"`.

**Row model.** One row per SoM region and one per placed span, sorted by `compareByTierThenAddress` within a tier group. A span has no `authorityClass`: it takes the tier of the region it names (`span.region`) when that name is unambiguous, `"unproven"` otherwise. At an equal base the region sorts before the spans that land in it.

- [ ] **Step 1: Write the failing harness assertions**

In `test/webview/ui-render.tsx`, inside the `memory-regions-aen` pass:

```tsx
const table = container.querySelector('ul[aria-label="Memory map rows"]');
if (!table) {
  problems.push("memory-regions-aen: no unified memory table found");
} else {
  const firstRow = table.querySelector('li[role="option"]');
  const firstName = (firstRow?.textContent || "").toLowerCase();
  if (!firstName.includes("he_slot0")) {
    problems.push(
      `memory-regions-aen: first row is "${firstName.trim()}" — the writable group must sort first`,
    );
  }
  const columns = firstRow?.querySelectorAll("[data-col]") ?? [];
  if (columns.length !== 4) {
    problems.push(
      `memory-regions-aen: row renders ${columns.length} columns at rest, want exactly 4`,
    );
  }
  for (const cls of [
    "customer_runtime",
    "customer_image",
    "locked",
    "reserved",
    "composite",
  ]) {
    const found = Array.from(table.querySelectorAll('li[role="option"]')).some(
      (li) => (li.getAttribute("aria-label") || "").includes(cls),
    );
    if (!found) {
      problems.push(
        `memory-regions-aen: authority class "${cls}" reaches no row's accessible name — deferred must not mean dropped`,
      );
    }
  }
  const groups = table.querySelectorAll('[role="group"]');
  if (groups.length !== 3) {
    problems.push(
      `memory-regions-aen: ${groups.length} tier groups rendered, want exactly 3`,
    );
  }

  // Carried forward from Task 2. Its swatch gate can only read source text —
  // `AuthoritySwatch` was mounted nowhere, so there was no rendered output to
  // assert against, and the review proved three mutations that kept that gate
  // green: hardcoding `data-tier="yours"`, dropping the attribute, and
  // returning null. This task is the first that mounts the component, so it is
  // the first that can check what actually reaches the DOM.
  for (const group of Array.from(groups)) {
    const groupTier = group.getAttribute("data-tier-group");
    for (const row of Array.from(group.querySelectorAll('li[role="option"]'))) {
      const swatches = row.querySelectorAll("[data-tier]");
      if (swatches.length !== 1) {
        problems.push(
          `memory-regions-aen: a row carries ${swatches.length} [data-tier] elements, want exactly 1`,
        );
        continue;
      }
      const tier = swatches[0].getAttribute("data-tier");
      if (!["yours", "locked", "unproven"].includes(tier || "")) {
        problems.push(
          `memory-regions-aen: a row's swatch reads data-tier="${tier}", which is not one of the three tiers`,
        );
      }
      if (groupTier && tier !== groupTier) {
        problems.push(
          `memory-regions-aen: a row in the "${groupTier}" group carries a "${tier}" swatch — the swatch is not following its row's tier`,
        );
      }
    }
  }
}
```

The group element therefore carries `data-tier-group` alongside its `role="group"`
and `aria-label`, so the rendered swatch can be checked against the group it sits
in rather than against a value the test itself supplies.

- [ ] **Step 2: Run the harness to verify it fails**

Run: `pnpm run test:e2e:webview`
Expected: FAIL — `memory-regions-aen: no unified memory table found`.

- [ ] **Step 3: Write `MemoryTable.tsx`**

The row shape, with every rule that must survive:

```tsx
<div className={styles.root}>
  <h3 className={styles.title}>Memory map ({rows.length})</h3>
  <AuthorityLegend />
  <ul className={styles.rows} role="listbox" aria-label="Memory map rows">
    {(["yours", "locked", "unproven"] as AuthorityTier[]).map((tier) => (
      <li
        key={tier}
        role="group"
        aria-label={`${TIER_LABEL[tier]} (${byTier[tier].length})`}
      >
        <button
          type="button"
          className={styles.groupHead}
          aria-expanded={open[tier]}
          onClick={() => toggleGroup(tier)}
        >
          {TIER_LABEL[tier]} ({byTier[tier].length})
        </button>
        {open[tier] && (
          <ul className={styles.groupRows}>
            {byTier[tier].map((row) => (
              <li
                key={row.key}
                role="option"
                aria-selected={row.selected}
                aria-expanded={expanded === row.key}
                aria-disabled={row.inert || undefined}
                aria-label={row.accessibleName}
                data-selected={row.selected || undefined}
                tabIndex={row.isActive ? 0 : -1}
              >
                <span data-col="swatch">
                  <AuthoritySwatch tier={row.tier} />
                </span>
                <span data-col="name">
                  {row.name}
                  <span className={styles.producer}>{row.producer}</span>
                </span>
                <code data-col="range">{row.range}</code>
                <span data-col="size">{row.size}</span>
                {expanded === row.key && <RowDetail row={row} />}
              </li>
            ))}
          </ul>
        )}
      </li>
    ))}
  </ul>
</div>
```

Rules, each load-bearing in the code this replaces:

- `row.producer` is `"SoM region"` or `"placed image"`, always rendered. It is the only thing stopping two adjacent rows from reading as one fact, which is why the by-name join is refused in the data.
- `row.accessibleName` concatenates, in order: name, producer, the exact `authorityClass` string, `authorityLabel(region)`, `kindLabel(kind)`, the range, the size, cores, and the reason. Step 1's assertion is what keeps "deferred" from becoming "dropped".
- A duplicated name stays inert: `aria-disabled`, no `onSelect`, and `.row[aria-disabled]` sets `cursor: default` — the variant the old CSS lacked (#664).
- `row.size` prints `formatBytes(...)`, or `"size not pinned by this manifest"` — never `—`, never `0`.
- A span whose extent is resolved by a same-named region prints `extent from region <name>` in its detail. The two numbers are never merged.
- `outside this map's window` renders at Title register with a status colour, not as trailing italic metadata.
- `devicesWithNoRegion` still renders its footer line: `<name> is a controller instance, not a region (no base)`.

- [ ] **Step 4: Run the harness to verify it passes**

Run: `pnpm run test:e2e:webview`
Expected: PASS on `memory-regions-aen`.

- [ ] **Step 5: Delete the old table and update the tripwire**

```bash
git rm packages/alp-webview/src/features/build-plan/MemoryRegionTable.tsx packages/alp-webview/src/features/build-plan/MemoryRegionTable.module.css
```

Replace `MemoryRegionTable.tsx` with `MemoryTable.tsx` in `VIEW_FILES`.

- [ ] **Step 6: Run the full suite**

Run: `pnpm test`
Expected: 0 failures.

- [ ] **Step 7: Commit**

```bash
git add packages/alp-webview/src/features/build-plan/MemoryTable.tsx packages/alp-webview/src/features/build-plan/MemoryTable.module.css test/memoryRegions.readOnly.test.js test/webview/ui-render.tsx
```

```bash
git commit -q -m "feat(build-plan): replace the two lists with one address-ordered table (#484)"
```

---

### Task 5: The single piecewise rail

**Files:**
- Modify: `packages/alp-webview/src/features/build-plan/MemoryChart.tsx`, `MemoryChart.module.css`, `test/webview/ui-render.tsx`
- Create (only if the cap demands it, Step 5): `packages/alp-webview/src/features/build-plan/MemoryRail.tsx`

**Interfaces:**
- Consumes: `layoutRail`, `GAP_PX`, `MIN_EXTENT_PX` (Task 3); `tierOf` (Task 1); `chartWindowOf`, `resolvedRegions`, `regionsInWindow`, `endOf`, `budgetEnd` (`./regionWindow`).
- Produces: `<MemoryChart spans apertures regions budgets selected onSelect width />` — `equalized` is gone from the props.

**Deletions, named:** `DETAIL_FACTOR`, `DETAIL_X`, `DETAIL_W`, the second `<Rail>`, `detailSpan`, `detail`, `inDetail`, `regionsInDetail`, `.detailMark`, `.bracket`, the `equalized` prop and every `!equalized &&` guard, `.regionFrame` and its six `[data-authority]` rules, the rotated `.apertureLabel` (its text moves to the table row).

- [ ] **Step 1: Write the failing harness assertions**

```tsx
const svgs = container.querySelectorAll("svg");
if (svgs.length !== 1) {
  problems.push(`memory-regions-aen: ${svgs.length} rails drawn, want exactly 1`);
}
if ((container.textContent || "").includes("22×")) {
  problems.push("memory-regions-aen: the fixed 22× magnification caption survived");
}
const focusableInSvg = container.querySelectorAll("svg [tabindex]");
if (focusableInSvg.length !== 0) {
  problems.push(
    `memory-regions-aen: ${focusableInSvg.length} focusable descendants inside svg[role=img]`,
  );
}
const gapMarks = container.querySelectorAll('[data-segment="gap"]');
if (gapMarks.length === 0) {
  problems.push("memory-regions-aen: no compressed gap was marked on the rail");
}
for (const mark of Array.from(gapMarks)) {
  const label = mark.getAttribute("aria-label") || mark.textContent || "";
  if (!/\d/.test(label)) {
    problems.push(
      "memory-regions-aen: a compressed gap does not state how much it compressed",
    );
  }
}
```

- [ ] **Step 2: Run the harness to verify it fails**

Run: `pnpm run test:e2e:webview`
Expected: FAIL — two rails, `22×` present, focusable descendants present, no gap marks.

- [ ] **Step 3: Rewrite `Rail` on the piecewise layout**

- Replace `scaleLinear().domain([win.lo, win.hi]).range([PLOT_BOTTOM, PLOT_TOP])` with `layoutRail(win, boundaries, PLOT_TOP, PLOT_BOTTOM, occupied)`. `y(addr)` becomes `layout.yOf(addr)`; `y.invert(...)` becomes `layout.addressAt(...)`.
- `boundaries` is every `span.base`, every `endOf(span)`, every `budgetEnd(span, budgets.get(span.label))`, and every resolved region's `lo`/`hi`, filtered to the window.
- `occupied` is that same set as intervals, so a run nothing covers becomes a `gap`.
- Each `gap` renders a zigzag rule plus `` `${formatBytes(seg.hi - seg.lo)} empty, compressed` ``, carried in `aria-label` as well as in text, and marked `data-segment="gap"`.
- Axis ticks come from segment boundaries only. `binaryTicks` stays exported and keeps its power-of-two rule for interior marks, rendered one register down in secondary ink so a computed mark can never be mistaken for a declared boundary.
- The authority gutter draws one `<rect>` per resolved region at `x - 10`, width 6, filled from `tierOf(region.authorityClass)` — replacing `.regionFrame` entirely. Nothing is drawn behind the bands any more.
- The span `<g>` loses `role="button"` and `tabIndex`; selection is driven from the table. Keep `onClick` for mouse convenience, with no ARIA role and no keyboard claim.

- [ ] **Step 4: Run the harness to verify it passes**

Run: `pnpm run test:e2e:webview`
Expected: PASS.

- [ ] **Step 5: Check the line count before committing**

Run: `wc -l packages/alp-webview/src/features/build-plan/MemoryChart.tsx`
Expected: under 800. If it is not, move `Rail` into `MemoryRail.tsx` now — the split belongs to the task that would cross the cap, not to a later one.

- [ ] **Step 6: Commit**

```bash
git add packages/alp-webview/src/features/build-plan/MemoryChart.tsx packages/alp-webview/src/features/build-plan/MemoryChart.module.css test/webview/ui-render.tsx
```

```bash
git commit -q -m "feat(build-plan): draw one piecewise rail and drop the fixed 22x detail rail (#484)"
```

---

### Task 6: Compose the tab — findings up, modes gone

**Files:**
- Modify: `packages/alp-webview/src/features/build-plan/MemoryRegions.tsx`, `MemoryRegions.module.css`, `test/webview/ui-render.tsx`, `test/buildPlan.typeScale.test.js`

**Interfaces:**
- Consumes: `MemoryTable` (Task 4), `MemoryChart` (Task 5), `AuthorityLegend` (Task 2).
- Produces: no new exports; `MemoryRegions` keeps its `{ memory, sizes }` props.

**Changes:**
- Delete the `equalized` state, both `.scaleBtn` buttons, `.scaleRow`, and the equalized branch of `.legend`. The legend becomes `<AuthorityLegend />` plus one sentence naming the rail a schematic, placed ABOVE the chart.
- `unresolved` entries whose `status` is `"blocked"` render through `FindingList` in the same `role="alert"` region as `Conflicts`, above the picture. Non-blocked entries stay in `Declared, not placed (N)` below.
- The reason renders as a bordered callout at Title register, not `styles.reason` body text.
- Real headings: the section titles become `<h3>`/`<h4>`, not `<p>`.

- [ ] **Step 1: Write the failing harness assertions**

```tsx
if ((container.textContent || "").includes("Equalized")) {
  problems.push("memory-regions-aen: the Equalized mode button survived");
}
const alerts = Array.from(container.querySelectorAll('[role="alert"]'));
const alertText = alerts.map((a) => a.textContent || "").join(" ");
if (!alertText.includes("alp_default_rpmsg")) {
  problems.push(
    "memory-regions-aen: the blocked IPC carve-out is not in an alert region above the chart",
  );
}
if (container.querySelectorAll("h3, h4").length === 0) {
  problems.push("memory-regions-aen: the view still has no real headings");
}
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm run test:e2e:webview`
Expected: FAIL on all three.

- [ ] **Step 3: Apply the changes**

- [ ] **Step 4: Pin the swatch CSS in the BUILT artifact**

Carried forward from Task 2, where it was correctly impossible: the swatch gate
reads the source CSS, because until this task nothing imported the component and
`packages/alp-webview/dist/main.css` carried zero `data-tier` rules. Rendering the
legend here is what puts them in the bundle, so this is the first task that can
assert they survive Vite.

Add an arm to `test/buildPlan.swatchContrast.test.js` that runs after
`pnpm run compile` and asserts all three `[data-tier="…"]` rules are present in
`packages/alp-webview/dist/main.css`. `test/buildPlan.chartContrast.test.js`
already has a `readDistCss()` helper written for exactly this reason — a source
read "cannot tell a working override from dead markup" — so reuse it rather than
writing a second reader.

Prove the arm bites: temporarily remove the `AuthorityLegend` import so the CSS
module is tree-shaken out, confirm the arm FAILS naming the missing selectors,
then restore the import.

- [ ] **Step 5: Run the harness and the type-scale gate**

Run: `pnpm run test:e2e:webview`
Run: `node --test test/buildPlan.typeScale.test.js`
Expected: PASS. Update the `CHROME` allowlist and `SANCTIONED` list for every size that moved, including `.apertureLabel`'s sanctioned `9px` if the rotated label is gone.

- [ ] **Step 6: Commit**

```bash
git add packages/alp-webview/src/features/build-plan/MemoryRegions.tsx packages/alp-webview/src/features/build-plan/MemoryRegions.module.css test/webview/ui-render.tsx test/buildPlan.typeScale.test.js test/buildPlan.swatchContrast.test.js
```

```bash
git commit -q -m "feat(build-plan): promote blocking findings and drop the scale modes (#484)"
```

---

### Task 7: Open-file and copy, through the host

**Files:**
- Modify: `packages/alp-webview/src/types.ts`, `src/ideHub/buildPlanPanel.ts`, `packages/alp-webview/src/features/build-plan/MemoryRegions.tsx`, `test/webview.payloadMirror.test.js`, `test/ideHub.buildPlanPanel.test.js`

**Interfaces:**
- Produces: `{ type: "openWorkspaceFile"; path: string }` and `{ type: "copyText"; text: string }`, webview to host.

A raw `vscode://file` href is not reliable under the webview CSP and is not used. The host calls `vscode.window.showTextDocument` and `vscode.env.clipboard.writeText`.

- [ ] **Step 1: Write the failing host test**

```js
test("openWorkspaceFile opens the named path and refuses one that escapes the workspace", async () => {
  const opened = [];
  const panel = makePanel({ showTextDocument: (uri) => opened.push(uri.fsPath) });
  await panel.onMessage({ type: "openWorkspaceFile", path: "board.yaml" });
  assert.equal(opened.length, 1);
  await panel.onMessage({ type: "openWorkspaceFile", path: "../../etc/passwd" });
  assert.equal(opened.length, 1, "a path escaping the workspace must be refused");
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `node --test test/ideHub.buildPlanPanel.test.js`
Expected: FAIL — unknown message type.

- [ ] **Step 3: Implement both handlers**

Resolve the path against the workspace root and refuse anything outside it. `copyText` writes the given string with `vscode.env.clipboard.writeText` and needs no path handling.

- [ ] **Step 4: Run the host test and the mirror gate**

Run: `node --test test/ideHub.buildPlanPanel.test.js test/webview.payloadMirror.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/alp-webview/src/types.ts src/ideHub/buildPlanPanel.ts packages/alp-webview/src/features/build-plan/MemoryRegions.tsx test/ideHub.buildPlanPanel.test.js test/webview.payloadMirror.test.js
```

```bash
git commit -q -m "feat(build-plan): open the named file and copy addresses through the host (#484)"
```

---

### Task 8: Measured layout, no breakpoints

**Files:**
- Modify: `packages/alp-webview/src/features/build-plan/MemoryChart.tsx`, `MemoryRegions.tsx`, `MemoryRegions.module.css`
- Create: `test/buildPlan.noBreakpoints.test.js`

**Changes:**
- Remove `const W = 578` and the `width`/`height` attributes pinned to it; the `viewBox` is computed from the measured width and `H`.
- `MemoryRegions` measures its chart column with a `ResizeObserver` and passes `width` down. It does NOT scale the SVG: scaling takes the type down with it, which is the stated reason `max-width: none` exists.
- `.chartScroll`'s `flex: none` and `overflow-x: auto` are removed.
- `.map` becomes `display: grid; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));` so it collapses to one column with no media query.

- [ ] **Step 1: Write the gate**

`test/buildPlan.noBreakpoints.test.js`:

```js
test("the build-plan stylesheets declare no width-based media query", () => {
  for (const file of CSS_FILES) {
    const css = fs.readFileSync(file, "utf8");
    for (const m of css.match(/@media[^{]+/g) ?? []) {
      assert.ok(
        m.includes("prefers-reduced-motion"),
        `${file} declares "${m.trim()}" — the No-Breakpoint Rule allows only prefers-reduced-motion`,
      );
    }
  }
});
```

- [ ] **Step 2: Prove the gate can fail**

Temporarily add `@media (max-width: 600px) { .map { display: block; } }` to `MemoryRegions.module.css`.
Run: `node --test test/buildPlan.noBreakpoints.test.js`
Expected: FAIL, naming that query. Then remove the line and re-run: PASS.

- [ ] **Step 3: Apply the layout change**

- [ ] **Step 4: Run the harness at both widths**

Run: `pnpm run test:e2e:webview`
Expected: PASS, with no clipped caption or truncated identifier at the narrow width.

- [ ] **Step 5: Commit**

```bash
git add packages/alp-webview/src/features/build-plan/MemoryChart.tsx packages/alp-webview/src/features/build-plan/MemoryRegions.tsx packages/alp-webview/src/features/build-plan/MemoryRegions.module.css test/buildPlan.noBreakpoints.test.js
```

```bash
git commit -q -m "feat(build-plan): measure the rail instead of pinning it to 578px (#484)"
```

---

### Task 9: The keyboard model

**Files:**
- Modify: `packages/alp-webview/src/features/build-plan/BuildPlanView.tsx`, `MemoryTable.tsx`, `test/webview/ui-render.tsx`

**Changes:**
- The tab strip gains `ArrowLeft`/`ArrowRight`/`Home`/`End`, roving `tabIndex` (`0` on the selected tab, `-1` on the others), a real `role="tabpanel"` wrapping the rendered content, and `id`/`aria-controls` pairing.
- The table listbox keeps ONE tab stop; `ArrowUp`/`ArrowDown`/`Home`/`End` move a roving `tabIndex` across rows, crossing group boundaries.
- Selection stays on `Enter`. Expansion gets its own key and its own `aria-expanded` on the row; the revealed detail is owned by the row, never inserted as new options.
- A collapsed group's rows leave the option set entirely.
- `preventDefault()` on `Space` everywhere it is handled.

- [ ] **Step 1: Write the failing harness assertions**

```tsx
const tabs = Array.from(container.querySelectorAll('button[role="tab"]'));
const roving = tabs.filter((t) => t.getAttribute("tabindex") === "0");
if (roving.length !== 1) {
  problems.push(`memory-regions-aen: ${roving.length} tabs are tab stops, want exactly 1`);
}
if (!container.querySelector('[role="tabpanel"]')) {
  problems.push("memory-regions-aen: no role=tabpanel wraps the tab content");
}
const rows = Array.from(container.querySelectorAll('li[role="option"]'));
const rowStops = rows.filter((r) => r.getAttribute("tabindex") === "0");
if (rowStops.length !== 1) {
  problems.push(`memory-regions-aen: ${rowStops.length} rows are tab stops, want exactly 1`);
}
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm run test:e2e:webview`
Expected: FAIL — three tab stops, no tabpanel, one stop per row.

- [ ] **Step 3: Implement the keyboard model**

- [ ] **Step 4: Run the harness**

Run: `pnpm run test:e2e:webview`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/alp-webview/src/features/build-plan/BuildPlanView.tsx packages/alp-webview/src/features/build-plan/MemoryTable.tsx test/webview/ui-render.tsx
```

```bash
git commit -q -m "feat(build-plan): give the tab strip and the table a real keyboard model (#484)"
```

---

### Task 10: DESIGN.md, the CHANGELOG, and the full gate run

**Files:**
- Modify: `DESIGN.md`, `CHANGELOG.md`, `test/webview.payloadMirror.test.js`

- [ ] **Step 1: Replace the named rule**

In `DESIGN.md`, replace **The Region-Frame Rule (#484 phase 2)** with a rule stating: the swatch gutter beside the rail and at the head of every table row; three achromatic tiers derived from `{colors.text-primary}`, separated by fill density and hatch, never hue; the permanent three-item legend above the chart; the ≥3:1 and pairwise-distinguishable criteria across the shipping defaults and both high-contrast themes; and that the six exact class names stay in the row's accessible name and expanded detail.

- [ ] **Step 2: Add the CHANGELOG entry**

One `## Unreleased` entry describing what actually ships after all ten tasks.

- [ ] **Step 3: Close the #664 mirror gap**

Register `MemoryRegionSource`, `MemoryRegionKind` and `MemoryRegionStatus` in `ALIASES` in `test/webview.payloadMirror.test.js`. `aliasMembers` already splits on `|`, so `(string & {})` parses.

- [ ] **Step 4: Run the FULL gate set**

```bash
pnpm run format:check
```

```bash
pnpm run compile
```

```bash
pnpm test
```

```bash
pnpm exec vsce package --no-dependencies --out alp-sdk.vsix
```

```bash
bash scripts/check-vsix-allowlist.sh alp-sdk.vsix
```

Expected: every one green. Report the real test counts.

- [ ] **Step 5: Verify commit hygiene across the branch**

```bash
git log --format=%B origin/dev..HEAD | grep -iE 'claude-session|co-authored|claude\.ai'
```

Expected: no output.

- [ ] **Step 6: Commit**

```bash
git add DESIGN.md CHANGELOG.md test/webview.payloadMirror.test.js
```

```bash
git commit -q -m "docs(build-plan): replace the Region-Frame Rule with the swatch gutter (#484)"
```

---

## Self-Review

**Spec coverage.** §1 table → Task 4. §2 rail → Tasks 3 and 5. §3 swatch and legend → Tasks 1, 2, 5. §4 typography → Task 6, with the gate updated there. §5 findings and host messages → Tasks 6 and 7. §6 keyboard and accessibility → Tasks 5 (focusable descendants) and 9. §7 layout → Task 8. §8 degenerate states → Tasks 4 and 5, pinned by the `rpmsg-v2n` and `aen801` harness passes. §9 DESIGN.md → Task 10. §10 file decomposition → Task 5 Step 5, which checks the cap before committing rather than after. §11 tests and gates → every task, with the full set in Task 10. §12 risks → the gates in Tasks 2 and 3.

**Placeholder scan.** No "TBD", no "handle edge cases", no "similar to Task N". Every code step carries real code or an explicit, named list of edits.

**Type consistency.** `AuthorityTier`, `tierOf`, `TIER_LABEL`, `TIER_ORDER`, `compareByTierThenAddress` are defined in Task 1 and used under those names in Tasks 2, 4, 5. `Segment`, `RailLayout`, `layoutRail`, `GAP_PX`, `MIN_EXTENT_PX` are defined in Task 3 and used under those names in Task 5. `MemoryTable` is created in Task 4 and modified in Task 9 under the same name. `AuthoritySwatch` and `AuthorityLegend` are created in Task 2 and used in Tasks 4, 5, 6.

**Known gap, deliberate.** Task 4's `RowDetail` is specified by its contents and its rules rather than written out: its markup follows directly from the four-column row above it, and writing it twice would be the verbatim duplication the review rubric treats as a defect. Every string it renders is named in the task.
