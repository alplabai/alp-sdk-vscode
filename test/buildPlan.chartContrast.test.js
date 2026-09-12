// SPDX-License-Identifier: Apache-2.0
//
// WCAG contrast for the Memory tab's chart — pinning the four fixes from the
// Build Plan panel's colour-contrast audit (assessment §4), not re-deriving
// them from memory: every ratio below is computed from the CSS's OWN
// declared tokens (read straight out of tokens.css / MemoryChart.module.css
// / MemoryRegions.module.css), resolved to VS Code's canonical Dark+/Light+
// registerColor() defaults, the same way `contrast.py` (the audit's
// verification script) did. If a future edit repoints one of these rules at
// an unsafe token, this recomputes and fails — it does not compare against a
// hardcoded "was" value.
//
// The four pairs pinned, one `test()` per defect:
//   1. Every chart-series band/marker LABEL against its own series' 30%
//      band fill (was: the series colour on itself, 2.31-3.29:1 Dark+,
//      1.34-3.55:1 Light+; now: --chart-label-fg, one token for all six).
//   2. --chart-3 is opaque in both themes (was: charts.orange's own default
//      chain bottoms out at editor.findMatchHighlightBackground, ~33% alpha
//      by VS Code's own design, composited over input.background to
//      1.42:1 Dark+ / 1.51:1 Light+).
//   3. The pressed scale-toggle button's text, and its focus ring, against
//      its own fill (was: --accent-fg on --accent, 4.21:1 / 3.35:1 text;
//      now: --button-fg on --button-bg).
//   4. The chart's meaning-bearing strokes (rail frame, tick, bracket)
//      against their backdrop (was: --border-default, 1.45-1.59:1 both
//      themes; now: --border-chart).

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

// ---------------------------------------------------------------------------
// VS Code canonical Dark+/Light+ registerColor() defaults, for exactly the
// `--vscode-*` variables this file's tokens resolve to. Sourced the same way
// the audit was: microsoft/vscode's `src/vs/platform/theme/common/colors/*.ts`
// (fetched 2026-09-12) and, for `gitDecoration.modifiedResourceForeground`,
// `extensions/git/package.json`'s `contributes.colors` defaults.
// ---------------------------------------------------------------------------

const VSCODE_DEFAULTS = {
  dark: {
    "--vscode-foreground": "#CCCCCC",
    // transparent(foreground, 0.7) composited over sideBar.background —
    // the effective solid colour a webview var() actually resolves to.
    "--vscode-descriptionForeground": "#9A9A9A",
    "--vscode-focusBorder": "#007FD4",
    "--vscode-button-foreground": "#FFFFFF",
    "--vscode-button-background": "#0E639C",
    "--vscode-input-background": "#3C3C3C",
    "--vscode-sideBar-background": "#252526",
    "--vscode-editorWarning-foreground": "#CCA700",
    "--vscode-editorError-foreground": "#F14C4C",
    "--vscode-charts-blue": "#59A4F9",
    "--vscode-charts-green": "#89D185",
    "--vscode-charts-purple": "#B180D7",
    // charts.yellow / charts.red default straight to editorWarning /
    // editorError's own foreground (chartsColors.ts) — same values, the
    // `--vscode-charts-*` name the CSS actually reads.
    "--vscode-charts-yellow": "#CCA700",
    "--vscode-charts-red": "#F14C4C",
    // charts.orange's OWN default chain (minimap.findMatchHighlight ->
    // editor.findMatchHighlightBackground) — VS Code documents this colour
    // as "must not be opaque". Recorded here (not just omitted) so a
    // regression back to `--vscode-charts-orange` fails with a real,
    // computed ratio instead of a missing-lookup error.
    "--vscode-charts-orange": "#EA5C0055",
    "--vscode-gitDecoration-modifiedResourceForeground": "#E2C08D",
    "--vscode-tab-activeForeground": "#FFFFFF",
  },
  light: {
    "--vscode-foreground": "#616161",
    "--vscode-descriptionForeground": "#717171",
    "--vscode-focusBorder": "#0090F1",
    "--vscode-button-foreground": "#FFFFFF",
    "--vscode-button-background": "#007ACC",
    "--vscode-input-background": "#FFFFFF",
    "--vscode-sideBar-background": "#F3F3F3",
    "--vscode-editorWarning-foreground": "#BF8803",
    "--vscode-editorError-foreground": "#E51400",
    "--vscode-charts-blue": "#0063D3",
    "--vscode-charts-green": "#388A34",
    "--vscode-charts-purple": "#652D90",
    "--vscode-charts-yellow": "#BF8803",
    "--vscode-charts-red": "#E51400",
    "--vscode-charts-orange": "#EA5C0055",
    "--vscode-gitDecoration-modifiedResourceForeground": "#895503",
    "--vscode-tab-activeForeground": "#333333",
  },
};

