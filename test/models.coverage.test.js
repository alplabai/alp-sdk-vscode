// SPDX-License-Identifier: Apache-2.0
//
// The ADR-0028 NPU-coverage vocabulary mapping
// (packages/alp-webview/src/features/models/coverage.ts) under the CI gate.
//
// This file is webview code, not extension code, so it is transpiled here with
// esbuild and required — the same trick test/webview/run.mjs uses for the React
// harness, minus the bundling: coverage.ts is pure and imports nothing. It is
// worth the transpile because this is the module that decides what a customer
// is told about their model, and three of its decisions are the difference
// between an honest answer and a lie:
//
//   1. `undetermined` must not read as "won't run".
//   2. A `basis: "static-screen"` positive must not read as a guarantee.
//   3. Only `basis: "compiled"`/`"bench"` may present a result as proven, and
//      the retired word "fits" must never reach a label.
//
// Every fixture below is taken from an envelope captured by running
// `tan model check --board board.yaml --format json` for real.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const esbuild = require("esbuild");

const SRC = path.join(
  __dirname,
  "../packages/alp-webview/src/features/models/coverage.ts",
);
const out = path.join(
  fs.mkdtempSync(path.join(os.tmpdir(), "alp-coverage-")),
  "coverage.cjs",
);
esbuild.buildSync({
  entryPoints: [SRC],
  outfile: out,
  format: "cjs",
  platform: "node",
  target: "node18",
  logLevel: "error",
});
const {
  STATIC_SCREEN_CAVEAT,
  UNDETERMINED_CAVEAT,
  backendLabel,
  basisSummary,
  coverageBadge,
  coverageDetail,
  cpuCertainOps,
  isProven,
} = require(out);

/** A `BackendCoverage` with the ADR-0028 defaults, overridden per case. */
function backend(over) {
  return {
    backend: "ethos_u",
    variant: "u85",
    table: "/sdk/metadata/npu_ops/ethos_u/u85@vela-5.1.0.json",
    npuCoverage: "full-eligible",
    computeOnNpuPctMax: 100.0,
    npuPlacementPctReal: null,
    uncostedCpuOpCount: 0,
    basis: "static-screen",
    confidence: "screening",
    notes: [],
    ops: [],
    ...over,
  };
}

test("isProven: only compiled and bench", () => {
  assert.equal(isProven("compiled"), true);
  assert.equal(isProven("bench"), true);
  assert.equal(isProven("static-screen"), false);
  assert.equal(isProven("something-tan-adds-later"), false);
});

test("backendLabel: mirrors tan's own labels", () => {
  assert.equal(backendLabel("ethos_u", "u85"), "Ethos-U85");
  assert.equal(backendLabel("ethos_u", "u55"), "Ethos-U55");
  assert.equal(backendLabel("ethos_u", null), "Ethos-U");
  assert.equal(backendLabel("drpai", null), "DRP-AI");
  assert.equal(backendLabel("deepx_dxm1", null), "DEEPX DX-M1");
  assert.equal(backendLabel("something_new", null), "something_new");
});

// ── Semantics 1: `undetermined` is not `cpu-only` ──────────────────────────

test("undetermined never renders as a negative verdict", () => {
  // The real E1M-V2M101 case: DEEPX DX-M1 is the SKU's headline NPU and ships
  // no op table BY DECISION.
  const badge = coverageBadge(
    backend({
      backend: "deepx_dxm1",
      variant: null,
      table: null,
      npuCoverage: "undetermined",
      computeOnNpuPctMax: null,
      ops: [
        {
          op: "FULLY_CONNECTED",
          status: "unknown",
          reason: "format-not-accepted",
          macs: 0,
        },
      ],
    }),
  );
  assert.equal(badge.variant, "neutral");
  assert.equal(badge.label, "not determined");
  assert.notEqual(badge.variant, "err");
  assert.ok(!/won.t run|no fit|no-fit|cpu.only/i.test(badge.label));
});

