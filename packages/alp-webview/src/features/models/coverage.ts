// SPDX-License-Identifier: Apache-2.0
//
// The `tan model check` NPU-coverage vocabulary, narrowed for the webview.
//
// LOCKSTEP CONTRACT. These shapes and every string in the maps below mirror
// alp-sdk ADR-0028's amendment as tan implements it in `tan/model/analyze.py`
// (the static screen) and `tan/model/check.py` (the `--exact` upgrade), and
// as `tan/core/model_check.py` serialises it into `envelope.data.models[]
// .backends[]`. Both halves of that pair move together — a value tan adds
// here and the extension does not know renders through the fail-safe branch
// (never green, never "won't run"), which is safe but useless, so treat a new
// vocabulary value as a change owed to this file.
//
// The retired vocabulary was `fits | cpu-fallback | no-fit`. tan emits none of
// those from a static screen any more, and only `fits` survives at all — see
// `coverageBadge` below for the one basis that may still carry it.
//
// Three semantics this module exists to keep the UI honest about:
//
//   1. `undetermined` is NOT `cpu-only`. It means no data — a backend whose
//      support table is absent BY DECISION (`deepx_dxm1` ships none) reports
//      `undetermined` on every model, and DEEPX is the headline feature of the
//      E1M-V2M101 / E1M-V2M102 SKUs. Rendering that as "won't run" is a false
//      negative on the flagship part, so it gets its own neutral badge and its
//      own words, never a red one.
//   2. A `basis: "static-screen"` positive is ELIGIBILITY, never a guarantee.
//      The model runs either way: an operator the NPU cannot take falls back
//      to the CPU silently rather than failing. A bare percentage reads as a
//      promise, so every static figure is labelled as an upper bound and the
//      section carries the caveat in words.
//   3. Only `basis: "compiled"` or `basis: "bench"` may present a result as
//      proven.

/** One operator's verdict inside a `BackendCoverage`. */
export interface OpVerdictView {
  /** The operator as spelled in the model's own vocabulary (e.g. `FULLY_CONNECTED`). */
  op: string;
  /** `npu-eligible` | `cpu-certain` | `unknown` (open — see the lockstep note). */
  status: string;
  /** `op-not-in-table` | `constraint-unchecked` | `no-table-for-backend` | `format-not-accepted`. */
  reason: string;
  /** MAC estimate; `0` when the conv/dense-only estimator could not price it. */
  macs?: number;
}

/** One backend's coverage report for one model — `data.models[].backends[]`. */
export interface BackendCoverage {
  /** `ethos_u` | `drpai` | `deepx_dxm1` (tan excludes `cpu` from `check`). */
  backend: string;
  /** Ethos-U instance variant (`u85`, `u55`, `u65`); `null` for the others. */
  variant?: string | null;
  /** Absolute path of the support table that answered, or `null`. */
  table?: string | null;
  /** `full-eligible` | `partial` | `cpu-only` | `undetermined`, plus `fits` —
   *  which tan emits ONLY at `basis: "compiled"` with 100 % NPU placement. */
  npuCoverage: string;
  /** MAC-weighted UPPER bound, 0–100. Only ever set at `basis: "static-screen"`. */
  computeOnNpuPctMax?: number | null;
  /** The REAL op-count placement ratio, 0–100, from a compile. Only ever set
   *  at `basis: "compiled"`. A different unit from `computeOnNpuPctMax` — the
   *  two are never both set and must never be rendered as one number. */
  npuPlacementPctReal?: number | null;
  /** cpu-certain ops the MAC estimator could not price; they leave
   *  `computeOnNpuPctMax`'s denominator, so a nonzero count is a caveat ON
   *  that percentage. */
  uncostedCpuOpCount?: number;
  /** `static-screen` | `compiled` | `bench`. */
  basis: string;
  /** `certain` | `screening`. */
  confidence: string;
  /** tan's own caveats and refusals, rendered VERBATIM — they are the words
   *  semantics 1 and 2 are stated in, and paraphrasing them loses the fix
   *  (`pip install alp-tan[model-io]`, the vela profile refusal, …). */
  notes?: string[];
  ops?: OpVerdictView[];
}

