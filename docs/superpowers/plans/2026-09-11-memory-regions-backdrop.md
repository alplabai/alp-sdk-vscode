# Memory Regions Backdrop Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When `build/system-manifest.yaml` carries alp-sdk#1365's `memory[]`
pane, the Build Plan panel's Memory tab draws the SoM's own region table as a
backdrop behind the memory map (true scale) and as a grouped, keyboard-
selectable table below the map, labelled by write authority. When the pane is
absent, the tab renders exactly what it renders today.

**Architecture:** `packages/alp-core/src/systemManifest/memoryView.ts` gains a
pure narrower (`MemoryRegion[]`, `authorityClassOf`, an `outside_region`
finding) that `buildMemoryView` folds into the existing `MemoryView`. The
webview mirrors the new types in `types.ts`, grows the chart's window over
resolved regions with a new pure function in `MemoryChart.tsx`, draws
authority-tinted frames behind the spans, and renders a new
`MemoryRegionTable.tsx` component below the map, after the existing span
list — it has to live outside the map's own conditional so it still renders
when there is no map to sit beside (see Task 5 Step 4). Read-only throughout
— this is phase 2 of #484 (the read-only half); editing is #662.

**Tech Stack:** TypeScript, React 19 (webview), js-yaml, d3-scale, node:test,
esbuild/jsdom render harness.

## Global Constraints

- No schema re-vendor: `schemas/system-manifest-v1.schema.json` and
  `packages/alp-core/src/validation/vendoredSchemas.ts` stay byte-identical.
  Do not add `memory` to either.