test("undetermined draws no percentage line at all", () => {
  assert.equal(
    coverageDetail(
      backend({ npuCoverage: "undetermined", computeOnNpuPctMax: null }),
    ),
    null,
  );
});

test("ops whose status is `unknown` never become a 0/N eligibility figure", () => {
  // `format-not-accepted`/`no-table-for-backend` still emit one placeholder
  // verdict per input op so a consumer can see WHICH ops were skipped.
  // Counting those against `ops.length` reads as "0/2 ops are NPU-eligible" —
  // exactly the `cpu-only` misreading semantics 1 forbids.
  const line = coverageDetail(
    backend({
      npuCoverage: "undetermined",
      computeOnNpuPctMax: null,
      ops: [
        {
          op: "CONV_2D",
          status: "unknown",
          reason: "no-table-for-backend",
          macs: 40,
        },
        {
          op: "FULLY_CONNECTED",
          status: "unknown",
          reason: "no-table-for-backend",
          macs: 8,
        },
      ],
    }),
  );
  assert.equal(line, null);
});

// ── Semantics 2: a static positive is eligibility, not a promise ───────────

test("a static-screen positive is never green and never says 'fits'", () => {
  const full = coverageBadge(backend({ npuCoverage: "full-eligible" }));
  assert.equal(full.variant, "info");
  assert.equal(full.label, "all ops NPU-eligible");
  assert.ok(!/\bfits\b/.test(full.label));
  assert.ok(full.title.includes("eligibility only"));

  const partial = coverageBadge(backend({ npuCoverage: "partial" }));
  assert.equal(partial.variant, "info");
  assert.equal(partial.label, "some ops NPU-eligible");
});

test("a static percentage is labelled an upper bound, never a plain figure", () => {
  const line = coverageDetail(
    backend({
      npuCoverage: "partial",
      computeOnNpuPctMax: 87.5,
      ops: [
        {
          op: "CONV_2D",
          status: "npu-eligible",
          reason: "constraint-unchecked",
          macs: 70,
        },
        {
          op: "CUSTOM",
          status: "cpu-certain",
          reason: "op-not-in-table",
          macs: 10,
        },
      ],
    }),
  );
  assert.ok(line.startsWith("up to 88% of compute"));
  assert.ok(line.includes("(1/2 ops)"));
  assert.ok(line.includes("upper bound, static screen"));
});

test("an uncosted cpu-certain op is a visible caveat on the percentage", () => {
  // The percentage can read 100 % while real, un-priced CPU compute exists:
  // the MAC estimator only prices conv/dense, and everything else leaves the
  // denominator. tan carries this as a structured field precisely so a
  // consumer that does not render `notes` still surfaces it.
  const line = coverageDetail(
    backend({
      npuCoverage: "partial",
      computeOnNpuPctMax: 100.0,
      uncostedCpuOpCount: 2,
      ops: [
        {
          op: "CONV_2D",
          status: "npu-eligible",
          reason: "constraint-unchecked",
          macs: 1000,
        },
        {
          op: "PAD",
          status: "cpu-certain",
          reason: "op-not-in-table",
          macs: 0,
        },
        {
          op: "RESHAPE",
          status: "cpu-certain",
          reason: "op-not-in-table",
          macs: 0,
        },
      ],
    }),
  );
  assert.ok(line.includes("up to 100% of compute"));
  assert.ok(line.includes("2 CPU ops carry no MAC estimate and are excluded"));
});

test("cpu-only is a warning, not an error: the model still runs", () => {
  const badge = coverageBadge(
    backend({ npuCoverage: "cpu-only", computeOnNpuPctMax: 0 }),
  );
  assert.equal(badge.variant, "warn");
  assert.equal(badge.label, "no NPU-eligible ops");
  assert.notEqual(badge.variant, "err");
});

