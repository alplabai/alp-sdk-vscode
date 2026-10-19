// SPDX-License-Identifier: Apache-2.0
//
// What `--fill-locked` (tokens.css) paints in a covered theme, computed from
// the token's OWN declaration — color-mix(in srgb, var(--vscode-X, #fb) P%,
// var(--ink)) — shared by the locked-fill gate and the tier-mark helper, so
// the amber on the region cards and on the locked tier mark are measured as
// one colour.

const fs = require("node:fs");
const path = require("node:path");
const {
  VSCODE_DEFAULTS,
  resolvedOpaqueRgb,
  parseColor,
} = require("./vscodeThemes");

const TOKENS = fs.readFileSync(
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

/** `[r,g,b]` of --fill-locked in `theme`. */
function lockedFill(theme) {
  const m =
    /--fill-locked:\s*color-mix\(\s*in srgb,\s*var\(\s*(--vscode-[\w-]+)\s*,\s*(#[0-9a-fA-F]+)\s*\)\s*(\d+)%,\s*var\(\s*(--[\w-]+)\s*\)\s*\)/.exec(
      TOKENS,
    );
  if (!m) {
    throw new Error(
      "--fill-locked is no longer color-mix(var(--vscode-*, #fb) P%, var(--ink))",
    );
  }
  const ground = resolvedOpaqueRgb(theme, "--surface-bg", null);
  const warn = VSCODE_DEFAULTS[theme][m[1]]
    ? parseColor(VSCODE_DEFAULTS[theme][m[1]]).slice(0, 3)
    : parseColor(m[2]).slice(0, 3);
  const ink = resolvedOpaqueRgb(theme, m[4], ground);
  const p = Number(m[3]) / 100;
  return warn.map((c, i) => c * p + ink[i] * (1 - p));
}

module.exports = { lockedFill };
