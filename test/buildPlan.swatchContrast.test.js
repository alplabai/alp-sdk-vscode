// SPDX-License-Identifier: Apache-2.0
const test = require("node:test");
const assert = require("node:assert/strict");
const {
  THEMES,
  resolvedOpaqueRgb,
  contrast,
} = require("./helpers/vscodeThemes");
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

test("the three tiers are pairwise distinguishable in every covered theme", () => {
  for (const theme of THEMES) {
    const inks = {
      yours: swatchInkRgb(theme, "yours"),
      locked: swatchInkRgb(theme, "locked"),
      unproven: swatchInkRgb(theme, "unproven"),
    };
    for (const [a, b] of [
      ["yours", "locked"],
      ["yours", "unproven"],
      ["locked", "unproven"],
    ]) {
      const ratio = contrast(inks[a], inks[b]);
      assert.ok(
        ratio >= 1.5,
        `swatch tiers ${a} vs ${b} in ${theme}: ${ratio.toFixed(2)}:1 — too close to tell apart`,
      );
    }
  }
});