test("the standing caveats say the silent-CPU-fallback part out loud", () => {
  assert.ok(/falls back to the CPU silently/.test(STATIC_SCREEN_CAVEAT));
  assert.ok(/runs either way/.test(STATIC_SCREEN_CAVEAT));
  assert.ok(/no data for that backend/.test(UNDETERMINED_CAVEAT));
  assert.ok(
    /not a finding that the model will not run/.test(UNDETERMINED_CAVEAT),
  );
});

// ── Semantics 3: proven only from a compile or a bench run ─────────────────

test("`fits` renders as a proven claim only at basis: compiled", () => {
  const badge = coverageBadge(
    backend({
      npuCoverage: "fits",
      computeOnNpuPctMax: null,
      npuPlacementPctReal: 100.0,
      basis: "compiled",
      confidence: "certain",
      ops: [],
    }),
  );
  assert.equal(badge.variant, "ok");
  assert.equal(badge.label, "all ops on NPU (proven)");
  assert.ok(!/\bfits\b/.test(badge.label));
  assert.ok(badge.title.includes("proven"));
});

test("`fits` at a non-proven basis is downgraded, never promoted", () => {
  // tan's contract says this pair cannot occur. If it ever does, the honest
  // move is to weaken the claim to eligibility, not to strengthen the basis.
  const badge = coverageBadge(backend({ npuCoverage: "fits" }));
  assert.equal(badge.variant, "info");
  assert.equal(badge.label, "all ops NPU-eligible");
});

test("a compiled report reports the compiler's placement, in its own unit", () => {
  const line = coverageDetail(
    backend({
      npuCoverage: "fits",
      computeOnNpuPctMax: null,
      npuPlacementPctReal: 100.0,
      basis: "compiled",
      confidence: "certain",
      ops: [],
    }),
  );
  assert.equal(
    line,
    "100% of operators placed on the NPU — measured by the compiler",
  );
  assert.ok(!line.includes("upper bound"));
});

test("a compiled report never recomputes coverage from the kept static ops", () => {
  // Captured for real: float32_fc.tflite on E1M-AEN801 under `--exact` with
  // vela 5.1.0 reports npuCoverage `cpu-only` and npuPlacementPctReal 0.0
  // while its KEPT static verdict still says `npu-eligible`. Table membership
  // does not check dtype or shape, so the two legitimately disagree — drawing
  // "1/1 ops NPU-eligible" beside "0% placed on the NPU" is self-contradiction.
  const b = backend({
    npuCoverage: "cpu-only",
    computeOnNpuPctMax: null,
    npuPlacementPctReal: 0.0,
    basis: "compiled",
    confidence: "certain",
    ops: [
      {
        op: "FULLY_CONNECTED",
        status: "npu-eligible",
        reason: "constraint-unchecked",
        macs: 8,
      },
    ],
  });
  assert.equal(
    coverageDetail(b),
    "0% of operators placed on the NPU — measured by the compiler",
  );
  assert.equal(cpuCertainOps(b), null);
  assert.equal(coverageBadge(b).label, "CPU only (proven)");
});

test("the certain-CPU list is drawn for a static screen only", () => {
  const ops = [
    { op: "CUSTOM", status: "cpu-certain", reason: "op-not-in-table", macs: 0 },
    { op: "PAD", status: "cpu-certain", reason: "op-not-in-table", macs: 0 },
  ];
  assert.equal(
    cpuCertainOps(backend({ npuCoverage: "partial", ops })),
    "2 ops are certain CPU fallback: CUSTOM, PAD",
  );
  assert.equal(
    cpuCertainOps(backend({ npuCoverage: "partial", basis: "compiled", ops })),
    null,
  );
});

test("the certain-CPU list truncates past 8 the way tan's own render does", () => {
  const ops = Array.from({ length: 10 }, (_, i) => ({
    op: `OP_${i}`,
    status: "cpu-certain",
    reason: "op-not-in-table",
    macs: 0,
  }));
  assert.equal(
    cpuCertainOps(backend({ npuCoverage: "cpu-only", ops })),
    "10 ops are certain CPU fallback: OP_0, OP_1, OP_2, OP_3, OP_4, OP_5, OP_6, OP_7, +2 more",
  );
});

