// SPDX-License-Identifier: Apache-2.0
//
// Every design token the webview USES must be one it DECLARES.
//
// The failure this closes is invisible by construction, which is the whole
// reason it needs a test rather than a review habit: `var(--typo, 8px)` renders
// the fallback and looks completely fine. Seven such references were live in
// this package when the gate was written, across four files, and not one of
// them was visible as a defect:
//
//   * four spacing tokens in `HardwareExplorerView.module.css` (#496) — the
//     view was pinned to hardcoded pixels and would simply not have followed a
//     change to the `--space-*` scale;
//   * `--radius-pill` in `NewProjectFlowView.module.css` (real: `--radius-full`)
//     — cosmetically identical, so nothing to notice;
//   * `--surface-sidebar` in `shared/ui/Card` — its fallback already resolved
//     to the correct token, so the pixels were right and the declaration lied;
//   * `--status-error` in `BuildPlanView.module.css` (real: `--status-err`).
//     THIS one was rendering wrong. Its fallback was `var(--status-warn)`, so a
//     FAILED build slice and an over-budget footprint both drew in the WARNING
//     colour — while the file's own comment two rules above said `over` "reads
//     as an error". A plausible colour appeared, so nobody saw it. (#499)
//
// A one-character near-miss between `--status-err` and `--status-error` is
// exactly what this catches, and exactly what no amount of care catches
// reliably by eye.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const CSS_ROOT = path.join(__dirname, "..", "packages", "alp-webview", "src");

/**
 * `--vscode-*` is supplied by the VS Code webview host at runtime, not by this
 * package, so it is correctly absent from our declarations and must not be
 * required. Nothing else gets an exemption: a token this package names is a
 * token this package owns.
 */
const HOST_PROVIDED = /^--vscode-/;

/** Every `.css` under the webview source, as `{ rel, text }`. */
function cssFiles(dir, base = dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...cssFiles(full, base));
    } else if (entry.isFile() && entry.name.endsWith(".css")) {
      out.push({
        rel: path.relative(base, full),
        text: fs.readFileSync(full, "utf8"),
      });
    }
  }
  return out;
}

const FILES = cssFiles(CSS_ROOT);

/**
 * Custom properties DECLARED anywhere in the package. Package-wide rather than
 * per-file on purpose: `tokens.css` is the intended home, but a module
 * declaring its own local variable is legitimate and must not be reported.
 *
 * `\s*` before the name, not `^`, because a declaration is indented inside its
 * `:root` block.
 */
function declaredIn(text) {
  return Array.from(text.matchAll(/^\s*(--[A-Za-z0-9-]+)\s*:/gm)).map(
    (m) => m[1],
  );
}

/**
 * Custom properties USED, with the line they appear on. The second pass exists
 * because a long fallback chain wraps — `tokens.css` itself has
 * `var(\n  --vscode-sideBar-background,\n  …)` — and a single-line scan would
 * silently skip every wrapped reference, which is most of the interesting ones.
 */
function usedIn(text) {
  const out = [];
  text.split("\n").forEach((line, index) => {
    for (const m of line.matchAll(/var\(\s*(--[A-Za-z0-9-]+)/g)) {
      out.push({ name: m[1], line: index + 1 });
    }
  });
  // A wrapped `var(` puts the name on the NEXT line, so the per-line pass above
  // misses it. Catch those separately, without a line number, so they are still
  // gated even though the report can only name the file.
  for (const m of text.matchAll(/var\(\s*\n\s*(--[A-Za-z0-9-]+)/g)) {
    out.push({ name: m[1], line: null });
  }
  return out;
}

const declared = new Set(FILES.flatMap((f) => declaredIn(f.text)));

test("every custom property the webview uses is one it declares", () => {
  const offenders = [];
  for (const file of FILES) {
    for (const use of usedIn(file.text)) {
      if (HOST_PROVIDED.test(use.name)) continue;
      if (declared.has(use.name)) continue;
      offenders.push(
        `  ${file.rel}${use.line ? `:${use.line}` : ""}  ${use.name}`,
      );
    }
  }

  assert.deepEqual(
    [...new Set(offenders)],
    [],
    "these custom properties are used but declared nowhere in " +
      "packages/alp-webview/src. Each one silently renders its fallback, so " +
      "it looks correct and is not. Either declare it in styles/tokens.css, " +
      "or point the reference at the token that already exists — check for a " +
      "near-miss first (`--status-error` vs `--status-err` was drawing errors " +
      "in the warning colour). `--vscode-*` is exempt: the webview host " +
      "supplies it.",
  );
});

// ---------------------------------------------------------------------------
// The scan itself
// ---------------------------------------------------------------------------

// A gate that reads nothing passes forever. These pin every way this one could
// go quiet: no files found, a declaration pattern that matches nothing, a use
// pattern that matches nothing, and an exemption so broad it swallows the lot.
test("the token scan actually reads the package", () => {
  assert.ok(
    FILES.length >= 10,
    `found only ${FILES.length} stylesheets under packages/alp-webview/src — ` +
      "the file walker is broken, not the package",
  );
  assert.ok(
    declared.size >= 20,
    `parsed only ${declared.size} declared tokens — the declaration pattern ` +
      "is broken",
  );
  for (const known of ["--space-4", "--status-err", "--radius-full"]) {
    assert.ok(
      declared.has(known),
      `\`${known}\` is declared in styles/tokens.css but the scan did not ` +
        "find it",
    );
  }

  const uses = FILES.flatMap((f) => usedIn(f.text));
  assert.ok(uses.length >= 100, "the `var(--…)` pattern parsed almost nothing");
  assert.ok(
    uses.some((u) => HOST_PROVIDED.test(u.name)),
    "no `--vscode-*` use was seen at all — either the scan or the exemption " +
      "pattern is wrong",
  );
  assert.ok(
    uses.some((u) => !HOST_PROVIDED.test(u.name)),
    "EVERY use matched the host-provided exemption — the gate would pass no " +
      "matter what",
  );
});

// The wrapped-`var(` arm is the one a future edit is most likely to drop, and
// dropping it is invisible: the gate keeps passing and simply stops seeing the
// references that wrap.
test("a `var(` whose token wraps onto the next line is still seen", () => {
  const wrapped = usedIn(
    "a {\n  color: var(\n    --wrapped-token,\n    red\n  );\n}",
  );
  assert.ok(
    wrapped.some((u) => u.name === "--wrapped-token"),
    "a wrapped var() reference was not picked up — every multi-line fallback " +
      "chain in tokens.css would go unchecked",
  );
});
