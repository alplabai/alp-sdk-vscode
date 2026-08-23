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

// ---------------------------------------------------------------------------
// Fallback agreement (#557)
// ---------------------------------------------------------------------------
//
// The gate above asserts a token is DECLARED. It says nothing about the value
// written beside it, so `var(--radius-md, 6px)` sails through while the token
// is really `3px` — a declaration that is off by 2x and renders correctly,
// because the token exists and the fallback never fires.
//
// That makes these dormant, not live. They wake up the moment `tokens.css`
// fails to load, and until then they misinform every reader about what the
// design system says. Fourteen were live in this package when this arm was
// written, across `--radius-md`, `--radius-sm`, `--radius-full`, `--space-3`
// and `--space-4`.
//
// ── Scope: NUMERIC tokens only, and that boundary is load-bearing ───────────
//
// Ten `var()` fallbacks in this package disagree with their token ON PURPOSE
// and are not defects:
//
//   * `var(--border-default, transparent)` — no border when the theme has none;
//   * `var(--ease-out, ease-out)` / `var(--ease-in-out, ease-in-out)` — the CSS
//     keyword as a deliberate coarse stand-in for a cubic-bezier;
//   * `var(--text-mono, monospace)` / `var(--font-family-mono, monospace)` —
//     the generic family as the right degraded answer for a concrete stack.
//
// Gating those would red on correct code, and a gate that reds on correct code
// is a gate someone deletes — after which the numeric drift comes back. So the
// rule keys off the DECLARED value: if the token declares a bare number with a
// unit, the fallback must match it exactly; anything else is a judgement call
// and stays out.

/**
 * Base-block declarations only.
 *
 * `tokens.css` declares `--duration-fast`, `--duration-base` and
 * `--duration-slow` TWICE: the real value in `:root`, then `0ms` inside
 * `@media (prefers-reduced-motion: reduce)`. A "last declaration wins" parse
 * therefore reports the correct `var(--duration-slow, 250ms)` in
 * `shared/ui/Button/Button.module.css` as a mismatch against `0ms`. It is not a
 * mismatch — it matches the base value, which is the one a missing stylesheet
 * would have to stand in for. So every `@media` block is stripped first.
 */
function stripAtMediaBlocks(text) {
  let out = "";
  let i = 0;
  while (i < text.length) {
    const at = text.indexOf("@media", i);
    if (at === -1) {
      out += text.slice(i);
      break;
    }
    out += text.slice(i, at);
    const open = text.indexOf("{", at);
    if (open === -1) break;
    let depth = 1;
    let j = open + 1;
    while (j < text.length && depth > 0) {
      if (text[j] === "{") depth += 1;
      else if (text[j] === "}") depth -= 1;
      j += 1;
    }
    i = j;
  }
  return out;
}

/** A bare number with an optional unit — the only shape this arm gates. */
const NUMERIC = /^-?(?:\d+\.?\d*|\.\d+)(?:px|rem|em|ms|s|ch|vh|vw|%)?$/;

/** `{ "--token": "3px" }` for every base declaration whose value is numeric. */
function numericDeclarations(files) {
  const out = {};
  for (const file of files) {
    for (const m of stripAtMediaBlocks(file.text).matchAll(
      /(--[A-Za-z0-9-]+)\s*:\s*([^;{}]+);/g,
    )) {
      const value = m[2].replace(/\s+/g, " ").trim();
      if (NUMERIC.test(value)) out[m[1]] = value;
    }
  }
  return out;
}

/**
 * Every `var(--token, <fallback>)` whose fallback contains no parentheses.
 *
 * The paren exclusion is not a limitation worth fixing: a fallback that
 * contains `(` is a nested `var()`, an `rgba()`, or a `cubic-bezier()` — never
 * the bare number this arm gates.
 */
function fallbacksIn(text) {
  const out = [];
  for (const m of text.matchAll(
    /var\(\s*(--[A-Za-z0-9-]+)\s*,\s*([^()]*?)\s*\)/g,
  )) {
    out.push({
      name: m[1],
      fallback: m[2].replace(/\s+/g, " ").trim(),
      line: text.slice(0, m.index).split("\n").length,
    });
  }
  return out;
}

const NUMERIC_TOKENS = numericDeclarations(FILES);

test("a numeric token's fallback names the value the token declares", () => {
  const offenders = [];
  for (const file of FILES) {
    for (const use of fallbacksIn(file.text)) {
      const declaredValue = NUMERIC_TOKENS[use.name];
      if (declaredValue === undefined) continue; // non-numeric: out of scope
      if (use.fallback === declaredValue) continue;
      offenders.push(
        `  ${file.rel}:${use.line}  var(${use.name}, ${use.fallback})  ` +
          `— declared ${declaredValue}`,
      );
    }
  }

  assert.deepEqual(
    offenders.sort(),
    [],
    "these fallbacks name a value the token does not have. Nothing renders " +
      "wrong today — the token exists, so the fallback never fires — but the " +
      "declaration is false, and it becomes the rendered value the moment " +
      "styles/tokens.css fails to load. Correct the fallback to the declared " +
      "value; do not change the token to match the fallback.",
  );
});

// Same reasoning as the scan self-check above: pin every way THIS arm could go
// quiet, and pin the boundary that keeps it shippable.
test("the fallback-agreement arm reads the package and keeps its boundary", () => {
  assert.ok(
    Object.keys(NUMERIC_TOKENS).length >= 10,
    `parsed only ${Object.keys(NUMERIC_TOKENS).length} numeric tokens — the ` +
      "declaration pattern or the @media strip is broken",
  );
  for (const [token, value] of [
    ["--radius-sm", "2px"],
    ["--radius-md", "3px"],
    ["--radius-full", "9999px"],
    ["--space-3", "6px"],
    ["--space-4", "8px"],
  ]) {
    assert.equal(
      NUMERIC_TOKENS[token],
      value,
      `${token} should parse as ${value}`,
    );
  }

  // The @media trap: the base value must win over the reduced-motion override.
  assert.equal(
    NUMERIC_TOKENS["--duration-slow"],
    "250ms",
    "--duration-slow parsed as its prefers-reduced-motion override instead of " +
      "its base value — every duration fallback would be reported as wrong",
  );

  // The boundary. These tokens are non-numeric on purpose and MUST stay
  // ungated; gating them reds on correct code and the gate gets deleted.
  for (const token of [
    "--border-default",
    "--ease-out",
    "--ease-in-out",
    "--text-mono",
    "--font-family-mono",
  ]) {
    assert.ok(
      !(token in NUMERIC_TOKENS),
      `${token} was treated as numeric — its deliberate fallback ` +
        "(transparent / a keyword / a generic family) would be reported as a " +
        "defect",
    );
  }

  const seen = FILES.flatMap((f) => fallbacksIn(f.text));
  assert.ok(
    seen.length >= 20,
    `the var(--token, fallback) pattern found only ${seen.length} uses`,
  );
  assert.ok(
    seen.some((u) => u.name in NUMERIC_TOKENS),
    "no fallback for a numeric token was seen at all — this arm would pass " +
      "no matter what",
  );
});

test("@media redefinitions are stripped, base declarations are not", () => {
  const parsed = numericDeclarations([
    {
      rel: "probe.css",
      text:
        ":root { --probe: 250ms; --keep: 4px; }\n" +
        "@media (prefers-reduced-motion: reduce) {\n" +
        "  :root { --probe: 0ms; }\n" +
        "}\n",
    },
  ]);
  assert.equal(parsed["--probe"], "250ms", "the @media override won");
  assert.equal(parsed["--keep"], "4px", "a base declaration was lost");
});
