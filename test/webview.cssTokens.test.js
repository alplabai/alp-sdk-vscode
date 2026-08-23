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

/* ── Shared CSS lexing helpers ──────────────────────────────────────────────
 * Used by every arm below. They live here, above the arms, because each arm
 * has to answer the same two questions first: is this text actually code,
 * and is this literal inside a var() fallback or standing on its own.
 */
/** Blank out `/* … *\/` comments while preserving byte offsets, so a literal
 * quoted in prose is not mistaken for a declaration and line numbers stay
 * true. The radius arm above does not need this only because its pattern
 * requires a `:` and a `;`, which prose does not supply. */
function withoutComments(text) {
  let out = "";
  let i = 0;
  while (i < text.length) {
    const c = text[i];
    // A quoted string: copy it whole. `content: "/* not a comment */"` is a
    // string value, and a naive stripper would blank the rest of the file
    // from there to the next real `*/`.
    if (c === '"' || c === "'") {
      const end = text.indexOf(c, i + 1);
      const stop = end === -1 ? text.length : end + 1;
      out += text.slice(i, stop);
      i = stop;
      continue;
    }
    // An unquoted url() token: `/*` is legal inside a URL.
    if (/^url\(/i.test(text.slice(i, i + 4))) {
      const end = text.indexOf(")", i);
      const stop = end === -1 ? text.length : end + 1;
      out += text.slice(i, stop);
      i = stop;
      continue;
    }
    if (c === "/" && text[i + 1] === "*") {
      const end = text.indexOf("*/", i + 2);
      const stop = end === -1 ? text.length : end + 2;
      // Blank it but keep the newlines, so reported line numbers stay true.
      out += text.slice(i, stop).replace(/[^\n]/g, " ");
      i = stop;
      continue;
    }
    out += c;
    i++;
  }
  return out;
}

/**
 * Remove every `var(...)` call, counting parens so nested calls and
 * function-valued fallbacks (`var(--a, var(--b, rgba(0,0,0,.1)))`) come out
 * whole. A regex cannot do this: `/var\([^()]*\)/` stops at the first inner
 * `(` and leaves the fallback's literal behind, which would report the exact
 * sites the rule permits.
 */
function stripVarCalls(value) {
  let out = "";
  let i = 0;
  while (i < value.length) {
    // CSS keywords are case-insensitive, so `VAR(--x, #fff)` is the rule being
    // FOLLOWED and must not survive the strip and read as a bare literal.
    const at = value.toLowerCase().indexOf("var(", i);
    if (at === -1) {
      out += value.slice(i);
      break;
    }
    out += value.slice(i, at);
    let depth = 0;
    let j = at + 3;
    for (; j < value.length; j++) {
      if (value[j] === "(") depth++;
      else if (value[j] === ")") {
        depth--;
        if (depth === 0) {
          j++;
          break;
        }
      }
    }
    i = j;
  }
  return out;
}

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

// ---------------------------------------------------------------------------
// Bare border-radius literals (#558)
// ---------------------------------------------------------------------------
//
// The two arms above check a token once a `var()` reference exists. They say
// nothing about a `border-radius` that skips `var()` altogether and writes a
// raw pixel value — a second, undeclared corner language running alongside
// the documented scale. Seven such sites were live in this package when this
// arm was written, across three files; four of them (`4px` x3, `5px` x1) were
// not just untokenised but off-scale — a value the documented scale
// (`--radius-sm` 2px / `--radius-md` 3px / `--radius-lg` 8px / `--radius-xl`
// 10px / `--radius-full` 9999px — DESIGN.md, "Shapes", The Two-Pixel Rule)
// does not contain at all. Those four snap to `--radius-md`, the nearest
// token; adding a new scale step between 3px and 8px was considered and
// rejected, since it would weaken The Two-Pixel Rule.
//
// `50%` is allowed: several circles in this package are written that way and
// a percentage radius is not a scale value to tokenise. A bare `0` / `0px`
// is allowed on the same reasoning (no visible corner to name) — but no site
// in this package currently writes one, so that branch is exercised only by
// the inline probe below, not by a real file.

/**
 * `border-radius` declarations, with the full value and 1-based line number.
 * Same line-counting technique as the fallback-agreement arm above: count
 * newlines up to the match. `border-radius` values in this package never
 * wrap, so a single-line scan is enough (contrast `usedIn` above, which has
 * to handle a wrapped `var(`).
 */
function borderRadiusDeclarationsIn(text) {
  const out = [];
  // Comments are blanked first: a commented-out `border-radius: 4px;` supplies
  // both the colon and the semicolon this pattern looks for, and reading it as
  // live code is how a gate starts failing on correct files.
  const code = withoutComments(text);
  // All five spellings, and a declaration may be terminated by `}` instead of
  // `;` when it is the last one in its block. Property names are matched
  // case-insensitively because CSS is.
  const pattern =
    /border(?:-top-left|-top-right|-bottom-right|-bottom-left)?-radius\s*:\s*([^;{}]+)(?=[;}])/gi;
  for (const m of code.matchAll(pattern)) {
    out.push({
      property: m[0].slice(0, m[0].indexOf(":")).trim().toLowerCase(),
      value: m[1].replace(/\s+/g, " ").trim(),
      line: code.slice(0, m.index).split("\n").length,
    });
  }
  return out;
}

