// SPDX-License-Identifier: Apache-2.0
//
// Resolves what each memory-map authority gutter tier actually paints, in a
// given theme — the SVG analogue of swatchInk.js's swatch reading. The
// gutter (MemoryChart.module.css's `.gutter[data-tier="…"]`) and the swatch
// (AuthoritySwatch.module.css's `.swatch[data-tier="…"]`) share the exact
// same three-tier vocabulary and are held to the exact same numbers — this
// file reuses swatchInk.js's own `varNameIn`/`compositeColorMix` rather than
// re-deriving them, so the two readers can never drift apart from each
// other's parsing.
//
// Two shapes differ from the swatch's own CSS, because SVG `fill` is not
// `background`:
//   - "yours"/"locked" are flat `fill: var(--name)` and
//     `fill: color-mix(in srgb, var(--name) P%, transparent)` — read exactly
//     like the swatch's own `background` declarations of the same shape.
//   - "unproven" is `fill: url(#memory-authority-hatch)`, a reference to a
//     `<pattern>` MemoryChart.tsx defines once in `<defs>` — SVG has no
//     `repeating-linear-gradient()` fill, so the hatch itself is markup, not
//     CSS, and only its stroke's colour (`.hatchStroke`) lives in the
//     stylesheet this file reads.

const fs = require("node:fs");
const path = require("node:path");
const { resolvedOpaqueRgb } = require("./vscodeThemes");
const { varNameIn, compositeColorMix } = require("./swatchInk");

const CHART_CSS_PATH = path.join(
  __dirname,
  "..",
  "..",
  "packages",
  "alp-webview",
  "src",
  "features",
  "build-plan",
  "MemoryChart.module.css",
);
const CHART_CSS = fs.readFileSync(CHART_CSS_PATH, "utf8");

/** The declared `property` value for `selector { ... }`, paren-balanced —
 * the same walk swatchInk.js's `backgroundDeclarationFor` does, generalised
 * to an arbitrary selector and property so it can read `.gutter`'s `fill:`
 * and `.hatchStroke`'s `fill:` from the same file with one function. */
function declarationFor(selector, property) {
  const escaped = selector.replace(/[.[\]="]/g, "\\$&");
  const re = new RegExp(`${escaped}\\s*\\{[^}]*?${property}:\\s*`);
  const m = re.exec(CHART_CSS);
  if (!m) {
    throw new Error(`could not find ${selector}'s ${property} rule`);
  }
  let i = m.index + m[0].length;
  let depth = 0;
  let out = "";
  for (; i < CHART_CSS.length; i++) {
    const c = CHART_CSS[i];
    if (c === "(") depth++;
    if (c === ")") depth--;
    if (c === ";" && depth === 0) break;
    out += c;
  }
  return out.trim();
}

/** `{ rgb, pattern }` — what the gutter's `data-tier="tier"` fill actually
 * paints with, in `theme`. `pattern` is `"solid"` for a flat colour or a
 * `color-mix(...)`, and `"hatch"` only for the `url(#...)` tier — the gutter
 * declares no all-opaque gradient the way a swatch theoretically could, so
 * there is no ambiguous case to resolve from the stops themselves here. */
function gutterInk(theme, tier) {
  const decl = declarationFor(`.gutter[data-tier="${tier}"]`, "fill");

  if (decl.startsWith("url(")) {
    // A hatch: the pattern itself is markup (MemoryChart.tsx's <defs>), so
    // its stroke's OWN CSS rule — the one colour this stylesheet actually
    // controls — is what gets measured.
    const strokeDecl = declarationFor(".hatchStroke", "fill");
    if (strokeDecl.startsWith("color-mix(")) {
      return { rgb: compositeColorMix(theme, strokeDecl), pattern: "hatch" };
    }
    return {
      rgb: resolvedOpaqueRgb(theme, varNameIn(strokeDecl), null),
      pattern: "hatch",
    };
  }

  if (decl.startsWith("color-mix(")) {
    return { rgb: compositeColorMix(theme, decl), pattern: "solid" };
  }

  return {
    rgb: resolvedOpaqueRgb(theme, varNameIn(decl), null),
    pattern: "solid",
  };
}

module.exports = { gutterInk };