const THEMES = ["dark", "light"];

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
 * tokens.css's own alias chain — not a value this test invents. */
function resolvedRgba(theme, name) {
  const vscodeName = name.startsWith("--vscode-")
    ? name
    : resolveToVscodeVar(TOKENS_CSS, name);
  const hex = VSCODE_DEFAULTS[theme][vscodeName];
  if (!hex) {
    throw new Error(
      `no canonical Dark+/Light+ default recorded for \`${vscodeName}\` ` +
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

/** `{ bg, fg }` tokens for `.scaleBtn[aria-pressed="true"] { ... }` (NOT its
 * `:focus-visible` sibling), read out of MemoryRegions.module.css. */
function pressedButtonTokens() {
  const re = /\.scaleBtn\[aria-pressed="true"\]\s*\{([^}]*)\}/;
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

// ---------------------------------------------------------------------------
// Defect 1 — every chart-series label against its OWN series' 30% band fill.
// ---------------------------------------------------------------------------

test("every chart-series band/marker label clears 4.5:1 against its own series' band fill", () => {
  const labelToken = labelFillToken();
  for (const theme of THEMES) {
    const surfaceInput = resolvedRgba(theme, "--surface-input").slice(0, 3);
    const labelRgb = resolvedRgba(theme, labelToken).slice(0, 3);
    for (let n = 1; n <= 6; n++) {
      const { token, pct } = bandFillFor(n);
      const seriesRgb = resolvedRgba(theme, token).slice(0, 3);
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
  // CSS specificity, not just the base rule, decided what actually painted:
  // a `.bandLabel[data-series="N"]`/`.markerLabel[data-series="N"]` override
  // beats the bare `.bandLabel`/`.markerLabel` rule the contrast test above
  // reads. That override — one per series, each filling with its OWN
  // `--chart-N` — is the exact self-fill pairing defect 1 fixed, so its
  // reappearance must fail here even though the consolidated rule above
  // would still (by coincidence) read as a token name, not a colour.
  const re = /\.(?:bandLabel|markerLabel)\[data-series="\d+"\]\s*\{[^}]*fill:/;
  assert.equal(
    re.test(CHART_CSS),
    false,
    "a per-series override on .bandLabel/.markerLabel's fill reintroduces " +
      "the label-inherits-the-series-colour pairing that failed 4.5:1 " +
      "against its own band fill for all six series, both themes",
  );
});

// ---------------------------------------------------------------------------
// Defect 2 — --chart-3 is opaque in both themes, and reads against the rail.
// ---------------------------------------------------------------------------

test("--chart-3 is fully opaque in both Dark+ and Light+", () => {
  for (const theme of THEMES) {
    const [, , , alpha] = resolvedRgba(theme, "--chart-3");
    assert.equal(
      alpha,
      255,
      `--chart-3 resolved to a translucent colour in ${theme} (alpha ` +
        `${alpha}/255) — charts.orange's own default chain bottoms out at ` +
        "editor.findMatchHighlightBackground, which VS Code documents as " +
        "never opaque",
    );
  }
});

test("--chart-3 reads clearly against the rail (input.background) in both themes", () => {
  for (const theme of THEMES) {
    const chart3 = resolvedRgba(theme, "--chart-3").slice(0, 3);
    const surfaceInput = resolvedRgba(theme, "--surface-input").slice(0, 3);
    const ratio = contrast(chart3, surfaceInput);
    assert.ok(
      ratio >= 4.5,
      `--chart-3 vs --surface-input in ${theme}: ${ratio.toFixed(2)}:1, ` +
        "need >= 4.5:1",
    );
  }
});

// ---------------------------------------------------------------------------
// Defect 3 — the pressed scale-toggle button's text, and its focus ring.
// ---------------------------------------------------------------------------

test("the pressed scale-toggle button's text clears 4.5:1 against its own fill", () => {
  const { bg, fg } = pressedButtonTokens();
  for (const theme of THEMES) {
    const bgRgb = resolvedRgba(theme, bg).slice(0, 3);
    const fgRgb = resolvedRgba(theme, fg).slice(0, 3);
    const ratio = contrast(fgRgb, bgRgb);
    assert.ok(
      ratio >= 4.5,
      `pressed .scaleBtn text (${fg}) vs its fill (${bg}) in ${theme}: ` +
        `${ratio.toFixed(2)}:1, need >= 4.5:1`,
    );
  }
});

test("the pressed scale-toggle button's fill is no longer --accent", () => {
  const { bg } = pressedButtonTokens();
  assert.notEqual(
    bg,
    "--accent",
    "--accent is --vscode-focusBorder, a border colour with no contrast " +
      "guarantee against --accent-fg — the button fill must be a real " +
      "button token",
  );
});

test("the pressed scale-toggle button's own focus ring clears 3:1 against its fill", () => {
  const { bg } = pressedButtonTokens();
  const ringToken = pressedFocusRingToken();
  for (const theme of THEMES) {
    const bgRgb = resolvedRgba(theme, bg).slice(0, 3);
    const ringRgb = resolvedRgba(theme, ringToken).slice(0, 3);
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

test("the rail frame, the axis ticks and the inter-rail bracket use a stroke token that clears 3:1", () => {
  for (const selector of [".railFrame", ".tick", ".bracket"]) {
    const token = strokeTokenFor(selector);
    assert.notEqual(
      token,
      "--border-default",
      `${selector}'s stroke is meaning-bearing, not decorative — it must ` +
        "not use --border-default (1.45-1.59:1 against both chart " +
        "backdrops, both themes)",
    );
    for (const theme of THEMES) {
      const strokeRgb = resolvedRgba(theme, token).slice(0, 3);
      const surfaceBg = resolvedRgba(theme, "--surface-bg").slice(0, 3);
      const surfaceInput = resolvedRgba(theme, "--surface-input").slice(0, 3);
      const ratioBg = contrast(strokeRgb, surfaceBg);
      const ratioInput = contrast(strokeRgb, surfaceInput);
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
// Self-checks — pin every way this file's own scan could go quiet.
// ---------------------------------------------------------------------------

test("the resolver actually follows multi-hop aliases", () => {
  // --border-chart -> --text-secondary -> --vscode-descriptionForeground.
  const resolved = resolveToVscodeVar(TOKENS_CSS, "--border-chart");
  assert.equal(resolved, "--vscode-descriptionForeground");
});

test("an unsafe pairing is still caught (the gate is not vacuously true)", () => {
  // The OLD, broken pairing: the series colour on its own 30% fill. If this
  // stopped failing, the arm above would be checking nothing.
  const surfaceInputDark = resolvedRgba("dark", "--surface-input").slice(0, 3);
  const chart1Dark = resolvedRgba("dark", "--chart-1").slice(0, 3);
  const oldTint = composite([...chart1Dark, 0.3 * 255], surfaceInputDark);
  const oldRatio = contrast(chart1Dark, oldTint);
  assert.ok(
    oldRatio < 4.5,
    "the old self-fill pairing no longer fails — this arm's threshold check " +
      "would pass no matter what was fixed",
  );
});
