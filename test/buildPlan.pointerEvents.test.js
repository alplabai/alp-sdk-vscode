// SPDX-License-Identifier: Apache-2.0
//
// An INVISIBLE ELEMENT MUST STATE WHAT IT DOES TO THE POINTER.
//
// THE DEFECT THIS EXISTS FOR. `MemoryChart.module.css`'s `.hover` was
// `fill: transparent` and nothing else — a rect covering the whole rail,
// emitted last, existing only to catch the pointer for the live address
// readout. But `transparent` is `rgba(0, 0, 0, 0)`, not `none`, and under
// the SVG default `pointer-events: visiblePainted` an alpha-zero fill is
// still PAINTED. So it hit-tested above every `<g class="hit">` beneath it
// and swallowed every click meant for one: the chart's only interactive
// affordance was unreachable by any input in a real browser, while
// advertising `cursor: pointer`. Measured in Chromium: `elementFromPoint` at
// a band's centre answered the overlay, the band's `onClick` fired 0 times,
// and adding `pointer-events: none` made it fire.
//
// WHY A STYLESHEET GATE AND NOT A RENDER ONE. Hit-testing needs layout, and
// jsdom has none — `elementFromPoint` is not a thing there, and the render
// harness reaches the band by dispatching a synthetic event straight at it,
// which is exactly the case that fires whether an overlay is in the way or
// not. No assertion over a rendered tree can ever see this class of defect;
// the declaration that causes it is visible in the source, so that is where
// it is caught.
//
// THE RULE. Two arms:
//
//  1. Any rule block that paints NOTHING — an invisible `fill` with no
//     `stroke` to draw — must declare `pointer-events` explicitly. Either
//     value is allowed, because both are real answers: `none` for a purely
//     decorative overlay, anything else for a deliberate hit area. What is
//     refused is SAYING NOTHING, which is what silently inherits
//     `visiblePainted` and eats the pointer. A stylesheet cannot see
//     document order, so it cannot check the other half of the remedy; what
//     it can do is force the author to state the intent.
//
//  2. The classes that exist to be DRAWN OVER the rail rather than hit are
//     held to `pointer-events: none` by name. This list encodes a fact CSS
//     cannot express — which elements overlay interactive content — and it
//     is verified against the stylesheet, so a rename or a deletion turns
//     this red rather than quietly shrinking what is covered.
//
// FILE LIST IS DERIVED, not hand-written, and floored — the same shape
// test/buildPlan.noBreakpoints.test.js uses, for the same reason: a list
// typed out by hand stops covering a stylesheet added later, silently.

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

/** Every `*.module.css` under the build-plan feature directory, recursively. */
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

/** `{ selector, body }` for every rule block in `css`, comments stripped. */
function ruleBlocks(css) {
  const withoutComments = css.replace(/\/\*[\s\S]*?\*\//g, "");
  const out = [];
  for (const m of withoutComments.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    out.push({ selector: m[1].trim(), body: m[2] });
  }
  return out;
}

/** The class names a selector mentions. */
function classesIn(selector) {
  return Array.from(selector.matchAll(/\.([A-Za-z_][\w-]*)/g), (m) => m[1]);
}

const DECL = (body, prop) =>
  new RegExp(`(^|[;{\\s])${prop}\\s*:\\s*([^;]+)`, "i").exec(body)?.[2].trim();

/**
 * The rule paints nothing at all: an invisible `fill` and no `stroke`.
 *
 * `fill: none` WITH a stroke is ordinary, correct SVG — `.gapZigzag` is a
 * stroked path and must not be caught here — so the stroke is what separates
 * "draws nothing" from "draws an outline". An alpha-zero `rgba()` counts as
 * invisible too: it is the exact spelling `transparent` expands to, and the
 * whole defect was a fill that looked absent and behaved present.
 */
function paintsNothing(body) {
  const fill = DECL(body, "fill");
  if (fill === undefined) return false;
  const invisible =
    /^none$/i.test(fill) ||
    /^transparent$/i.test(fill) ||
    /^rgba\([^)]*,\s*0(\.0+)?\s*\)$/i.test(fill) ||
    /^hsla\([^)]*,\s*0(\.0+)?\s*\)$/i.test(fill);
  if (!invisible) return false;
  const stroke = DECL(body, "stroke");
  return stroke === undefined || /^none$/i.test(stroke);
}