// ── Fail-safe: a value this build does not know ────────────────────────────

test("an unrecognised coverage value renders neutral, never green, never red", () => {
  for (const basis of ["static-screen", "compiled"]) {
    const badge = coverageBadge(
      backend({ npuCoverage: "a-word-tan-adds-later", basis }),
    );
    assert.equal(badge.variant, "neutral");
    assert.equal(badge.label, "a-word-tan-adds-later");
  }
});

test("the retired vocabulary produces no label of its own", () => {
  // `cpu-fallback`/`no-fit` are gone from tan. If one somehow arrives, it must
  // fall through the fail-safe branch rather than resurrect a retired meaning.
  for (const retired of ["cpu-fallback", "no-fit"]) {
    const badge = coverageBadge(backend({ npuCoverage: retired }));
    assert.equal(badge.variant, "neutral");
    assert.equal(badge.label, retired);
  }
});

// ── The shape a pre-ADR-0028 tan actually sends ────────────────────────────
//
// The test above puts a retired WORD in the NEW field. No tan build has ever
// sent that: a CLI predating the amendment sends `verdict` and no
// `npuCoverage`, `basis` or `confidence` at all. `SUPPORTED_CLI_VERSION` on
// this branch is "0.3.1", so a MISSING field — not an unknown value — is the
// shape every currently supported CLI produces, and the fail-safe branch was
// written for the other one.

/** A `backends[]` entry exactly as the retired vocabulary spelled it. */
function retiredBackend(over) {
  return {
    backend: "ethos_u",
    variant: "u85",
    verdict: "fits",
    est_sram_kib: 512,
    op_coverage_pct: 100,
    unsupported_ops: [],
    ...over,
  };
}

test("a report with no npuCoverage never renders the text `undefined`", () => {
  for (const verdict of ["fits", "cpu-fallback", "no-fit"]) {
    const badge = coverageBadge(retiredBackend({ verdict }));
    assert.equal(badge.variant, "neutral");
    assert.equal(
      typeof badge.label,
      "string",
      `label must be a string, got ${badge.label}`,
    );
    assert.ok(
      badge.label.length > 0,
      "an empty label renders an empty badge with no text at all",
    );
    // The rendered cell is `${backendLabel(...)}: ${badge.label}` — a missing
    // label reaches the customer as "Ethos-U85: undefined".
    assert.doesNotMatch(badge.label, /undefined/);
    assert.doesNotMatch(badge.title, /undefined/);
  }
});

test("a report with no basis states so, rather than claiming an eligibility screen", () => {
  const b = retiredBackend();
  assert.doesNotMatch(basisSummary(b), /undefined/);
  assert.equal(coverageDetail(b), null);
  assert.equal(cpuCertainOps(b), null);
});

// ── Semantics 1 outranks the basis ─────────────────────────────────────────

test("undetermined draws no percentage line even at a proven basis", () => {
  // A compile that produced no data must not draw a hard "0% placed on the
  // NPU" under a badge that says "not determined". `coverageBadge` gates on
  // `undetermined` FIRST; `coverageDetail` gated on `isProven` first, so the
  // two disagreed. `deepx_dxm1` — the headline backend of E1M-V2M101 /
  // E1M-V2M102 — is exactly the one that reports `undetermined`.
  const b = backend({
    backend: "deepx_dxm1",
    variant: null,
    table: null,
    npuCoverage: "undetermined",
    computeOnNpuPctMax: null,
    npuPlacementPctReal: 0.0,
    basis: "compiled",
    confidence: "certain",
    ops: [],
  });
  assert.equal(coverageBadge(b).label, "not determined");
  assert.equal(coverageDetail(b), null);
});

// ── Rounding must not contradict the badge beside it ───────────────────────