/** One declared model's coverage result — `data.models[]`. There is no
 *  per-model `error` field any more: tan reports a per-model failure as an
 *  envelope issue coded `model.check-failed`, which the panel already renders
 *  through `IssuesBanner`. */
export interface ModelCoverage {
  name: string;
  /** Absolute path of the model source tan screened. */
  source?: string;
  backends?: BackendCoverage[];
}

/** Badge colour. `info` and `neutral` exist so a static-screen positive never
 *  claims the green of a proven one, and so `undetermined` never borrows the
 *  red of a real negative. */
export type CoverageVariant = "ok" | "info" | "warn" | "neutral";

export interface CoverageBadge {
  variant: CoverageVariant;
  label: string;
  /** Tooltip: basis + confidence, so the strength of the claim is one hover away. */
  title: string;
}

/** The two bases whose results may be presented as proven. */
const PROVEN_BASES = ["compiled", "bench"];

export function isProven(basis: string): boolean {
  return PROVEN_BASES.includes(basis);
}

/** Cosmetic backend → label, mirroring tan's own `_BACKEND_LABELS`
 *  (`tan/core/model_check.py`) so the panel and `tan model check --format
 *  text` name the same hardware the same way. */
const BACKEND_LABELS: Record<string, string> = {
  ethos_u: "Ethos-U",
  drpai: "DRP-AI",
  deepx_dxm1: "DEEPX DX-M1",
};

/** `ethos_u` + `u85` → `Ethos-U85`; mirrors tan's `backend_label`. */
export function backendLabel(backend: string, variant?: string | null): string {
  if (backend === "ethos_u" && variant && variant.startsWith("u")) {
    return `Ethos-U${variant.slice(1)}`;
  }
  return BACKEND_LABELS[backend] ?? backend;
}

/** Proven (`basis: compiled|bench`) coverage → badge. */
const PROVEN_BADGE: Record<
  string,
  { variant: CoverageVariant; label: string }
> = {
  fits: { variant: "ok", label: "all ops on NPU" },
  partial: { variant: "warn", label: "some ops on NPU" },
  "cpu-only": { variant: "warn", label: "CPU only" },
};

/** Static-screen coverage → badge. Never green: a name-membership screen
 *  cannot see the quantization/shape/dtype decision a real compile makes, so
 *  the strongest honest claim is "eligible". */
const SCREENED_BADGE: Record<
  string,
  { variant: CoverageVariant; label: string }
> = {
  "full-eligible": { variant: "info", label: "all ops NPU-eligible" },
  partial: { variant: "info", label: "some ops NPU-eligible" },
  "cpu-only": { variant: "warn", label: "no NPU-eligible ops" },
  // tan's contract says `fits` cannot reach a static basis. If one ever does,
  // downgrade the claim to eligibility rather than promoting the basis —
  // over-claiming here is the failure this module exists to prevent.
  fits: { variant: "info", label: "all ops NPU-eligible" },
};

/** "No data" — semantics 1. Deliberately its own label rather than any
 *  wording that could read as a verdict on the model. */
const UNDETERMINED_BADGE: { variant: CoverageVariant; label: string } = {
  variant: "neutral",
  label: "not determined",
};

/** Shown wherever tan sent no value at all, so a missing field reads as a
 *  missing field instead of reaching the customer as the text `undefined`. */
const NOT_REPORTED = "not reported";

/** A field tan may simply not have sent. Every CLI before the ADR-0028
 *  amendment omits `npuCoverage`, `basis` and `confidence` entirely — it sends
 *  the retired `verdict` instead — and `SUPPORTED_CLI_VERSION` is still on that
 *  side of the change, so this is the common shape, not a corner case. */
