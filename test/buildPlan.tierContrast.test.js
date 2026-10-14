// SPDX-License-Identifier: Apache-2.0
//
// The memory strip's authority tier mark (MemoryStrip.module.css
// `.tierMark[data-tier]`) encodes authority on TWO channels, and each needs
// its own gate:
//
//   1. Every tier, on its own, must be visible against the panel ground —
//      an ink too faint to see is a defect regardless of what tells tiers
//      apart from each other. Plain 3:1 non-text contrast, unconditional.
//
//   2. Every PAIR of tiers must be told apart from one another — but not
//      necessarily by ink. `yours` and `unproven` are deliberately the SAME
//      colour (both resolve `var(--text-primary)` at full strength) and are
//      told apart by PATTERN — solid fill vs hatch — precisely so the
//      difference "survives a greyscale display and does not rest on
//      lightness alone". Two identical colours contrast at exactly 1.00:1
//      no matter what percentage either tier's CSS declares; a gamut scan
//      across every covered theme proved no percentage could ever fit three
//      pairwise-1.5:1 achromatic tiers between a 3:1 floor and full ink.
//      So: a pair whose PATTERNS differ is already distinguishable; a pair
//      that shares a pattern (only `yours` vs `locked`, both a flat fill)
//      still needs its ink apart by 1.5:1, because density is the only
//      channel they have.
//
// A third check holds the set of tiers the component can ever be given
// (`AuthorityTier` in authorityTier.ts, which MemoryStrip.tsx types its
// `data-tier` against) to the set the stylesheet has a rule for. A fourth
// reads what MemoryStrip.tsx actually EMITS — a component that hardcodes
// one tier, or drops the attribute, satisfies the first three while painting
// nothing real. The last reads the BUILT dist/main.css, because a CSS
// Modules class is hashed and only the compiled output can tell a working
// selector from dead markup.

const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const assert = require("node:assert/strict");
const {
  THEMES,
  resolvedOpaqueRgb,
  contrast,
} = require("./helpers/vscodeThemes");
const { tierInk, STRIP_CSS_PATH } = require("./helpers/tierInk");
const { readDistCss } = require("./helpers/distCss");

function escapeForRegExp(literal) {
  return literal.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

const BUILD_PLAN_DIR = path.join(
  __dirname,
  "..",
  "packages",
  "alp-webview",
  "src",
  "features",
  "build-plan",
);
const COMPONENT_TSX = path.join(BUILD_PLAN_DIR, "MemoryStrip.tsx");
const AUTHORITY_TIER_TS = path.join(BUILD_PLAN_DIR, "authorityTier.ts");

const TIERS = ["yours", "locked", "unproven"];

test("each tier mark clears 3:1 against the panel ground in every covered theme", () => {
  for (const theme of THEMES) {
    const ground = resolvedOpaqueRgb(theme, "--surface-bg", null);
    for (const tier of TIERS) {
      const ratio = contrast(tierInk(theme, tier).rgb, ground);
      assert.ok(
        ratio >= 3,
        `tier ${tier} vs panel ground in ${theme}: ${ratio.toFixed(2)}:1, need >= 3:1`,
      );
    }
  }
});

test("the three tiers are pairwise distinguishable in every covered theme", () => {
  for (const theme of THEMES) {
    const inks = Object.fromEntries(TIERS.map((t) => [t, tierInk(theme, t)]));
    for (const [a, b] of [
      ["yours", "locked"],
      ["yours", "unproven"],
      ["locked", "unproven"],
    ]) {
      const A = inks[a];
      const B = inks[b];
      // Different pattern (solid vs hatch) is its own distinguishing
      // channel — no ink separation is required or expected.
      if (A.pattern !== B.pattern) continue;
      const ratio = contrast(A.rgb, B.rgb);
      assert.ok(
        ratio >= 1.5,
        `tiers ${a} and ${b} are both "${A.pattern}" and contrast at ` +
          `${ratio.toFixed(2)}:1 in ${theme} — two tiers may share a colour ` +
          "only when their patterns differ",
      );
    }
  }
});

test("the hatch really is a hatch, and only one tier wears it", () => {
  const patterns = TIERS.map((t) => tierInk("dark", t).pattern);
  assert.deepEqual(patterns, ["solid", "solid", "hatch"]);
});

test("the AuthorityTier set MemoryStrip.tsx types data-tier against is exactly the set MemoryStrip.module.css styles", () => {
  const componentSrc = fs.readFileSync(COMPONENT_TSX, "utf8");
  assert.match(
    componentSrc,
    /import\s*\{[^}]*\bAuthorityTier\b[^}]*\}\s*from\s*"\.\/authorityTier"/,
    "MemoryStrip.tsx no longer types its tiers against ./authorityTier's " +
      "AuthorityTier — this cross-check has nothing left to verify",
  );
  const typeMatch = /type AuthorityTier\s*=\s*([^;]+);/.exec(
    fs.readFileSync(AUTHORITY_TIER_TS, "utf8"),
  );
  assert.ok(typeMatch, "could not find `type AuthorityTier = ...`");
  const typeTiers = [...typeMatch[1].matchAll(/"([a-z]+)"/g)]
    .map((m) => m[1])
    .sort();
  const cssTiers = [
    ...fs
      .readFileSync(STRIP_CSS_PATH, "utf8")
      .matchAll(/\.tierMark\[data-tier="([a-z]+)"\]/g),
  ]
    .map((m) => m[1])
    .sort();
  assert.deepEqual(
    typeTiers,
    cssTiers,
    `AuthorityTier's literals (${typeTiers.join(", ")}) and ` +
      `MemoryStrip.module.css's .tierMark[data-tier="…"] selectors ` +
      `(${cssTiers.join(", ")}) have drifted apart`,
  );
});

