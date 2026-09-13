// SPDX-License-Identifier: Apache-2.0
//
// Two rules, not one, because the swatch encodes authority on TWO different
// channels and each needs its own gate:
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
//      lightness alone" (AuthoritySwatch.module.css). Two identical colours
//      contrast at exactly 1.00:1 no matter what percentage either tier's
//      CSS declares — that is not a defect to chase with a different
//      percentage, it is the point: pattern is carrying the distinction
//      instead of tone. A prior version of this gate compared ink alone and
//      demanded 1.5:1 between every pair, including `yours` vs `unproven`;
//      that demanded a difference on a channel the design never put one on,
//      and a gamut scan across every covered theme proved no percentage
//      could ever satisfy it (VS Code's own Light+/Dark+/2026-Dark
//      foreground-vs-background pairs are not far enough apart to fit three
//      pairwise-1.5:1 achromatic tiers between a 3:1 floor and full ink,
//      full stop). So: a pair whose PATTERNS differ is already
//      distinguishable and needs no ink check; a pair that shares a pattern
//      (only `yours` vs `locked` does — both a flat fill, differing solely
//      in density) still needs its ink apart by 1.5:1, because density is
//      the ONLY channel they have.

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  THEMES,
  resolvedOpaqueRgb,
  contrast,
} = require("./helpers/vscodeThemes");
const { swatchInk } = require("./helpers/swatchInk");

test("each swatch tier clears 3:1 against the panel ground in every covered theme", () => {
  for (const theme of THEMES) {
    const ground = resolvedOpaqueRgb(theme, "--surface-bg", null);
    for (const tier of ["yours", "locked", "unproven"]) {
      const ratio = contrast(swatchInk(theme, tier).rgb, ground);
      assert.ok(
        ratio >= 3,
        `swatch tier ${tier} vs panel ground in ${theme}: ${ratio.toFixed(2)}:1, need >= 3:1`,
      );
    }
  }
});

test("the three tiers are pairwise distinguishable in every covered theme", () => {
  for (const theme of THEMES) {
    const tiers = {
      yours: swatchInk(theme, "yours"),
      locked: swatchInk(theme, "locked"),
      unproven: swatchInk(theme, "unproven"),
    };
    for (const [a, b] of [
      ["yours", "locked"],
      ["yours", "unproven"],
      ["locked", "unproven"],
    ]) {
      const A = tiers[a];
      const B = tiers[b];
      if (A.pattern !== B.pattern) {
        // Different pattern (solid vs hatch) is its own distinguishing
        // channel — no ink separation is required or expected.
        continue;
      }
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
