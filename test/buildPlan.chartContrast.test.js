// SPDX-License-Identifier: Apache-2.0
//
// WCAG contrast for the Memory tab's chart — pinning the fixes from the
// Build Plan panel's colour-contrast audit (assessment §4) and two review
// rounds, not re-deriving them from memory: every ratio below is computed
// from the CSS's OWN declared tokens (read straight out of tokens.css /
// MemoryChart.module.css / Button.module.css — and, for the accent button's
// `[data-tier]` survival, the BUILT dist/main.css, since a CSS Modules class
// is hashed and only the built artifact can tell a working selector from
// dead markup), resolved to VS Code's canonical Dark+/Light+/High-Contrast-
// Dark/High-Contrast-Light registerColor() defaults plus one real shipping
// default (2026 Dark, which has a TRANSLUCENT focusBorder — the other four
// themes' is opaque). If a future edit repoints one of these rules at an
// unsafe token, this recomputes and fails — it does not compare against a
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
//   3. --accent-fg (white) vs --accent: six real/current themes pass;
//      Dark+/Light+ are an accepted, declined shortfall pinned exactly (the
//      round-4 record from the pressed scale-toggle button audit).
//   4. The chart's meaning-bearing strokes (rail frame, tick, the computed-
//      mark tick) against their backdrop (was: --border-default; now
//      --border-chart, or, for a DECLARED axis boundary, --text-primary),
//      holding in every theme this file tests.
//
// RETIRED, #484 phase 4: the pressed scale-toggle button (`.scaleBtn`), the
// inter-rail bracket (`.bracket`) and the region-frame authority encoding
// (`.regionFrame`) this file used to pin contrast fixes for are all deleted
// along with the second rail and the equalized-mode toggle. Their SELECTOR-
// specific tests (the pressed-fill/pressed-text-role check, both focus-ring
// checks, the region-frame out-of-scope pin) are removed with them, not
// adapted — there is no fill/token left on those selectors to re-derive a
// ratio from.
//
// NOT RETIRED, ONLY RETARGETED (fix round 1 caught this): the
// `--accent-fg`/`--accent` PAIR itself did not die with `.scaleBtn` — it
// still ships on `.btn[data-appearance="accent"]` (Button.module.css), the
// "toggles / segmented controls" appearance that inherited the deleted
// toggle's role. Defect 3 below reads THAT selector. The High-Contrast-Dark
// `:global(...)` override was genuinely `.scaleBtn`-specific (no such
// override exists on the button component) and stays gone — but the
// BUILT-ARTIFACT verification method it demonstrated (a CSS Modules class is
// hashed, so only the compiled output can tell a working selector from dead
// markup) is restored below against something this branch actually ships:
// the authority gutter's three `[data-tier]` rules surviving Vite.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const {
  VSCODE_DEFAULTS,
  THEMES,
  resolvedOpaqueRgb,
  contrast,
  parseColor,
} = require("./helpers/vscodeThemes");

const SRC = path.join(__dirname, "..", "packages", "alp-webview", "src");
const TOKENS_CSS = fs.readFileSync(
  path.join(SRC, "styles", "tokens.css"),
  "utf8",
);
const CHART_CSS = fs.readFileSync(
  path.join(SRC, "features", "build-plan", "MemoryChart.module.css"),
  "utf8",
);
const BUTTON_CSS = fs.readFileSync(
  path.join(SRC, "shared", "ui", "Button", "Button.module.css"),
  "utf8",
);
const DIST_CSS_PATH = path.join(SRC, "..", "dist", "main.css");

/** The BUILT stylesheet — required for anything that depends on how CSS
 * Modules hashes a class name, because the source alone cannot show whether
 * a rule actually reaches a real selector once built. `pnpm test` always
 * compiles first, so this is normally present; run `pnpm run compile` before
 * running this file standalone. */
function readDistCss() {
  try {
    return fs.readFileSync(DIST_CSS_PATH, "utf8");
  } catch {
    throw new Error(
      `${DIST_CSS_PATH} is missing — run \`pnpm run compile\` first. This ` +
        "file asserts the gutter's [data-tier] rules against the BUILT " +
        "artifact, not the CSS Modules source: a class name is hashed at " +
        "build time, and reading only the source cannot tell a working " +
        "selector from dead markup.",
    );
  }
}

/** The exact (hashed) local class name the BUILT `dist/main.css` uses for
 * `.gutter`'s own BASE rule (`pointer-events: none` — its full body, and the
 * one declaration unique to it in the whole bundle). Matching on this,
 * rather than on any hashed class followed by `[data-tier=...]`, is what
 * keeps the [data-tier] test below from being satisfied by a DIFFERENT
 * class that happens to share the same attribute vocabulary —
 * `AuthoritySwatch.module.css`'s `.swatch[data-tier="…"]` rules do exactly
 * that, and a round-2 fix review proved the unscoped regex passed against
 * them even with every `.gutter[data-tier]` rule deleted from source. */