test("MemoryStrip.tsx binds the mark's data-tier to the region's own tier, never a literal", () => {
  const src = fs.readFileSync(COMPONENT_TSX, "utf8");
  assert.ok(
    src.includes("className={styles.tierMark} data-tier={r.tier}"),
    "the band's tier mark no longer binds data-tier={r.tier}",
  );
  assert.ok(
    src.includes("className={styles.tierMark}\n            data-tier={tier}") ||
      src.includes("className={styles.tierMark} data-tier={tier}"),
    "the legend's tier mark no longer binds data-tier={tier}",
  );
  const literal = /className=\{styles\.tierMark\}[^>]*data-tier="([^"]*)"/.exec(
    src,
  );
  assert.equal(
    literal,
    null,
    literal ? `a tier mark hardcodes data-tier="${literal[1]}"` : undefined,
  );
  // A band with NO declared authority carries no tier at all — the
  // fail-closed default must never be painted as if the SoM had said it.
  assert.ok(
    src.includes("{r.tier && (") || src.includes("{r.tier &&"),
    "a band paints a tier mark even when the SoM declared no authority",
  );
});

/** `.tierMark`'s hashed name, found through its base rule — the only rule
 * in the bundle that is a 3px-high, pointer-inert, absolutely placed strip. */
function builtTierMarkClass(distCss) {
  // Lookaheads, because the minifier reorders declarations inside a rule.
  const re =
    /\._([\w-]+)\{(?=[^}]*pointer-events:none)(?=[^}]*height:3px)(?=[^}]*position:absolute)[^}]*\}/;
  const m = re.exec(distCss);
  if (!m) {
    throw new Error(
      "could not find the built .tierMark base rule in dist/main.css — run " +
        "`pnpm run compile`",
    );
  }
  return m[1];
}

test("the three [data-tier] rules survive the build (verified against the built artifact, not just source)", () => {
  const distCss = readDistCss();
  const cls = builtTierMarkClass(distCss);
  for (const tier of TIERS) {
    const re = new RegExp(
      `\\._${escapeForRegExp(cls)}\\[data-tier=(?:"${tier}"|${tier})\\]`,
    );
    assert.ok(
      re.test(distCss),
      `dist/main.css has no ._${cls}[data-tier=${tier}] rule — the class is ` +
        "hashed at build time and only the compiled output proves the rule " +
        "reaches a real selector",
    );
  }
});
