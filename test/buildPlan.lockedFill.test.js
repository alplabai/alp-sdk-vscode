// SPDX-License-Identifier: Apache-2.0
//
// WCAG gate for the locked region cards' amber squares (--fill-locked in
// tokens.css): the fill must clear the 3:1 non-text floor against BOTH the
// panel ground and the card's own background (the strip's quiet 12% grey tint
// over that ground), in every covered theme — light, dark and the two
// high-contrast ones — and must stay a warm hue distinct from the red
// reserved for real warnings. Computed from the CSS's own declaration, the
// same way the tier-mark gate reads its rules.

const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const assert = require("node:assert/strict");
const {
  THEMES,
  resolvedOpaqueRgb,
  contrast,
} = require("./helpers/vscodeThemes");
const { lockedFill } = require("./helpers/lockedFill");

const SRC = path.join(__dirname, "..", "packages", "alp-webview", "src");
const TOKENS = fs.readFileSync(path.join(SRC, "styles", "tokens.css"), "utf8");
const STRIP = fs.readFileSync(
  path.join(SRC, "features", "build-plan", "MemoryStrip.module.css"),
  "utf8",
);

/** A box's own background in `theme`: the text-secondary tint of its rule
 *  (the first color-mix against transparent) over the panel ground. */
function boxBackground(selector, theme) {
  const rule = new RegExp(
    `${selector.replace(".", "\\.")}\\s*\\{[^}]*\\}`,
  ).exec(STRIP);
  assert.ok(rule, `${selector} rule not found`);
  const m =
    /color-mix\(in srgb,\s*var\((--[\w-]+)\)\s*(\d+)%,\s*transparent\)/.exec(
      rule[0],
    );
  assert.ok(
    m,
    `${selector} no longer tints with color-mix(var(--x) P%, transparent)`,
  );
  const ground = resolvedOpaqueRgb(theme, "--surface-bg", null);
  const ink = resolvedOpaqueRgb(theme, m[1], ground);
  const a = Number(m[2]) / 100;
  return ink.map((c, i) => c * a + ground[i] * (1 - a));
}

function hue([r, g, b]) {
  const [rn, gn, bn] = [r / 255, g / 255, b / 255];
  const max = Math.max(rn, gn, bn);
  const d = max - Math.min(rn, gn, bn);
  if (d === 0) return 0;
  let h =
    max === rn
      ? ((gn - bn) / d) % 6
      : max === gn
        ? (bn - rn) / d + 2
        : (rn - gn) / d + 4;
  h *= 60;
  return h < 0 ? h + 360 : h;
}

test("the locked fill clears 3:1 on the panel ground and on a cell, a container bar and a card, in every covered theme", () => {
  for (const theme of THEMES) {
    const fill = lockedFill(theme);
    const ground = resolvedOpaqueRgb(theme, "--surface-bg", null);
    const grounds = [
      ["panel ground", ground],
      ...[".region", ".parent", ".regionCard"].map((sel) => [
        sel,
        boxBackground(sel, theme),
      ]),
    ];
    for (const [what, bg] of grounds) {
      const ratio = contrast(fill, bg);
      assert.ok(
        ratio >= 3,
        `locked fill vs ${what} in ${theme}: ${ratio.toFixed(2)}:1, need >= 3:1`,
      );
    }
  }
});

test("the locked tier mark on cells and container bars paints the same --fill-locked amber", () => {
  assert.match(
    STRIP,
    /\.tierMark\[data-tier="locked"\]\s*\{[^}]*var\(--fill-locked\)/,
  );
});

test("the locked fill stays amber: a warm hue, well away from error red", () => {
  for (const theme of THEMES) {
    const h = hue(lockedFill(theme));
    assert.ok(
      h >= 28 && h <= 60,
      `locked fill hue in ${theme}: ${h.toFixed(0)} deg`,
    );
  }
});

test("the locked cards paint --fill-locked, and nothing in the card rules uses the error colour", () => {
  assert.match(
    STRIP,
    /\.waffle\[data-kind="locked"\]\s*\{[^}]*var\(--fill-locked\)/,
  );
  const cardRules = STRIP.slice(
    STRIP.indexOf(".regionCard {"),
    STRIP.indexOf("/* Lit cells"),
  );
  assert.ok(
    !/status-err|chart-6|charts-red/.test(cardRules),
    "red is reserved for real warnings",
  );
});