- No `SUPPORTED_CLI_VERSION` bump. It stays `0.6.0`.
- No editing, no host round-trip. `write_authority` is optional in both
  `som-preset-v1` and `system-manifest-v1` (promotion to required is
  alp-sdk#2024), so the view stays read-only — `test/memoryRegions.readOnly
  .test.js` enforces this on every file it names in `VIEW_FILES`.
- No eligibility, "free" or "remaining" claims anywhere in new copy or tests.
- CSS: CSS Modules and `styles/tokens.css` aliases only. No new colour or
  spacing tokens — reuse existing `--text-*` / `--border-*` / `--surface-*` /
  `--radius-*` / `--font-size-*` tokens. Never the six-colour chart series
  palette (`--chart-1`..`--chart-6`) for a region frame — that stays with the
  spans. Every `font-size` is `var(--font-size-base)` or `var(--font-size-md)`
  in any new file (nothing below reading size).
- Anchor every edit to an EXISTING symbol or JSX landmark named in this plan
  (a function name, an import line, a unique JSX fragment) — never a line
  number. Task 0 rebases the branch onto `dev` (and PR #661's landed
  type-scale gate) before any other task starts, so every later anchor is
  read against that post-rebase tree, not the pre-#661 one this plan was
  drafted against.
- Company name "Alp Lab". No AI/Claude attribution anywhere. Plain
  `git commit -m "<message>"` for every commit step, no trailers.
- TDD throughout: write the failing test, run it, watch it fail for the
  right reason, implement, run it again, watch it pass, commit.

---

## Task 0: Rebase onto `dev` (PR #661 must be merged first)

**Files:** none (verification + rebase only).

This plan was drafted against PR #661's old head, then corrected for review
findings against its real head. #661 touches four files this plan also
touches (`MemoryChart.tsx`, `MemoryChart.module.css`, `MemoryRegions.tsx`,
`test/buildPlan.typeScale.test.js` — the last one is new in #661, not merely
edited) and adds the `.chartScroll` wrapper this plan's own wording now
accounts for (see the Architecture paragraph above). Every task from here on
assumes `.chartScroll` and `test/buildPlan.typeScale.test.js` already exist —
they do not exist at this branch's current base (`f0b16a04`), only after
#661 merges to `dev`. Do not start Task 1 until this task's Step 4 is green.

- [ ] **Step 1: Confirm #661 has merged**

  ```bash
  gh pr view 661 --json state -q .state
  ```

  Expected: `MERGED`. If it prints `OPEN` or anything else, stop here and
  wait — rebasing onto an unmerged `dev` would not carry #661's changes at
  all, and Task 1 onward would silently run against the pre-#661 tree this
  plan is not written for.

- [ ] **Step 2: Rebase**

  ```bash
  git fetch origin
  git rebase origin/dev
  ```

  This branch's own history is a single commit (the design doc), so no
  conflict is expected here — the conflict risk is in re-anchoring THIS
  PLAN's own instructions against #661's landed code, not in the rebase
  itself.

- [ ] **Step 3: Confirm the two landmarks this plan's later tasks assume**

  ```bash
  test -f test/buildPlan.typeScale.test.js && echo "typeScale test: present"
  grep -q 'styles.chartScroll' packages/alp-webview/src/features/build-plan/MemoryRegions.tsx && echo "chartScroll: present"
  ```

  Expected: both lines print. If either is missing, #661 did not land what
  this plan expects — stop and re-read #661's actual diff before continuing;
  do not patch around a missing landmark by guessing where its equivalent
  moved to.

- [ ] **Step 4: Confirm the post-rebase tree still builds and its own tests
      pass**

  ```bash
  pnpm install --frozen-lockfile
  pnpm run compile
  pnpm run typecheck
  node --test test/buildPlan.typeScale.test.js test/memoryRegions.readOnly.test.js
  ```

  Expected: all four commands exit 0. This is the tree every subsequent task
  in this plan edits — green here means the baseline this plan's diffs apply
  to is sound before this plan adds anything to it.

---

## Task 1: Core plumbing — `memory[]` on the manifest model, two vendored fixtures

**Files:**
- Modify: `packages/alp-core/src/systemManifest/models.ts` (`SystemManifest` interface)
- Modify: `packages/alp-core/src/systemManifest/service.ts` (`parseSystemManifest`)
- Create: `test/fixtures/system-manifest.rpmsg-aen.memory.yaml`
- Create: `test/fixtures/system-manifest.rpmsg-v2n.memory.yaml`
- Test: `test/systemManifest.memoryView.test.js` (append only — do not touch
  any existing `test(...)` block in this file)
- Test: `test/webview.payloadMirror.test.js` (append only —
  `KNOWN_UNMIRRORED` entry, Step 6)

**Interfaces:**
- Consumes: nothing new.
- Produces: `SystemManifest.memory?: unknown[]` — read by Task 2's `regions()`
  narrower.

- [ ] **Step 1: Vendor the two real emitted fixtures, by redirecting `git show`
      — never by pasting**

  These are the SDK's own emit-snapshot goldens. **Do not hand-paste YAML into
  a file** — a paste inside a markdown list is not a byte-safe way to create a
  fixture, and it is exactly how a wrong `board_hw_rev` slips in unnoticed.
  Instead, from a checkout of `alplabai/alp-sdk`, redirect `git show` straight
  to the target path:

  ```bash
  git show 20fec7a7e9ea0479e5a9241edc75c6a8354d0fd0:tests/fixtures/emit-snapshots/rpmsg-aen.system-manifest.snap > test/fixtures/system-manifest.rpmsg-aen.memory.yaml
  git show 20fec7a7e9ea0479e5a9241edc75c6a8354d0fd0:tests/fixtures/emit-snapshots/rpmsg-v2n.system-manifest.snap > test/fixtures/system-manifest.rpmsg-v2n.memory.yaml
  ```

  Pin the commit, not just the branch tip: `20fec7a7e9ea0479e5a9241edc75c6a8354d0fd0`
  ("fix(aen): repair five E1M-EVK drivers, correct the TMP112 address, and add
  the phased EVK demo (#2036)") is the commit both files must be read at —
  **not** the `memory[]` producer's own landing commit (alp-sdk#2030). That
  earlier commit's `rpmsg-aen` snapshot still carries `board_hw_rev: r1`; a
  later, unrelated fix rolled the EVK's `board_hw_rev` to `r2`, and `r2` is
  what every fixture and test value in this plan assumes. `rpmsg-v2n` is
  byte-identical at both commits, so pinning the same, later one for both
  files is simpler than tracking two.

  Sanity-check the result without re-deriving it by eye: the `aen` file must
  have exactly 7 `memory:` rows (`mcuboot`, `he_slot0`, `hp_slot0`, `reserved`,
  `storage`, `atoc`, `mram_main` — the last with `kind: unresolved`, `status:
  unresolved`, no `base`) and `hw_info.board_hw_rev: r2`; the `v2n` file must
  have exactly 3 (`ddr_main`, `ocram_low`, `m33_tcm`, all `source: soc_derived`,
  `kind: unresolved`, `status: ok`, none carrying `write_authority`). Count
  INSIDE the parsed `memory` array, not with a raw `grep -c '^- name:'` — both
  files also have unindented `- name:` rows under `ipc:` and `helper_mcus:`
  (`alp_default_rpmsg`/`cc3501e_otp` for aen, `alp_default_rpmsg`/`gd32_bridge`
  for v2n), so a flat grep over-counts at 9 and 5. `js-yaml` is already a root
  dependency (`package.json`'s own `dependencies`, used by
  `test/systemManifest.fixtures.schemaConformance.test.js`):

  ```bash
  node -e 'const d=require("js-yaml").load(require("fs").readFileSync(process.argv[1],"utf8"));console.log(d.memory.length,d.hw_info.board_hw_rev)' test/fixtures/system-manifest.rpmsg-aen.memory.yaml   # 7 r2
  node -e 'const d=require("js-yaml").load(require("fs").readFileSync(process.argv[1],"utf8"));console.log(d.memory.length,d.hw_info.board_hw_rev)' test/fixtures/system-manifest.rpmsg-v2n.memory.yaml   # 3 r1
  ```

  This also passes `test/systemManifest.fixtures.schemaConformance.test.js`
  unedited — both files were verified against the schema's `required` keys at
  every level before this plan was written.

- [ ] **Step 2: Write the absent/empty invariance tests, plus one real
      red-bar probe**

  Append to the END of `test/systemManifest.memoryView.test.js` (it already
  imports `buildMemoryView`, `parseSystemManifest`, `fs`, `path`, and defines
  `blockedSample()` near the top — reuse all four, do not re-declare them).
  The first four tests below are **invariance guards**: they assert a
  property that must hold both BEFORE this task's implementation (trivially —
  `buildMemoryView` does not set `regions` at all yet) AND after it (by
  construction). They are not a red/green pair on their own, which is why the
  fifth test exists — it is the one assertion in this block that actually
  fails today, for a demonstrable reason (see Step 3).

  ```js
  // ---------------------------------------------------------------------------
  // The SoM region table (#484 phase 2) — memory[]
  //
  // Fixture provenance: test/fixtures/system-manifest.rpmsg-{aen,v2n}.memory.yaml
  // are byte copies of alp-sdk's own emit-snapshot goldens
  // (tests/fixtures/emit-snapshots/rpmsg-{aen,v2n}.system-manifest.snap) at
  // alp-sdk commit 20fec7a7e9ea0479e5a9241edc75c6a8354d0fd0, written with
  // `git show <commit>:<path> > <target>` — see Task 1 Step 1.
  // ---------------------------------------------------------------------------

  test("an absent memory[] pane produces no `regions` key on the view", () => {
    // This fixture predates alp-sdk#2030's memory[] pane.
    const text = fs.readFileSync(
      path.join(__dirname, "fixtures", "system-manifest.rpmsg-v2n.snap.yaml"),
      "utf8",
    );
    const view = buildMemoryView(parseSystemManifest(text));
    assert.equal(
      "regions" in view,
      false,
      "buildMemoryView must not invent a regions key for a producer that never sent one",
    );
  });

  test("the aen801 absent-case baseline also produces no `regions` key", () => {
    // The OTHER absent baseline named in the spec (#484 §5) — a second real
    // fixture that also carries no `memory[]` key, so the same guard is
    // checked against a manifest shaped differently than rpmsg-v2n's.
    const text = fs.readFileSync(
      path.join(__dirname, "fixtures", "system-manifest.aen801.yaml"),
      "utf8",
    );
    const view = buildMemoryView(parseSystemManifest(text));
    assert.equal("regions" in view, false);
  });

  test("memory: [] is treated the same as an absent pane", () => {
    const manifest = blockedSample();
    manifest.memory = [];
    const view = buildMemoryView(manifest);
    assert.equal("regions" in view, false);
  });

  test("an absent memory[] pane produces exactly the pre-#484-phase-2 view shape", () => {
    // NOTE this does NOT compare buildMemoryView(manifest) against
    // buildMemoryView({ ...manifest, memory: undefined }) — for these two
    // fixtures `parseSystemManifest` already returns `memory: undefined`
    // (neither fixture has a `memory:` key), so that comparison would be
    // f(x) === f(x) and could not fail under any implementation. Instead,
    // pin the actual field SET the view carries for an absent pane: it must
    // be exactly the five pre-#484-phase-2 fields, with no `regions` key
    // added by mistake and nothing else quietly dropped either.
    for (const fixture of [
      "system-manifest.aen801.yaml",
      "system-manifest.rpmsg-v2n.snap.yaml",
    ]) {
      const text = fs.readFileSync(path.join(__dirname, "fixtures", fixture), "utf8");
      const view = buildMemoryView(parseSystemManifest(text));
      assert.deepEqual(
        Object.keys(view).sort(),
        ["apertures", "conflicts", "sku", "spans", "unresolved"],
        fixture,
      );
    }
  });

  test("[RED PROBE] parseSystemManifest reads the vendored rpmsg-aen fixture's memory[] pane, seven rows", () => {
    // Unlike the four invariance guards above, this genuinely fails before
    // Steps 4-5 below: `SystemManifest` has no `memory` field yet and
    // `parseSystemManifest` does not read one, so `manifest.memory` is
    // `undefined` and `.length` throws. See Step 3.
    const text = fs.readFileSync(
      path.join(__dirname, "fixtures", "system-manifest.rpmsg-aen.memory.yaml"),
      "utf8",
    );
    const manifest = parseSystemManifest(text);
    assert.equal(manifest.memory.length, 7);
  });
  ```

- [ ] **Step 3: Run the tests to verify the red probe fails for the right
      reason**

  Run: `pnpm --filter ./packages/alp-core run compile && node --test test/systemManifest.memoryView.test.js`
  Expected: the four invariance guards PASS (they hold today because
  `buildMemoryView` never sets `regions` at all yet). The fifth test —
  `[RED PROBE] ...` — FAILS with `TypeError: Cannot read properties of
  undefined (reading 'length')`, because `SystemManifest` has no `memory`
  field yet and `parseSystemManifest` does not read one. That failure is what
  Steps 4-5 fix.

- [ ] **Step 4: Add `memory?: unknown[]` to `SystemManifest`**

  In `packages/alp-core/src/systemManifest/models.ts`, find the
  `SystemManifest` interface (it already ends with `storage?: unknown[];`).
  Add directly below that field:

  ```ts
    /** The SoM's own region table (#484 phase 2) — present only from an
     *  alp-sdk that carries alp-sdk#1365's `memory[]` pane (landed in
     *  alp-sdk#2030; not yet in a tagged release, alp-sdk#2047) and only
     *  when it resolves at least one region for this SoM. `unknown[]` at
     *  this boundary for the same reason `storage` is: every field is
     *  narrowed from scratch in `memoryView.ts`, never cast. */
    memory?: unknown[];
  ```

- [ ] **Step 5: Read `memory` in `parseSystemManifest`**

  In `packages/alp-core/src/systemManifest/service.ts`, find the returned
  object literal in `parseSystemManifest` (it already has
  `storage: Array.isArray(doc.storage) ? doc.storage : undefined,` as its
  last field). Add directly below it:

  ```ts
      memory: Array.isArray(doc.memory) ? doc.memory : undefined,
  ```

- [ ] **Step 6: Record `SystemManifest.memory?` as an intentional payload-mirror
      omission**

  `test/webview.payloadMirror.test.js` walks every core model field and fails
  the moment one is neither mirrored in the webview's `types.ts` nor listed in
  `KNOWN_UNMIRRORED` — and `SystemManifest` is one of the models it walks. Left
  unrecorded, this step's new `memory?` field would redden that gate the
  instant this commit lands, not later. In `test/webview.payloadMirror.test.js`,
  in the `KNOWN_UNMIRRORED` object, directly below the existing
  `"ManifestSlice.recipe?": ...,` entry (still inside the "── system manifest
  ──" group), add:

  ```ts
    "SystemManifest.memory?":
      "The raw memory[] rows are not rendered directly. Only the DERIVED " +
      "MemoryView.regions (built by buildMemoryView: authority-classified, " +
      "narrowed field for field, joined to spans/apertures by name) reaches " +
      "the webview — mirroring the raw pane too would give one screen two " +
      "shapes of the same data to disagree about.",
  ```

- [ ] **Step 7: Run the tests to verify they pass**

  Run: `pnpm --filter ./packages/alp-core run compile && node --test test/systemManifest.memoryView.test.js test/systemManifest.service.test.js test/systemManifest.fixtures.schemaConformance.test.js test/webview.payloadMirror.test.js`
  Expected: PASS — all four files green, including every pre-existing test.
  `test/webview.payloadMirror.test.js` passing here, at this commit, is the
  point of Step 6: every later task in this plan can also run it and stay
  green, rather than discovering a stale mirror only at the end.

- [ ] **Step 8: Commit**

  ```bash
  git add packages/alp-core/src/systemManifest/models.ts packages/alp-core/src/systemManifest/service.ts test/fixtures/system-manifest.rpmsg-aen.memory.yaml test/fixtures/system-manifest.rpmsg-v2n.memory.yaml test/systemManifest.memoryView.test.js test/webview.payloadMirror.test.js
  git commit -m "feat: read system-manifest-v1's memory[] pane (#484)"
  ```

---

## Task 2: `MemoryRegion` narrowing + `authorityClassOf` + `MemoryView.regions?`

**Files:**
- Modify: `packages/alp-core/src/systemManifest/memoryView.ts`
- Modify: `packages/alp-webview/src/types.ts`
- Test: `test/systemManifest.memoryView.test.js` (append only)
- Test: `test/webview.payloadMirror.test.js` (append only)

**Interfaces:**
- Consumes: `SystemManifest.memory?: unknown[]` (Task 1).
- Produces: `MemoryRegion`, `MemoryRegionSource`, `MemoryRegionKind`,
  `MemoryRegionStatus`, `MemoryAuthorityClass`, `authorityClassOf(writeAuthority:
  string | null, source: MemoryRegionSource): MemoryAuthorityClass`,
  `MemoryView.regions?: MemoryRegion[]`, all mirrored onto
  `packages/alp-webview/src/types.ts` in THIS task (Step 4 below) so that
  `test/webview.payloadMirror.test.js` stays green at this task's own commit,
  not just by the end of the plan — consumed by Task 3 (`outside_region`),
  Task 4/5 (webview).

- [ ] **Step 1: Write the failing tests**

  Append to `test/systemManifest.memoryView.test.js`:

  ```js
  test("authorityClassOf covers the full table, including absent under both sources and an unrecognised string", () => {
    const {
      authorityClassOf,
    } = require("../packages/alp-core/dist/systemManifest/memoryView.js");
    const cases = [
      ["customer_runtime", "som_preset", "customer_runtime"],
      ["customer_image", "som_preset", "customer_image"],
      ["vendor_image", "som_preset", "locked"],
      ["secure_enclave", "som_preset", "locked"],
      ["none", "som_preset", "reserved"],
      ["composite", "som_preset", "composite"],
      [null, "som_preset", "unstated"],
      [null, "soc_derived", "unstated"],
      ["quantum_flux", "som_preset", "unstated"],
      // Fail-CLOSED means an inherited Object.prototype key must not leak
      // through as a truthy lookup result — these two would return the
      // Object constructor / Object.prototype itself from a plain object
      // literal indexed by bracket notation, which is not null/undefined and
      // so would defeat a `?? "unstated"` fallback silently.
      ["constructor", "som_preset", "unstated"],
      ["__proto__", "som_preset", "unstated"],
    ];
    for (const [writeAuthority, source, want] of cases) {
      assert.equal(
        authorityClassOf(writeAuthority, source),
        want,
        `authorityClassOf(${writeAuthority}, ${source})`,
      );
    }
  });

  test("rpmsg-aen: the SoM region table narrows to seven rows, mram_main unresolved", () => {
    const text = fs.readFileSync(
      path.join(__dirname, "fixtures", "system-manifest.rpmsg-aen.memory.yaml"),
      "utf8",
    );
    const manifest = parseSystemManifest(text);
    const view = buildMemoryView(manifest);

    assert.deepEqual(
      view.regions.map((r) => r.base),
      [
        2147483648, 2147549184, 2150301696, 2153054208, 2153119744,
        2153218048, null,
      ],
    );
    const mram = view.regions.find((r) => r.name === "mram_main");
    assert.deepEqual(
      { base: mram.base, sizeBytes: mram.sizeBytes, status: mram.status },
      { base: null, sizeBytes: 5767168, status: "unresolved" },
    );
    // Verbatim and in full (spec #484 §1's `reason` contract) — not a
    // substring match, which would still pass if the narrower silently
    // truncated or mangled the rest of the sentence.
    assert.equal(
      mram.reason,
      "Region 'mram_main' declares `base: TBD`, a placeholder, not an " +
        "address, so no extent can be resolved and no class derived. Its " +
        "size resolves, so only the address is missing. Declare `base:` " +
        "in this SoM preset's `memory_map:` to resolve it.",
    );

    // Regions never feed spans/apertures/conflicts.
    const bare = buildMemoryView({ ...manifest, memory: undefined });
    assert.deepEqual(view.spans, bare.spans);
    assert.deepEqual(view.apertures, bare.apertures);
    assert.deepEqual(view.conflicts, bare.conflicts);
  });

  test("rpmsg-v2n: three soc_derived regions, unstated authority, no conflicts", () => {
    const text = fs.readFileSync(
      path.join(__dirname, "fixtures", "system-manifest.rpmsg-v2n.memory.yaml"),
      "utf8",
    );
    const view = buildMemoryView(parseSystemManifest(text));

    assert.deepEqual(
      view.regions.map((r) => [r.name, r.writeAuthority, r.authorityClass]),
      [
        ["ddr_main", null, "unstated"],
        ["ocram_low", null, "unstated"],
        ["m33_tcm", null, "unstated"],
      ],
    );
    assert.deepEqual(view.conflicts, []);
  });

  test("a duplicated region name is kept as two rows", () => {
    const manifest = blockedSample();
    manifest.memory = [
      { name: "dup", source: "som_preset", kind: "flash", status: "ok", base: 1, size_bytes: 2 },
      { name: "dup", source: "som_preset", kind: "flash", status: "ok", base: 3, size_bytes: 4 },
    ];
    assert.equal(buildMemoryView(manifest).regions.length, 2);
  });

  test("a region row with no text name is dropped whole", () => {
    const manifest = blockedSample();
    manifest.memory = [
      { source: "som_preset", kind: "flash", status: "ok", base: 1, size_bytes: 2 },
      null,
      42,
    ];
    assert.deepEqual(buildMemoryView(manifest).regions, undefined);
  });

  test("a quoted-hex base in the region pane is a producer deviation and is dropped, never coerced", () => {
    const manifest = blockedSample();
    manifest.memory = [
      {
        name: "hexy",
        source: "som_preset",
        kind: "flash",
        status: "ok",
        base: "0x80000000",
        size_bytes: 65536,
      },
    ];
    assert.equal(buildMemoryView(manifest).regions[0].base, null);
  });

  test("an unrecognised status is never drawn, even when the row also carries a base", () => {
    const manifest = blockedSample();
    manifest.memory = [
      {
        name: "degraded_region",
        source: "som_preset",
        kind: "flash",
        status: "degraded", // not "ok" — the only status this narrower draws
        base: 0x80000000,
        size_bytes: 65536,
      },
    ];
    const region = buildMemoryView(manifest).regions[0];
    assert.equal(region.status, "degraded");
    assert.equal(
      region.base,
      null,
      "base is kept only when status is exactly \"ok\" — an unrecognised status must not surface a base the UI would then draw",
    );
  });
  ```

- [ ] **Step 2: Run the tests to verify they fail**

  Run: `pnpm --filter ./packages/alp-core run compile && node --test test/systemManifest.memoryView.test.js`
  Expected: FAIL — `authorityClassOf` and `view.regions` do not exist.

- [ ] **Step 3: Implement in `memoryView.ts`**

  First, correct three comments in this file that were true only because the
  region table did not exist. Each is a claim about the CONTRACT, not just a
  remark, and `memory[]` landing on the contract (Task 1) makes all three
  false as written. Find the `// ── Why this module is narrow ──` section
  near the top of the file (it currently says "The SoM's own region table is
  not in the contract" and lists eight root keys) and replace it with:

  ```ts
  // ── Why this module is narrow ────────────────────────────────────────────────
  //
  // The SoM's own region table arrives as a NINTH root key, `memory[]`, only
  // from an alp-sdk that carries alp-sdk#1365's `memory[]` pane (landed in
  // alp-sdk#2030; not yet in a tagged release, alp-sdk#2047). Older
  // producers, and this contract before that commit, declare only eight:
  // `schema_version, generated_by, hw_info, slices, ipc, helper_mcus,
  // boot_order, storage`. When
  // `memory[]` is present it is narrowed into `MemoryRegion[]` below (#484
  // phase 2) — but it is NEVER joined into a span's own `base`: a span's base
  // stays exactly what the emitter pinned for it, never a value this module
  // computed by combining two panes. Reading `metadata/e1m_modules/<SKU>.yaml`
  // directly from TypeScript remains out of bounds either way — that is what
  // the manifest's own description forbids ("Tools read THIS instead of
  // re-deriving folder layout / build wiring from board.yaml + the SoM
  // presets").
  //
  // So `spans`/`apertures`/`conflicts` below still derive ONLY the extents the
  // manifest already resolves for the customer-owned half: the IPC carve-outs
  // and the storage partitions declared in `board.yaml`, plus the load address
  // the emitter pins for each Zephyr slice. `regions` is additive, read
  // separately, and joined to the rest BY NAME only (see `MemoryRegion` and
  // `findOutsideRegion`) — never folded into a span's own fields. Everything
  // else renders as absent, and absent is rendered as absent — never as zero.
  ```

  Next, find `MemorySpan.base`'s doc comment (the one saying "the device's
  own base lives in the region table this contract does not carry") and
  replace it with:

  ```ts
    /**
     * Absolute base address, or `null` when the manifest pins no absolute one.
     *
     * A storage partition is always `null` here even when it fully resolves: the
     * emitter reports `offset_kib` as an offset WITHIN its flash device, and the
     * device's own base is a SEPARATE pane (`memory[]`, narrowed below into
     * `regions`) that this field does not join in. Combining the two would
     * fold two differently-sourced numbers into one that reads as a single
     * fact from the manifest, so the offset is reported as an offset and the
     * absolute address stays absent here — a reader wanting the device's own
     * base joins `MemorySpan.device` to a `MemoryRegion.name` by hand, the way
     * the region table and `MemoryRegionTable` do.
     */
  ```

  Next, find `MemoryAperture`'s doc comment (the one saying "the aperture's
  own base and size live in the SoM region table, which this contract does
  not carry") and replace it with:

  ```ts
  /**
   * A region or flash device the manifest NAMES but does not describe here.
   *
   * `carve_out_region` and `flash_device` say which aperture the resolver
   * allocated out of; the aperture's own base and size, when the contract
   * carries them at all, arrive as a SEPARATE `memory[]` row (narrowed below
   * into `MemoryRegion`) — this type never reads that pane. So an aperture
   * here is still a name plus the hull of what landed inside it, never the
   * aperture's own extent, EVEN WHEN a same-named `MemoryRegion` resolves one:
   * the two are joined only in the UI, by name, never merged into one object
   * here. The distinction matters on screen either way: a rail drawn to the
   * hull says "at least this much of it is in use", which is true, where a
   * rail drawn to a guessed extent would say how much is left, which nothing
   * in THIS type knows.
   */
  ```

  Two more doc comments in this file make the same now-stale claim, in the
  same direction as the three just corrected — "the manifest does not carry
  this" is no longer quite true now that `memory[]` can. Find
  `MemorySpan.sizeBytes`'s doc comment (the one saying a slot image's
  "capacity is a SoM budget the manifest does not carry") and replace it
  with:

  ```ts
    /** Extent in bytes, or `null` when the manifest pins a base but no size
     *  — which is the normal state of a slot image: the SLOT SPAN itself
     *  carries no size here, ever. A same-named `MemoryRegion` row MAY carry
     *  that slot's extent (`memory[]`, when the manifest resolves one) —
     *  listed separately in the region table and never joined to this span,
     *  the same rule `MemorySpan.base`'s doc above states for base. */
    sizeBytes: number | null;
  ```

  Find `slotSpans`'s doc comment (the one saying a slot's capacity "is a
  budget from the SoM, which `tan size` reports separately and this contract
  does not carry") and replace it with:

  ```ts
  /**
   * Slot images.
   *
   * Only slices that participate at all: an `os: "off"` core builds nothing, so
   * a load address on one would point at an image that does not exist. Size is
   * left null on purpose — the slot SPAN itself never carries one: `tan size`
   * reports the same slot's capacity separately (as a budget, not a manifest
   * fact), and a `memory[]` row may separately resolve that slot's own extent
   * as a region — joined to this span only in the UI, by name, never merged
   * into one object here.
   */
  ```

  Now add these new exported types directly below the existing
  `MemorySpanKind` export:

  ```ts
  /** `som_preset` | `soc_derived`, open: an unrecognised string is kept
   *  verbatim rather than dropped — see `MemoryRegion`. */
  export type MemoryRegionSource = "som_preset" | "soc_derived" | (string & {});

  /** `unclassified` and `unresolved` mean "not proven" and must never be
   *  read as RAM; open for the same reason as `MemoryRegionSource`. */
  export type MemoryRegionKind =
    | "flash"
    | "ram"
    | "unclassified"
    | "unresolved"
    | (string & {});

  /** Only `"ok"` is drawn; an unrecognised value is treated like
   *  `"unresolved"` — never drawn, even when the row also carries a base. */
  export type MemoryRegionStatus = "ok" | "unresolved" | (string & {});

  /** Derived from `write_authority` + `source` by `authorityClassOf`. A
   *  CLOSED union — unlike the three above, the UI's authority-tinted
   *  frames and grouping have to exhaust it. */
  export type MemoryAuthorityClass =
    | "customer_runtime"
    | "customer_image"
    | "locked"
    | "reserved"
    | "composite"
    | "unstated";
  ```

  Add the `MemoryRegion` interface directly below `MemoryAperture`:

  ```ts
  /**
   * One row of the SoM's own region table (#484 phase 2): `memory[]` on
   * `system-manifest-v1`, present only from an alp-sdk that carries
   * alp-sdk#1365's `memory[]` pane (landed in alp-sdk#2030; not yet in a
   * tagged release, alp-sdk#2047) and only when it resolves at least one
   * region for this SoM.
   *
   * Regions never feed `spans`, `apertures` or the pre-existing conflict
   * checks — the UI joins them to spans and apertures BY NAME. The one
   * exception is `outside_region` (below), which reads both.
   */
  export interface MemoryRegion {
    /** `memory:<name>` — distinct from `MemoryAperture`'s `region:<name>`,
     *  which names a different object and must not share selection state
     *  with this one. */
    id: string;
    name: string;
    source: MemoryRegionSource;
    kind: MemoryRegionKind;
    status: MemoryRegionStatus;
    /** Kept only when `status` is exactly `"ok"` — an unrecognised status
     *  drops it even if the row carries one. */
    base: number | null;
    /** Resolves independently of `base`. */
    sizeBytes: number | null;
    /** Verbatim, or `null` when the producer named none. */
    writeAuthority: string | null;
    authorityClass: MemoryAuthorityClass;
    cores: string[];
    /** Verbatim and in full. */
    reason: string | null;
  }
  ```

  Add `authorityClassOf` directly below `MemoryRegion`:

  ```ts
  // A Map, not a plain object literal: a plain object indexed by bracket
  // notation returns an inherited Object.prototype member for a key like
  // "constructor" or "__proto__" — a real, non-null value that a `?? "unstated"`
  // fallback would never catch. A Map's `.get` has no prototype chain to leak
  // through, so an unrecognised key (however it spells itself) always misses
  // cleanly.
  const AUTHORITY_CLASS_BY_WRITE_AUTHORITY = new Map<string, MemoryAuthorityClass>([
    ["customer_runtime", "customer_runtime"],
    ["customer_image", "customer_image"],
    ["vendor_image", "locked"],
    ["secure_enclave", "locked"],
    ["none", "reserved"],
    ["composite", "composite"],
  ]);

  /**
   * Fail-closed derivation of a region's `authorityClass` from its raw
   * `write_authority` string. Exhaustively unit-tested; defaults to
   * `"unstated"` for `null` and for any string this table does not
   * recognise — including an inherited `Object.prototype` member name, which
   * a plain-object lookup would not have refused.
   *
   * `source` never changes the CLASS this returns today — a `som_preset` row
   * and a `soc_derived` row with the same (or absent) `write_authority`
   * always land in the same class. It is still a parameter: the LABEL a UI
   * puts beside that class (never computed here — see the webview) differs
   * by source for the absent case ("authority not declared" vs "not
   * authored · SoC-derived table"), and keeping both functions keyed on the
   * same two arguments is what keeps them from drifting apart on what a
   * region even is.
   */
  export function authorityClassOf(
    writeAuthority: string | null,
    source: MemoryRegionSource,
  ): MemoryAuthorityClass {
    void source;
    if (writeAuthority === null) return "unstated";
    return AUTHORITY_CLASS_BY_WRITE_AUTHORITY.get(writeAuthority) ?? "unstated";
  }
  ```

  Add the `regions()` narrower directly below the existing `partitions()`
  function:

  ```ts
  /** A string field that is always readable even when it names nothing this
   *  contract recognises — `source`, `kind` and `status` are open unions on
   *  purpose (see their type docs), so an unrecognised value must still be a
   *  string a UI can render, never null. */
  function asOpenString(value: unknown): string {
    return typeof value === "string" ? value : "";
  }

  /**
   * The SoM's own region table, when the manifest carries one.
   *
   * `base` and `size_bytes` are the emitter's own plain YAML integers here —
   * UNLIKE `carve_out_base`/`carve_out_size`, they are never quoted hex — so
   * `asCount` is the whole rule; a hex string in this pane is a producer
   * deviation and is dropped, never coerced (`asHexOrCount` is deliberately
   * not used here). A row with no text `name` is dropped whole; every other
   * field defaults to an empty string or null rather than dropping the row,
   * because an unrecognised `source`/`kind`/`status` is still something a UI
   * can render (as "not proven" / "unstated"), where dropping the row would
   * hide a resolved extent instead. Duplicate names are kept as separate
   * rows; only `findOutsideRegion`'s name-join refuses an ambiguous name.
   */
  function regions(value: unknown): MemoryRegion[] {
    const out: MemoryRegion[] = [];
    for (const row of records(value)) {
      const name = asText(row.name);
      if (name === null) continue;
      const source = asOpenString(row.source);
      const status = asOpenString(row.status);
      const writeAuthority = asText(row.write_authority);
      out.push({
        id: `memory:${name}`,
        name,
        source,
        kind: asOpenString(row.kind),
        status,
        base: status === "ok" ? asCount(row.base) : null,
        sizeBytes: asCount(row.size_bytes),
        writeAuthority,
        authorityClass: authorityClassOf(writeAuthority, source),
        cores: asCores(row.accessible_from),
        reason: asText(row.reason),
      });
    }
    return out;
  }
  ```

  In the `MemoryView` interface, add directly below the existing
  `apertures: MemoryAperture[];` field:

  ```ts
    /** The SoM's own region table (#484 phase 2). Omitted — never an empty
     *  array — when the manifest carries no `memory[]` pane, or the pane
     *  resolves no regions for this SoM. */
    regions?: MemoryRegion[];
  ```

  In `buildMemoryView`, replace:

  ```ts
    return {
      sku: asText(manifest.hw_info?.sku) ?? "",
      spans,
      unresolved: [...ipc.unresolved, ...storage.unresolved],
      apertures: findApertures(spans),
      conflicts: findConflicts(spans),
    };
  ```

  with:

  ```ts
    const memoryRegions = regions(manifest.memory);
    return {
      sku: asText(manifest.hw_info?.sku) ?? "",
      spans,
      unresolved: [...ipc.unresolved, ...storage.unresolved],
      apertures: findApertures(spans),
      conflicts: findConflicts(spans),
      ...(memoryRegions.length > 0 ? { regions: memoryRegions } : {}),
    };
  ```

  (`findOutsideRegion` is added to this `conflicts` array in Task 3 — leave
  `conflicts: findConflicts(spans)` as the placeholder for now; Task 3
  extends it.)

- [ ] **Step 4: Mirror the new types onto the webview's `types.ts`, in the
      SAME task that introduces them**

  This step exists so `test/webview.payloadMirror.test.js`'s "every field the
  source adds is either mirrored or a recorded omission" check stays green at
  THIS commit — not two tasks from now. That test walks `MemoryView` (already
  registered in `MODELS`) field by field; adding `regions?` to the core
  interface above without mirroring it here would redden that gate the
  instant this task's commit lands.

  First, correct a stale comment this same file already carries. Find
  `MemorySpan.base`'s doc comment (the one saying "the device's own base is
  in the SoM region table, which system-manifest-v1 does not carry
  (alp-sdk#1365)") and replace it with:

  ```ts
    /** Absolute base, or null. A partition is ALWAYS null: its `offset_kib`
     *  is device-relative, and the device's own base is a SEPARATE mirrored
     *  type (`MemoryRegion`, below) that this field never joins in — a
     *  reader wanting it joins `MemorySpan.device` to a `MemoryRegion.name`
     *  by hand, the way `MemoryRegionTable` does. */
  ```

  Directly below it, find `MemorySpan.sizeBytes`'s doc comment (the one
  saying a slot image's "capacity is a SoM budget `tan size` reports
  separately") and replace it with:

  ```ts
    /** Null when a base is pinned but no size is — the normal state of a
     *  slot image: this SPAN itself never carries one. A same-named
     *  `MemoryRegion` row may separately resolve that slot's own extent as a
     *  region, listed in the region table and never joined to this span. */
  ```

  Now, in `packages/alp-webview/src/types.ts`, find the comment block
  `// --- Memory regions (#484): mirrors ... ---` and the existing
  `export type MemoryConflictKind = ...;` declaration below it. Add, directly
  above `export interface MemoryConflict { ... }`:

  ```ts
  /** Mirrors `@alp-sdk/core/systemManifest/memoryView`'s open unions. */
  export type MemoryRegionSource = "som_preset" | "soc_derived" | (string & {});
  export type MemoryRegionKind =
    | "flash"
    | "ram"
    | "unclassified"
    | "unresolved"
    | (string & {});
  export type MemoryRegionStatus = "ok" | "unresolved" | (string & {});

  /** Derived host-side by `authorityClassOf`; a CLOSED union the UI's
   *  authority tint and grouping must exhaust. */
  export type MemoryAuthorityClass =
    | "customer_runtime"
    | "customer_image"
    | "locked"
    | "reserved"
    | "composite"
    | "unstated";

  /** One row of the SoM's own region table (#484 phase 2), present only from
   *  a producer new enough to resolve one. */
  export interface MemoryRegion {
    id: string;
    name: string;
    source: MemoryRegionSource;
    kind: MemoryRegionKind;
    status: MemoryRegionStatus;
    base: number | null;
    sizeBytes: number | null;
    writeAuthority: string | null;
    authorityClass: MemoryAuthorityClass;
    cores: string[];
    reason: string | null;
  }
  ```

  In the `MemoryView` interface, add directly below the existing
  `apertures: MemoryAperture[];` field:

  ```ts
    /** Omitted — never an empty array — when the manifest carries no
     *  memory[] pane, or it resolves no regions for this SoM. */
    regions?: MemoryRegion[];
  ```

- [ ] **Step 5: Register the new mirrors in `test/webview.payloadMirror.test.js`**

  In the `MODELS` array, directly below the existing
  `{ mirror: "MemoryView", file: MEMORY_REL },` line, add:

  ```ts
    { mirror: "MemoryRegion", file: MEMORY_REL },
  ```

  In the `ALIASES` array, directly below the existing
  `{ mirror: "MemorySpanKind", file: MEMORY_REL },` line, add:

  ```ts
    { mirror: "MemoryAuthorityClass", file: MEMORY_REL },
  ```

- [ ] **Step 6: Run the tests to verify they pass**

  Run: `pnpm --filter ./packages/alp-core run compile && node --test test/systemManifest.memoryView.test.js test/webview.payloadMirror.test.js test/webview.protocolMirror.test.js`
  Expected: PASS — every test in all three files, old and new. The second
  file is where Step 4/5's mirror registrations actually get checked; the
  third is run only as a regression check (this task does not touch it).

- [ ] **Step 7: Commit**

  ```bash
  git add packages/alp-core/src/systemManifest/memoryView.ts packages/alp-webview/src/types.ts test/systemManifest.memoryView.test.js test/webview.payloadMirror.test.js
  git commit -m "feat: narrow memory[] into MemoryRegion + authorityClassOf, mirrored to the webview (#484)"
  ```

---

## Task 3: `outside_region` finding

**Files:**
- Modify: `packages/alp-core/src/systemManifest/memoryView.ts`
- Modify: `packages/alp-webview/src/types.ts`
- Modify: `packages/alp-webview/src/features/build-plan/MemoryRegions.tsx`
- Test: `test/systemManifest.memoryView.test.js` (append only)

**Interfaces:**
- Consumes: `MemorySpan`, `MemoryRegion`, `extentOf` (already private to this
  module), `MemoryConflict`.
- Produces: `MemoryConflictKind` gains `"outside_region"` on BOTH sides (core
  and its webview mirror, in the same step — `test/webview.payloadMirror
  .test.js`'s `ALIASES` array already pairs `MemoryConflictKind` across the
  two files and compares their member SETS, so the two must move together or
  that comparison fails); `buildMemoryView`'s `conflicts` array includes it;
  a new `OutsideRegionNotice` component in `MemoryRegions.tsx` renders
  `outside_region` findings in their OWN block, worded as the manifest's own
  numbers disagreeing — never through the existing `Conflicts` component,
  whose heading ("One extent lands on another") is a collision framing that
  does not fit "this extent is not inside the region it names" (spec #484
  §3). `CONFLICT_TITLE` still gains the matching entry (it is a
  `Record<MemoryConflict["kind"], string>`, so TypeScript requires every
  member even though this path never renders it — see Step 4).

- [ ] **Step 1: Write the failing tests**

  Append to `test/systemManifest.memoryView.test.js` (reuses
  `RESOLVED_CARVE_OUT`, already defined at the top of this file — its
  `carve_out_region` is `"mram_main"`, base `0x80540000`, size `0x00040000`):

  ```js
  // ---------------------------------------------------------------------------
  // outside_region — the manifest's own numbers disagree
  // ---------------------------------------------------------------------------

  test("outside_region: a resolved carve-out that overruns its own named region", () => {
    const manifest = blockedSample();
    manifest.ipc = [RESOLVED_CARVE_OUT];
    manifest.memory = [
      {
        name: "mram_main",
        source: "som_preset",
        kind: "flash",
        status: "ok",
        base: 0x80540000,
        size_bytes: 0x00020000, // half the carve-out's own size
        write_authority: "customer_image",
      },
    ];

    const view = buildMemoryView(manifest);

    assert.deepEqual(
      view.conflicts.map((c) => [c.kind, c.first, c.second]),
      [["outside_region", "alp_rpmsg", "mram_main"]],
    );
  });

  test("outside_region is not emitted for an unresolved named region", () => {
    const manifest = blockedSample();
    manifest.ipc = [RESOLVED_CARVE_OUT];
    manifest.memory = [
      {
        name: "mram_main",
        source: "som_preset",
        kind: "flash",
        status: "unresolved",
        size_bytes: 0x20000,
        reason: "TBD",
      },
    ];
    assert.deepEqual(buildMemoryView(manifest).conflicts, []);
  });

  test("outside_region is not emitted for a sizeless named region", () => {
    const manifest = blockedSample();
    manifest.ipc = [RESOLVED_CARVE_OUT];
    manifest.memory = [
      {
        name: "mram_main",
        source: "som_preset",
        kind: "flash",
        status: "ok",
        base: 0x80540000,
      },
    ];
    assert.deepEqual(buildMemoryView(manifest).conflicts, []);
  });

  test("outside_region is not emitted for a duplicated region name", () => {
    const manifest = blockedSample();
    manifest.ipc = [RESOLVED_CARVE_OUT];
    // Deliberately SMALLER than the carve-out (0x40000): if the duplicate
    // refusal were missing or buggy and this join picked either row anyway,
    // the carve-out would overrun it and the (wrong) finding WOULD fire —
    // unlike a same-size duplicate, which would pass this test whether or
    // not duplicates are actually refused.
    manifest.memory = [
      { name: "mram_main", source: "som_preset", kind: "flash", status: "ok", base: 0x80540000, size_bytes: 0x20000 },
      { name: "mram_main", source: "som_preset", kind: "flash", status: "ok", base: 0x80540000, size_bytes: 0x20000 },
    ];
    assert.deepEqual(buildMemoryView(manifest).conflicts, []);
  });

  test("outside_region is not emitted when the carve-out's region name matches no row", () => {
    // A `memory[]` pane that is PRESENT but simply never names "mram_main" —
    // distinct from an absent/empty pane, which is a different case this
    // finding must also refuse (there being nothing to compare against
    // either way, but for a different reason: no pane at all, vs. a pane
    // that resolves other regions and just not this one).
    const manifest = blockedSample();
    manifest.ipc = [RESOLVED_CARVE_OUT];
    manifest.memory = [
      { name: "other", source: "som_preset", kind: "flash", status: "ok", base: 0x80540000, size_bytes: 0x20000 },
    ];
    assert.deepEqual(buildMemoryView(manifest).conflicts, []);
  });

  test("outside_region is not emitted for an empty memory[] pane", () => {
    const manifest = blockedSample();
    manifest.ipc = [RESOLVED_CARVE_OUT];
    manifest.memory = [];
    assert.deepEqual(buildMemoryView(manifest).conflicts, []);
  });

  test("outside_region is not emitted for a TRULY absent memory[] pane", () => {
    // Distinct from the empty-array case above: `blockedSample()` sets no
    // `memory` key at all, so `manifest.memory` is `undefined` here, not
    // `[]` — the two are handled by the same early-out in `regions()`, but
    // this pins that "absent" and "empty" are both refused, not just one.
    const manifest = blockedSample();
    manifest.ipc = [RESOLVED_CARVE_OUT];
    assert.deepEqual(buildMemoryView(manifest).conflicts, []);
  });
  ```

- [ ] **Step 2: Run the tests to verify they fail**

  Run: `pnpm --filter ./packages/alp-core run compile && node --test test/systemManifest.memoryView.test.js`
  Expected: FAIL — the positive case reports `conflicts: []` because
  `outside_region` does not exist yet.

- [ ] **Step 3: Implement**

  In the `MemoryConflictKind` union, add the new member AND its doc bullet
  (the JSDoc block directly above the union already lists `overlap`,
  `covers_load_address` and `device_overlap` — add a fourth line):

  ```ts
  /**
   *  - `overlap`              two sized extents share addresses
   *  - `covers_load_address`  a sized extent contains a slice's load address —
   *                           the shape of the ATOC incident (alp-sdk#1289): an
   *                           allocation landing on top of something already
   *                           living there, with nothing failing at build time
   *  - `device_overlap`       two partitions overlap inside one flash device
   *  - `outside_region`       a resolved carve-out's extent is not contained
   *                           in the one resolved region its `carve_out_region`
   *                           names — the manifest's own numbers disagreeing,
   *                           not a collision
   */
  export type MemoryConflictKind =
    | "overlap"
    | "covers_load_address"
    | "device_overlap"
    | "outside_region";
  ```

  Add directly below `findConflicts`:

  ```ts
  /** A region's own absolute extent, or null when it does not resolve one —
   *  the same half-open shape `extentOf` gives a span. */
  function regionExtentOf(region: MemoryRegion): { lo: number; hi: number } | null {
    if (region.status !== "ok" || region.base === null) return null;
    if (region.sizeBytes === null || region.sizeBytes <= 0) return null;
    return { lo: region.base, hi: region.base + region.sizeBytes };
  }

  /**
   * The one finding that reads both `spans` and `regions`: a resolved
   * carve-out whose `carve_out_region` names exactly one resolved region,
   * and whose extent that region does not fully contain. Worded as the
   * manifest's own numbers disagreeing, not as a collision — rendered by
   * the webview's `OutsideRegionNotice`, its own component with its own
   * heading, never through `Conflicts`/`CONFLICT_TITLE`'s collision framing.
   *
   * "Exactly one": a region name shared by two or more rows is ambiguous, so
   * this join refuses it rather than guessing which one the carve-out meant.
   * Never emitted for an unresolved, sizeless or absent region either — there
   * is nothing to compare the carve-out's extent against.
   */
  function findOutsideRegion(
    spans: MemorySpan[],
    regionRows: MemoryRegion[],
  ): MemoryConflict[] {
    const byName = new Map<string, MemoryRegion[]>();
    for (const region of regionRows) {
      byName.set(region.name, [...(byName.get(region.name) ?? []), region]);
    }

    const out: MemoryConflict[] = [];
    for (const span of spans) {
      if (span.kind !== "carve_out" || span.region === null) continue;
      const extent = extentOf(span);
      if (extent === null) continue;

      const candidates = byName.get(span.region);
      if (!candidates || candidates.length !== 1) continue;
      const regionExtent = regionExtentOf(candidates[0]);
      if (regionExtent === null) continue;
      if (extent.lo >= regionExtent.lo && extent.hi <= regionExtent.hi) continue;

      out.push({
        id: `outside_region:${span.label}:${candidates[0].name}`,
        kind: "outside_region",
        first: span.label,
        second: candidates[0].name,
        from: extent.lo,
        to: extent.hi,
        device: null,
      });
    }
    return out;
  }
  ```

  In `buildMemoryView`, change `conflicts: findConflicts(spans),` to:

  ```ts
      conflicts: [
        ...findConflicts(spans),
        ...findOutsideRegion(spans, memoryRegions),
      ],
  ```

- [ ] **Step 4: Mirror the new member in `types.ts`, and satisfy `CONFLICT_TITLE`**

  In `packages/alp-webview/src/types.ts`, change:

  ```ts
  export type MemoryConflictKind =
    | "overlap"
    | "covers_load_address"
    | "device_overlap";
  ```

  to:

  ```ts
  export type MemoryConflictKind =
    | "overlap"
    | "covers_load_address"
    | "device_overlap"
    | "outside_region";
  ```

  In `packages/alp-webview/src/features/build-plan/MemoryRegions.tsx`, find
  the `CONFLICT_TITLE` record (it already has `overlap`, `covers_load_address`
  and `device_overlap` entries) and add a fourth — required for TypeScript's
  exhaustiveness check on `Record<MemoryConflict["kind"], string>`, even
  though `Conflicts` (below) never receives an `outside_region` item to look
  it up for:

  ```ts
    // Never actually looked up: OutsideRegionNotice (below) owns this kind's
    // rendering and Conflicts never receives one. Present only because
    // Record<MemoryConflict["kind"], string> requires every member.
    outside_region: "lands outside the region it names",
  ```

  Directly below the existing `Conflicts` function, add a second component
  that renders `outside_region` findings on their own — worded as the
  manifest's own numbers disagreeing, never as a collision, since nothing
  here "lands on" anything else:

  ```tsx
  /**
   * `outside_region` findings, rendered separately from `Conflicts` above.
   *
   * `Conflicts`' heading ("One extent lands on another") and its row
   * (`{first} · {second}`) are a COLLISION framing: two things sharing an
   * address. A carve-out that overruns the region it names is a different
   * shape of problem — the manifest's OWN numbers disagreeing with each
   * other — and reusing the collision heading here would claim something
   * false: nothing else occupies the space this carve-out spilled into.
   */
  function OutsideRegionNotice({ findings }: { findings: MemoryConflict[] }) {
    if (findings.length === 0) return null;
    return (
      <div className={styles.conflicts} role="alert">
        <p className={styles.conflictsTitle}>
          {findings.length === 1
            ? "The manifest's own numbers disagree"
            : `${findings.length} extents disagree with the region they name`}
        </p>
        <ul className={styles.conflictList}>
          {findings.map((f) => (
            <li key={f.id} className={styles.conflictRow}>
              <span className={styles.rowName}>
                {f.first}&rsquo;s extent is not inside region {f.second}
              </span>
              <code className={styles.addr}>
                {f.from === f.to
                  ? formatAddress(f.from)
                  : `${formatAddress(f.from)} – ${formatAddress(f.to)}`}
              </code>
            </li>
          ))}
        </ul>
      </div>
    );
  }
  ```

  Finally, split `memory.conflicts` between the two components instead of
  handing the whole array to `Conflicts` alone. Find, in the `MemoryRegions`
  function's returned JSX:

  ```tsx
      <Conflicts conflicts={memory.conflicts} />
  ```

  and replace it with:

  ```tsx
      <Conflicts
        conflicts={memory.conflicts.filter((c) => c.kind !== "outside_region")}
      />
      <OutsideRegionNotice
        findings={memory.conflicts.filter((c) => c.kind === "outside_region")}
      />
  ```

- [ ] **Step 5: Run the tests to verify they pass**

  Run: `pnpm --filter ./packages/alp-core run compile && node --test test/systemManifest.memoryView.test.js test/webview.payloadMirror.test.js`
  Expected: PASS — every test in both files, including the `MemoryConflictKind`
  alias member-set comparison in `webview.payloadMirror.test.js`.

  Run: `pnpm run typecheck`
  Expected: PASS — `CONFLICT_TITLE`'s `Record<MemoryConflict["kind"], string>`
  type is satisfied for all four members.

- [ ] **Step 6: Commit**

  ```bash
  git add packages/alp-core/src/systemManifest/memoryView.ts packages/alp-webview/src/types.ts packages/alp-webview/src/features/build-plan/MemoryRegions.tsx test/systemManifest.memoryView.test.js
  git commit -m "feat: add the outside_region finding, mirrored to the webview (#484)"
  ```

---

## Task 4: Webview — window growth + chart backdrop frames

**Files:**
- Modify: `packages/alp-webview/src/features/build-plan/MemoryChart.tsx`
- Modify: `packages/alp-webview/src/features/build-plan/MemoryChart.module.css`

**Interfaces:**
- Consumes: `MemoryRegion`, `MemoryAuthorityClass` (Task 2).
- Produces: `MemoryChart`'s prop list gains `regions?: MemoryRegion[]`
  (OPTIONAL, defaulting to `[]` — see Step 2's note on why this task must
  type-check on its own, before Task 5 updates the only external call site);
  exported `resolvedRegions(regions: MemoryRegion[]): ResolvedRegion[]`,
  `growWindowOverRegions(win: Window, regions: ResolvedRegion[]): Window`,
  `regionsInWindow(win: Window, regions: ResolvedRegion[]): ResolvedRegion[]`,
  exported `duplicatedNames(regions: MemoryRegion[]): Set<string>`, exported
  `interface ResolvedRegion { region: MemoryRegion; lo: number; hi: number }`
  — all consumed by Task 5 (`MemoryRegions.tsx`, to compute the same window
  for `MemoryRegionTable`; `MemoryRegionTable.tsx` imports `duplicatedNames`
  from here rather than declaring its own copy — see Task 5 Step 2).
- No unit test file for these pure functions (this codebase pins
  `MemoryChart.tsx`'s pure helpers only through the render harness — see
  Task 7, which pins the exact grown window `0x80000000`–`0x80580000` via the
  chart's own `aria-label`).

- [ ] **Step 1: Extend the type import and add the pure functions**

  First, correct a stale comment: find `ApertureBar`'s doc comment (the one
  saying "An aperture's own base and size are not in this contract") and
  replace it with:

  ```ts
  /**
   * One aperture as a bar beside the map — never as a band inside it.
   *
   * An aperture's own base and size are never READ here, even though the
   * contract can now carry them for a same-named row (the SoM region table,
   * `regions` below): what this bar draws from is only which extents the
   * resolver put inside it. So the bar still spans the hull of its members
   * — "at least this much of it is in use", which is true, where a bar
   * drawn to a guessed extent would say how much is left, which this
   * function does not know and does not try to.
   */
  ```

  In `MemoryChart.tsx`, change:

  ```ts
  import type { MemoryAperture, MemorySpan, SliceSize } from "../../types";
  ```

  to:

  ```ts
  import type {
    MemoryAperture,
    MemoryRegion,
    MemorySpan,
    SliceSize,
  } from "../../types";
  ```

  Directly below the existing `windowOf` function, add:

  ```ts
  /** A region's own resolved extent, paired with the row it came from — the
   *  shape both the window-growth rule and `Rail`'s frame-drawing want, so
   *  neither re-derives `status === "ok"` + a positive size itself. */
  export interface ResolvedRegion {
    region: MemoryRegion;
    lo: number;
    hi: number;
  }

  /** Every region that resolves an extent: `status: "ok"`, a base, and a
   *  positive size. An unresolved, sizeless or zero-size region draws no
   *  frame and cannot grow the window. */
  export function resolvedRegions(regions: MemoryRegion[]): ResolvedRegion[] {
    const out: ResolvedRegion[] = [];
    for (const region of regions) {
      if (region.status !== "ok" || region.base === null) continue;
      if (region.sizeBytes === null || region.sizeBytes <= 0) continue;
      out.push({ region, lo: region.base, hi: region.base + region.sizeBytes });
    }
    return out;
  }

  /**
   * Grows a window, to a FIXPOINT, over every resolved region that
   * intersects or TOUCHES it — so a region ending exactly where the window
   * begins (the normal adjacency of a region table, not a gap) still pulls
   * the window's edge out to cover it, and the next region touching THAT new
   * edge is pulled in too, and so on until nothing moves. A region that
   * never intersects or touches the window through that whole process is
   * left out on purpose — the region table then says it is outside it.
   */
  export function growWindowOverRegions(
    win: Window,
    regions: ResolvedRegion[],
  ): Window {
    let { lo, hi } = win;
    let changed = true;
    while (changed) {
      changed = false;
      for (const r of regions) {
        if (r.lo > hi || r.hi < lo) continue;
        if (r.lo < lo) {
          lo = r.lo;
          changed = true;
        }
        if (r.hi > hi) {
          hi = r.hi;
          changed = true;
        }
      }
    }
    return { lo, hi };
  }

  /** The resolved regions that actually intersect a window — what a rail
   *  draws a frame for. Strict intersection, not "touches": a region merely
   *  adjacent to the window has nothing to show and would draw a
   *  zero-height frame. */
  export function regionsInWindow(
    win: Window,
    regions: ResolvedRegion[],
  ): ResolvedRegion[] {
    return regions.filter((r) => r.lo < win.hi && r.hi > win.lo);
  }

  /** Names shared by two or more rows. Selecting a region row sets `selected`
   *  to its id (`memory:<name>`) — for a duplicated name that id belongs to
   *  every row sharing it, so a click could highlight all of them at once
   *  unless the caller refuses the join. The single source of truth for that
   *  refusal: `MemoryRegionTable.tsx` (Task 5) imports this instead of
   *  keeping its own copy, so the chart frame, the aperture bar and the table
   *  row all refuse the same names the same way. */
  export function duplicatedNames(regions: MemoryRegion[]): Set<string> {
    const seen = new Set<string>();
    const dupes = new Set<string>();
    for (const region of regions) {
      if (seen.has(region.name)) dupes.add(region.name);
      seen.add(region.name);
    }
    return dupes;
  }
  ```

- [ ] **Step 2: Wire the grown window into `MemoryChart`**

  Change the `MemoryChart` function's prop type and body. Find:

  ```ts
  export function MemoryChart({
    spans,
    apertures,
    budgets,
    equalized,
    selected,
    onSelect,
  }: {
    spans: MemorySpan[];
    apertures: MemoryAperture[];
    budgets: Map<string, SliceSize>;
    equalized: boolean;
    selected: string | null;
    onSelect: (id: string) => void;
  }) {
    const placed = spans.filter((s) => s.base !== null);
    const win = windowOf(placed, budgets);
    if (!win) return null;
  ```

  Replace with:

  ```ts
  export function MemoryChart({
    spans,
    apertures,
    budgets,
    regions = [],
    equalized,
    selected,
    onSelect,
  }: {
    spans: MemorySpan[];
    apertures: MemoryAperture[];
    budgets: Map<string, SliceSize>;
    // OPTIONAL, defaulting to `[]` — not because a real caller ever omits it,
    // but so THIS task's own `pnpm run typecheck` passes standalone. Task 5
    // updates this component's only external call site
    // (`MemoryRegions.tsx`) to pass a real array; making the prop required
    // until then would report a missing-prop error at that call site for an
    // entire task, which is not a state this plan asks anyone to tolerate.
    regions?: MemoryRegion[];
    equalized: boolean;
    selected: string | null;
    onSelect: (id: string) => void;
  }) {
    const placed = spans.filter((s) => s.base !== null);
    const resolved = resolvedRegions(regions);
    const rawWindow = windowOf(placed, budgets);
    if (!rawWindow) return null;
    // §4's window rule: grow the spans/budgets window to a fixpoint over
    // every resolved region that intersects or touches it. Regions never
    // CREATE a window on their own — only widen one that already exists.
    const win = growWindowOverRegions(rawWindow, resolved);
  ```

  Directly below the existing `const regionApertures = apertures.filter(...)`
  line, add:

  ```ts
    const regionsInMain = regionsInWindow(win, resolved);
  ```

  Find the `detail` window computation (`const detail: Window = { lo:
  win.hi - detailSpan, hi: win.hi };`) and, directly below the existing
  `const inDetail = placed.filter((s) => { ... });` block, add:

  ```ts
    const regionsInDetail = regionsInWindow(detail, resolved);
  ```

- [ ] **Step 3: Pass `regions` into both `<Rail>` calls, and selection into
      `<ApertureBar>`**

  Extend `RailProps` (the interface directly above `function Rail`) by
  adding, directly below the existing `series: Map<string, number>;` field:

  ```ts
    regions: ResolvedRegion[];
    /** Null when nothing is selected, OR when the selected region's name is
     *  shared by two or more rows — a duplicated name is refused here, not
     *  just in the table, so a click on either duplicate row never
     *  highlights both this frame and the aperture bar of the same name.
     *  Distinct from `selected` (the raw id), which spans still match
     *  directly — only a region frame/aperture match is name-based and so
     *  is the one that needs this refusal. */
    selectedRegionName: string | null;
  ```

  Change `Rail`'s own parameter destructuring from:

  ```ts
  function Rail({
    win,
    spans,
    budgets,
    x,
    width,
    equalized,
    selected,
    onSelect,
    axis,
    caption,
    series,
  }: RailProps) {
  ```

  to:

  ```ts
  function Rail({
    win,
    spans,
    budgets,
    regions,
    selectedRegionName,
    x,
    width,
    equalized,
    selected,
    onSelect,
    axis,
    caption,
    series,
  }: RailProps) {
  ```

  In the main `<Rail ... />` call inside `MemoryChart`'s return, add
  `regions={regionsInMain}` and `selectedRegionName={selectedRegionName}`
  alongside the existing `series={series}` prop. In the detail `<Rail ... />`
  call, add `regions={regionsInDetail}` and the same
  `selectedRegionName={selectedRegionName}`.

  In `Rail`'s JSX, directly after the existing
  `<rect className={styles.railFrame} .../>` element and BEFORE the comment
  `{/* \`tan size\` budgets, behind everything the manifest pinned. */}`,
  insert:

  ```tsx
        {/* The SoM's own region table (#484 phase 2), behind every band the
         *  manifest pins — a stroke tinted by authority class, never the
         *  six-colour series palette, which stays with the spans.
         *
         *  LABEL ANCHOR: right-aligned at the rail's OWN right edge, never
         *  `x + 5` — that is where a budget/band label's baseline already
         *  sits (see below), and a region's own top routinely coincides with
         *  a span or budget top (mcuboot's frame top IS the window's own
         *  low edge; hp_slot0's frame top is exactly where its budget band
         *  starts). Anchoring from the OPPOSITE edge means the two labels
         *  only collide if BOTH read right to the rail's full width, which
         *  neither does at this panel's reading size. */}
        {!equalized &&
          regions.map(({ region, lo, hi }, i) => {
            const top = y(hi);
            const height = Math.max(y(lo) - top, 1);
            // Not `height >= TICK_LABEL_H` (14): a 14-19-unit-tall frame
            // would pass that check yet still print its label ON or BELOW
            // the frame's own bottom edge, because the label's baseline
            // drops BAND_LABEL_DY (15) below the frame's top — see
            // BAND_LABEL_DY's own docblock ("a band's own height must clear
            // BAND_LABEL_DY plus a descender (~17.3 units)"). +3 rounds that
            // ~2.3-unit descender up to a whole unit.
            const labelFits = height >= BAND_LABEL_DY + 3;
            return (
              <g key={`region-${i}-${region.id}`}>
                <rect
                  className={styles.regionFrame}
                  data-authority={region.authorityClass}
                  data-selected={selectedRegionName === region.name || undefined}
                  x={x}
                  y={top}
                  width={width}
                  height={height}
                />
                {labelFits && (
                  <text
                    className={styles.regionLabel}
                    x={x + width - 5}
                    y={top + BAND_LABEL_DY}
                    textAnchor="end"
                  >
                    {region.name}
                  </text>
                )}
              </g>
            );
          })}
  ```

  Now wire aperture selection. In `MemoryChart.tsx`, find the `ApertureBar`
  function's parameter list:

  ```ts
  function ApertureBar({
    aperture,
    win,
    x,
  }: {
    aperture: MemoryAperture;
    win: Window;
    x: number;
  }) {
  ```

  and replace it with:

  ```ts
  function ApertureBar({
    aperture,
    win,
    x,
    selected,
  }: {
    aperture: MemoryAperture;
    win: Window;
    x: number;
    selected: boolean;
  }) {
  ```

  Then find the `<rect>` this function renders:

  ```tsx
      <rect
        className={styles.apertureBar}
        x={x}
        y={top}
        width={APERTURE_W}
        height={height}
      >
  ```

  and add `data-selected`:

  ```tsx
      <rect
        className={styles.apertureBar}
        data-selected={selected || undefined}
        x={x}
        y={top}
        width={APERTURE_W}
        height={height}
      >
  ```

  In `MemoryChart`'s body, directly above the `return (` that renders the
  `<svg>`, add:

  ```ts
    // A selected REGION (id `memory:<name>`) also highlights the aperture of
    // the same name — a different id namespace (`region:<name>`), so this is
    // a name match, not an id match. Refused (set to null) when that name is
    // shared by two or more rows in the FULL region list (not just the
    // resolved ones in `win`/`detail`) — the same join `duplicatedNames`
    // refuses in the table, computed the same way here so the chart frame,
    // this aperture highlight and the table row all refuse the identical set
    // of names.
    const rawSelectedRegionName =
      selected !== null && selected.startsWith("memory:")
        ? selected.slice("memory:".length)
        : null;
    const duplicatedRegionNames = duplicatedNames(regions);
    const selectedRegionName =
      rawSelectedRegionName !== null &&
      duplicatedRegionNames.has(rawSelectedRegionName)
        ? null
        : rawSelectedRegionName;
  ```

  In the `regionApertures.map((a, i) => ...)` call, add
  `selected={selectedRegionName === a.name}` to each `<ApertureBar ... />`.

- [ ] **Step 4: Add the CSS**

  In `MemoryChart.module.css`, directly below the existing `.apertureLabel`
  rule, add:

  ```css
  .apertureBar[data-selected] {
    stroke-width: 2.5;
  }

  /* The SoM's own region table, drawn as frames behind every band the
   * manifest pins (#484 phase 2). A stroke only, tinted by authority class —
   * never the six-colour series palette above, which stays with the spans:
   * a region wearing one of those six would read as a seventh extent
   * rather than the ground the others sit on. */
  .regionFrame {
    fill: none;
    stroke: var(--border-default);
    stroke-width: 1;
  }

  .regionFrame[data-authority="customer_runtime"] {
    fill: color-mix(in srgb, var(--text-primary) 12%, transparent);
  }

  /* Distinct from customer_runtime by MORE than fill percentage — the two
   * sit under a 30%-opacity span fill in the common case, where an 8-vs-12%
   * difference in the frame underneath is not reliably legible. The dashed
   * stroke is the load-bearing distinction; the lighter fill is secondary. */
  .regionFrame[data-authority="customer_image"] {
    fill: color-mix(in srgb, var(--text-primary) 8%, transparent);
    stroke-dasharray: 3 1;
  }

  .regionFrame[data-authority="locked"] {
    fill: color-mix(in srgb, var(--text-primary) 4%, transparent);
    stroke-dasharray: 2 2;
  }

  .regionFrame[data-authority="reserved"] {
    stroke-dasharray: 1 3;
  }

  .regionFrame[data-authority="composite"] {
    stroke-dasharray: 4 2;
  }

  .regionFrame[data-authority="unstated"] {
    stroke: var(--text-secondary);
  }

  .regionFrame[data-selected] {
    stroke-width: 2.5;
  }

  .regionLabel {
    fill: var(--text-secondary);
    font-size: var(--font-size-base);
  }
  ```

- [ ] **Step 5: Verify with the existing gates (no dedicated unit test for
      this task — verified in Task 7's render harness)**

  Run: `pnpm run compile && pnpm run typecheck`
  Expected: PASS — no type errors, with nothing deferred to a later task.
  `MemoryChart`'s new `regions` prop is OPTIONAL (defaults to `[]`, per Step
  2), specifically so this task's own commit type-checks standalone even
  though `MemoryRegions.tsx` — its only caller — is not updated to pass a
  real array until Task 5.

- [ ] **Step 6: Commit**

  ```bash
  git add packages/alp-webview/src/features/build-plan/MemoryChart.tsx packages/alp-webview/src/features/build-plan/MemoryChart.module.css
  git commit -m "feat: grow the memory chart's window over resolved regions and draw backdrop frames (#484)"
  ```

---

## Task 5: Webview — `MemoryRegionTable`, wiring, keyboard selection, read-only tripwire

**Files:**
- Create: `packages/alp-webview/src/features/build-plan/MemoryRegionTable.tsx`
- Create: `packages/alp-webview/src/features/build-plan/MemoryRegionTable.module.css`
- Modify: `packages/alp-webview/src/features/build-plan/MemoryRegions.tsx`
- Modify: `test/memoryRegions.readOnly.test.js`
- Modify: `test/buildPlan.typeScale.test.js` (register the new `.title`
  sub-heading — see Step 6)

**Interfaces:**
- Consumes: `MemoryRegion`, `MemorySpan`, `MemoryView` (Task 2);
  `resolvedRegions`, `growWindowOverRegions`, `windowOf`, `Window`,
  `duplicatedNames` (Task 4, all exported from `MemoryChart.tsx`).
- Produces: `MemoryRegionTable({ regions, spans, window, selected, onSelect
  }): JSX.Element` — a new file, self-contained; no other file consumes it
  except `MemoryRegions.tsx`.

- [ ] **Step 1: Write the failing read-only tripwire test edit first**

  In `test/memoryRegions.readOnly.test.js`, change:

  ```js
  const VIEW_FILES = ["MemoryRegions.tsx", "MemoryChart.tsx"].map((name) =>
  ```

  to:

  ```js
  const VIEW_FILES = ["MemoryRegions.tsx", "MemoryChart.tsx", "MemoryRegionTable.tsx"].map((name) =>
  ```

  Directly below the existing paragraph in this file's header comment that
  ends `// lands it, rather than quietly outliving its reason.`, add:

  ```js
  //
  // #484 PHASE 2 landed read-only backdrop+table rendering FROM `memory[]`
  // (alp-sdk#1365 / alp-sdk#2030) WITHOUT re-vendoring this schema — that
  // stays #662, tag-only. So the tripwire below has NOT fired: the vendored
  // copy still declares the same eight root keys, even though a real
  // manifest from a new-enough SDK now carries a ninth (`memory`). D5 was
  // re-taken against that landed contract anyway, because `write_authority`
  // ships optional on both sides (no schema-required, no default) — the
  // precondition below was never about the KEY existing, only about
  // authority being unambiguous once it does. It still is not, so the map
  // stays read-only.
  ```

  Run: `node --test test/memoryRegions.readOnly.test.js`
  Expected: FAIL — `MemoryRegionTable.tsx` does not exist yet
  (`fs.readFileSync` throws `ENOENT`).

- [ ] **Step 2: Create `MemoryRegionTable.tsx`**

  ```tsx
  // SPDX-License-Identifier: Apache-2.0
  //
  // The SoM's own region table (#484 phase 2) — mcuboot, the image slots, the
  // writable window, the Secure-Enclave band — read straight from
  // `system-manifest-v1`'s `memory[]` pane, when a producer new enough to
  // emit it resolved one for this SoM. Grouped by write authority: that is
  // the one axis a customer opens this tab to answer ("can I write here"),
  // so it groups the rows rather than sitting in a column to scan.
  //
  // READ-ONLY, same gate as MemoryRegions.tsx and MemoryChart.tsx:
  // `test/memoryRegions.readOnly.test.js`'s VIEW_FILES covers this file too.

  import type { MemoryRegion, MemorySpan } from "../../types";
  import { duplicatedNames } from "./MemoryChart";
  import { formatAddress, formatBytes } from "./format";
  import styles from "./MemoryRegionTable.module.css";

  /** Spec table (#484 §2), verbatim. `write_authority` null is "absent" —
   *  its label depends on `source`, which the class itself does not (see
   *  `authorityClassOf` in core). */
  function authorityLabel(region: MemoryRegion): string {
    const { writeAuthority, source } = region;
    if (writeAuthority === null) {
      return source === "soc_derived"
        ? "not authored · SoC-derived table"
        : "authority not declared";
    }
    switch (writeAuthority) {
      case "customer_runtime":
        return "customer · writable at runtime";
      case "customer_image":
        return "customer · written at flash time";
      case "vendor_image":
        return "vendor image · locked";
      case "secure_enclave":
        return "Secure Enclave · locked";
      case "none":
        return "no writer · reserved";
      case "composite":
        return "composite · see the contained regions";
      default:
        return `${writeAuthority} · unrecognised`;
    }
  }

  /** `flash` / `ram` render as themselves; `unclassified`, `unresolved`, or
   *  anything this build has never seen renders "class not proven" — an
   *  open `kind` this wide cannot be read as RAM just because it is not the
   *  word "flash". */
  function kindLabel(kind: string): string {
    return kind === "flash" || kind === "ram" ? kind : "class not proven";
  }

  /** Grouping order (#484 §4): locked, customer, reserved, composite,
   *  unstated. `customer_runtime` and `customer_image` share a GROUP
   *  position but keep their own distinct LABEL above — merging them into
   *  one value would be the one-axis collapse the contract's two-axis
   *  vocabulary exists to prevent. */
  const GROUP_ORDER: Record<MemoryRegion["authorityClass"], number> = {
    locked: 0,
    customer_runtime: 1,
    customer_image: 1,
    reserved: 2,
    composite: 3,
    unstated: 4,
  };

  function byGroupThenAddress(a: MemoryRegion, b: MemoryRegion): number {
    const g = GROUP_ORDER[a.authorityClass] - GROUP_ORDER[b.authorityClass];
    if (g !== 0) return g;
    if (a.base === null && b.base === null) return a.name.localeCompare(b.name);
    if (a.base === null) return 1;
    if (b.base === null) return -1;
    if (a.base !== b.base) return a.base - b.base;
    return a.name.localeCompare(b.name);
  }

  // `duplicatedNames` is imported from `MemoryChart.tsx` (Task 4), not
  // redeclared here: every by-name join in this file — `usersOf` below, plus
  // the chart's own frame/aperture selection and core's `findOutsideRegion`
  // — refuses an ambiguous name the same way, off the same computation, so
  // the table row, the chart frame and the aperture bar can never disagree
  // about which names are ambiguous.

  /** The labels of every resolved carve-out or partition that names this
   *  region — a `carve_out_region` or a `flash_device` match, exactly the
   *  by-name join `MemoryAperture.members` already does for the chart's
   *  aperture bars, done here again because a region row and an aperture are
   *  different objects with different id namespaces (see `MemoryRegion.id`'s
   *  own doc). Reads only `spans`, never `unresolved`: a carve-out that
   *  named this region but did not resolve is not a user of it yet.
   *
   *  NEVER call this for a region whose name is in `duplicatedNames()` —
   *  the caller (`MemoryRegionTable` below) renders the shared-name note
   *  instead, the same refusal `findOutsideRegion` applies in core. */
  function usersOf(region: MemoryRegion, spans: MemorySpan[]): string[] {
    return spans
      .filter((s) => s.region === region.name || s.device === region.name)
      .map((s) => s.label);
  }

  /** Every distinct `flash_device` a resolved partition names that has no
   *  matching region row — #484 §4's footer line: a controller instance is
   *  not a region and has no base to show. */
  function devicesWithNoRegion(
    spans: MemorySpan[],
    regionNames: Set<string>,
  ): string[] {
    const out: string[] = [];
    const seen = new Set<string>();
    for (const span of spans) {
      if (span.kind !== "partition" || span.device === null) continue;
      if (seen.has(span.device) || regionNames.has(span.device)) continue;
      seen.add(span.device);
      out.push(span.device);
    }
    return out;
  }

  export function MemoryRegionTable({
    regions,
    spans,
    window,
    selected,
    onSelect,
  }: {
    regions: MemoryRegion[];
    spans: MemorySpan[];
    /** The chart's own (possibly grown) window, or null when no chart drew
     *  one — with no window there is no "outside it" to report. */
    window: { lo: number; hi: number } | null;
    selected: string | null;
    onSelect: (id: string) => void;
  }) {
    const ordered = [...regions].sort(byGroupThenAddress);
    const regionNames = new Set(regions.map((r) => r.name));
    const orphanDevices = devicesWithNoRegion(spans, regionNames);
    const dupes = duplicatedNames(regions);
    const countByName = new Map<string, number>();
    for (const r of regions) {
      countByName.set(r.name, (countByName.get(r.name) ?? 0) + 1);
    }

    return (
      <div className={styles.root}>
        <p className={styles.title}>SoM regions ({regions.length})</p>
        <ul className={styles.rows} role="listbox" aria-label="SoM regions">
          {ordered.map((region, i) => {
            const isDuplicated = dupes.has(region.name);
            // Refuse the join for a duplicated name here too, the same way
            // MemoryChart's `selectedRegionName` does: two rows share the
            // same `id` (`memory:<name>`), so checking `selected ===
            // region.id` alone would mark BOTH rows selected the instant
            // either is clicked. `isDuplicated` is computed above, from the
            // same `duplicatedNames` this file imports from MemoryChart.
            const isSelected = selected === region.id && !isDuplicated;
            // A sizeless row (base known, size unresolved — the F22 "size
            // unresolved" state) still says so when its base alone is
            // outside the window: the `>= window.hi` half is checked either
            // way, and only the LOWER half needs the extent to know it fully
            // clears `window.lo` versus merely starting before it.
            const outside =
              window !== null &&
              region.base !== null &&
              (region.base >= window.hi ||
                (region.sizeBytes !== null
                  ? region.base + region.sizeBytes <= window.lo
                  : region.base < window.lo));
            return (
              // Keyed by index PLUS id: two duplicate-named rows share the
              // same `id` (`memory:<name>`) — `id` alone would collide as a
              // React key, and `isSelected` above already refuses to mark
              // either one selected, so a click on either never highlights
              // both.
              <li
                key={`${i}-${region.id}`}
                className={styles.row}
                data-selected={isSelected || undefined}
                role="option"
                aria-selected={isSelected}
                tabIndex={0}
                onClick={() => onSelect(region.id)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    onSelect(region.id);
                  }
                }}
              >
                <span className={styles.rowName}>{region.name}</span>
                <span className={styles.authority} data-class={region.authorityClass}>
                  {authorityLabel(region)}
                </span>
                <span className={styles.regionClass}>{kindLabel(region.kind)}</span>
                <code className={styles.addr}>
                  {region.base !== null
                    ? region.sizeBytes !== null
                      ? `${formatAddress(region.base)} – ${formatAddress(region.base + region.sizeBytes)}`
                      : `${formatAddress(region.base)} – size unresolved`
                    : "address unresolved"}
                </code>
                <span className={styles.rowSize}>
                  {region.sizeBytes !== null ? formatBytes(region.sizeBytes) : "—"}
                </span>
                {region.cores.length > 0 && (
                  <span className={styles.rowMeta}>{region.cores.join(" ↔ ")}</span>
                )}
                {isDuplicated ? (
                  // Refuse the join rather than guessing which row a
                  // carve-out or partition meant — the same rule
                  // `findOutsideRegion` applies in core.
                  <span className={styles.rowMeta}>
                    name shared by {countByName.get(region.name)} rows, not joined
                  </span>
                ) : (
                  (() => {
                    const users = usersOf(region, spans);
                    return (
                      users.length > 0 && (
                        <span className={styles.rowMeta}>
                          used by {users.join(", ")}
                        </span>
                      )
                    );
                  })()
                )}
                {outside && (
                  <span className={styles.outsideNote}>
                    outside this map&rsquo;s window
                  </span>
                )}
                {region.reason && (
                  <span className={styles.reason}>{region.reason}</span>
                )}
              </li>
            );
          })}
        </ul>
        {orphanDevices.map((name) => (
          <p key={name} className={styles.footerNote}>
            <code>{name}</code> is a controller instance, not a region (no base)
          </p>
        ))}
      </div>
    );
  }
  ```

- [ ] **Step 3: Create `MemoryRegionTable.module.css`**

  ```css
  /* SPDX-License-Identifier: Apache-2.0
   *
   * The SoM's own region table (#484 phase 2) — read the same way the span
   * list above it is: mono for hex, reading size throughout, a hairline
   * around the selected row. Grouped by authority, never by kind, because
   * "can I write here" is the axis this tab exists to answer. */

  .root {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
  }

  /* md, one rung above the base rows it heads and one below the panel's own
   * title — the same treatment MemoryRegions.module.css gives
   * .unresolvedTitle and .conflictsTitle. */
  .title {
    margin: 0;
    font-size: var(--font-size-md);
    font-weight: 600;
    color: var(--text-section-header);
  }

  .rows {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
  }

  .row {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-2);
    padding: var(--space-1) var(--space-2);
    border-radius: var(--radius-sm);
    border: 1px solid transparent;
    cursor: pointer;
  }

  .row[data-selected] {
    border-color: var(--border-focus);
    background: var(--surface-hover);
  }

  .rowName {
    font-family: var(--font-family-mono);
    font-size: var(--font-size-base);
    font-weight: 600;
  }

  /* The write-authority label — the axis this table is grouped by. Colour
   * only distinguishes "locked" from the rest; never the six-colour chart
   * series, which stays with the spans it distinguishes. */
  .authority {
    font-size: var(--font-size-base);
    color: var(--text-secondary);
  }

  .authority[data-class="locked"] {
    color: var(--text-primary);
  }

  /* customer_image vs. customer_runtime: the label text already says which
   * is which, but the chart's backdrop frame ALSO tells them apart by
   * stroke pattern (dashed vs. solid) — this italic gives the table the
   * same non-colour distinction rather than relying on the reader to parse
   * the label's own words every time (#484 §2's "stay visually distinct"). */
  .authority[data-class="customer_image"] {
    font-style: italic;
  }

  /* The region's class column (flash / ram / "class not proven") — named
   * `.regionClass`, never `.kind`, because the Build Plan panel's type-scale
   * gate (test/buildPlan.typeScale.test.js) matches its CHROME allowlist by
   * FINAL CLASS across every panel module, and `.kind` is already on that
   * allowlist (MemoryRegions.module.css's own carve-out/partition/slot-image
   * chip) at xs/sm — this table's own reading-size column would collide
   * with that entry and fail "chrome stays below the reading size" the
   * moment both modules are walked together. */
  .regionClass {
    font-size: var(--font-size-base);
    color: var(--text-secondary);
  }

  .addr {
    font-family: var(--font-family-mono);
    font-size: var(--font-size-base);
    color: var(--text-primary);
  }

  .rowSize,
  .rowMeta {
    font-size: var(--font-size-base);
    color: var(--text-secondary);
  }

  .outsideNote {
    font-size: var(--font-size-base);
    color: var(--text-secondary);
    font-style: italic;
  }

  .reason {
    flex-basis: 100%;
    font-family: var(--font-family-mono);
    font-size: var(--font-size-base);
    color: var(--text-secondary);
    white-space: pre-wrap;
  }

  .footerNote {
    margin: 0;
    font-size: var(--font-size-base);
    color: var(--text-secondary);
  }

  .footerNote code {
    font-family: var(--font-family-mono);
  }
  ```

- [ ] **Step 4: Wire it into `MemoryRegions.tsx`, and make span rows keyboard-selectable**

  Change the import line:

  ```ts
  import { MemoryChart, budgetEnd, endOf } from "./MemoryChart";
  ```

  to:

  ```ts
  import {
    MemoryChart,
    budgetEnd,
    endOf,
    windowOf,
    growWindowOverRegions,
    resolvedRegions,
  } from "./MemoryChart";
  import { MemoryRegionTable } from "./MemoryRegionTable";
  ```

  In the `MemoryRegions` function, directly below the existing
  `const placed = memory.spans.filter((s) => s.base !== null);` line, add:

  ```ts
    const rawWindow = windowOf(placed, budgetByCore);
    const chartWindow = rawWindow
      ? growWindowOverRegions(rawWindow, resolvedRegions(memory.regions ?? []))
      : null;
  ```

  On the existing `<MemoryChart ... />` call, add `regions={memory.regions ??
  []}` alongside the existing `apertures={memory.apertures}` prop.

  Find the closing of the `{placed.length === 0 && deviceRelative.length ===
  0 ? ( <p className={styles.empty}> ... </p> ) : ( <div className=
  {styles.map}> ... </div> )}` conditional (its `<div className={styles.map}>`
  closes directly above the existing
  `{memory.unresolved.length > 0 && ( ... )}` block). Insert, between that
  conditional's closing and the `{memory.unresolved.length > 0 && (` block:

  ```tsx
        {memory.regions && memory.regions.length > 0 && (
          <MemoryRegionTable
            regions={memory.regions}
            spans={memory.spans}
            window={chartWindow}
            selected={selected}
            onSelect={toggle}
          />
        )}
  ```

  Make the existing span-row list keyboard-selectable. Change:

  ```tsx
          <ul className={styles.rows}>
            {[...placed, ...deviceRelative].map((span) => (
  ```

  to:

  ```tsx
          <ul className={styles.rows} role="listbox" aria-label="Placed extents">
            {[...placed, ...deviceRelative].map((span) => (
  ```

  In the `SpanRow` function, change:

  ```tsx
      <li
        className={styles.row}
        data-selected={selected || undefined}
        onClick={onSelect}
      >
  ```

  to:

  ```tsx
      <li
        className={styles.row}
        data-selected={selected || undefined}
        role="option"
        aria-selected={selected}
        tabIndex={0}
        onClick={onSelect}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            onSelect();
          }
        }}
      >
  ```

- [ ] **Step 5: Correct the stale header comment in `MemoryRegions.tsx`**

  Replace the file's header comment block (from `// The address-space half of
  the system manifest (#484).` through `// the reason its own header gives.`)
  with:

  ```ts
  // The address-space half of the system manifest (#484).
  //
  // THE SoM's OWN REGION TABLE — mcuboot / slot0 / reserved / storage / the
  // Secure-Enclave ATOC band — now DOES reach this view: alp-sdk#1365 landed
  // `memory[]` on `system-manifest-v1` (alp-sdk#2030), and `MemoryChart`
  // draws each resolved region as a backdrop frame behind the spans, with
  // the table below the map in `MemoryRegionTable`. Absent when the
  // manifest predates that producer, or resolves no regions for this SoM —
  // never guessed, and never read from `metadata/e1m_modules/<SKU>.yaml`,
  // which the manifest's own description still forbids parsing from
  // TypeScript.
  //
  // STILL READ-ONLY, for the same reason as before: `write_authority` is
  // optional on both `som-preset-v1` and `system-manifest-v1` (promotion to
  // required is alp-sdk#2024), so an editable affordance over a map that
  // cannot always tell `storage` from `atoc` remains a live hazard — writing
  // the ATOC can leave the part unbootable. #484 D5 was re-taken against the
  // landed contract and reached the same answer.
  //
  // READ-ONLY IS A GATE, NOT A HABIT: `test/memoryRegions.readOnly.test.js`
  // fails if this file grows a write path.
  //
  // The picture lives in `MemoryChart` — an SVG with a fixed viewBox, for
  // the reason its own header gives. The table lives in `MemoryRegionTable`.
  ```

- [ ] **Step 6: Register `MemoryRegionTable`'s `.title` in the type-scale
      gate's sub-heading arm**

  `MemoryRegionTable.module.css`'s `.title` (Step 3 above) is a NEW
  sub-heading — "SoM regions (N)" — the same rank as `.unresolvedTitle` and
  `.conflictsTitle` in `MemoryRegions.module.css`. `test/buildPlan
  .typeScale.test.js`'s sub-heading arm (its own comment: "`>= base` cannot
  hold a sub-heading, because base is precisely the mistake") walks a fixed
  `SUB_HEADINGS` array, so an unregistered sub-heading is invisible to that
  gate — a later regression that drops `.title` back to base tier would pass
  it green. In `test/buildPlan.typeScale.test.js`, in the `SUB_HEADINGS`
  array, directly below the existing
  `{ file: "MemoryNotes.module.css", selector: ".title", heads: [".note p"],
  ... },` entry, add:

  ```ts
    {
      file: "MemoryRegionTable.module.css",
      selector: ".title",
      heads: [".rowName", ".reason"],
      why: "'SoM regions (N)' — the heading over the SoM's own region table",
    },
  ```

  Both head classes (`.rowName`, `.reason`) are set to `var(--font-size-base)`
  in `MemoryRegionTable.module.css` (Step 3), so this entry's own arm passes
  without changing either rule.

- [ ] **Step 7: Run the tests to verify they pass**

  Run: `pnpm run compile && node --test test/memoryRegions.readOnly.test.js test/buildPlan.typeScale.test.js`
  Expected: PASS — including the new `SUB_HEADINGS` entry from Step 6.

  Run: `pnpm run typecheck`
  Expected: PASS — `MemoryChart`'s new `regions` prop is now satisfied at its
  only call site.

- [ ] **Step 8: Commit**

  ```bash
  git add packages/alp-webview/src/features/build-plan/MemoryRegionTable.tsx packages/alp-webview/src/features/build-plan/MemoryRegionTable.module.css packages/alp-webview/src/features/build-plan/MemoryRegions.tsx test/memoryRegions.readOnly.test.js test/buildPlan.typeScale.test.js
  git commit -m "feat: render the SoM region table, grouped by authority and keyboard-selectable (#484)"
  ```

---

## Task 6: Copy — MemoryNotes, staleness.ts, TROUBLESHOOTING_VALIDATION.md, DESIGN.md, CHANGELOG

**Files:**
- Modify: `packages/alp-webview/src/features/build-plan/MemoryNotes.tsx`
- Modify: `packages/alp-core/src/systemManifest/staleness.ts`
- Modify: `docs/TROUBLESHOOTING_VALIDATION.md`
- Modify: `DESIGN.md`
- Modify: `CHANGELOG.md`

**Interfaces:** none (prose only).

- [ ] **Step 1: Rewrite `MemoryNotes.tsx` in full — the header comment and
      three of its four sections are stale, not just one**

  This file's header comment and its "What the map can show" and
  "Apertures" sections all assert or imply "half the picture is absent"
  unconditionally — true only before this plan's earlier tasks landed
  `memory[]`. Only rewriting "What it cannot show, and why" (as an earlier
  draft of this plan did) would leave the other three false. Replace the
  ENTIRE file with:

  ```tsx
  // SPDX-License-Identifier: Apache-2.0
  //
  // Everything the memory map would otherwise have to explain in place (#484).
  //
  // The map is a reading surface: a customer opens it to see where things land,
  // not to read three paragraphs about what is missing from a schema. That
  // context is real and worth keeping — from an alp-sdk that carries
  // alp-sdk#1365's `memory[]` pane (not yet in a tagged release,
  // alp-sdk#2047) the picture is no longer half-absent, but eligibility is
  // still never claimed and nothing on it is ever editable — so it lives
  // here, one tab away, instead of above the chart.

  import styles from "./MemoryNotes.module.css";

  export function MemoryNotes() {
    return (
      <div className={styles.root}>
        <section className={styles.note}>
          <h4 className={styles.title}>What the map can show</h4>
          <p>
            What <code>build/system-manifest.yaml</code> pins: the load
            address of each Zephyr slice, the resolved IPC carve-outs, and the
            resolved storage partitions — the customer-owned half, declared
            in <code>board.yaml</code>. From an alp-sdk that carries{" "}
            <code>alp-sdk#1365</code>&rsquo;s <code>memory[]</code> pane (not
            yet in a tagged release, alp-sdk#2047) it also shows the
            SoM&rsquo;s own region table when the manifest carries one —
            bootloader, image slots, the writable window, the Secure-Enclave
            band — drawn behind the customer-owned extents and listed below
            them.
          </p>
          <p>
            A <strong>band</strong> is an extent. A <strong>line</strong> is a
            base with no size — the slice&rsquo;s own load address never
            carries one, and an invented height would put a wall where there
            is a point. A slot&rsquo;s extent comes from{" "}
            <code>tan size</code>, which resolves the budget from SoM
            metadata; the row list names that measurement separately from
            the address. When the manifest also resolves that same slot as a
            region, the table below lists its extent too — separately, never
            joined to this line.
          </p>
        </section>

        <section className={styles.note}>
          <h4 className={styles.title}>What it cannot show, and why</h4>
          <p>
            The SoM&rsquo;s own region table — bootloader, image slots, the
            writable window and the Secure-Enclave band — reaches this view
            only from a manifest new enough to carry it (
            <code>alp-sdk#1365</code>; not yet in a tagged alp-sdk release,
            alp-sdk#2047). On an older manifest, or a SoM whose region layout
            is still pending, the region table is simply not in{" "}
            <code>system-manifest-v1</code> at all, and this view shows no
            table rather than an empty one.
          </p>
          <p>
            A bundled schema older than the producer that wrote your
            manifest may still underline <code>memory:</code> in the editor.
            That squiggle names a schema this extension has not caught up to
            yet, not a bad manifest.
          </p>
          <p>
            Even when the table is shown, it claims no eligibility: a region
            here is a fact about the SoM, not a verdict on whether a
            carve-out or a mount may land on it. That verdict is the
            allocator&rsquo;s, and it already reaches this panel as{" "}
            <code>ipc[].status</code> / <code>ipc[].reason</code>.
          </p>
          <p>
            Nothing here is editable either way:{" "}
            <code>write_authority</code> is optional in both the SoM preset
            and the manifest, so this view cannot yet always tell a
            customer-sized band from a Secure-Enclave-owned one, and writing
            the wrong one can leave the part unbootable.
          </p>
        </section>

        <section className={styles.note}>
          <h4 className={styles.title}>Apertures</h4>
          <p>
            A region or flash device is named by the manifest but not always
            described by it: <code>carve_out_region</code> /{" "}
            <code>flash_device</code> say which aperture the resolver
            allocated out of, and its own base and size are a separate,
            optional fact — the SoM region table above — that this bar never
            merges in. So an aperture bar still spans the hull of what
            landed inside it — &ldquo;at least this much is in use&rdquo; —
            never the aperture&rsquo;s own extent, EVEN WHEN a same-named row
            in the region table resolves one: the two are shown side by
            side, joined only by name, never combined into one shape.
          </p>
        </section>

        <section className={styles.note}>
          <h4 className={styles.title}>Overlaps</h4>
          <p>
            Reported here, not by the build. The allocator compares a carve-out
            only against carve-outs already placed in the same region, so a pinned{" "}
            <code>ipc[].address:</code>, a partition offset and a slice&rsquo;s
            load address are compared nowhere upstream.
          </p>
        </section>
      </div>
    );
  }
  ```

- [ ] **Step 2: Add a clarifying note to `staleness.ts`'s header**

  Directly below the existing paragraph ending
  `// "STALE" AND "UNKNOWN" ARE DIFFERENT ANSWERS, AND CONFLATING THEM IS THE BUG`
  section's closing sentence (`// conclusion this module refuses to draw for
  them.`), add:

  ```ts
  //
  // #484 PHASE 2 added a `memory[]` pane to the contract, read by a sibling
  // module (`memoryView.ts`) — not by this one, and this file carried no
  // stale claim about a region table to correct. Recorded here only so a
  // future reader auditing this file against that change finds the answer
  // rather than re-deriving it: freshness is a fact about the FILE's age,
  // never its contents, and that holds identically whether or not the
  // manifest resolves a region table. A manifest carrying a `memory[]` pane
  // and one carrying none are dated exactly the same way.
  ```

- [ ] **Step 3: Add a section to `docs/TROUBLESHOOTING_VALIDATION.md`**

  Append, after the existing `## 5. Editor Assistance` section:

  ```markdown

  ## 6. `memory:` Squiggle in `system-manifest.yaml`

  An alp-sdk that carries alp-sdk#1365's `memory[]` pane can emit one inside
  `build/system-manifest.yaml` (landed in alp-sdk#2030; not yet in a tagged
  release, alp-sdk#2047). If this extension's bundled
  `schemas/system-manifest-v1.schema.json` predates that producer, the
  editor underlines `memory:` as an unknown property.

  - This is a stale BUNDLED SCHEMA, not a bad manifest — the file itself is
    fine and the Build Plan panel's Memory tab reads it normally.
  - Confirm by opening the panel: if the Memory tab shows a "SoM regions"
    table, the manifest parsed correctly regardless of the squiggle.
  - Safe to ignore until the extension's next vendored-schema bump.
  ```

- [ ] **Step 4: Add a note to `DESIGN.md`, anchored where the file's own
      vocabulary actually lives**

  The spec (#484 §4, "Visual direction") calls for "a refinement in Operate
  mode inside `DESIGN.md`". As of this plan, `DESIGN.md` has no "Operate
  mode" section at all (`git grep -i operate DESIGN.md` finds nothing), and
  it has no section documenting the Build Plan panel or its Memory tab
  either — the spec's own vocabulary does not exist in the file it names, and
  neither does a per-panel section to append to. Do not invent either one to
  satisfy the letter of the spec line; instead, record this feature's colour
  rule where `DESIGN.md` already keeps every OTHER named colour rule: `##
  Colors` → `### Named Rules`, directly after **The Wash-With-Foreground
  Rule** paragraph (the one ending "4% for a chrome bar (the Overview header
  and the configurator's `.topbar` and `.footer` both use it), 8% one level
  deeper for a card header (`.advHead`)."). Add, directly below that
  paragraph:

  ```markdown

  **The Region-Frame Rule (#484 phase 2).** A SoM region frame in the Build
  Plan panel's Memory tab is a stroke in `{colors.border-default}` plus a
  wash of `{colors.text-primary}` — never a hatch, never the six-colour
  chart series palette. The percentage is again the whole design decision,
  this time keyed to authority class rather than nesting depth:
  `customer_runtime` 12%, `customer_image` 8% (plus a dashed stroke —
  distinguished from `customer_runtime` by more than fill percentage, since
  both sit under the span's own 30%-opacity fill), `locked` 4%, and no wash
  at all for `reserved`/`composite`/`unstated` (a dash pattern only). Same
  rule, one more axis: the wash says how heavily authored the region is: the
  dash pattern says which authority class, so the two together read at a
  glance in monochrome too.
  ```

- [ ] **Step 5: Add an Unreleased entry to `CHANGELOG.md`**

  `CHANGELOG.md` already opens with an `## Unreleased` heading (from #661's
  own unreleased entries) — do not add a second one. Find the existing
  `## Unreleased` heading and add this new bullet directly below it, above
  whatever bullets are already there:

  ```markdown
  - **The Build Plan panel's Memory tab now draws the SoM's own region table
    when the manifest carries one (#484).** `system-manifest-v1`'s
    `memory[]` pane (alp-sdk#1365; not yet in a tagged release, alp-sdk#2047)
    is read into a new `MemoryRegion[]` view, drawn as authority-tinted
    frames behind the existing spans and listed below them in a grouped,
    keyboard-selectable region table. Absent when the manifest
    predates that producer or resolves no regions for the SoM — the tab
    renders exactly what it rendered before. Read-only, same as the rest of
    this tab (#484 D5 re-taken against the landed contract). No schema
    re-vendor, no `SUPPORTED_CLI_VERSION` bump.
  ```

- [ ] **Step 6: Run the render-harness needles this copy must still satisfy**

  Run: `pnpm run compile && node test/webview/run.mjs`
  Expected: PASS — in particular, the existing `build-plan` pass's Notes-tab
  needles (`"alp-sdk#1365"`, `"not in"`, `"nothing here is editable"`) are
  still found in the rewritten prose.

- [ ] **Step 7: Commit**

  ```bash
  git add packages/alp-webview/src/features/build-plan/MemoryNotes.tsx packages/alp-core/src/systemManifest/staleness.ts docs/TROUBLESHOOTING_VALIDATION.md DESIGN.md CHANGELOG.md
  git commit -m "docs: correct stale memory-pane copy and add the schema-squiggle note (#484)"
  ```

---

## Task 7: Render-harness passes for rpmsg-aen and rpmsg-v2n

**Files:**
- Modify: `test/webview/ui-render.tsx`
- Modify: `test/webview/run.mjs`

**Interfaces:**
- Consumes: `parseSystemManifest` (core), `buildMemoryView` (core, already
  imported by this file), the two fixtures from Task 1.

- [ ] **Step 1: Add the imports this task needs, and read the fixtures at
      BUNDLE time, never at run time**

  `run.mjs` bundles `ui-render.tsx` with esbuild to a file inside
  `fs.mkdtempSync(...)` and runs that bundle with `spawnSync`. `platform:
  "node"`/`format: "cjs"` bundling leaves `__dirname` alone, so at RUN time
  `__dirname` inside the bundle is that temp directory, not this file's real
  location. `fs.readFileSync(path.join(__dirname, "..", "fixtures", ...))`
  would resolve against the temp dir's parent — `os.tmpdir()` — and throw
  `ENOENT`, taking the whole harness down with it (exit 1), not just this
  task's two new passes.

  So these fixtures are read at BUNDLE time instead, via esbuild's own `text`
  loader, which needs one line in `run.mjs`. Find the `esbuild.build({...})`
  call's options object (it already has `entryPoints`, `bundle: true`,
  `platform: "node"`, `format: "cjs"`, `jsx: "automatic"`, `outfile: out`,
  `external: ["jsdom"]`, `nodePaths: [...]`, `plugins: [...]`) and add,
  directly below `jsx: "automatic",`:

  ```js
    loader: { ".yaml": "text" },
  ```

  Now in `test/webview/ui-render.tsx`, directly below the existing
  `import "./jsdom-setup.js";` line, add:

  ```ts
  // esbuild's `text` loader (configured in run.mjs) inlines these as plain
  // strings AT BUNDLE TIME — before the bundle ever runs from the temp
  // directory run.mjs builds it into. Reading them with fs + __dirname at
  // RUN time would resolve against that temp directory instead of this
  // file's real location; see run.mjs's own comment.
  declare module "*.yaml" {
    const content: string;
    export default content;
  }
  import aenFixtureText from "../fixtures/system-manifest.rpmsg-aen.memory.yaml";
  import v2nFixtureText from "../fixtures/system-manifest.rpmsg-v2n.memory.yaml";
  ```

  Directly below the existing
  `import { buildMemoryView } from "../../packages/alp-core/src/systemManifest/memoryView";`
  line, add:

  ```ts
  import { parseSystemManifest } from "../../packages/alp-core/src/systemManifest/service";
  ```

- [ ] **Step 2: Add the two new render passes**

  Directly below the existing "error-boundary" block (the one ending
  `` console.log(`  ${problems.length === 0 ? "PASS" : "FAIL"}  error-boundary: caught a throwing render`); `` and its closing `}`), and above the final
  summary `console.log` + `if (problems.length) { ... }` block, insert:

  ```ts
    // ── the SoM region backdrop, rpmsg-aen (#484 phase 2) ──
    // A real emitted golden with a resolved region table: mcuboot / two image
    // slots / reserved / storage / atoc all resolve, mram_main does not. Runs
    // the real parser + narrower, exactly like feedState() above.
    {
      const container = document.createElement("div");
      document.body.appendChild(container);
      const problemsBefore = problems.length;
      const root = createRoot(container);
      root.render(
        React.createElement(AppProvider, null, React.createElement(BuildPlanView)),
      );
      await settle();
      feedState();
      await settle();
      feedState();
      await settle();

      const aenManifest = parseSystemManifest(aenFixtureText);
      g.__ALP_POST_TO_WEBVIEW__({
        type: "systemManifestData",
        postBuild: true,
        manifest: aenManifest,
        provenance: null,
        memory: buildMemoryView(aenManifest),
      });
      await settle();
      // `feedState()` above also posted a `sliceSizesData` report giving
      // m55_hp a 5 767 168 B tan-size budget (needed by the PRE-EXISTING
      // `build-plan` pass's own "22× top 378.2 kib" needle) — `useBuildPlan`
      // keeps `sizes` across a `systemManifestData` post, so that stale
      // budget would otherwise still apply to hp_slot0 here and grow the
      // window to 0x80830000 instead of the 0x80580000 this pass asserts.
      // Clear it: this pass is about the region-grown window, not slot
      // budgets.
      g.__ALP_POST_TO_WEBVIEW__({
        type: "sliceSizesData",
        report: {
          schema: "alp-size/1",
          slices: [],
          summary: { over_budget: [], unknown_budget: [] },
        },
      });
      await settle();

      const tabs = Array.from(container.querySelectorAll('button[role="tab"]'));
      const memoryTab = tabs.find((b) =>
        (b.textContent || "").toLowerCase().includes("memory"),
      );
      if (!memoryTab) {
        problems.push("memory-regions-aen: no Memory tab found");
      } else {
        (memoryTab as HTMLButtonElement).click();
        await settle();
        const memText = (container.textContent || "").toLowerCase();
        for (const needle of [
          "vendor image · locked", // mcuboot
          "customer · written at flash time", // he_slot0 / hp_slot0
          "no writer · reserved", // reserved
          "customer · writable at runtime", // storage
          "secure enclave · locked", // atoc
          "a placeholder, not an address", // mram_main's reason, verbatim
          "som regions (7)", // the table's own heading
        ]) {
          if (!memText.includes(needle.toLowerCase())) {
            problems.push(`memory-regions-aen: missing "${needle}"`);
          }
        }
        for (const forbidden of ["free", "remaining"]) {
          if (memText.includes(forbidden)) {
            problems.push(
              `memory-regions-aen: rendered the eligibility word "${forbidden}", which this view must never claim`,
            );
          }
        }
        const svg = container.querySelector('svg[role="img"]');
        const ariaLabel = (svg?.getAttribute("aria-label") || "").toLowerCase();
        if (!ariaLabel.includes("0x80000000") || !ariaLabel.includes("0x80580000")) {
          problems.push(
            `memory-regions-aen: chart aria-label "${ariaLabel}" does not span 0x80000000-0x80580000 — the window did not grow over the SoM's regions`,
          );
        }
      }
      console.log(
        `  ${problems.length === problemsBefore ? "PASS" : "FAIL"}  memory-regions-aen: the SoM region backdrop`,
      );
    }

    // ── the SoM region backdrop, rpmsg-v2n (#484 phase 2) ──
    // Three soc_derived regions, kind "unresolved" on every row (never
    // authored write_authority), and two of the three fall outside the
    // (unchanged) chart window.
    {
      const container = document.createElement("div");
      document.body.appendChild(container);
      const problemsBefore = problems.length;
      const root = createRoot(container);
      root.render(
        React.createElement(AppProvider, null, React.createElement(BuildPlanView)),
      );
      await settle();
      feedState();
      await settle();
      feedState();
      await settle();

      const v2nManifest = parseSystemManifest(v2nFixtureText);
      g.__ALP_POST_TO_WEBVIEW__({
        type: "systemManifestData",
        postBuild: true,
        manifest: v2nManifest,
        provenance: null,
        memory: buildMemoryView(v2nManifest),
      });
      await settle();

      const tabs = Array.from(container.querySelectorAll('button[role="tab"]'));
      const memoryTab = tabs.find((b) =>
        (b.textContent || "").toLowerCase().includes("memory"),
      );
      if (!memoryTab) {
        problems.push("memory-regions-v2n: no Memory tab found");
      } else {
        (memoryTab as HTMLButtonElement).click();
        await settle();
        const memText = (container.textContent || "").toLowerCase();
        for (const needle of [
          "class not proven", // every v2n region's `kind` is "unresolved"
          "ddr_main",
          "ocram_low",
          "m33_tcm",
          "som regions (3)",
        ]) {
          if (!memText.includes(needle)) {
            problems.push(`memory-regions-v2n: missing "${needle}"`);
          }
        }
        // A CURLY apostrophe, not a straight one: MemoryRegionTable.tsx
        // renders this note with `&rsquo;`, which becomes U+2019 (’) in
        // textContent — a straight `'` here would silently match zero rows
        // every time, since `String.match` does not fold the two.
        const outsideCount = (memText.match(/outside this map’s window/g) || [])
          .length;
        if (outsideCount !== 2) {
          problems.push(
            `memory-regions-v2n: ${outsideCount} row(s) marked outside the chart window, want exactly 2 (ddr_main, m33_tcm — ocram_low is the one that joins the window)`,
          );
        }
      }
      console.log(
        `  ${problems.length === problemsBefore ? "PASS" : "FAIL"}  memory-regions-v2n: class-not-proven and outside-window rows`,
      );
    }

    // ── an unrecognised kind, and outside_region's own wording (#484 phase 2
    //    spec pins 6 and 8) ──
    // A hand-built manifest, not a vendored fixture: no real emitted golden
    // exercises a `kind` this build has never seen (`unresolved` — the only
    // non-flash/ram value in both real fixtures — is still a DOCUMENTED
    // member; this is a genuinely novel string), nor an outside_region
    // violation. Built the same way test/systemManifest.memoryView.test.js's
    // `blockedSample()` is: a plain object, not YAML, fed straight to
    // `buildMemoryView`.
    {
      const container = document.createElement("div");
      document.body.appendChild(container);
      const problemsBefore = problems.length;
      const root = createRoot(container);
      root.render(
        React.createElement(AppProvider, null, React.createElement(BuildPlanView)),
      );
      await settle();
      feedState();
      await settle();
      feedState();
      await settle();

      const manifest = {
        schema_version: 1,
        generated_by: "scripts/alp_orchestrate.py",
        hw_info: { sku: "E1M-AEN801", silicon: "alif:ensemble:e8" },
        slices: [],
        ipc: [
          {
            name: "alp_rpmsg",
            kind: "rpmsg",
            endpoints: ["m55_hp", "m55_he"],
            carve_out_base: "0x80540000",
            carve_out_size: "0x00040000",
            carve_out_region: "odd_region",
            cacheable: false,
            rpmsg_endpoint_ids: { src: "0x000004e6", dst: "0x000004e7" },
            mailbox_channel: 0,
          },
        ],
        helper_mcus: [],
        boot_order: [],
        memory: [
          {
            name: "odd_region",
            source: "som_preset",
            kind: "sram_tcm", // never documented by the schema
            status: "ok",
            base: 0x80540000,
            size_bytes: 0x00020000, // half the carve-out's own size — overruns it
          },
        ],
      };
      g.__ALP_POST_TO_WEBVIEW__({
        type: "systemManifestData",
        postBuild: true,
        manifest,
        provenance: null,
        memory: buildMemoryView(manifest as never),
      });
      await settle();
      g.__ALP_POST_TO_WEBVIEW__({
        type: "sliceSizesData",
        report: {
          schema: "alp-size/1",
          slices: [],
          summary: { over_budget: [], unknown_budget: [] },
        },
      });
      await settle();

      const tabs = Array.from(container.querySelectorAll('button[role="tab"]'));
      const memoryTab = tabs.find((b) =>
        (b.textContent || "").toLowerCase().includes("memory"),
      );
      if (!memoryTab) {
        problems.push("memory-regions-unrecognised: no Memory tab found");
      } else {
        (memoryTab as HTMLButtonElement).click();
        await settle();
        const memText = (container.textContent || "").toLowerCase();
        if (!memText.includes("class not proven")) {
          problems.push(
            'memory-regions-unrecognised: kind "sram_tcm" (never documented) did not render "class not proven"',
          );
        }
        if (!memText.includes("the manifest's own numbers disagree")) {
          problems.push(
            "memory-regions-unrecognised: outside_region did not render its own non-collision heading",
          );
        }
        if (memText.includes("one extent lands on another")) {
          problems.push(
            "memory-regions-unrecognised: outside_region rendered through the Conflicts collision heading instead of OutsideRegionNotice's own",
          );
        }
      }
      console.log(
        `  ${problems.length === problemsBefore ? "PASS" : "FAIL"}  memory-regions-unrecognised: unrecognised kind + outside_region wording`,
      );
    }

    // ── duplicate region names refuse the selection join, everywhere (#484
    //    phase 2 — the same refusal `findOutsideRegion` applies in core and
    //    `duplicatedNames` applies in the webview) ──
    // A hand-built manifest with two rows sharing one name and NO carve-out
    // naming either, so this pass is only about selection, not about
    // outside_region (which the previous pass already covers with its own
    // single-row "odd_region").
    {
      const container = document.createElement("div");
      document.body.appendChild(container);
      const problemsBefore = problems.length;
      const root = createRoot(container);
      root.render(
        React.createElement(AppProvider, null, React.createElement(BuildPlanView)),
      );
      await settle();
      feedState();
      await settle();
      feedState();
      await settle();

      const manifest = {
        schema_version: 1,
        generated_by: "scripts/alp_orchestrate.py",
        hw_info: { sku: "E1M-AEN801", silicon: "alif:ensemble:e8" },
        slices: [],
        ipc: [],
        helper_mcus: [],
        boot_order: [],
        memory: [
          {
            name: "dup_region",
            source: "som_preset",
            kind: "flash",
            status: "ok",
            base: 0x80600000,
            size_bytes: 0x1000,
          },
          {
            name: "dup_region",
            source: "som_preset",
            kind: "flash",
            status: "ok",
            base: 0x80610000,
            size_bytes: 0x1000,
          },
        ],
      };
      g.__ALP_POST_TO_WEBVIEW__({
        type: "systemManifestData",
        postBuild: true,
        manifest,
        provenance: null,
        memory: buildMemoryView(manifest as never),
      });
      await settle();
      g.__ALP_POST_TO_WEBVIEW__({
        type: "sliceSizesData",
        report: {
          schema: "alp-size/1",
          slices: [],
          summary: { over_budget: [], unknown_budget: [] },
        },
      });
      await settle();

      const tabs = Array.from(container.querySelectorAll('button[role="tab"]'));
      const memoryTab = tabs.find((b) =>
        (b.textContent || "").toLowerCase().includes("memory"),
      );
      if (!memoryTab) {
        problems.push("memory-regions-duplicate: no Memory tab found");
      } else {
        (memoryTab as HTMLButtonElement).click();
        await settle();

        const rows = Array.from(
          container.querySelectorAll('ul[aria-label="SoM regions"] [role="option"]'),
        );
        if (rows.length !== 2) {
          problems.push(
            `memory-regions-duplicate: expected 2 rows for the duplicated name, found ${rows.length}`,
          );
        } else {
          (rows[0] as HTMLLIElement).click();
          await settle();
          const selectedCount = container.querySelectorAll(
            '[aria-selected="true"]',
          ).length;
          if (selectedCount !== 0) {
            problems.push(
              `memory-regions-duplicate: clicking one of two duplicate-named rows left ${selectedCount} element(s) aria-selected — the join must be refused, selecting neither`,
            );
          }
          const memText = (container.textContent || "").toLowerCase();
          if (!memText.includes("name shared by 2 rows, not joined")) {
            problems.push(
              'memory-regions-duplicate: missing "name shared by 2 rows, not joined"',
            );
          }
        }
      }
      console.log(
        `  ${problems.length === problemsBefore ? "PASS" : "FAIL"}  memory-regions-duplicate: two same-named rows refuse the selection join`,
      );
    }
  ```

- [ ] **Step 3: Run the harness to verify all four new passes are green**

  Run: `pnpm run compile && node test/webview/run.mjs`
  Expected: PASS — `memory-regions-aen`, `memory-regions-v2n`,
  `memory-regions-unrecognised` and `memory-regions-duplicate` all print
  `PASS`, and every pre-existing line (including `build-plan: ...`) still
  reads `PASS`, with the summary line
  reporting `0 problem(s)`.

- [ ] **Step 4: Commit**

  ```bash
  git add test/webview/ui-render.tsx test/webview/run.mjs
  git commit -m "test: pin the region backdrop in the render harness for rpmsg-aen and rpmsg-v2n (#484)"
  ```

---

## Task 8: Full local gates, Extension Development Host check, screenshots, PR

**Files:** none (verification only).

Task 0 already rebased this branch onto `dev` (and PR #661) before Task 1
started, so no rebase happens here — this task runs the full gate list
against the tree Tasks 1-7 already built on top of that rebase.

- [ ] **Step 1: Run every step of `ci.yml`'s build job locally, in order**

  ```bash
  pnpm install --frozen-lockfile
  pnpm run format:check
  pnpm run compile
  pnpm run typecheck
  node scripts/fetch-tan-contract.mjs
  node --test "test/*.test.js"
  pnpm run test:e2e:webview
  node scripts/check-extension-deps.mjs
  node scripts/check-cli-pin.mjs
  pnpm exec vsce package --no-dependencies --out alp-sdk.vsix
  bash scripts/check-vsix-allowlist.sh alp-sdk.vsix
  test -f schemas/board.schema.json && node -e "JSON.parse(require('fs').readFileSync('schemas/board.schema.json','utf8'))"
  ```

  Expected: every command exits 0. If `format:check` fails on any file this
  plan touched, run `pnpm run format` and re-verify rather than hand-editing
  whitespace. If `node --test "test/*.test.js"` flags a new class in
  `MemoryRegionTable.module.css` or `MemoryRegions.module.css` in
  `test/buildPlan.typeScale.test.js`'s "chrome stays below the reading size"
  or "nothing outside the chrome allowlist is set below the reading size"
  tests: that gate matches its `CHROME` allowlist by a selector's FINAL
  CLASS across every `*.module.css` in the panel directory, with no per-file
  scoping — so a class this plan names (e.g. `.regionClass`, deliberately
  NOT `.kind` for exactly this reason — see Task 5 Step 3) can still collide
  with an existing chrome entry defined for a DIFFERENT file's class of the
  same name. **Rename the colliding class; do not resize it or add a second
  allowlist entry for the same name** — two different things sharing one
  class name is the actual defect the gate is catching, and forcing a real
  reading-size class down to chrome size (or vice versa) to satisfy the gate
  would hide it instead of fixing it.

- [ ] **Step 2: Verify in the Extension Development Host**

  Copy one of the two vendored fixtures to a scratch workspace's
  `build/system-manifest.yaml` (the panel reads the file from disk — no `tan
  build` is needed):

  ```bash
  WS="$(mktemp -d)"
  mkdir -p "$WS/build"
  cp test/fixtures/system-manifest.rpmsg-aen.memory.yaml "$WS/build/system-manifest.yaml"
  ```

  Press F5 to launch the Extension Development Host against `$WS`, open the
  Build Plan panel, and confirm by eye: the Memory tab's chart draws tinted
  region frames behind the spans (mcuboot at the bottom, atoc at the top,
  the dashed stroke distinguishing the two `customer_image` slot frames from
  the solid `customer_runtime` `storage` frame), the region table below the
  map groups rows by authority with the exact labels from Task 5, and the
  Notes tab's copy matches Task 6. `rpmsg-aen`'s only IPC entry is
  `blocked` (no resolved carve-out), so this fixture draws no aperture bar —
  region-frame selection has nothing to highlight an aperture FOR here, and
  that is expected, not a bug.

  Repeat with the v2n fixture (`cp test/fixtures/system-manifest.rpmsg-v2n.memory.yaml "$WS/build/system-manifest.yaml"`,
  then reload the Extension Development Host window) and confirm:
  `ddr_main`/`m33_tcm` show the outside-window note, and selecting the
  `ocram_low` row (its carve-out DOES resolve, unlike `rpmsg-aen`'s) both
  highlights its own frame AND the `ocram_low` aperture bar beside the chart
  — the bar itself is labelled by the REGION it is the hull of
  (`findApertures` names by `span.region`), never by the carve-out inside it,
  so the label to look for is `ocram_low`, not `alp_default_rpmsg`. The
  carve-out exactly fills the region here (both are `0x00010000`–
  `0x00090000`), so the frame, the band and the bar all coincide.

  Also confirm the storage-device footer line by editing a copy of the aen
  fixture to add one `storage:` entry naming a `flash_device` not present in
  `memory:`, and confirm the "is a controller instance, not a region (no
  base)" line appears.

- [ ] **Step 3: Capture the screenshot matrix the spec asks to have "seen
      working"**

  Twelve screenshots: the three manifests above (`system-manifest.aen801.yaml`
  the absent case, plus the two vendored fixtures) × two VS Code themes ×
  two widths. For each fixture, with it copied to `$WS/build/system-manifest.yaml`
  and the Extension Development Host open on the Memory tab:

  1. Set the theme via the Command Palette → "Preferences: Color Theme" →
     "Dark Modern"; resize the editor group (drag its border, or resize the
     whole window) to roughly 420px wide; screenshot the panel.
  2. Resize to roughly 1200px wide; screenshot again.
  3. Switch theme to "Light Modern"; repeat both widths.

  Use the OS screenshot tool (macOS: Cmd+Shift+4; Windows: Win+Shift+S) — no
  new tooling or script is added for this, since nothing in `ci.yml` or this
  repo automates a screenshot today. Attach all twelve to the PR description
  under a "Seen working" heading, one per fixture/theme/width combination.

- [ ] **Step 4: Open the PR**

  ```bash
  git push -u origin feat/memory-regions-backdrop
  gh pr create --base dev --title "Draw the SoM region backdrop from memory[] (#484 phase 2)" --body "$(cat <<'EOF'
  ## Summary
  - Reads system-manifest-v1's memory[] pane (alp-sdk#1365) into a new MemoryRegion[] view, derives authorityClassOf per the spec table, and adds the outside_region finding.
  - Draws each resolved region as an authority-tinted backdrop frame behind the existing spans, growing the chart's window to a fixpoint over every region that touches it.
  - Adds a grouped, keyboard-selectable SoM region table below the map, read-only (#484 D5 re-taken against the landed contract).
  - Absent when the manifest carries no memory[] pane: the tab renders exactly what it rendered before.

  Refs #484

  ## Test plan
  - [ ] `node --test "test/*.test.js"` green
  - [ ] `node test/webview/run.mjs` green, including all four new memory-regions-* passes (aen, v2n, an unrecognised kind + outside_region wording, and the duplicate-name selection refusal)
  - [ ] Extension Development Host, rpmsg-aen fixture: the chart draws tinted region frames behind the spans (mcuboot at the bottom, atoc at the top), the dashed stroke distinguishes the two customer_image slot frames from the solid customer_runtime storage frame, and the region table below the map groups rows by authority with the exact labels
  - [ ] Extension Development Host, rpmsg-v2n fixture: ddr_main and m33_tcm show the outside-window note, and selecting the ocram_low row highlights both its own frame and the ocram_low aperture bar (the hull of alp_default_rpmsg)
  - [ ] Extension Development Host: the storage-device footer line ("is a controller instance, not a region (no base)") appears for a flash_device with no matching region row
  - [ ] Screenshot matrix attached under a "Seen working" heading: the three manifests (the absent-case aen801, rpmsg-aen, rpmsg-v2n) × Dark Modern/Light Modern × ~420px/~1200px widths, 12 screenshots total
  EOF
  )"
  ```
