// SPDX-License-Identifier: Apache-2.0
//
// The VS Code theme table + colour math shared by every contrast gate in
// this test suite. Extracted out of buildPlan.chartContrast.test.js so a
// second gate (buildPlan.swatchContrast.test.js) reads the SAME canonical
// registerColor() defaults instead of hand-copying them into a second table
// that drifts from the first — the failure mode this area already shipped
// once. See buildPlan.chartContrast.test.js for how these values were
// sourced (microsoft/vscode's colour registry, fetched 2026-09-12) and for
// the file-specific reasoning that stays local to that file.

const fs = require("node:fs");
const path = require("node:path");

const TOKENS_CSS = fs.readFileSync(
  path.join(
    __dirname,
    "..",
    "..",
    "packages",
    "alp-webview",
    "src",
    "styles",
    "tokens.css",
  ),
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
// VS Code canonical registerColor() defaults for Dark+, Light+, High Contrast
// Dark and High Contrast Light — for exactly the `--vscode-*` variables this
// file's tokens resolve to. Sourced the same way the audit was:
// microsoft/vscode's `src/vs/platform/theme/common/colors/*.ts` and
// `src/vs/workbench/contrib/terminal/common/terminalColorRegistry.ts`
// (fetched 2026-09-12), and — for the round-1 mistake buildPlan.chartContrast
// still pins a regression test against — `extensions/git/package.json`'s
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
    "--vscode-terminal-ansiBlack": "#000000",
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
    "--vscode-terminal-ansiBlack": "#000000",
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
    "--vscode-terminal-ansiBlack": "#000000",
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
    // ansiBlack's own hcLight default is a dark grey, not black — HC
    // Light's own chrome is black-on-white everywhere else, and VS Code did
    // not chase pure #000000 for the terminal palette in this one theme.
    // It is recorded because ansiBlack was evaluated as the pressed-text
    // colour (round 3) and declined (round 4): #292929 on HC Light's accent
    // reaches only 2.66:1, while the --accent-fg white that ships reads
    // 5.47:1 there unaided. No HC Light override exists or is needed.
    "--vscode-terminal-ansiBlack": "#292929",
    "--vscode-tab-activeForeground": "#292929",
  },
  // 2026 Dark — a real, current, out-of-the-box VS Code default
  // (`ThemeSettingDefaults.COLOR_THEME_DARK` in `workbenchThemeService.ts`),
  // not a registerColor() default: its theme JSON
  // (`extensions/theme-defaults/themes/2026-dark.json`, itself `"include"`d
  // from `dark_modern.json` -> `dark_plus.json`) overrides most of the
  // tokens below directly. The one this file exists to exercise:
  // `"focusBorder": "#3994BCB3"` — TRANSLUCENT, unlike every registerColor()
  // default above, which are all opaque. Values not listed in 2026-dark.json
  // itself (editorWarning/editorError/terminal.ansi*) fall through the
  // `"include"` chain to the core registerColor() dark defaults, verified by
  // grepping all three theme files for each key.
  dark2026: {
    "--vscode-foreground": "#bfbfbf",
    "--vscode-descriptionForeground": "#8C8C8C", // opaque override, not transparent(foreground, .7)
    "--vscode-focusBorder": "#3994BCB3", // translucent — the case this theme exists to cover
    "--vscode-button-foreground": "#FFFFFF",
    "--vscode-input-background": "#191A1B",
    "--vscode-sideBar-background": "#191A1B",
    "--vscode-editorWarning-foreground": "#CCA700", // inherited core default
    "--vscode-editorError-foreground": "#F14C4C", // inherited core default
    "--vscode-charts-blue": "#57A3F8",
    "--vscode-charts-green": "#86CF86",
    "--vscode-charts-yellow": "#E0B97F",
    "--vscode-charts-red": "#EF8773",
    "--vscode-charts-purple": "#AD80D7",
    "--vscode-charts-orange": "#CD861A", // opaque override — see tokens.css's corrected comment
    "--vscode-terminal-ansiCyan": "#11a8cd", // inherited core default
    "--vscode-terminal-ansiBlack": "#000000", // inherited core default
    "--vscode-tab-activeForeground": "#bfbfbf",
  },
};

const THEMES = ["dark", "light", "hcDark", "hcLight", "dark2026"];

// ---------------------------------------------------------------------------
// tokens.css alias resolution — follows a `--name` through as many `var()`
// hops as tokens.css declares, down to the `--vscode-*` root, the same
// indirection a real webview resolves at paint time. Private to this module:
// callers outside get the resolved RESULT (`resolvedOpaqueRgb`), not these
// mechanical steps — buildPlan.chartContrast.test.js keeps its own copy of
// this resolver because several of its own tests call it directly on
// `CHART_CSS`/`REGIONS_CSS`-scoped tokens; duplicating a stateless parser is
// not the "two theme tables" drift this extraction exists to kill.
// ---------------------------------------------------------------------------

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
 * tokens.css's own alias chain. May carry real alpha — composite with
 * `resolvedOpaqueRgb` before comparing colours. */
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

module.exports = {
  VSCODE_DEFAULTS,
  THEMES,
  resolvedOpaqueRgb,
  contrast,
  relLum,
  parseColor,
};
