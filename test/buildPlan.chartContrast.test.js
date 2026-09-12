// SPDX-License-Identifier: Apache-2.0
//
// WCAG contrast for the Memory tab's chart — pinning the fixes from the
// Build Plan panel's colour-contrast audit (assessment §4) and its first
// review round, not re-deriving them from memory: every ratio below is
// computed from the CSS's OWN declared tokens (read straight out of
// tokens.css / MemoryChart.module.css / MemoryRegions.module.css), resolved
// to VS Code's canonical Dark+/Light+/High-Contrast-Dark/High-Contrast-Light
// registerColor() defaults, the same way `contrast.py` (the audit's
// verification script) did. If a future edit repoints one of these rules at
// an unsafe token, this recomputes and fails — it does not compare against a
// hardcoded "was" value.
//
// Defects pinned:
//   1. Every chart-series band/marker LABEL against its own series' 30%
//      band fill (was: the series colour on itself, failing in both themes
//      for all six series; now: --chart-label-fg, one token for all six).
//   2. --chart-3 is opaque in every default theme and separated from
//      --chart-5 (was: charts.orange, never opaque, both themes; round 1's
//      gitDecoration.modifiedResourceForeground was opaque but
//      extension-contributed AND too close in hue to --chart-5; now:
//      terminal.ansiCyan — core, opaque, ~145° from --chart-5's hue).
//   3. The pressed scale-toggle button's fill stays --accent (DESIGN.md's
//      Selected-Not-Suggested Rule; round 1's re-point to button.background
//      regressed High Contrast Dark, where button.background is pure black,
//      identical to the panel ground). --accent-fg's shortfall against
//      --accent in Dark+/Light+/HC Dark is NOT fixable without moving
//      --accent or using a bare literal (documented, not silently accepted);
//      HC Dark alone gets a scoped fix because its own panel ground happens
//      to be pure black.
//   4. The chart's meaning-bearing strokes (rail frame, tick, bracket)
//      against their backdrop (was: --border-default; now: --border-chart),
//      holding in all four default themes.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const SRC = path.join(__dirname, "..", "packages", "alp-webview", "src");
const TOKENS_CSS = fs.readFileSync(
  path.join(SRC, "styles", "tokens.css"),
  "utf8",
);
const CHART_CSS = fs.readFileSync(
  path.join(SRC, "features", "build-plan", "MemoryChart.module.css"),
  "utf8",
);
const REGIONS_CSS = fs.readFileSync(
  path.join(SRC, "features", "build-plan", "MemoryRegions.module.css"),
  "utf8",
);

// ---------------------------------------------------------------------------
// Colour math (ports contrast.py's maths verbatim — same formulas, same
// rounding behaviour, so a ratio computed here matches the audit's).
// ---------------------------------------------------------------------------

function parseColor(raw) {
  const value = raw.trim();
  if (value[0] === "#") {
    const h = value.slice(1);
    if (h.length === 6) {
      return [
        parseInt(h.slice(0, 2), 16),
        parseInt(h.slice(2, 4), 16),
        parseInt(h.slice(4, 6), 16),
        255,
      ];
    }
    if (h.length === 8) {
      return [
        parseInt(h.slice(0, 2), 16),
        parseInt(h.slice(2, 4), 16),
        parseInt(h.slice(4, 6), 16),
        parseInt(h.slice(6, 8), 16),
      ];
    }
    throw new Error(`unrecognised hex colour: ${raw}`);
  }
  const m =
    /rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*(?:,\s*([\d.]+))?\s*\)/.exec(
      value,
    );
  if (m) {
    const a = m[4] !== undefined ? parseFloat(m[4]) * 255 : 255;
    return [parseFloat(m[1]), parseFloat(m[2]), parseFloat(m[3]), a];
  }
  throw new Error(`unrecognised colour: ${raw}`);
}

/** Composite an (r,g,b,a 0-255) foreground over an OPAQUE (r,g,b) background. */
function composite(fgRgba, bgRgb) {
  const [r, g, b, a255] = fgRgba;
  const a = a255 / 255;
  const [br, bg, bb] = bgRgb;
  return [r * a + br * (1 - a), g * a + bg * (1 - a), b * a + bb * (1 - a)];
}

