// SPDX-License-Identifier: Apache-2.0
//
// Resolves the ACTUAL ink each AuthoritySwatch tier paints with, in a given
// theme, by reading AuthoritySwatch.module.css itself (so a future edit to
// the rule is what this measures, not a value this test invents) and
// resolving its declared colour through tokens.css's alias chain the same
// way vscodeThemes.resolvedOpaqueRgb does.
//
// Two shapes appear in AuthoritySwatch.module.css:
//   - a flat `background: var(--name)`                        (yours)
//   - `color-mix(in srgb, var(--name) P%, transparent)`        (locked)
//   - a `repeating-linear-gradient(..., var(--name) 0 Wpx, transparent ...)`
//     (unproven) — a hatch. It is measured at its STROKE colour (the
//     gradient's own opaque colour stop), not an average of stripe and gap:
//     a hatch is legible by its strokes, and averaging would score the
//     pattern as if it were a flat, diluted wash — which is exactly the
//     wrong answer for "can a reader see this at all" (the first test in
//     buildPlan.swatchContrast.test.js) and collapses it toward `locked`'s
//     own half-tone percentage for "can a reader tell these apart" (the
//     second test) instead of measuring the mark that is actually drawn.

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

/** The [r,g,b] a swatch tier actually paints with, in `theme`.
 *
 *  - flat `var(--name)`: the opaque resolved colour.
 *  - `color-mix(in srgb, var(--name) P%, transparent)`: that colour at P%
 *    alpha, composited against the theme's own `--surface-bg` — the ground
 *    the swatch is actually drawn on.
 *  - a hatch (`repeating-linear-gradient(...)`): the STROKE stop's colour —
 *    the first opaque `var(--name)` inside the gradient — not a stripe/gap
 *    average (see the module comment). */
function swatchInkRgb(theme, tier) {
  const decl = backgroundDeclarationFor(tier);

  if (decl.startsWith("color-mix(")) {
    const { name, pct } = colorMixParts(decl);
    const ground = resolvedOpaqueRgb(theme, "--surface-bg", null);
    const ink = resolvedOpaqueRgb(theme, name, ground);
    const alpha = pct / 100;
    return [
      ink[0] * alpha + ground[0] * (1 - alpha),
      ink[1] * alpha + ground[1] * (1 - alpha),
      ink[2] * alpha + ground[2] * (1 - alpha),
    ];
  }

  if (decl.startsWith("repeating-linear-gradient(")) {
    const strokeMatch =
      /var\(\s*(--[A-Za-z0-9-]+)\s*\)\s+[\d.]+(?:px|%)\s+[\d.]+(?:px|%)/.exec(
        decl,
      );
    const name = strokeMatch ? strokeMatch[1] : varNameIn(decl);
    return resolvedOpaqueRgb(theme, name, null);
  }

  // Flat `background: var(--name)`.
  const name = varNameIn(decl);
  return resolvedOpaqueRgb(theme, name, null);
}

module.exports = { swatchInkRgb };
