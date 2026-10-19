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
  VSCODE_DEFAULTS,
  resolvedOpaqueRgb,
  contrast,
  parseColor,
} = require("./helpers/vscodeThemes");

const SRC = path.join(__dirname, "..", "packages", "alp-webview", "src");
const TOKENS = fs.readFileSync(path.join(SRC, "styles", "tokens.css"), "utf8");
const STRIP = fs.readFileSync(
  path.join(SRC, "features", "build-plan", "MemoryStrip.module.css"),
  "utf8",
);

/** `[r,g,b]` of --fill-locked in `theme`, parsed from its declaration:
 *  color-mix(in srgb, var(--vscode-X, fallback) P%, var(--text-primary)). */
function lockedFill(theme) {
  const m =
    /--fill-locked:\s*color-mix\(\s*in srgb,\s*var\(\s*(--vscode-[\w-]+)\s*,\s*(#[0-9a-fA-F]+)\s*\)\s*(\d+)%,\s*var\(\s*(--[\w-]+)\s*\)\s*\)/.exec(
      TOKENS,
    );
  assert.ok(
    m,
    "--fill-locked is no longer color-mix(var(--vscode-*, #fb) P%, var(--ink))",
  );
  const ground = resolvedOpaqueRgb(theme, "--surface-bg", null);
  const warn = VSCODE_DEFAULTS[theme][m[1]]
    ? parseColor(VSCODE_DEFAULTS[theme][m[1]]).slice(0, 3)
    : parseColor(m[2]).slice(0, 3);
  const ink = resolvedOpaqueRgb(theme, m[4], ground);
  const p = Number(m[3]) / 100;
  return warn.map((c, i) => c * p + ink[i] * (1 - p));
}

/** The card's own background: `.regionCard`'s text-secondary tint over the
 *  ground (the tint is the first color-mix in its background stack). */
function cardBackground(theme) {
  const rule = /\.regionCard\s*\{[^}]*\}/.exec(STRIP);
  assert.ok(rule, ".regionCard rule not found");
  const m =
    /color-mix\(in srgb,\s*var\((--[\w-]+)\)\s*(\d+)%,\s*transparent\)/.exec(
      rule[0],
    );
  assert.ok(
    m,
    ".regionCard no longer tints with color-mix(var(--x) P%, transparent)",
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

test("the locked fill clears 3:1 on the panel ground and on the card in every covered theme", () => {
  for (const theme of THEMES) {
    const fill = lockedFill(theme);
    const ground = resolvedOpaqueRgb(theme, "--surface-bg", null);
    const card = cardBackground(theme);
    for (const [what, bg] of [
      ["panel ground", ground],
      ["card", card],
    ]) {
      const ratio = contrast(fill, bg);
      assert.ok(
        ratio >= 3,
        `locked fill vs ${what} in ${theme}: ${ratio.toFixed(2)}:1, need >= 3:1`,
      );
    }
  }
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
    STRIP.indexOf(".lockedSwatch"),
  );
  assert.ok(
    !/status-err|chart-6|charts-red/.test(cardRules),
    "red is reserved for real warnings",
  );
});
