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
//     gradient's own first colour-stop expression), not an average of
//     stripe and gap: a hatch is legible by its strokes, and averaging would
//     score the pattern as if it were a flat, diluted wash. The stroke's OWN
//     colour expression can be a bare `var(--name)` OR a `color-mix(...)` —
//     an alpha-reduced stroke is composited at the alpha it actually paints,
//     never read as if it were opaque.
//
// "hatch" is decided from the STOPS themselves, not from the function name:
// a `repeating-linear-gradient(...)` whose stops are all opaque colours (no
// stop is the bare keyword `transparent`) paints a flat fill indistinguishable
// from `yours`, and must report "solid" so the pairwise ink check still runs.

const fs = require("node:fs");
const path = require("node:path");
const { resolvedOpaqueRgb } = require("./vscodeThemes");

const SWATCH_CSS_PATH = path.join(
  __dirname,
  "..",
  "..",
  "packages",
  "alp-webview",
  "src",
  "features",
  "build-plan",
  "AuthoritySwatch.module.css",
);
const SWATCH_CSS = fs.readFileSync(SWATCH_CSS_PATH, "utf8");

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

/** `[r,g,b]` for a `color-mix(in srgb, var(--name) P%, transparent)`
 * expression, composited at its own P% alpha against `theme`'s own
 * `--surface-bg` — the ground every swatch actually paints on. Shared by the
 * `locked` tier's whole background AND by an alpha-reduced hatch stroke, so
 * an alpha-reduced stroke is measured at the alpha it paints, not at full
 * strength. */
function compositeColorMix(theme, mixExpr) {
  const { name, pct } = colorMixParts(mixExpr);
  const ground = resolvedOpaqueRgb(theme, "--surface-bg", null);
  const ink = resolvedOpaqueRgb(theme, name, ground);
  const alpha = pct / 100;
  return [
    ink[0] * alpha + ground[0] * (1 - alpha),
    ink[1] * alpha + ground[1] * (1 - alpha),
    ink[2] * alpha + ground[2] * (1 - alpha),
  ];
}

/** The top-level, comma-separated arguments of a `func(...)` CSS value —
 * paren-balanced, so a nested `color-mix(a, b, c)`'s own commas do not split
 * a `repeating-linear-gradient(...)`'s stop list early. */
function functionArgs(value) {
  const start = value.indexOf("(");
  const end = value.lastIndexOf(")");
  if (start === -1 || end === -1 || end < start) {
    throw new Error(`not a function(...) value: ${value}`);
  }
  const inner = value.slice(start + 1, end);
  const args = [];
  let depth = 0;
  let current = "";
  for (const ch of inner) {
    if (ch === "(") depth++;
    if (ch === ")") depth--;
    if (ch === "," && depth === 0) {
      args.push(current.trim());
      current = "";
    } else {
      current += ch;
    }
  }
  if (current.trim() !== "") args.push(current.trim());
  return args;
}

/** The colour-expression prefix of a gradient colour-stop string, e.g.
 * `"var(--text-primary) 0 2px"` -> `"var(--text-primary)"`, or
 * `"color-mix(in srgb, var(--text-primary) 15%, transparent) 0 2px"` ->
 * the whole `color-mix(...)` — paren-balanced, so a color-mix's own commas
 * and percentages are never mistaken for the stop's trailing length list. */
function colorExprOf(stop) {
  let depth = 0;
  for (let i = 0; i < stop.length; i++) {
    const c = stop[i];
    if (c === "(") depth++;
    if (c === ")") {
      depth--;
      if (depth === 0) return stop.slice(0, i + 1).trim();
    }
  }
  throw new Error(`could not find a colour expression in stop: ${stop}`);
}

/** `"solid" | "hatch"`, read off the gradient's OWN colour stops — NOT off
 * the function name and NOT a hardcoded tier -> pattern table. A
 * `repeating-linear-gradient(...)` is a hatch only when at least one of its
 * stops is the bare keyword `transparent`: that is what actually lets the
 * panel ground show through in alternating bands. A gradient whose stops are
 * all opaque/translucent colour expressions (no bare `transparent` stop)
 * paints an even fill with no gap — visually a solid swatch — and must
 * report "solid" so the pairwise ink check still runs on it. */
function patternOf(decl) {
  if (!decl.startsWith("repeating-linear-gradient(")) return "solid";
  const stops = functionArgs(decl).slice(1); // drop the angle argument
  const hasGapStop = stops.some((stop) => /^transparent(\s|$)/.test(stop));
  return hasGapStop ? "hatch" : "solid";
}

/** `{ rgb, pattern }` — what a swatch tier actually paints with, in `theme`.
 *
 *  rgb:
 *  - flat `var(--name)`: the opaque resolved colour.
 *  - `color-mix(in srgb, var(--name) P%, transparent)`: composited per
 *    `compositeColorMix`.
 *  - a hatch (`repeating-linear-gradient(...)`): its first colour stop's own
 *    expression, resolved the same way as any other declaration (flat or
 *    `color-mix`) — never a stripe/gap average, and never read as opaque
 *    when the stop itself declares an alpha reduction.
 *
 *  pattern: from `patternOf` — `"hatch"` only when a stop is genuinely
 *  `transparent`; `"solid"` otherwise, including a color-mix and an
 *  all-opaque repeating gradient alike. */
function swatchInk(theme, tier) {
  const decl = backgroundDeclarationFor(tier);
  const pattern = patternOf(decl);

  if (decl.startsWith("color-mix(")) {
    return { rgb: compositeColorMix(theme, decl), pattern };
  }

  if (decl.startsWith("repeating-linear-gradient(")) {
    const stops = functionArgs(decl).slice(1);
    if (stops.length === 0) {
      throw new Error(`repeating-linear-gradient has no colour stops: ${decl}`);
    }
    // The stroke is whichever stop is not the bare `transparent` gap — for
    // every tier this file currently declares that is the first stop, but
    // this does not assume stop ORDER, only that exactly one stop is real
    // ink when the pattern is a hatch, and the first stop otherwise.
    const strokeStop =
      stops.find((stop) => !/^transparent(\s|$)/.test(stop)) ?? stops[0];
    const strokeExpr = colorExprOf(strokeStop);
    if (strokeExpr.startsWith("color-mix(")) {
      return { rgb: compositeColorMix(theme, strokeExpr), pattern };
    }
    if (strokeExpr.startsWith("var(")) {
      return {
        rgb: resolvedOpaqueRgb(theme, varNameIn(strokeExpr), null),
        pattern,
      };
    }
    // Neither shape this module declares — stop and say so rather than
    // guessing at the first var() anywhere in the whole declaration (that
    // guess is what silently over-measured an alpha-reduced stroke before).
    throw new Error(
      `could not read the gradient's stroke stop (unrecognised colour ` +
        `expression "${strokeExpr}") in: ${decl}`,
    );
  }

  // Flat `background: var(--name)`.
  const name = varNameIn(decl);
  return { rgb: resolvedOpaqueRgb(theme, name, null), pattern };
}

module.exports = {
  swatchInk,
  // Exported for gutterInk.js (the memory chart's authority gutter, which
  // reads `fill:` off a different stylesheet rather than `background:` off
  // this one) to reuse rather than re-derive: the gutter and the swatch use
  // the exact same two colour shapes, and a second hand-written regex is how
  // the two would silently drift apart the first time either file's syntax
  // changed.
  varNameIn,
  compositeColorMix,
};