function relLum([r, g, b]) {
  const chan = (c) => {
    c = c / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * chan(r) + 0.7152 * chan(g) + 0.0722 * chan(b);
}

function contrast(rgb1, rgb2) {
  let l1 = relLum(rgb1);
  let l2 = relLum(rgb2);
  if (l1 < l2) [l1, l2] = [l2, l1];
  return (l1 + 0.05) / (l2 + 0.05);
}

/** Hue in degrees [0, 360) — standard RGB->HSL hue, no saturation/lightness
 * needed for a "how far apart on the wheel" check. */
function hueDegrees([r, g, b]) {
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const d = max - min;
  if (d === 0) return 0;
  let h;
  if (max === rn) h = ((gn - bn) / d) % 6;
  else if (max === gn) h = (bn - rn) / d + 2;
  else h = (rn - gn) / d + 4;
  h *= 60;
  if (h < 0) h += 360;
  return h;
}

function hueDelta(h1, h2) {
  const d = Math.abs(h1 - h2);
  return Math.min(d, 360 - d);
}

// ---------------------------------------------------------------------------
// VS Code canonical registerColor() defaults for Dark+, Light+, High Contrast
// Dark and High Contrast Light — for exactly the `--vscode-*` variables this
// file's tokens resolve to. Sourced the same way the audit was:
// microsoft/vscode's `src/vs/platform/theme/common/colors/*.ts` and
// `src/vs/workbench/contrib/terminal/common/terminalColorRegistry.ts`
// (fetched 2026-09-12), and — for the round-1 mistake this file still pins a
// regression test against — `extensions/git/package.json`'s
// `contributes.colors` defaults.
//
// `--vscode-descriptionForeground` is recorded with its REAL alpha
// (`transparent(foreground, 0.7)` in Dark+/HC Dark/HC Light; opaque only in
// Light+) rather than a pre-composited hex: callers must composite it
// themselves against whatever backdrop they are testing, the same way a real
// webview paints it. `resolvedOpaqueRgb` below does this.
// ---------------------------------------------------------------------------

const VSCODE_DEFAULTS = {
  dark: {
    "--vscode-foreground": "#CCCCCC",
    "--vscode-descriptionForeground": "#CCCCCCB3", // transparent(foreground, 0.7)
    "--vscode-focusBorder": "#007FD4",
    "--vscode-button-foreground": "#FFFFFF",
    "--vscode-input-background": "#3C3C3C",
    "--vscode-sideBar-background": "#252526",
    "--vscode-editorWarning-foreground": "#CCA700",
    "--vscode-editorError-foreground": "#F14C4C",
    "--vscode-charts-blue": "#59A4F9",
    "--vscode-charts-green": "#89D185",
    "--vscode-charts-yellow": "#CCA700",
    "--vscode-charts-red": "#F14C4C",
    "--vscode-charts-purple": "#B180D7",
    // charts.orange's OWN default chain (minimap.findMatchHighlight ->
    // editor.findMatchHighlightBackground) — VS Code documents this colour
    // as "must not be opaque". Recorded here (not just omitted) so a
    // regression back to `--vscode-charts-orange` fails with a real,
    // computed ratio instead of a missing-lookup error.
    "--vscode-charts-orange": "#EA5C0055",
    // Round 1's mistake: opaque, but extension-contributed (the Git
    // extension's package.json, not the core colour registry) and too close
    // in hue to --chart-5. Kept here so a regression back to it is caught
    // with real numbers, not a missing-lookup error.
    "--vscode-gitDecoration-modifiedResourceForeground": "#E2C08D",
    "--vscode-terminal-ansiCyan": "#11a8cd",
    "--vscode-tab-activeForeground": "#FFFFFF",
  },
  light: {
    "--vscode-foreground": "#616161",
    "--vscode-descriptionForeground": "#717171", // opaque in Light+ only
    "--vscode-focusBorder": "#0090F1",
    "--vscode-button-foreground": "#FFFFFF",
    "--vscode-input-background": "#FFFFFF",
    "--vscode-sideBar-background": "#F3F3F3",
    "--vscode-editorWarning-foreground": "#BF8803",
    "--vscode-editorError-foreground": "#E51400",
    "--vscode-charts-blue": "#0063D3",
    "--vscode-charts-green": "#388A34",
    "--vscode-charts-yellow": "#BF8803",
    "--vscode-charts-red": "#E51400",
    "--vscode-charts-purple": "#652D90",
    "--vscode-charts-orange": "#EA5C0055",
    "--vscode-gitDecoration-modifiedResourceForeground": "#895503",
    "--vscode-terminal-ansiCyan": "#0598bc",
    "--vscode-tab-activeForeground": "#333333",
  },
  hcDark: {
    "--vscode-foreground": "#FFFFFF",
    "--vscode-descriptionForeground": "#FFFFFFB3", // transparent(foreground, 0.7)
    "--vscode-focusBorder": "#F38518",
    "--vscode-button-foreground": "#FFFFFF",
    "--vscode-input-background": "#000000",
    "--vscode-sideBar-background": "#000000",
    "--vscode-editorWarning-foreground": "#FFD370",
    "--vscode-editorError-foreground": "#F48771",
    "--vscode-charts-blue": "#59a4f9",
    "--vscode-charts-green": "#89D185",
    "--vscode-charts-yellow": "#FFD370",
    "--vscode-charts-red": "#F48771",
    "--vscode-charts-purple": "#B180D7",
    "--vscode-terminal-ansiCyan": "#00cdcd",
    "--vscode-tab-activeForeground": "#FFFFFF",
  },
  hcLight: {
    "--vscode-foreground": "#292929",
    "--vscode-descriptionForeground": "#292929B3", // transparent(foreground, 0.7)
    "--vscode-focusBorder": "#006BBD",
    "--vscode-button-foreground": "#FFFFFF",
    "--vscode-input-background": "#FFFFFF",
    "--vscode-sideBar-background": "#FFFFFF",
    "--vscode-editorWarning-foreground": "#895503",
    "--vscode-editorError-foreground": "#B5200D",
    "--vscode-charts-blue": "#0063d3",
    "--vscode-charts-green": "#374e06",
    "--vscode-charts-yellow": "#895503",
    "--vscode-charts-red": "#B5200D",
    "--vscode-charts-purple": "#652D90",
    "--vscode-terminal-ansiCyan": "#0598bc",
    "--vscode-tab-activeForeground": "#292929",
  },
};

const THEMES = ["dark", "light", "hcDark", "hcLight"];

// ---------------------------------------------------------------------------
// tokens.css alias resolution — follows a `--name` through as many `var()`
// hops as tokens.css declares, down to the `--vscode-*` root, the same
// indirection a real webview resolves at paint time.
// ---------------------------------------------------------------------------

/** The declared value of `--name` in `tokensCss`, balanced-paren aware so a
 * multi-line `var(\n  --a,\n  var(--b)\n)` comes out whole. */
function declarationValue(tokensCss, name) {
  const re = new RegExp(`(^|[\\s;{])${name}(?![\\w-])\\s*:\\s*`, "m");
  const m = re.exec(tokensCss);
  if (!m) return null;
  let i = m.index + m[0].length;
  let depth = 0;
  let out = "";
  for (; i < tokensCss.length; i++) {
    const c = tokensCss[i];
    if (c === "(") depth++;
    if (c === ")") depth--;
    if (c === ";" && depth === 0) break;
    out += c;
  }
  return out.trim();
}

function firstVarName(value) {
  const m = /var\(\s*(--[A-Za-z0-9-]+)/.exec(value);
  return m ? m[1] : null;
}

/** Resolve a `--name` (declared in tokens.css, or already a `--vscode-*`
 * name) down to the `--vscode-*` root it ultimately reads. */
function resolveToVscodeVar(tokensCss, name, seen = new Set()) {
  if (name.startsWith("--vscode-")) return name;
  if (seen.has(name)) {
    throw new Error(`cycle resolving ${name}: ${[...seen].join(" -> ")}`);
  }
  seen.add(name);
  const decl = declarationValue(tokensCss, name);
  if (decl === null) {
    throw new Error(`\`${name}\` is not declared in tokens.css`);
  }
  const next = firstVarName(decl);
  if (!next) {
    throw new Error(`\`${name}\` declares \`${decl}\` — no var() to follow`);
  }
  return resolveToVscodeVar(tokensCss, next, seen);
}

/** The canonical [r,g,b,a] this `--name` resolves to in `theme`, following
 * tokens.css's own alias chain — not a value this test invents. May carry
 * real alpha (`--vscode-descriptionForeground` does, in three of four
 * themes) — composite with `resolvedOpaqueRgb` before comparing colours. */
function resolvedRgba(theme, name) {
  const vscodeName = name.startsWith("--vscode-")
    ? name
    : resolveToVscodeVar(TOKENS_CSS, name);
  const hex = VSCODE_DEFAULTS[theme][vscodeName];
  if (!hex) {
    throw new Error(
      `no canonical default recorded for \`${vscodeName}\` ` +
        `(resolved from \`${name}\`, theme ${theme})`,
    );
  }
  return parseColor(hex);
}

/** The opaque [r,g,b] `--name` paints as, in `theme`, over `backdropRgb`.
 * A translucent resolution (descriptionForeground) is composited against the
 * backdrop it is actually drawn on, matching real rendering; an opaque one
 * ignores the backdrop entirely. */
function resolvedOpaqueRgb(theme, name, backdropRgb) {
  const rgba = resolvedRgba(theme, name);
  if (rgba[3] === 255) return rgba.slice(0, 3);
  if (!backdropRgb) {
    throw new Error(`\`${name}\` is translucent in ${theme} — pass a backdrop`);
  }
  return composite(rgba, backdropRgb);
}

// ---------------------------------------------------------------------------
// Reading the ACTUAL rules out of the component CSS — the test fails on a
// future edit to any of these selectors, not only on a change to tokens.css.
// ---------------------------------------------------------------------------

function escapeForRegExp(literal) {
  return literal.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** The `{ token, pct }` a `.band[data-series="N"]`/`.budget[data-series="N"]`
 * rule fills with, read out of MemoryChart.module.css. */
function bandFillFor(n) {
  const re = new RegExp(
    `\\.band\\[data-series="${n}"\\][^{]*\\{[^}]*fill:\\s*color-mix\\(in srgb,\\s*var\\((--chart-${n})\\)\\s*(\\d+)%`,
  );
  const m = re.exec(CHART_CSS);
  if (!m) {
    throw new Error(`could not find the band fill rule for series ${n}`);
  }
  return { token: m[1], pct: parseInt(m[2], 10) };
}

/** The token `.markerLabel, .bandLabel { fill: ... }` uses, read out of
 * MemoryChart.module.css — the ONE rule all six series' labels now share. */
function labelFillToken() {
  const re = /\.markerLabel,\s*\.bandLabel\s*\{[^}]*fill:\s*var\((--[\w-]+)/;
  const m = re.exec(CHART_CSS);
  if (!m) {
    throw new Error("could not find the consolidated label fill rule");
  }
  return m[1];
}

/** The token a bare `selector { stroke: var(...) }` rule uses. */
function strokeTokenFor(selector) {
  const re = new RegExp(
    `${escapeForRegExp(selector)}\\s*\\{[^}]*stroke:\\s*var\\((--[\\w-]+)`,
  );
  const m = re.exec(CHART_CSS);
  if (!m) throw new Error(`could not find a stroke rule for ${selector}`);
  return m[1];
}

/** `{ bg, fg }` tokens for `.scaleBtn[aria-pressed="true"] { ... }` (NOT its
 * `:focus-visible` sibling or the HC-Dark-scoped override), read out of
 * MemoryRegions.module.css. */
function pressedButtonTokens() {
  const re = /(?:^|\n)\.scaleBtn\[aria-pressed="true"\]\s*\{([^}]*)\}/;
  const m = re.exec(REGIONS_CSS);
  if (!m) throw new Error("pressed .scaleBtn rule not found");
  const bg = /background:\s*var\((--[\w-]+)/.exec(m[1]);
  const fg = /color:\s*var\((--[\w-]+)/.exec(m[1]);
  if (!bg || !fg) {
    throw new Error("pressed .scaleBtn rule is missing background/color var()");
  }
  return { bg: bg[1], fg: fg[1] };
}

/** The `outline-color` token for the pressed button's own `:focus-visible`. */
function pressedFocusRingToken() {
  const re = /\.scaleBtn\[aria-pressed="true"\]:focus-visible\s*\{([^}]*)\}/;
  const m = re.exec(REGIONS_CSS);
  if (!m) throw new Error("pressed .scaleBtn:focus-visible rule not found");
  const oc = /outline-color:\s*var\((--[\w-]+)/.exec(m[1]);
  if (!oc) throw new Error("outline-color var() not found");
  return oc[1];
}

/** The `color` token the HC-Dark-scoped override paints the pressed button's
 * text with (`body.vscode-high-contrast .scaleBtn[aria-pressed="true"]`). */
function hcDarkPressedTextToken() {
  const re =
    /body\.vscode-high-contrast\s+\.scaleBtn\[aria-pressed="true"\]\s*\{([^}]*)\}/;
  const m = re.exec(REGIONS_CSS);
  if (!m) throw new Error("HC-Dark pressed-text override rule not found");
  const c = /color:\s*var\((--[\w-]+)/.exec(m[1]);
  if (!c) throw new Error("HC-Dark override has no color var()");
  return c[1];
}

/** The literal hex a `var(--name, #literal)` declaration falls back to. */
function fallbackHexFor(name) {
  const decl = declarationValue(TOKENS_CSS, name);
  if (decl === null)
    throw new Error(`\`${name}\` is not declared in tokens.css`);
  const m = /,\s*(#[0-9A-Fa-f]{3,8})\s*\)/.exec(decl);
  if (!m) throw new Error(`\`${name}\` has no var() fallback literal: ${decl}`);
  return m[1];
}

// ---------------------------------------------------------------------------
// Defect 1 — every chart-series label against its OWN series' 30% band fill.
// ---------------------------------------------------------------------------

test("every chart-series band/marker label clears 4.5:1 against its own series' band fill", () => {
  const labelToken = labelFillToken();
  for (const theme of THEMES) {
    const surfaceInput = resolvedOpaqueRgb(theme, "--surface-input", null);
    const labelRgb = resolvedOpaqueRgb(theme, labelToken, surfaceInput);
    for (let n = 1; n <= 6; n++) {
      const { token, pct } = bandFillFor(n);
      const seriesRgb = resolvedOpaqueRgb(theme, token, surfaceInput);
      const tint = composite([...seriesRgb, (pct / 100) * 255], surfaceInput);
      const ratio = contrast(labelRgb, tint);
      assert.ok(
        ratio >= 4.5,
        `series ${n} label (${labelToken}) vs its own ${pct}% band fill in ` +
          `${theme}: ${ratio.toFixed(2)}:1, need >= 4.5:1`,
      );
    }
  }
});

test("the label no longer inherits the series colour (one shared token, not six)", () => {
  const labelToken = labelFillToken();
  for (let n = 1; n <= 6; n++) {
    assert.notEqual(
      labelToken,
      `--chart-${n}`,
      "the band/marker label must not fill with its own series token — " +
        "that pairing is what failed 4.5:1 against its own tint",
    );
  }
});

test("no per-series override re-appears on the band/marker label", () => {
  const re = /\.(?:bandLabel|markerLabel)\[data-series="\d+"\]\s*\{[^}]*fill:/;
  assert.equal(
    re.test(CHART_CSS),
    false,
    "a per-series override on .bandLabel/.markerLabel's fill reintroduces " +
      "the label-inherits-the-series-colour pairing that failed 4.5:1 " +
      "against its own band fill for all six series",
  );
});

test("no data-series attribute survives on a label element (dead since the label fill stopped varying by series)", () => {
  const CHART_TSX = fs.readFileSync(
    path.join(SRC, "features", "build-plan", "MemoryChart.tsx"),
    "utf8",
  );
  // A `<text className={... bandLabel ...} data-series=...>` (or
  // markerLabel) would be a CSS consumer with nothing left to consume it.
  const re =
    /<text[^>]*className=\{[^}]*(?:bandLabel|markerLabel)[^}]*\}[^>]*data-series=/;
  assert.equal(
    re.test(CHART_TSX),
    false,
    "a label <text> element still carries data-series, but no CSS rule " +
      "selects .bandLabel[data-series=...]/.markerLabel[data-series=...] " +
      "any more — dead markup",
  );
});

// ---------------------------------------------------------------------------
// Defect 2 — --chart-3 is opaque, core-registered, and separated from
// --chart-5 in every default theme.
// ---------------------------------------------------------------------------

test("--chart-3 is fully opaque in every default theme", () => {
  for (const theme of THEMES) {
    const [, , , alpha] = resolvedRgba(theme, "--chart-3");
    assert.equal(
      alpha,
      255,
      `--chart-3 resolved to a translucent colour in ${theme} (alpha ` +
        `${alpha}/255)`,
    );
  }
});

test("--chart-3 reads clearly against the rail (input.background) in every default theme", () => {
  // Non-text (>=3:1): post-consolidation, --chart-3 paints a band fill and a
  // 1px stroke, never text (see defect 1) — 4.5:1 would over-grade a mark.
  for (const theme of THEMES) {
    const chart3 = resolvedOpaqueRgb(theme, "--chart-3", null);
    const surfaceInput = resolvedOpaqueRgb(theme, "--surface-input", null);
    const ratio = contrast(chart3, surfaceInput);
    assert.ok(
      ratio >= 3,
      `--chart-3 vs --surface-input in ${theme}: ${ratio.toFixed(2)}:1, ` +
        "need >= 3:1",
    );
  }
});

test("--chart-3 is not the translucent charts.orange chain", () => {
  const resolved = resolveToVscodeVar(TOKENS_CSS, "--chart-3");
  assert.notEqual(
    resolved,
    "--vscode-charts-orange",
    "charts.orange's own default (minimap.findMatchHighlight -> " +
      "editor.findMatchHighlightBackground) is documented by VS Code as " +
      "never opaque",
  );
});

test("--chart-3 is not the extension-contributed gitDecoration token", () => {
  const resolved = resolveToVscodeVar(TOKENS_CSS, "--chart-3");
  assert.notEqual(
    resolved,
    "--vscode-gitDecoration-modifiedResourceForeground",
    "gitDecoration.modifiedResourceForeground is contributed by the Git " +
      "extension, not the core colour registry — it vanishes if Git is " +
      "ever disabled, and this specific value collides in hue with " +
      "--chart-5",
  );
});

test("--chart-3 is separated from --chart-5 by hue in Dark+ and Light+", () => {
  // Hue delta, not a raw WCAG swatch-to-swatch contrast: the six-series
  // palette is a categorical hue scheme (its own EXISTING pairs already sit
  // as low as ~1.1:1 raw contrast — 1-vs-5 in Dark+, 2-vs-6 in Light+ — and
  // are not defects), so hue proximity is what the audit actually flagged.
  // Threshold 15°: comfortably below every surviving pair's smallest gap
  // (~20°, chart-1 vs chart-3 itself) and comfortably above round 1's actual
  // collision (chart-3 vs chart-5: ~13° Dark+, ~6° Light+).
  for (const theme of ["dark", "light"]) {
    const c3 = resolvedOpaqueRgb(theme, "--chart-3", null);
    const c5 = resolvedOpaqueRgb(theme, "--chart-5", null);
    const delta = hueDelta(hueDegrees(c3), hueDegrees(c5));
    assert.ok(
      delta >= 15,
      `--chart-3 vs --chart-5 hue delta in ${theme}: ${delta.toFixed(1)}°, ` +
        "need >= 15°",
    );
  }
});

test("--chart-3's fallback literal is held to the same bar as the variable", () => {
  const fallback = fallbackHexFor("--chart-3");
  const rgba = parseColor(fallback);
  assert.equal(
    rgba[3],
    255,
    `--chart-3's var() fallback ${fallback} must be opaque too`,
  );
  for (const theme of ["dark", "light"]) {
    const surfaceInput = resolvedOpaqueRgb(theme, "--surface-input", null);
    const ratio = contrast(rgba.slice(0, 3), surfaceInput);
    assert.ok(
      ratio >= 3,
      `--chart-3's fallback ${fallback} vs --surface-input in ${theme}: ` +
        `${ratio.toFixed(2)}:1, need >= 3:1`,
    );
  }
});

// ---------------------------------------------------------------------------
// Defect 3 — the pressed scale-toggle button stays on --accent (user
// decision); --accent-fg's remaining shortfall is documented, not hidden;
// High Contrast Dark gets a scoped fix; the focus ring holds in all four.
// ---------------------------------------------------------------------------

test("the pressed scale-toggle button's fill is --accent (DESIGN.md's Selected-Not-Suggested Rule)", () => {
  const { bg, fg } = pressedButtonTokens();
  assert.equal(
    bg,
    "--accent",
    "the pressed/selected scale-toggle marks 'currently selected', which " +
      "DESIGN.md reserves --accent for; button.background regressed High " +
      "Contrast Dark (pure black there, identical to the panel ground)",
  );
  assert.equal(fg, "--accent-fg");
});

test("--accent-fg vs --accent: the known, documented shortfall in three themes, a pass in the fourth", () => {
  const { bg, fg } = pressedButtonTokens();
  // Pinned to two decimal places: if this ever changes, it is because a
  // token moved, and the new number must be re-justified in the comment
  // above this rule in MemoryRegions.module.css, not silently absorbed here.
  const expected = { dark: 4.21, light: 3.35, hcDark: 2.57, hcLight: 5.47 };
  for (const theme of THEMES) {
    const bgRgb = resolvedOpaqueRgb(theme, bg, null);
    const fgRgb = resolvedOpaqueRgb(theme, fg, null);
    const ratio = contrast(fgRgb, bgRgb);
    assert.equal(
      ratio.toFixed(2),
      expected[theme].toFixed(2),
      `pressed .scaleBtn text (${fg}) vs its fill (${bg}) in ${theme} moved ` +
        `to ${ratio.toFixed(2)}:1 (was ${expected[theme]}:1) — update the ` +
        "reasoning in MemoryRegions.module.css, then this number",
    );
  }
  assert.ok(
    contrast(
      resolvedOpaqueRgb("hcLight", fg, null),
      resolvedOpaqueRgb("hcLight", bg, null),
    ) >= 4.5,
    "High Contrast Light must still clear 4.5:1 unaided — it is the one " +
      "theme where focusBorder is dark enough for --accent-fg to read",
  );
});

test("High Contrast Dark gets a scoped text override that actually clears 4.5:1", () => {
  const { bg } = pressedButtonTokens();
  const hcDarkToken = hcDarkPressedTextToken();
  const textRgb = resolvedOpaqueRgb("hcDark", hcDarkToken, null);
  const bgRgb = resolvedOpaqueRgb("hcDark", bg, null);
  const ratio = contrast(textRgb, bgRgb);
  assert.ok(
    ratio >= 4.5,
    `HC-Dark override text (${hcDarkToken}) vs --accent in hcDark: ` +
      `${ratio.toFixed(2)}:1, need >= 4.5:1`,
  );
});

test("the pressed scale-toggle button's own focus ring clears 3:1 against --accent in every default theme", () => {
  const { bg } = pressedButtonTokens();
  const ringToken = pressedFocusRingToken();
  for (const theme of THEMES) {
    const bgRgb = resolvedOpaqueRgb(theme, bg, null);
    const ringRgb = resolvedOpaqueRgb(theme, ringToken, null);
    const ratio = contrast(ringRgb, bgRgb);
    assert.ok(
      ratio >= 3,
      `pressed .scaleBtn focus ring (${ringToken}) vs its fill (${bg}) in ` +
        `${theme}: ${ratio.toFixed(2)}:1, need >= 3:1`,
    );
  }
});

// ---------------------------------------------------------------------------
// Defect 4 — the chart's meaning-bearing strokes (rail frame, tick, bracket).
// ---------------------------------------------------------------------------

test("the rail frame, the axis ticks and the inter-rail bracket use a stroke token that clears 3:1 in every default theme", () => {
  for (const selector of [".railFrame", ".tick", ".bracket"]) {
    const token = strokeTokenFor(selector);
    assert.notEqual(
      token,
      "--border-default",
      `${selector}'s stroke is meaning-bearing, not decorative — it must ` +
        "not use --border-default",
    );
    for (const theme of THEMES) {
      const surfaceBg = resolvedOpaqueRgb(theme, "--surface-bg", null);
      const surfaceInput = resolvedOpaqueRgb(theme, "--surface-input", null);
      const strokeVsBg = resolvedOpaqueRgb(theme, token, surfaceBg);
      const strokeVsInput = resolvedOpaqueRgb(theme, token, surfaceInput);
      const ratioBg = contrast(strokeVsBg, surfaceBg);
      const ratioInput = contrast(strokeVsInput, surfaceInput);
      assert.ok(
        ratioBg >= 3,
        `${selector} stroke (${token}) vs --surface-bg in ${theme}: ` +
          `${ratioBg.toFixed(2)}:1, need >= 3:1`,
      );
      assert.ok(
        ratioInput >= 3,
        `${selector} stroke (${token}) vs --surface-input in ${theme}: ` +
          `${ratioInput.toFixed(2)}:1, need >= 3:1`,
      );
    }
  }
});

test("the region-frame rule (out of scope) still strokes with --border-default", () => {
  // Pins that the fix did NOT blanket-replace every --border-default use:
  // the region-frame authority encoding is being deleted by a separate
  // redesign and must be left untouched here.
  const re = /\.regionFrame\s*\{[^}]*stroke:\s*var\((--[\w-]+)/;
  const m = re.exec(CHART_CSS);
  assert.ok(m, ".regionFrame base rule not found");
  assert.equal(
    m[1],
    "--border-default",
    ".regionFrame's own stroke must stay --border-default — it is out of " +
      "scope for this fix",
  );
});

// ---------------------------------------------------------------------------
// Palette-wide — pairwise hue separation, so a future edit cannot reintroduce
// a chart-3-vs-chart-5-shaped collision anywhere else in the six.
// ---------------------------------------------------------------------------

test("every pair of the six chart-series colours is separated by hue in Dark+ and Light+", () => {
  for (const theme of ["dark", "light"]) {
    const rgbs = {};
    for (let n = 1; n <= 6; n++) {
      rgbs[n] = resolvedOpaqueRgb(theme, `--chart-${n}`, null);
    }
    for (let i = 1; i <= 6; i++) {
      for (let j = i + 1; j <= 6; j++) {
        const delta = hueDelta(hueDegrees(rgbs[i]), hueDegrees(rgbs[j]));
        assert.ok(
          delta >= 15,
          `chart-${i} vs chart-${j} hue delta in ${theme}: ` +
            `${delta.toFixed(1)}°, need >= 15°`,
        );
      }
    }
  }
});

// ---------------------------------------------------------------------------
// Self-checks — pin every way this file's own scan could go quiet.
// ---------------------------------------------------------------------------

test("the resolver actually follows multi-hop aliases", () => {
  // --border-chart -> --text-secondary -> --vscode-descriptionForeground.
  const resolved = resolveToVscodeVar(TOKENS_CSS, "--border-chart");
  assert.equal(resolved, "--vscode-descriptionForeground");
});

test("descriptionForeground's real alpha is exercised, not silently opaque", () => {
  // If this ever stops being translucent in Dark+, resolvedOpaqueRgb's
  // composite branch for --border-chart goes untested by every arm above.
  const [, , , alpha] = resolvedRgba("dark", "--border-chart");
  assert.ok(
    alpha < 255,
    "descriptionForeground is expected translucent in Dark+ " +
      "(transparent(foreground, 0.7)) — if VS Code made it opaque, the " +
      "composite path this file relies on is no longer real",
  );
});

test("an unsafe pairing is still caught (the gate is not vacuously true)", () => {
  // The OLD, broken pairing: the series colour on its own 30% fill. If this
  // stopped failing, the arm above would be checking nothing.
  const surfaceInputDark = resolvedOpaqueRgb("dark", "--surface-input", null);
  const chart1Dark = resolvedOpaqueRgb("dark", "--chart-1", null);
  const oldTint = composite([...chart1Dark, 0.3 * 255], surfaceInputDark);
  const oldRatio = contrast(chart1Dark, oldTint);
  assert.ok(
    oldRatio < 4.5,
    "the old self-fill pairing no longer fails — this arm's threshold check " +
      "would pass no matter what was fixed",
  );
});

test("round 1's actual chart-3/chart-5 collision is still caught by the hue-delta arm", () => {
  const oldChart3 = { dark: "#E2C08D", light: "#895503" };
  for (const theme of ["dark", "light"]) {
    const oldC3 = parseColor(oldChart3[theme]).slice(0, 3);
    const c5 = resolvedOpaqueRgb(theme, "--chart-5", null);
    const delta = hueDelta(hueDegrees(oldC3), hueDegrees(c5));
    assert.ok(
      delta < 15,
      `round 1's chart-3 vs chart-5 hue delta in ${theme} is ${delta.toFixed(1)}° ` +
        "— if this stopped being < 15°, the hue-delta arm's threshold is " +
        "not actually calibrated against the real regression it exists to catch",
    );
  }
});
