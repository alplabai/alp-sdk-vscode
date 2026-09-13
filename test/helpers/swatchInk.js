// SPDX-License-Identifier: Apache-2.0
//
// Resolves what each AuthoritySwatch tier actually PAINTS, in a given theme,
// by reading AuthoritySwatch.module.css itself (so a future edit to the rule
// is what this measures, not a value this test invents): both its composited
// ink colour, and its PATTERN ("solid" or "hatch").
//
// The pattern matters as much as the colour. `yours` and `unproven` are
// deliberately the SAME ink — both resolve `var(--text-primary)` at full
// strength — and are told apart by shape (a solid fill vs a hatch), not by
// tone: "the difference survives a greyscale display and does not rest on
// lightness alone" per AuthoritySwatch.module.css's own comment. A contrast
// gate that only ever compared ink colours could not see that: two identical
// colours contrast at exactly 1.00:1 regardless of what percentage either
// tier's CSS declares, so `buildPlan.swatchContrast.test.js` reads BOTH
// channels off this helper and only falls back to an ink-contrast check
// between tiers that share a pattern.
//
// Two colour shapes appear in AuthoritySwatch.module.css:
//   - a flat `background: var(--name)`                        (yours)
//   - `color-mix(in srgb, var(--name) P%, transparent)`        (locked)
// and one pattern shape:
//   - `repeating-linear-gradient(..., var(--name) 0 Wpx, transparent ...)`
//     (unproven) — a hatch. It is measured at its STROKE colour (the
//     gradient's own opaque colour stop), not an average of stripe and gap:
//     a hatch is legible by its strokes, and averaging would score the
//     pattern as if it were a flat, diluted wash.

const fs = require("node:fs");
const path = require("node:path");
const { resolvedOpaqueRgb } = require("./vscodeThemes");

const SWATCH_CSS = fs.readFileSync(
  path.join(
    __dirname,
    "..",
    "..",
    "packages",
    "alp-webview",
    "src",
    "features",
    "build-plan",
    "AuthoritySwatch.module.css",
  ),
  "utf8",
);

/** The declared `background` value for `.swatch[data-tier="TIER"]`, exactly
 * as CSS text — balanced-paren aware, so a multi-line
 * `repeating-linear-gradient(...)` comes back whole. */
function backgroundDeclarationFor(tier) {
  const re = new RegExp(
    `\\.swatch\\[data-tier="${tier}"\\]\\s*\\{[^}]*?background:\\s*`,
  );
  const m = re.exec(SWATCH_CSS);
  if (!m) {
    throw new Error(
      `could not find .swatch[data-tier="${tier}"]'s background rule`,
    );
  }
  let i = m.index + m[0].length;
  let depth = 0;
  let out = "";
  for (; i < SWATCH_CSS.length; i++) {
    const c = SWATCH_CSS[i];
    if (c === "(") depth++;
    if (c === ")") depth--;
    if (c === ";" && depth === 0) break;
    out += c;
  }
  return out.trim();
}

/** The `--name` inside a `var(--name)` reference. */
function varNameIn(value) {
  const m = /var\(\s*(--[A-Za-z0-9-]+)/.exec(value);
  if (!m) throw new Error(`no var() reference found in: ${value}`);
  return m[1];
}

/** `{ name, pct }` out of `color-mix(in srgb, var(--name) P%, transparent)`. */
function colorMixParts(value) {
  const m =
    /color-mix\(in srgb,\s*var\(\s*(--[A-Za-z0-9-]+)\s*\)\s*(\d+)%/.exec(value);
  if (!m) throw new Error(`not a color-mix(...) against transparent: ${value}`);
  return { name: m[1], pct: parseInt(m[2], 10) };
}

/** `"solid" | "hatch"`, read off the declaration itself — NOT a hardcoded
 * tier -> pattern table, so a future edit that flattens the hatch (or turns
 * `locked` into a repeating gradient) changes what this returns, and the
 * pairwise test downstream reacts to it instead of sliding past it. */
function patternOf(decl) {
  return decl.startsWith("repeating-linear-gradient(") ? "hatch" : "solid";
}

/** `{ rgb, pattern }` — what a swatch tier actually paints with, in `theme`.
 *
 *  rgb:
 *  - flat `var(--name)`: the opaque resolved colour.
 *  - `color-mix(in srgb, var(--name) P%, transparent)`: that colour at P%
 *    alpha, composited against the theme's own `--surface-bg` — the ground
 *    the swatch is actually drawn on.
 *  - a hatch (`repeating-linear-gradient(...)`): the STROKE stop's colour —
 *    the first opaque `var(--name)` inside the gradient — not a stripe/gap
 *    average (see the module comment).
 *
 *  pattern: `"solid"` for a flat colour or a color-mix (both paint an even
 *  fill, differing only in density); `"hatch"` for a repeating gradient. */
function swatchInk(theme, tier) {
  const decl = backgroundDeclarationFor(tier);
  const pattern = patternOf(decl);

  if (decl.startsWith("color-mix(")) {
    const { name, pct } = colorMixParts(decl);
    const ground = resolvedOpaqueRgb(theme, "--surface-bg", null);
    const ink = resolvedOpaqueRgb(theme, name, ground);
    const alpha = pct / 100;
    return {
      rgb: [
        ink[0] * alpha + ground[0] * (1 - alpha),
        ink[1] * alpha + ground[1] * (1 - alpha),
        ink[2] * alpha + ground[2] * (1 - alpha),
      ],
      pattern,
    };
  }

  if (decl.startsWith("repeating-linear-gradient(")) {
    const strokeMatch =
      /var\(\s*(--[A-Za-z0-9-]+)\s*\)\s+[\d.]+(?:px|%)\s+[\d.]+(?:px|%)/.exec(
        decl,
      );
    const name = strokeMatch ? strokeMatch[1] : varNameIn(decl);
    return { rgb: resolvedOpaqueRgb(theme, name, null), pattern };
  }

  // Flat `background: var(--name)`.
  const name = varNameIn(decl);
  return { rgb: resolvedOpaqueRgb(theme, name, null), pattern };
}

module.exports = { swatchInk };