function builtGutterClass(distCss) {
  const re = /\._([\w-]+)\{pointer-events:none\}/;
  const m = re.exec(distCss);
  if (!m) {
    throw new Error(
      "could not find the built .gutter base rule (pointer-events: none) " +
        "in dist/main.css — run `pnpm run compile`",
    );
  }
  return m[1];
}

// ---------------------------------------------------------------------------
// Colour math (ports contrast.py's maths verbatim — same formulas, same
// rounding behaviour, so a ratio computed here matches the audit's).
// ---------------------------------------------------------------------------

/** Composite an (r,g,b,a 0-255) foreground over an OPAQUE (r,g,b) background. */
function composite(fgRgba, bgRgb) {
  const [r, g, b, a255] = fgRgba;
  const a = a255 / 255;
  const [br, bg, bb] = bgRgb;
  return [r * a + br * (1 - a), g * a + bg * (1 - a), b * a + bb * (1 - a)];
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
// The VS Code theme table (VSCODE_DEFAULTS/THEMES) and resolvedOpaqueRgb now
// live in ./helpers/vscodeThemes, imported above, so a second contrast gate
// (buildPlan.swatchContrast.test.js) shares this table instead of
// hand-copying it into one that can drift.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// tokens.css alias resolution — follows a `--name` through as many `var()`
// hops as tokens.css declares, down to the `--vscode-*` root, the same
// indirection a real webview resolves at paint time. Kept local (not moved
// to the helper) because several tests below call it directly.
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

/** The token a bare `selector { fill: var(...) }` rule uses. */
function fillTokenFor(selector) {
  const re = new RegExp(
    `${escapeForRegExp(selector)}\\s*\\{[^}]*fill:\\s*var\\((--[\\w-]+)`,
  );
  const m = re.exec(CHART_CSS);
  if (!m) throw new Error(`could not find a fill rule for ${selector}`);
  return m[1];
}

/** `{ bg, fg }` tokens for `.btn[data-appearance="accent"] { ... }`, read out
 * of Button.module.css — the "toggles / segmented controls" appearance that
 * inherited the deleted scale-toggle's role, and so inherited its
 * --accent/--accent-fg audit too (round-1 fix review). */
function accentButtonTokens() {
  const re = /\.btn\[data-appearance="accent"\]\s*\{([^}]*)\}/;
  const m = re.exec(BUTTON_CSS);
  if (!m) throw new Error('.btn[data-appearance="accent"] rule not found');
  const bg = /background:\s*var\((--[\w-]+)/.exec(m[1]);
  const fg = /color:\s*var\((--[\w-]+)/.exec(m[1]);
  if (!bg || !fg) {
    throw new Error(
      '.btn[data-appearance="accent"] rule is missing background/color var()',
    );
  }
  return { bg: bg[1], fg: fg[1] };
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
  // Threshold 19°: the palette's true minimum surviving gap is 20.0-20.1°
  // (chart-1 vs chart-3 itself, in Dark+/Light+/HC Light — HC Dark's own
  // ansiCyan value separates further, ~32°), so 15° left a 5° corridor a
  // future edit could degrade that pair into and stay green. 19° is
  // comfortably above round 1's actual collision (chart-3 vs chart-5: ~13°
  // Dark+, ~6° Light+) and just below the true 20.0° floor.
  for (const theme of ["dark", "light"]) {
    const c3 = resolvedOpaqueRgb(theme, "--chart-3", null);
    const c5 = resolvedOpaqueRgb(theme, "--chart-5", null);
    const delta = hueDelta(hueDegrees(c3), hueDegrees(c5));
    assert.ok(
      delta >= 19,
      `--chart-3 vs --chart-5 hue delta in ${theme}: ${delta.toFixed(1)}°, ` +
        "need >= 19°",
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
// Defect 3 — --accent-fg (white) vs --accent, on the appearance that
// inherited the deleted scale-toggle's role. Six themes pass (asserted);
// Dark+/Light+ are an accepted, declined shortfall (pinned at their exact
// value) — the same round-4 record the original `.scaleBtn` audit reached,
// re-measured against `.btn[data-appearance="accent"]` now that the toggle
// itself is gone.
//
// High Contrast Dark is NOT part of that retired-theme record — it is a
// CURRENT theme, and a round-2 fix review found it measures 2.57:1 here,
// below even the 3:1 non-text floor. The retired `.scaleBtn` control had a
// real, built-artifact-verified `:global(.vscode-high-contrast)` override
// that reached >=4.5:1 there (round 4 of the original audit); the shared
// `Button` component this pair now ships on has NO such override, and this
// branch does not add one (touching the shared Button component is outside
// its scope — see this task's report for the follow-up recorded against
// it). hcDark is pinned below at its exact measured value so a further
// regression, or a silent "fix" that assumes parity with what `.scaleBtn`
// shipped, cannot pass unnoticed.
// ---------------------------------------------------------------------------

test("--accent-fg (white) vs --accent: six real/current themes pass; Dark+/Light+/hcDark are pinned shortfalls, none silently reintroduced worse", () => {
  const { bg, fg } = accentButtonTokens();
  assert.equal(bg, "--accent");
  assert.equal(fg, "--accent-fg");

  // registerColor()-default themes already in VSCODE_DEFAULTS/THEMES.
  const declined = { dark: "4.21", light: "3.35" };
  for (const [theme, pin] of Object.entries(declined)) {
    const bgRgb = resolvedOpaqueRgb(theme, bg, null);
    const fgRgb = resolvedOpaqueRgb(theme, fg, null);
    const ratio = contrast(fgRgb, bgRgb);
    assert.equal(
      ratio.toFixed(2),
      pin,
      `accent button text (${fg}) vs its fill (${bg}) in ${theme} moved to ` +
        `${ratio.toFixed(2)}:1 (was ${pin}:1) — this is an ACCEPTED, ` +
        "declined shortfall (retired as VS Code's own default since 1.74); " +
        "any drift, better or worse, must be re-justified, not silently " +
        "absorbed",
    );
  }

  // High Contrast Dark, pinned SEPARATELY from the loop above: unlike
  // Dark+/Light+, this is a CURRENT theme, not a retired one, and the
  // `.scaleBtn` control this pair now audits used to clear >=4.5:1 here via
  // a real `:global(.vscode-high-contrast)` override. `Button`'s shared
  // `.btn[data-appearance="accent"]` carries NO such override, so this
  // measures worse than what shipped before — 2.57:1, under even the 3:1
  // non-text floor — and stays that way until the Button component itself
  // grows one (out of scope here; see this task's report).
  {
    const hcDarkPin = "2.57";
    const bgRgb = resolvedOpaqueRgb("hcDark", bg, null);
    const fgRgb = resolvedOpaqueRgb("hcDark", fg, null);
    const ratio = contrast(fgRgb, bgRgb);
    assert.equal(
      ratio.toFixed(2),
      hcDarkPin,
      `accent button text (${fg}) vs its fill (${bg}) in High Contrast ` +
        `Dark moved to ${ratio.toFixed(2)}:1 (was ${hcDarkPin}:1) — this ` +
        "control has NO High-Contrast-Dark override, unlike the retired " +
        ".scaleBtn control it replaced (which reached >=4.5:1 there); do " +
        "not assume parity with what shipped in the original audit, and " +
        "re-justify any drift rather than silently absorbing it",
    );
  }

  const passingCore = ["hcLight", "dark2026"]; // already full THEMES/VSCODE_DEFAULTS members
  for (const theme of passingCore) {
    const sbRgb = resolvedOpaqueRgb(theme, "--surface-bg", null);
    const bgRgb = resolvedOpaqueRgb(theme, bg, sbRgb); // composited if translucent (dark2026)
    const fgRgb = resolvedOpaqueRgb(theme, fg, null);
    const ratio = contrast(fgRgb, bgRgb);
    assert.ok(
      ratio >= 4.5,
      `accent button text (${fg}) vs its fill (${bg}) in ${theme}: ` +
        `${ratio.toFixed(2)}:1, need >= 4.5:1`,
    );
  }

  // Dark Modern / Light Modern / 2026 Light: real, current VS Code theme
  // JSON defaults, not registerColor() defaults — resolved directly here,
  // same as the original audit. `button.foreground` (--accent-fg) is a
  // SINGLE, non-per-kind VS Code default (Color.white), always opaque white
  // in every one of these.
  assert.equal(
    resolveToVscodeVar(TOKENS_CSS, fg),
    "--vscode-button-foreground",
    `${fg} no longer resolves to --vscode-button-foreground, so the white ` +
      "literal below stopped describing what this control paints — give " +
      "darkModern/lightModern/light2026 real VSCODE_DEFAULTS entries and " +
      "resolve through them, or update this arm deliberately",
  );
  const accentFgWhite = [255, 255, 255];
  const otherShippingThemes = {
    darkModern: "#0078D4",
    lightModern: "#005FB8",
    light2026: "#0069CC",
  };
  for (const [name, accentHex] of Object.entries(otherShippingThemes)) {
    const ratio = contrast(accentFgWhite, parseColor(accentHex).slice(0, 3));
    assert.ok(
      ratio >= 4.5,
      `--accent-fg (white) vs --accent (${accentHex}) in ${name}: ` +
        `${ratio.toFixed(2)}:1, need >= 4.5:1`,
    );
  }
});

// The built-artifact verification method the retired HC-Dark override test
// demonstrated — a CSS Modules class is hashed, so only the compiled output
// can tell a working selector from dead markup — restored here against
// something this branch actually ships: the authority gutter's three
// `[data-tier]` rules. SCOPED to `.gutter`'s own hashed class
// (`builtGutterClass`, above), not to "any hashed class at all" — an
// unscoped `\._[\w-]+\[data-tier=...\]` is satisfied independently by
// `AuthoritySwatch.module.css`'s `.swatch[data-tier="…"]` rules, which share
// the identical attribute vocabulary: a round-2 fix review deleted every
// `.gutter[data-tier]` rule from source, rebuilt, and the unscoped version
// of this test still passed 19/19.
test("the gutter's three [data-tier] rules survive the build (verified against the built artifact, not just source)", () => {
  const distCss = readDistCss();
  const gutterClass = builtGutterClass(distCss);
  for (const tier of ["yours", "locked", "unproven"]) {
    const re = new RegExp(
      `\\._${escapeForRegExp(gutterClass)}\\[data-tier=(?:"${tier}"|${tier})\\]`,
    );
    assert.ok(
      re.test(distCss),
      `dist/main.css has no ._${gutterClass}[data-tier=${tier}] rule — CSS ` +
        "Modules source alone cannot show this: the class is hashed at " +
        "build time and only the compiled output proves the rule reaches " +
        "a real selector",
    );
  }
});

// ---------------------------------------------------------------------------
// Defect 4 — the chart's meaning-bearing strokes (rail frame, declared-
// boundary tick, computed-mark tick).
// ---------------------------------------------------------------------------

test("the rail frame and both axis-tick registers use a stroke token that clears 3:1 in every default theme", () => {
  for (const selector of [".railFrame", ".tick", ".tickMinor"]) {
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

// A computed, power-of-two mark and a declared span/budget/region boundary
// share every other visual property (position math, label anchor, dominant
// baseline) — ink is the ONLY channel that tells them apart, which is the
// whole reason the old single-register axis was a defect this task set out
// to fix. Promoting `.tickLabelMinor` back to `--text-primary` (matching
// `.tickLabel`) would make a computed mark typographically identical to an
// authored address again, and nothing above would notice: the stroke-token
// loop checks CONTRAST against a background, never one tick label against
// the other.
test(".tickLabel and .tickLabelMinor resolve to different fill tokens", () => {
  const primary = fillTokenFor(".tickLabel");
  const secondary = fillTokenFor(".tickLabelMinor");
  assert.notEqual(
    primary,
    secondary,
    "a DECLARED boundary's tick label and a COMPUTED power-of-two mark's " +
      "must not share an ink token, or a computed mark becomes " +
      "indistinguishable from a declared one — the exact defect this " +
      "task's axis rewrite exists to fix",
  );
});

// ---------------------------------------------------------------------------
// Palette-wide — pairwise hue separation, so a future edit cannot reintroduce
// a chart-3-vs-chart-5-shaped collision anywhere else in the six.
// ---------------------------------------------------------------------------

// The 19° floor is calibrated against the tightest gap the palette actually
// has — chart-1 vs chart-3 at 19.9° in 2026 Dark, VS Code's current
// out-of-the-box default. Checking only Dark+/Light+ would leave that
// 0.9°-of-headroom pair ungated in the one theme most users run, which is
// the same "the gate covers themes nobody runs" mistake this file was
// rewritten to stop making. So the loop walks every theme the file knows.
test("every pair of the six chart-series colours is separated by hue in all covered themes", () => {
  for (const theme of THEMES) {
    const rgbs = {};
    for (let n = 1; n <= 6; n++) {
      rgbs[n] = resolvedOpaqueRgb(theme, `--chart-${n}`, null);
    }
    for (let i = 1; i <= 6; i++) {
      for (let j = i + 1; j <= 6; j++) {
        const delta = hueDelta(hueDegrees(rgbs[i]), hueDegrees(rgbs[j]));
        assert.ok(
          delta >= 19,
          `chart-${i} vs chart-${j} hue delta in ${theme}: ` +
            `${delta.toFixed(1)}°, need >= 19°`,
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
      delta < 19,
      `round 1's chart-3 vs chart-5 hue delta in ${theme} is ${delta.toFixed(1)}° ` +
        "— if this stopped being < 19°, the hue-delta arm's threshold is " +
        "not actually calibrated against the real regression it exists to catch",
    );
  }
});
