// SPDX-License-Identifier: Apache-2.0
//
// The No-Breakpoint Rule (DESIGN.md): the system ships zero width-based
// media queries; the only sanctioned `@media` anywhere is
// `prefers-reduced-motion: reduce`. This gate holds the build-plan feature's
// own stylesheets to that rule — MemoryRegions.module.css is the one Task 8
// (#484 phase 4) touches to make the memory tab's rail-and-table layout
// measured rather than pinned to a literal width, and a width-based media
// query is exactly the kind of "just add a breakpoint" fix that would
// defeat the point of measuring anything at all.
//
// CSS_FILES IS DERIVED, NOT HAND-WRITTEN. A file list typed out by hand
// stops covering a stylesheet added to this feature after this gate was
// written — silently, since nothing here would notice a name missing from
// its own list. Globbing the feature directory for every `*.module.css`
// means a new file is in scope the day it lands, with no second edit to
// this test required.

const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const assert = require("node:assert/strict");

const BUILD_PLAN_DIR = path.join(
  __dirname,
  "..",
  "packages",
  "alp-webview",
  "src",
  "features",
  "build-plan",
);

/** Every `*.module.css` under the build-plan feature directory, recursively
 *  — there is no subdirectory there today, but a walk that only read the
 *  top level would silently stop covering one that appears later. */
function cssModuleFiles(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...cssModuleFiles(full));
    } else if (entry.isFile() && entry.name.endsWith(".module.css")) {
      out.push(full);
    }
  }
  return out;
}

const CSS_FILES = cssModuleFiles(BUILD_PLAN_DIR);

// The gate ON the gate: a broken directory path or a broken suffix filter
// would make `CSS_FILES` an empty array, and the rule below would then pass
// vacuously — green because it checked nothing, not because nothing is
// wrong. This is what turns red first when that happens.
test("the glob actually found the build-plan feature's stylesheets", () => {
  assert.ok(
    CSS_FILES.length >= 5,
    `found ${CSS_FILES.length} build-plan *.module.css file(s), want at least 5`,
  );
  assert.ok(
    CSS_FILES.some((f) => f.endsWith("MemoryRegions.module.css")),
    "the glob did not find MemoryRegions.module.css — Task 8's own target file",
  );
});

// CASE-INSENSITIVE ON BOTH SIDES, on purpose. CSS at-rule keywords and media
// features are ASCII case-insensitive — a browser treats `@MEDIA` and
// `PREFERS-REDUCED-MOTION` exactly like their lowercase spellings — so a
// pattern match on `@media` alone lets `@MEDIA (max-width: 600px)` through
// as a real, working breakpoint the gate never saw. The `i` flag below fixes
// that miss, but it only reads half the rule right: apply `i` to the finder
// and leave the allowance a plain `includes("prefers-reduced-motion")` and
// `@MEDIA (PREFERS-REDUCED-MOTION: reduce)` — legitimate, sanctioned CSS —
// becomes a FALSE positive, refused for a capitalization the finder itself
// no longer cares about. Both sides read case-insensitively, or neither
// should.
test("the build-plan stylesheets declare no width-based media query", () => {
  for (const file of CSS_FILES) {
    const css = fs.readFileSync(file, "utf8");
    for (const m of css.match(/@media[^{]+/gi) ?? []) {
      assert.ok(
        m.toLowerCase().includes("prefers-reduced-motion"),
        `${file} declares "${m.trim()}" — the No-Breakpoint Rule allows only prefers-reduced-motion`,
      );
    }
  }
});