/** True once every token left is a zero radius — i.e. nothing that could be
 * a scale value remains. */
function isBareZero(remainder) {
  return remainder
    .split(/\s+/)
    .filter(Boolean)
    .every(
      (token) =>
        token === "0" ||
        token === "0px" ||
        // Any percentage radius: `50%` for a circle, `50% 50% 0 0` for a
        // half-circle, `100%`. A percentage is relative to the box, so it is
        // not a value the pixel scale could name.
        /^[0-9.]+%$/.test(token),
    );
}

/**
 * A `border-radius` value is an offender if, once every `var(...)` call is
 * stripped out, something is still left that isn't `50%` or a bare zero.
 * That "something" is a raw pixel/number literal bypassing the token scale —
 * whether the whole value is one (`4px`) or it's mixed into a shorthand
 * alongside `var()` calls (`4px 4px 0 0`, `var(--radius-md, 3px) 0 0`).
 */
function isBareRadiusLiteral(value) {
  // A `var()` reference only counts as tokenised if it names a radius token.
  // `border-radius: var(--space-4, 16px)` references a token and would sail
  // through a bare is-there-a-var check, while shipping a 16px corner the
  // scale does not contain — the exact drift this arm exists to stop.
  for (const ref of value.matchAll(/var\(\s*(--[a-z0-9-]+)/gi)) {
    if (!/^--radius-/i.test(ref[1])) return true;
  }
  // `stripVarCalls` counts parens, so a nested fallback comes out whole; the
  // regex this used to use stopped at the first inner `(`.
  const remainder = stripVarCalls(value)
    .replace(/!\s*important/gi, " ")
    // The elliptical form `<horizontal> / <vertical>` — the slash is syntax,
    // not a value to tokenise.
    .replace(/\//g, " ")
    .trim();
  if (remainder === "") return false; // entirely var() calls
  return !isBareZero(remainder);
}

test("no border-radius bypasses the token scale with a bare literal", () => {
  const offenders = [];
  for (const file of FILES) {
    for (const decl of borderRadiusDeclarationsIn(file.text)) {
      if (!isBareRadiusLiteral(decl.value)) continue;
      offenders.push(
        `  ${file.rel}:${decl.line}  ${decl.property}: ${decl.value};`,
      );
    }
  }

  assert.deepEqual(
    offenders.sort(),
    [],
    "these border-radius declarations write a raw literal instead of a " +
      "--radius-* token (or a var() fallback naming one). The documented " +
      "scale is --radius-sm 2px / --radius-md 3px / --radius-lg 8px / " +
      '--radius-xl 10px / --radius-full 9999px (DESIGN.md, "Shapes", The ' +
      "Two-Pixel Rule); an off-scale value snaps to the nearest token rather " +
      "than adding a new scale step. `50%` is allowed (circles).",
  );
});

// Same reasoning as the scan self-checks above: pin every way this arm could
// go quiet.
test("the border-radius scan actually reads the package", () => {
  const decls = FILES.flatMap((f) => borderRadiusDeclarationsIn(f.text));
  assert.ok(
    decls.length >= 20,
    `found only ${decls.length} border-radius declarations — the scan is broken`,
  );
  assert.ok(
    decls.some((d) => d.value.includes("var(")),
    "no tokenised border-radius was seen at all — the scan pattern is broken",
  );
  assert.ok(
    decls.some((d) => d.value === "50%"),
    "no `50%` border-radius was seen — the allowed-value exemption has " +
      "nothing real to exempt, so it could be wrong and this would not catch it",
  );
});

test("bare literal / var() / 50% / zero are told apart correctly", () => {
  assert.equal(
    isBareRadiusLiteral("4px"),
    true,
    "a bare pixel value is an offender",
  );
  assert.equal(
    isBareRadiusLiteral("4px 4px 0 0"),
    true,
    "a shorthand with a bare literal in it is still an offender",
  );
  assert.equal(
    isBareRadiusLiteral("var(--radius-md, 3px)"),
    false,
    "a var() reference is allowed, including the literal inside its fallback",
  );
  assert.equal(
    isBareRadiusLiteral("var(--radius-md, 3px) var(--radius-md, 3px) 0 0"),
    false,
    "a shorthand built entirely from var() calls plus a bare zero is allowed",
  );
  assert.equal(isBareRadiusLiteral("50%"), false, "a circle's 50% is allowed");
  assert.equal(
    isBareRadiusLiteral("50% 50% 0 0"),
    false,
    "a half-circle shorthand is percentages and zeros — still allowed",
  );
  assert.equal(
    isBareRadiusLiteral("var(--radius-md, 3px) !important"),
    false,
    "!important is syntax, not an untokenised value",
  );
  assert.equal(
    isBareRadiusLiteral("var(--radius-md, 3px) / var(--radius-sm, 2px)"),
    false,
    "the elliptical `/` form is syntax, not an untokenised value",
  );
  assert.equal(
    isBareRadiusLiteral("VAR(--radius-md, 3px)"),
    false,
    "CSS keywords are case-insensitive, so an uppercase VAR( is still a " +
      "token reference and must not read as a bare literal",
  );
  assert.equal(
    isBareRadiusLiteral("var(--space-4, 16px)"),
    true,
    "a var() that names a NON-radius token is not tokenisation — it ships " +
      "a corner the scale does not contain, wearing a token's clothes",
  );
  assert.equal(
    isBareRadiusLiteral("0"),
    false,
    "a bare zero radius is allowed",
  );
  assert.equal(
    isBareRadiusLiteral("0px"),
    false,
    "a bare 0px radius is allowed",
  );
});

// ---------------------------------------------------------------------------
// Literal colours outside a var() fallback (#559, #560)
// ---------------------------------------------------------------------------
//
// DESIGN.md, "Colors", The Borrowed Palette Rule: a hex, `rgb()` or `hsl()`
// value may appear only as the second argument of a `var()` fallback, never as
// the value itself. Until this arm, nothing enforced the second half of that
// sentence, and three sites in `ConfiguratorView.module.css` were darkening
// chrome with `color-mix(in srgb, var(--vscode-editor-background) 86%, #000
// 14%)`. Mixing black moves one way only: subtle on a dark theme, a grey slab
// on a light one. They now wash in `var(--text-primary)`, which inverts with
// the theme (#559).
//
// This arm exists in the repo, rather than being left to the Impeccable design
// detector, because that detector cannot make the distinction the rule is about:
// its literal matcher has no var()-fallback exclusion, so it reports
// `var(--vscode-charts-green, #89d185)` — the rule being FOLLOWED — as a
// violation. Measured across this package: 53 literals sit inside a fallback
// and 3 do not. A detector that fires on 53 correct sites to reach 3 stops
// being read. `design-system-color` is therefore suppressed in
// `.impeccable/config.json`, and this arm carries the rule instead (#560).
//
// The three surviving bare literals are the ones DESIGN.md itself sanctions,
// and are allowlisted below by file plus exact declaration — never by line
// number, which drifts on the next edit above them.

/**
 * Every CSS named colour that is an actual paint. `transparent` and
 * `currentColor` are deliberately absent: neither pins a colour, and both are
 * how this package writes "take it from context".
 */
const NAMED_COLOURS = [
  "aliceblue",
  "antiquewhite",
  "aqua",
  "aquamarine",
  "azure",
  "beige",
  "bisque",
  "black",
  "blanchedalmond",
  "blue",
  "blueviolet",
  "brown",
  "burlywood",
  "cadetblue",
  "chartreuse",
  "chocolate",
  "coral",
  "cornflowerblue",
  "cornsilk",
  "crimson",
  "cyan",
  "darkblue",
  "darkcyan",
  "darkgoldenrod",
  "darkgray",
  "darkgreen",
  "darkgrey",
  "darkkhaki",
  "darkmagenta",
  "darkolivegreen",
  "darkorange",
  "darkorchid",
  "darkred",
  "darksalmon",
  "darkseagreen",
  "darkslateblue",
  "darkslategray",
  "darkslategrey",
  "darkturquoise",
  "darkviolet",
  "deeppink",
  "deepskyblue",
  "dimgray",
  "dimgrey",
  "dodgerblue",
  "firebrick",
  "floralwhite",
  "forestgreen",
  "fuchsia",
  "gainsboro",
  "ghostwhite",
  "gold",
  "goldenrod",
  "gray",
  "green",
  "greenyellow",
  "grey",
  "honeydew",
  "hotpink",
  "indianred",
  "indigo",
  "ivory",
  "khaki",
  "lavender",
  "lavenderblush",
  "lawngreen",
  "lemonchiffon",
  "lightblue",
  "lightcoral",
  "lightcyan",
  "lightgoldenrodyellow",
  "lightgray",
  "lightgreen",
  "lightgrey",
  "lightpink",
  "lightsalmon",
  "lightseagreen",
  "lightskyblue",
  "lightslategray",
  "lightslategrey",
  "lightsteelblue",
  "lightyellow",
  "lime",
  "limegreen",
  "linen",
  "magenta",
  "maroon",
  "mediumaquamarine",
  "mediumblue",
  "mediumorchid",
  "mediumpurple",
  "mediumseagreen",
  "mediumslateblue",
  "mediumspringgreen",
  "mediumturquoise",
  "mediumvioletred",
  "midnightblue",
  "mintcream",
  "mistyrose",
  "moccasin",
  "navajowhite",
  "navy",
  "oldlace",
  "olive",
  "olivedrab",
  "orange",
  "orangered",
  "orchid",
  "palegoldenrod",
  "palegreen",
  "paleturquoise",
  "palevioletred",
  "papayawhip",
  "peachpuff",
  "peru",
  "pink",
  "plum",
  "powderblue",
  "purple",
  "rebeccapurple",
  "red",
  "rosybrown",
  "royalblue",
  "saddlebrown",
  "salmon",
  "sandybrown",
  "seagreen",
  "seashell",
  "sienna",
  "silver",
  "skyblue",
  "slateblue",
  "slategray",
  "slategrey",
  "snow",
  "springgreen",
  "steelblue",
  "tan",
  "teal",
  "thistle",
  "tomato",
  "turquoise",
  "violet",
  "wheat",
  "white",
  "whitesmoke",
  "yellow",
  "yellowgreen",
];

/**
 * A colour written as a value: a hex, a colour function, or a named colour.
 * `oklch`/`oklab`/`lab`/`lch` are here because they are the spellings a modern
 * stylesheet drifts to next, and a gate that only knows `rgb`/`hsl` would wave
 * them through. Case-insensitive, because `RGBA(0, 0, 0, .5)` is legal CSS.
 */
const COLOUR_LITERAL = new RegExp(
  "#[0-9a-f]{3,8}\\b" +
    "|\\b(?:rgba?|hsla?|hwb|oklch|oklab|lab|lch)\\s*\\(" +
    "|\\b(?:" +
    NAMED_COLOURS.join("|") +
    ")\\b",
  "i",
);
/** Same pattern, global — for counting rather than testing. */
const COLOUR_LITERAL_ALL = new RegExp(COLOUR_LITERAL.source, "gi");

/**
 * The literal colours DESIGN.md names as sanctioned, keyed by file and by the
 * whitespace-normalised declaration itself.
 *   - the Popover Lift, the design system's only shadow;
 *   - `.alp-boot-error`, which paints `#f88` because it renders only when
 *     React never mounted, and legibility outranks theming there.
 */
const SANCTIONED_LITERALS = new Map([
  [
    path.join("features", "configurator", "ConfiguratorView.module.css"),
    ["box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3)"],
  ],
  ["styles.css", ["color: #f88"]],
]);

function isSanctioned(rel, declaration) {
  return (SANCTIONED_LITERALS.get(rel) || []).includes(declaration);
}

/** Declarations whose value still contains a colour literal once every
 * `var()` call is stripped away. */
function bareColourDeclarationsIn(text) {
  const out = [];
  const code = withoutComments(text);
  // A declaration may end at `}` instead of `;` when it is the last one in
  // its block, and `border-radius: 4px }` is legal CSS.
  for (const m of code.matchAll(/([-a-zA-Z]+)\s*:\s*([^;{}]+)(?=[;}])/g)) {
    if (!COLOUR_LITERAL.test(stripVarCalls(m[2]))) continue;
    out.push({
      declaration: `${m[1]}: ${m[2].replace(/\s+/g, " ").trim()}`,
      line: code.slice(0, m.index).split("\n").length,
    });
  }
  return out;
}

test("no literal colour ships outside a var() fallback", () => {
  const offenders = [];
  for (const file of FILES) {
    for (const decl of bareColourDeclarationsIn(file.text)) {
      if (isSanctioned(file.rel, decl.declaration)) continue;
      offenders.push(`  ${file.rel}:${decl.line}  ${decl.declaration};`);
    }
  }

  assert.deepEqual(
    offenders.sort(),
    [],
    "these declarations write a colour literal as the value itself. " +
      'DESIGN.md, "Colors", The Borrowed Palette Rule allows one only as the ' +
      "second argument of a var() fallback. To differentiate a surface, wash " +
      "in var(--text-primary) at a low percentage — it inverts with the " +
      "theme, where mixing #000 only ever goes darker and lays a grey slab " +
      "over light themes.",
  );
});

// Same reasoning as the scan self-checks above: pin every way this arm could
// go quiet.
test("the colour scan actually reads the package, fallbacks and all", () => {
  // Count by subtraction rather than by a second pattern: every literal in
  // the file, minus the ones left standing once var() calls are stripped, is
  // exactly the set this arm has to forgive. Counting fallbacks with their own
  // regex would just be the balanced-paren bug again, in the self-check.
  const countLiterals = (text) => (text.match(COLOUR_LITERAL_ALL) || []).length;
  const inFallbacks = FILES.reduce((n, f) => {
    const code = withoutComments(f.text);
    return n + countLiterals(code) - countLiterals(stripVarCalls(code));
  }, 0);
  assert.ok(
    inFallbacks >= 45,
    `only ${inFallbacks} colour literals were seen inside var() fallbacks — ` +
      "the scan is broken, or the package stopped using fallbacks and this " +
      "arm is no longer proving it can tell them apart",
  );

  const sanctioned = FILES.flatMap((f) =>
    bareColourDeclarationsIn(f.text).filter((d) =>
      isSanctioned(f.rel, d.declaration),
    ),
  );
  assert.equal(
    sanctioned.length,
    3,
    `expected the 3 DESIGN.md-sanctioned literals to still be found by the ` +
      `scan, saw ${sanctioned.length} — if a sanctioned site was edited or ` +
      "removed, update SANCTIONED_LITERALS rather than leaving a dead entry " +
      "that could mask a real one",
  );
});

test("a fallback literal, a bare literal and a nested fallback are told apart", () => {
  const bare = (css) => bareColourDeclarationsIn(css).map((d) => d.declaration);

  assert.deepEqual(
    bare("a { color: var(--vscode-charts-green, #89d185); }"),
    [],
    "a literal inside a var() fallback is the rule being followed",
  );
  assert.deepEqual(
    bare("a { color: var(--a, var(--b, rgba(0, 0, 0, 0.1))); }"),
    [],
    "a nested fallback must come out whole — this is what a non-balanced " +
      "regex strip gets wrong",
  );
  assert.deepEqual(
    bare("a { background: color-mix(in srgb, var(--x) 86%, #000 14%); }"),
    ["background: color-mix(in srgb, var(--x) 86%, #000 14%)"],
    "a literal mixed in alongside a var() call is still a bare literal",
  );
  assert.deepEqual(
    bare("a { color: #f88; }"),
    ["color: #f88"],
    "a plain literal value is an offender",
  );
  assert.deepEqual(
    bare("a { background: RGBA(0, 0, 0, 0.5); }"),
    ["background: RGBA(0, 0, 0, 0.5)"],
    "an uppercase colour function is legal CSS and still an offender",
  );
  assert.deepEqual(
    bare("a { background: oklch(0.2 0 0); }"),
    ["background: oklch(0.2 0 0)"],
    "a modern colour function is the spelling a stylesheet drifts to next",
  );
  assert.deepEqual(
    bare("a { border: 1px solid black; }"),
    ["border: 1px solid black"],
    "a named colour is a literal too",
  );
  assert.deepEqual(
    bare("a { background: transparent; color: currentColor; }"),
    [],
    "transparent and currentColor pin no colour and are how this package " +
      "writes take-it-from-context",
  );
  assert.deepEqual(
    bare("a { color: #f88 }"),
    ["color: #f88"],
    "a last declaration in a block may end at `}` with no semicolon",
  );
  assert.deepEqual(
    bare('a { background: url("/* not a comment */x.png"); color: #f88; }'),
    ["color: #f88"],
    "a `/*` inside a quoted url must not blank the rest of the file and " +
      "hide the real violation after it",
  );
  assert.deepEqual(
    bare("a { color: VAR(--x, #fff); }"),
    [],
    "an uppercase VAR( fallback is the rule being followed",
  );
  assert.deepEqual(
    bare("/* the old #000 30% wash */\na { color: var(--text-primary); }"),
    [],
    "a literal quoted in a comment is prose, not a declaration",
  );
  assert.deepEqual(
    bare("/* border-radius: 4px; from before #558 */\na { color: var(--x); }"),
    [],
    "commented-out code supplies both a colon and a semicolon — the most " +
      "common comment content, and the case a naive stripper gets wrong",
  );
  assert.deepEqual(
    bare(
      "a { background: color-mix(in srgb, var(--text-primary) 4%, transparent); }",
    ),
    [],
    "the theme-correct wash this rule steers toward must not itself red",
  );
});