// Arm 2's list. Keyed by file so a class name shared between stylesheets
// cannot satisfy this from the wrong one.
const MUST_BE_POINTER_INERT = [
  // The three-tier authority strip beside the rail: a vocabulary to be
  // scanned, never a control. It sits over the plot area, so without this it
  // would shadow the bands underneath exactly as `.hover` did.
  { file: "MemoryChart.module.css", class: "gutter" },
];

// THE GATE ON THE GATE. A broken directory path, a broken suffix filter or a
// broken block parser would leave every check below passing over nothing —
// green because it measured nothing, not because nothing is wrong.
test("the glob and the block parser actually found the stylesheets", () => {
  assert.ok(
    CSS_FILES.length >= 5,
    `found ${CSS_FILES.length} build-plan *.module.css file(s), want at least 5`,
  );
  assert.ok(
    CSS_FILES.some((f) => f.endsWith("MemoryChart.module.css")),
    "the glob did not find MemoryChart.module.css — the file the rail is drawn from",
  );
  const blocks = CSS_FILES.flatMap((f) =>
    ruleBlocks(fs.readFileSync(f, "utf8")),
  );
  assert.ok(
    blocks.length >= 100,
    `the parser found ${blocks.length} rule block(s) across ${CSS_FILES.length} file(s), want at least 100`,
  );
});

// THE DETECTOR'S OWN FLOOR. Running `paintsNothing` only over real files
// cannot tell "nothing is wrong" from "the matcher is broken" — the healthy
// state of the real CSS is zero hits. So the matcher is exercised against
// the shapes it exists to catch, and against the shapes it must leave alone.
test("the invisible-paint detector catches what it is for, and nothing else", () => {
  const caught = [
    "fill: transparent;",
    "fill: none;",
    "fill: TRANSPARENT;",
    "fill: rgba(0, 0, 0, 0);",
    "fill: none;\n  stroke: none;",
  ];
  for (const body of caught) {
    assert.ok(
      paintsNothing(body),
      `the detector missed an invisible paint: ${JSON.stringify(body)}`,
    );
  }
  const allowed = [
    // A stroked path with no fill draws an outline — ordinary SVG.
    "fill: none;\n  stroke: var(--border-chart);\n  stroke-width: 1.5;",
    // A real paint.
    "fill: var(--text-primary);",
    // A paint reference.
    "fill: url(#memory-authority-hatch);",
    // No fill at all is not this rule's business.
    "pointer-events: none;",
  ];
  for (const body of allowed) {
    assert.ok(
      !paintsNothing(body),
      `the detector false-alarmed on: ${JSON.stringify(body)}`,
    );
  }
});

test("an invisible rule states what it does to the pointer", () => {
  for (const file of CSS_FILES) {
    const css = fs.readFileSync(file, "utf8");
    const blocks = ruleBlocks(css);
    for (const block of blocks) {
      if (!paintsNothing(block.body)) continue;
      // The declaration may live in this block or in any other block for the
      // same class in the same file — `.gutter { pointer-events: none }` and
      // `.gutter[data-tier="yours"] { fill: ... }` are one element's rules
      // split across two selectors, and the element is what the browser
      // resolves.
      const names = classesIn(block.selector);
      const stated =
        DECL(block.body, "pointer-events") !== undefined ||
        (names.length > 0 &&
          names.some((name) =>
            blocks.some(
              (b) =>
                classesIn(b.selector).includes(name) &&
                DECL(b.body, "pointer-events") !== undefined,
            ),
          ));
      assert.ok(
        stated,
        `${path.basename(file)}'s "${block.selector}" paints nothing and declares no pointer-events — ` +
          "an invisible element silently inherits SVG's visiblePainted and hit-tests above whatever it covers, " +
          "so it must say `pointer-events: none` (decoration) or state the value that makes it a deliberate hit area",
      );
    }
  }
});

test("the overlays that must never take the pointer say so", () => {
  for (const entry of MUST_BE_POINTER_INERT) {
    const file = CSS_FILES.find((f) => f.endsWith(entry.file));
    assert.ok(file, `${entry.file} is not in the globbed file list`);
    const blocks = ruleBlocks(fs.readFileSync(file, "utf8"));
    const own = blocks.filter((b) =>
      classesIn(b.selector).includes(entry.class),
    );
    assert.ok(
      own.length > 0,
      `${entry.file} declares no ".${entry.class}" — if it was renamed, rename it here too rather than leaving this list naming nothing`,
    );
    const inert = own.some(
      (b) => DECL(b.body, "pointer-events")?.toLowerCase() === "none",
    );
    assert.ok(
      inert,
      `${entry.file}'s ".${entry.class}" is drawn over the rail's interactive bands and must declare pointer-events: none`,
    );
  }
});