function reported(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

/**
 * `basis` + `confidence` as one line, and the strength of the claim in front
 * of them. Lives here rather than in the view so the vocabulary has exactly
 * one reader — a second `basis: ${b.basis}` template elsewhere is a second
 * place for a missing field to surface as `undefined`.
 */
export function basisSummary(b: BackendCoverage): string {
  const basis = reported(b.basis) ?? NOT_REPORTED;
  const confidence = reported(b.confidence) ?? NOT_REPORTED;
  const strength = isProven(b.basis) ? "proven" : "eligibility screen";
  return `${strength} — basis: ${basis}, confidence: ${confidence}`;
}

/**
 * The one place a `npuCoverage` × `basis` pair becomes something a customer
 * reads. Unrecognised coverage values fall through to the neutral badge with
 * the raw string shown: an unknown value must never render green (a promise
 * nothing supports) and must never render red (a "won't run" nothing supports
 * either).
 */
export function coverageBadge(b: BackendCoverage): CoverageBadge {
  const proven = isProven(b.basis);
  const basis = reported(b.basis) ?? NOT_REPORTED;
  const confidence = reported(b.confidence) ?? NOT_REPORTED;
  const title = proven
    ? `basis: ${basis} (proven) · confidence: ${confidence}`
    : `basis: ${basis} (eligibility only) · confidence: ${confidence}`;

  if (b.npuCoverage === "undetermined") {
    return {
      ...UNDETERMINED_BADGE,
      title: `${title} · no data for this backend`,
    };
  }
  // An ABSENT `npuCoverage` is a different thing from an unknown one, and the
  // fail-safe below cannot carry it: it renders the raw value, so a missing
  // field reaches the customer as the literal word `undefined` — as an empty
  // badge where the label is used bare, and as "Ethos-U85: undefined" where it
  // is interpolated. Every pre-amendment tan produces exactly this.
  const coverage = reported(b.npuCoverage);
  if (coverage === null) {
    return {
      variant: "neutral",
      label: NOT_REPORTED,
      title: `${title} · this CLI reported no NPU coverage for the backend`,
    };
  }
  const table = proven ? PROVEN_BADGE : SCREENED_BADGE;
  const hit = table[coverage];
  if (!hit) {
    return { variant: "neutral", label: coverage, title };
  }
  return {
    variant: hit.variant,
    label: proven ? `${hit.label} (proven)` : hit.label,
    title,
  };
}

/**
 * A percentage tan reported, or `null` when it is not one.
 *
 * The module is careful with unknown vocabulary STRINGS and was not careful at
 * all with numbers: `Infinity` rendered "up to Infinity% of compute" and `-5`
 * rendered "up to -5% of compute". Out-of-range and non-finite values are
 * DROPPED rather than clamped — a clamped figure is still a figure, and every
 * caller has an honest no-figure form to fall back to.
 */
function usablePct(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  if (value < 0 || value > 100) return null;
  return value;
}

/**
 * A percentage that cannot contradict the badge printed beside it.
 *
 * `.toFixed(0)` turns 99.667 into "100%" under a badge that says "some ops on
 * NPU", and 0.333 into "0%" under the same badge — 299/300 and 1/300 on an
 * ordinary 300-operator network. Only an exact 0 or 100 may print as `0%` or
 * `100%`; anything strictly between them keeps a boundary marker.
 */
function formatPct(value: number): string {
  const rounded = Math.round(value);
  if (rounded >= 100 && value < 100) return ">99%";
  if (rounded <= 0 && value > 0) return "<1%";
  return `${rounded}%`;
}

/**
 * The percentage line, or `null` when there is no honest one to draw.
 *
 * Mirrors tan's own `_coverage_line` gate (`tan/core/model_check.py`): no
 * static figure for `undetermined`, and none recomputed from `ops` on a
 * `basis: "compiled"` report — tan KEEPS the static per-op verdicts alongside
 * a real compile result, and those legitimately disagree with what the
 * compiler actually placed (table membership does not check dtype or shape).
 * A real captured envelope shows exactly that: a `float32_fc.tflite` on
 * E1M-AEN801 reports `npuCoverage: "cpu-only"` / `npuPlacementPctReal: 0.0`
 * while its kept `ops[0].status` is still `npu-eligible`. Recomputing "1/1 ops
 * NPU-eligible" next to "0 % placed on the NPU" is the self-contradiction the
 * gate exists to prevent.
 *
 * The two percentages are DIFFERENT UNITS and are labelled as such —
 * `computeOnNpuPctMax` is a MAC-weighted upper bound from the screen,
 * `npuPlacementPctReal` is a real operator-count placement from the compiler.
 */
export function coverageDetail(b: BackendCoverage): string | null {
  // Semantics 1 OUTRANKS the basis, and this check has to come first for the
  // badge and the line to agree. `coverageBadge` gates on `undetermined`
  // before it looks at `basis`; when this function gated on `isProven` first,
  // a `{basis: "compiled", npuCoverage: "undetermined", npuPlacementPctReal:
  // 0.0}` report drew "0% of operators placed on the NPU — measured by the
  // compiler" directly beneath a badge reading "not determined". That is the
  // false negative this module exists to prevent, on `deepx_dxm1` — the
  // backend that reports `undetermined` on every model, and the headline
  // feature of the E1M-V2M101 / E1M-V2M102 SKUs.
  if (b.npuCoverage === "undetermined") return null;
  if (isProven(b.basis)) {
    const placed = usablePct(b.npuPlacementPctReal);
    if (placed === null) return null;
    return `${formatPct(placed)} of operators placed on the NPU — measured by the compiler`;
  }
  const determined = (b.ops ?? []).filter(
    (o) => o.status === "npu-eligible" || o.status === "cpu-certain",
  );
  if (determined.length === 0) return null;
  const eligible = determined.filter((o) => o.status === "npu-eligible").length;
  const uncosted = b.uncostedCpuOpCount ?? 0;
  const caveat =
    uncosted > 0
      ? ` (${uncosted} CPU op${uncosted === 1 ? "" : "s"} carry no MAC estimate and are excluded)`
      : "";
  const pct = usablePct(b.computeOnNpuPctMax);
  if (pct !== null) {
    return `up to ${formatPct(pct)} of compute (${eligible}/${determined.length} ops) is NPU-eligible — upper bound, static screen${caveat}`;
  }
  return `${eligible}/${determined.length} ops are NPU-eligible by name — no MAC-weighted figure${caveat}`;
}

/**
 * The certain-CPU operator list, or `null`. Carries tan's `_cpu_fallback_line`
 * gate for the same reason `coverageDetail` carries `_coverage_line`'s: on a
 * `basis: "compiled"` report these static verdicts can contradict the real
 * placement rendered beside them.
 */
export function cpuCertainOps(b: BackendCoverage): string | null {
  if (!isProven(b.basis)) {
    const names = (b.ops ?? [])
      .filter((o) => o.status === "cpu-certain")
      .map((o) => o.op);
    if (names.length === 0) return null;
    const shown = names.slice(0, 8).join(", ");
    const more = names.length > 8 ? `, +${names.length - 8} more` : "";
    const noun = names.length === 1 ? "op is" : "ops are";
    return `${names.length} ${noun} certain CPU fallback: ${shown}${more}`;
  }
  return null;
}

/** Semantics 2, in words — the standing caveat under any static-screen result. */
export const STATIC_SCREEN_CAVEAT =
  "A static screen reports ELIGIBILITY, not a guarantee: an eligible operator still carries " +
  "quantization, shape and dtype constraints the screen cannot check. The model runs either way — " +
  "an operator the NPU cannot take falls back to the CPU silently rather than failing. Only a real " +
  "compile (marked “proven”) proves NPU execution.";

/** Semantics 1, in words — shown whenever any backend reports `undetermined`. */
export const UNDETERMINED_CAVEAT =
  "“not determined” means there is no data for that backend — a support table that is absent by " +
  "decision, or a source format the backend does not ingest. It is not a finding that the model " +
  "will not run.";
