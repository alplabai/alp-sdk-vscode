// SPDX-License-Identifier: Apache-2.0
//
// The one reader of the BUILT `dist/main.css`, shared by every contrast gate
// that needs it — a CSS Modules class name is hashed at build time, so a
// check of whether a `[data-tier="…"]` rule (or any other selector) actually
// reaches a real, compiled selector cannot be answered from source alone.
// `buildPlan.chartContrast.test.js` needed this first, for the memory
// chart's authority gutter; `buildPlan.swatchContrast.test.js` needs the
// identical reader for `AuthoritySwatch.module.css`'s own rules once Task 6
// mounts the legend — sharing ONE reader here is what keeps the two gates
// from drifting on where `dist/main.css` lives or how a missing build is
// reported.

const fs = require("node:fs");
const path = require("node:path");

const DIST_CSS_PATH = path.join(
  __dirname,
  "..",
  "..",
  "packages",
  "alp-webview",
  "dist",
  "main.css",
);

/** The BUILT stylesheet — required for anything that depends on how CSS
 * Modules hashes a class name, because the source alone cannot show whether
 * a rule actually reaches a real selector once built. `pnpm test` always
 * compiles first, so this is normally present; run `pnpm run compile` before
 * running a file that calls this standalone. */
function readDistCss() {
  try {
    return fs.readFileSync(DIST_CSS_PATH, "utf8");
  } catch {
    throw new Error(
      `${DIST_CSS_PATH} is missing — run \`pnpm run compile\` first. A ` +
        "gate reading this asserts against the BUILT artifact, not CSS " +
        "Modules source: a class name is hashed at build time, and reading " +
        "only the source cannot tell a working selector from dead markup.",
    );
  }
}

module.exports = { DIST_CSS_PATH, readDistCss };
