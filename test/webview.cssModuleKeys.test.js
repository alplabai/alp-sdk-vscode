// SPDX-License-Identifier: Apache-2.0
//
// Every `styles.X` a component uses must be a class its own CSS module
// declares.
//
// THE HOLE THIS CLOSES. `test/webview/run.mjs` stubs CSS-module imports with a
// key-echoing Proxy, so `styles.doesNotExist` returns the string
// "doesNotExist" and every gate stays green. In a Vite build the same
// expression is `undefined`, the element loses its class, and the layout it
// carried — `position: absolute`, a width, an overflow — silently does not
// apply. That is a rendering defect no test in this repo could see: it was
// found by reading, in the first revision of MemoryRegions.tsx, which used
// `styles.axisTop` / `styles.axisBottom` against a module declaring neither.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.join(__dirname, "..", "packages", "alp-webview", "src");

/** Every `*.tsx` under the webview source tree. */
function tsxFiles(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...tsxFiles(full));
    else if (entry.name.endsWith(".tsx")) out.push(full);
  }
  return out;
}

/** The module a file imports as `styles`, or null when it imports none. */
function styleImport(source) {
  const m = source.match(
    /^import\s+styles\s+from\s+"(\.[^"]*\.module\.css)";$/m,
  );
  return m ? m[1] : null;
}

/**
 * Class names a CSS module declares.
 *
 * Selector text only — the class must appear after a `.`, so a `--token` in a
 * declaration or a word inside a comment cannot pass as one. Compound and
 * attribute selectors (`.band[data-kind="x"]`, `.a .b`) are covered because
 * every `.name` in them is matched independently.
 */
function declaredClasses(css) {
  const withoutComments = css.replace(/\/\*[\s\S]*?\*\//g, "");
  const names = new Set();
  for (const block of withoutComments.split("{")) {
    // Only the selector half of each rule: the text after the previous `}`.
    const selector = block.slice(block.lastIndexOf("}") + 1);
    for (const m of selector.matchAll(/\.([A-Za-z_][\w-]*)/g)) names.add(m[1]);
  }
  return names;
}

/**
 * Every `styles.X` / `styles["X"]` a component reads.
 *
 * The lookbehind keeps a path out of the results: `import "./styles.css"` is
 * not a use of a class called `css`.
 */
function usedKeys(source) {
  const keys = new Set();
  for (const m of source.matchAll(/(?<![\w./"'])styles\.([A-Za-z_]\w*)/g)) {
    keys.add(m[1]);
  }
  for (const m of source.matchAll(/\bstyles\[\s*"([^"]+)"\s*\]/g))
    keys.add(m[1]);
  return keys;
}

test("every styles.X used in a component is declared in its CSS module", () => {
  const files = tsxFiles(ROOT);
  assert.ok(files.length > 5, "the walk must actually find components");

  const problems = [];
  let checked = 0;
  for (const file of files) {
    const source = fs.readFileSync(file, "utf8");
    const rel = styleImport(source);
    const used = usedKeys(source);
    if (rel === null) {
      if (used.size > 0) {
        problems.push(
          `${path.relative(ROOT, file)}: uses styles.* but imports no CSS module`,
        );
      }
      continue;
    }
    const cssPath = path.join(path.dirname(file), rel);
    if (!fs.existsSync(cssPath)) {
      problems.push(`${path.relative(ROOT, file)}: imports missing ${rel}`);
      continue;
    }
    checked += 1;
    const declared = declaredClasses(fs.readFileSync(cssPath, "utf8"));
    for (const key of used) {
      if (!declared.has(key)) {
        problems.push(
          `${path.relative(ROOT, file)}: styles.${key} is not declared in ${rel}`,
        );
      }
    }
  }

  assert.ok(checked > 3, `only ${checked} components had a CSS module`);
  assert.deepEqual(problems, []);
});

test("a class sized inline by its component does not also flex in the main axis", () => {
  // THE BUG THIS ENCODES. `.rail` carried `flex: 1` — written when it lived in
  // a ROW — while the component set its height inline. Once it moved into a
  // COLUMN flex container, `flex: 1`'s `flex-basis: 0%` applied to HEIGHT and
  // beat the inline value: the rail collapsed to 0px and `overflow: hidden`
  // erased every band, marker and budget inside it. The panel rendered axis
  // labels beside an empty column.
  //
  // jsdom performs no layout, so the render harness cannot see this and never
  // will. This is the static half: an element whose size its component sets
  // inline must not also hand that axis to the flex algorithm.
  const files = tsxFiles(ROOT);
  const problems = [];
  for (const file of files) {
    const source = fs.readFileSync(file, "utf8");
    const rel = styleImport(source);
    if (rel === null) continue;
    const cssPath = path.join(path.dirname(file), rel);
    if (!fs.existsSync(cssPath)) continue;
    // Classes the component sizes inline: `className={styles.x} style={{ height:`
    // in either order, within one element's attribute list.
    const sizedInline = new Set();
    for (const m of source.matchAll(
      /styles\.([A-Za-z_]\w*)[^>]{0,400}?style=\{\{[^}]*\b(?:height|width):/g,
    )) {
      sizedInline.add(m[1]);
    }
    const css = fs
      .readFileSync(cssPath, "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "");
    for (const name of sizedInline) {
      const rule = css.match(new RegExp(`\\.${name}\\s*\\{([^}]*)\\}`));
      if (!rule) continue;
      const flex = rule[1].match(/(^|;)\s*flex\s*:\s*([^;]+)/);
      // `flex: none` / `flex: 0 0 auto` keep the declared size; a numeric grow
      // with the default 0% basis replaces it.
      if (flex && /^\s*\d/.test(flex[2]) && !/\bauto\b/.test(flex[2])) {
        problems.push(
          `${path.relative(ROOT, file)}: .${name} is sized inline but declares ` +
            `flex: ${flex[2].trim()} — flex-basis overrides that size in the main axis`,
        );
      }
    }
  }
  assert.deepEqual(problems, []);
});