test("a proven placement short of 100 % never prints as 100 %", () => {
  // 299/300 operators placed. `.toFixed(0)` reads "100% of operators placed on
  // the NPU" directly under a "some ops on NPU (proven)" badge. A
  // 300-operator network is ordinary.
  const line = coverageDetail(
    backend({
      npuCoverage: "partial",
      computeOnNpuPctMax: null,
      npuPlacementPctReal: 99.66666666666667,
      basis: "compiled",
      confidence: "certain",
      ops: [],
    }),
  );
  assert.doesNotMatch(line, /\b100%/);
  assert.match(line, /of operators placed on the NPU/);
});

test("a nonzero proven placement never prints as 0 %", () => {
  // The mirror: 1/300 placed reads "0% of operators placed on the NPU" beside
  // a badge that says some of them were.
  const line = coverageDetail(
    backend({
      npuCoverage: "partial",
      computeOnNpuPctMax: null,
      npuPlacementPctReal: 0.3333333333333333,
      basis: "compiled",
      confidence: "certain",
      ops: [],
    }),
  );
  assert.doesNotMatch(line, /\b0% of operators/);
});

test("an exact 0 % and an exact 100 % still print as themselves", () => {
  // The guard above must not blur a real all-or-nothing result into "<1%" or
  // ">99%" — the captured float32_fc.tflite case is a true 0.0.
  const proven = (pct) =>
    coverageDetail(
      backend({
        npuCoverage: "partial",
        computeOnNpuPctMax: null,
        npuPlacementPctReal: pct,
        basis: "compiled",
        confidence: "certain",
        ops: [],
      }),
    );
  assert.match(proven(0.0), /^0% of operators/);
  assert.match(proven(100.0), /^100% of operators/);
});

test("a static upper bound short of 100 % never prints as 100 %", () => {
  const line = coverageDetail(
    backend({
      npuCoverage: "partial",
      computeOnNpuPctMax: 99.6,
      ops: [
        {
          op: "CONV_2D",
          status: "npu-eligible",
          reason: "constraint-unchecked",
          macs: 996,
        },
        {
          op: "CUSTOM",
          status: "cpu-certain",
          reason: "op-not-in-table",
          macs: 4,
        },
      ],
    }),
  );
  assert.doesNotMatch(line, /up to 100%/);
  assert.match(line, /\(1\/2 ops\)/);
});

// ── A number that is not a percentage is not rendered as one ───────────────

test("a non-finite or out-of-range percentage is dropped, never printed", () => {
  // The module is defensive about unknown vocabulary STRINGS and was not
  // defensive at all about numbers: Infinity rendered "up to Infinity% of
  // compute", -5 rendered "up to -5% of compute". Dropped rather than clamped
  // — a clamped figure is still a figure, and a wrong figure is the thing this
  // module exists to avoid.
  const ops = [
    {
      op: "CONV_2D",
      status: "npu-eligible",
      reason: "constraint-unchecked",
      macs: 70,
    },
    {
      op: "CUSTOM",
      status: "cpu-certain",
      reason: "op-not-in-table",
      macs: 10,
    },
  ];
  for (const bad of [Infinity, -Infinity, NaN, -5, 1e9, "100"]) {
    const line = coverageDetail(
      backend({ npuCoverage: "partial", computeOnNpuPctMax: bad, ops }),
    );
    assert.equal(
      line,
      "1/2 ops are NPU-eligible by name — no MAC-weighted figure",
      `computeOnNpuPctMax ${String(bad)} must not reach the rendered line`,
    );
  }
  for (const bad of [Infinity, NaN, -5, 1e9, "100"]) {
    assert.equal(
      coverageDetail(
        backend({
          npuCoverage: "partial",
          computeOnNpuPctMax: null,
          npuPlacementPctReal: bad,
          basis: "compiled",
          confidence: "certain",
          ops: [],
        }),
      ),
      null,
      `npuPlacementPctReal ${String(bad)} must not reach the rendered line`,
    );
  }
});
