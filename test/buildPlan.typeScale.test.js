// SPDX-License-Identifier: Apache-2.0
//
// The Build Plan panel's type scale.
//
// THE COMPLAINT was that this panel's fonts read too small. THE REASON it
// needs a gate rather than a review habit is that the scale it draws from is
// FIXED. `packages/alp-webview/src/styles/tokens.css` anchors every step to
// `--vscode-font-size`, which VS Code injects into every webview as a constant
// 13px, tied to no setting (`webview/browser/themeing.ts`) — not
// `editor.fontSize`, which feeds a different variable
// (`--vscode-editor-font-size`) that nothing in this package reads. The
// webview injects no font variable of its own, so the host's fixed value is
// the only input:
//
//   xs 11px · sm 12px · base 13px · md 14px · lg 16px · xl 20px
//
// A reader who finds 11px too small has NO setting that moves it. Window zoom
// scales the whole workbench, so it never changes the relationship between two
// tokens. The only lever is which token a rule names — which makes every size
// choice in this panel permanent, and a permanent 11px on a hex address or a
// diagnostic reason is a correctness problem, not a taste one.
//
// ── WHY THIS FILE, WHEN webview.cssTokens.test.js ALREADY WALKS EVERY .css ──
//
// That gate asserts every token USED is DECLARED, and that a `var()` fallback
// names the value its token really has. It never looks at a bare literal, so
// `font-size: 9px` and `font-size: 10px` sat in `MemoryChart.module.css` —
// axis addresses and the hover readout, drawn at 10px next to 13px body text —
// with the whole suite green.
//
// A gate keyed ONLY on that hole would still have been useless here: the
// literals were five declarations out of the ~35 sites this panel was fixed
// in. Every other one named a token and was simply the wrong token — `xs` on a
// hex base, `xs` on the reason a carve-out did not resolve, `sm` on the warning
// that says why Build is unavailable. So this file gates on THREE things:
//
//   (a) THE TOKEN ARM. Every `font-size` (and every `font` shorthand's size
//       component) must be written EXACTLY as `var(--font-size-<tier>)`, or be
//       the keyword `inherit` — nothing else passes. This affirmatively lists
//       what is ALLOWED rather than enumerating what is forbidden, because a
//       denylist of bad shapes always has one more shape than the list: a
//       keyword (`x-small`), a unit nobody enumerated (`1.4ex`, `0.8vw`), a
//       `calc()` that reads as "names the base token" to a scan that only
//       pattern-matches for the substring while actually rendering smaller
//       (`calc(var(--font-size-base) * 0.8)`), or a `var()` fallback that
//       quietly stops being "exactly" the token. The one exception is named
//       and reasoned about below (SANCTIONED), never silently skipped.
//
//   (b) THE COVERAGE ARM. Every declaration that DOES name a real tier must
//       sit at `var(--font-size-base)` or above — UNLESS its selector's FINAL
//       CLASS is on the CHROME allowlist below, each entry carrying why it is
//       small on purpose. This walks every rule in every `*.module.css` under
//       this directory, not a hand-maintained list of "selectors that render
//       primary content": a positive list needs one entry per selector AND per
//       variant of that selector, and says nothing about a module that does
//       not exist yet — which is exactly how a new selector (`.row .addr`), a
//       brand-new file, or an existing chrome class mutated to a keyword could
//       all ship unseen. CHROME is the only list left, and it is small,
//       reasoned, and matched by class rather than by exact selector string.
//
//   (c) THE SUB-HEADING ARM. The panel has four rungs — xl title, md
//       sub-heading, base body, xs/sm chrome — and only the middle one cannot
//       be held by (b), because `>= base` is satisfied by exactly the mistake
//       it needs to catch: a sub-heading left at the size of the list
//       underneath it. So sub-headings are graded against the body they
//       actually head, and a separate hierarchy check holds the ceiling: that
//       nothing in the panel reaches the panel's own title.
//
// CHROME is not a second coverage list. It exists to name the selectors that
// are small ON PURPOSE and say why, and its own test asserts each one is still
// real and still below reading size — growing it to cover every rule in the
// panel would be the same failure as (b) growing to swallow chrome.
//
// Source text, not a rendered DOM: jsdom performs no layout and the webview
// bundle is IIFE-formatted for the webview's non-module script tag, so there is
// nothing to import. Same idiom as configurator.peripheralChoices.test.js.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const PANEL = path.join(
  __dirname,
  "..",
  "packages",
  "alp-webview",
  "src",
  "features",
  "build-plan",
);

/** Every CSS module in the panel, as `{ name, text }`. Walked rather than
 * listed: a new module added beside these four is gated the day it lands. */
const FILES = fs
  .readdirSync(PANEL)
  .filter((name) => name.endsWith(".module.css"))
  .sort()
  .map((name) => ({
    name,
    text: fs.readFileSync(path.join(PANEL, name), "utf8"),
  }));

/* ── Lexing ────────────────────────────────────────────────────────────────
 * Deliberately self-contained rather than shared with
 * webview.cssTokens.test.js: every gate in this suite carries its own
 * scanners, so one can be re-pointed without silently moving another.
 */

/**
 * Blank `/* … *\/` comments while preserving byte offsets, so reported line
 * numbers stay true. Load-bearing HERE in particular: these four files
 * ARGUE about pixel sizes in prose — "the old 10px / 3px pair", "these labels
 * were 10px", "its font size IS the bar's width" — and a scanner that read
 * comments as code would report the explanation as the defect.
 *
 * Quoted strings are copied whole (`[data-status="ok"]`) so an apostrophe or a
 * `/*` inside one cannot blank the rest of the file.
 */
function withoutComments(text) {
  let out = "";
  let i = 0;
  while (i < text.length) {
    const c = text[i];
    if (c === '"' || c === "'") {
      const end = text.indexOf(c, i + 1);
      const stop = end === -1 ? text.length : end + 1;
      out += text.slice(i, stop);
      i = stop;
      continue;
    }
    if (c === "/" && text[i + 1] === "*") {
      const end = text.indexOf("*/", i + 2);
      const stop = end === -1 ? text.length : end + 2;
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
 * `font-size`, and the `font` shorthand — which carries a size too, so a gate
 * that knew only the long form could be walked straight around with
 * `font: 600 11px/1.4 monospace`. The lookbehind is what keeps `font-size`
 * from also matching as `font`, and keeps `font-family` out of both.
 */
const FONT_SIZE_DECL = /(?<![-\w])(font-size|font)\s*:\s*([^;{}]+)/gi;

/** The scale, low to high. Index is the tier. */
const SCALE = [
  "--font-size-xs",
  "--font-size-sm",
  "--font-size-base",
  "--font-size-md",
  "--font-size-lg",
  "--font-size-xl",
];
const BASE = SCALE.indexOf("--font-size-base");

/** 1-based line of an offset. */
const lineOf = (text, index) => text.slice(0, index).split("\n").length;

/**
 * Every type-setting declaration in a stylesheet, as
 * `{ selector, property, value, line }` — one entry PER SELECTOR, so
 * `.markerLabel, .bandLabel { … }` is reported under both names and either can
 * be named in the CHROME allowlist below.
 *
 * The rule pattern is flat (`selector { body }` with no `{}` inside). These
 * four files carry no `@media` and no nesting; were one added, its inner rules
 * would still be matched individually — the wrapper is what gets skipped, not
 * the declarations.
 */
function typeRulesIn(text) {
  const code = withoutComments(text);
  const out = [];
  for (const rule of code.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const bodyStart = rule.index + rule[1].length + 1;
    for (const decl of rule[2].matchAll(FONT_SIZE_DECL)) {
      const value = decl[2].replace(/\s+/g, " ").trim();
      const line = lineOf(code, bodyStart + decl.index);
      for (const selector of rule[1]
        .split(",")
        .map((s) => s.replace(/\s+/g, " ").trim())
        .filter(Boolean)) {
        out.push({ selector, property: decl[1].toLowerCase(), value, line });
      }
    }
  }
  return out;
}

const RULES = FILES.flatMap((f) =>
  typeRulesIn(f.text).map((r) => ({ ...r, file: f.name })),
);

/* ── Grading a font-size value ────────────────────────────────────────────
 * The core of the redesign: instead of asking "does this value contain a bad
 * shape we thought to look for", these ask "is this value written EXACTLY
 * one of the two shapes the scale allows". Anything else is invalid by
 * construction, so a keyword, an unenumerated unit, a calc(), or a fallback
 * never needs its own denylist entry to be caught.
 */

/**
 * Isolates the piece of a declaration's value that actually sets the
 * font-size. For a `font-size` declaration that is the whole value. For the
 * `font` shorthand it is buried behind optional style / variant / weight
 * tokens and a trailing family, with an optional `/<line-height>` glued
 * directly onto the size (`size/line-height family`) — so `.fileToggle`'s
 * `font: inherit` (a keyword covering the WHOLE shorthand) and a
 * `font: var(--font-size-base)/19px var(--text-mono)` both need grading on
 * their SIZE, not on their family or their line-height. Reading a `/19px`
 * line-height AS a font-size is exactly how a legitimately token-sized
 * shorthand could fail this file's own check.
 *
 * Deliberately narrow rather than a general shorthand parser: the only two
 * shapes this file has ever needed to grade are the whole-value keyword and
 * "size/line-height family", so that is all it handles.
 */
function isolateSize(property, value) {
  const trimmed = value.trim();
  if (property !== "font") return trimmed;
  if (trimmed.toLowerCase() === "inherit") return trimmed;
  const slash = trimmed.indexOf("/");
  if (slash === -1) return trimmed;
  return trimmed.slice(0, slash).trim().split(/\s+/).pop();
}

/**
 * Grades a rule's font-size value against the scale. The ONLY things that
 * pass are a token named EXACTLY `var(--font-size-<tier>)` and the `inherit`
 * keyword — no `calc()`, no `var()` fallback, no other custom property, no
 * CSS keyword size (`x-small`), no other CSS unit (`1.4ex`, `0.8vw`, `90%`).
 */
function gradeFontSize(rule) {
  const size = isolateSize(rule.property, rule.value);
  if (size.toLowerCase() === "inherit") return { kind: "inherit" };
  const m = /^var\(\s*(--font-size-[a-z]+)\s*\)$/i.exec(size);
  if (m) {
    const tier = SCALE.indexOf(m[1].toLowerCase());
    if (tier !== -1) return { kind: "token", tier };
  }
  return { kind: "invalid", text: size };
}

/**
 * What is wrong with a rejected value, in words — used only for the failure
 * message. The pass/fail decision itself lives entirely in `gradeFontSize`'s
 * one regex; this never gates anything on its own.
 */
function describeInvalid(text) {
  if (/^calc\(/i.test(text)) {
    return (
      "an arithmetic expression, not one of the scale's tokens named " +
      "exactly — it may render on-scale today, but neither a reader nor a " +
      "scan that only pattern-matches for a token's name can tell that " +
      "without evaluating it"
    );
  }
  const varRef = /^var\(\s*(--[a-z0-9-]+)/i.exec(text);
  if (varRef) {
    return /^--font-size-/i.test(varRef[1])
      ? "a var() naming a size token, but not written as exactly " +
          "`var(--font-size-<tier>)` — a fallback length or stray text " +
          "keeps it from matching the scale exactly"
      : `a token that is not a size token: var(${varRef[1]})`;
  }
  return `\`${text}\` — not one of the scale's six tokens or \`inherit\``;
}

/**
 * The right-most class named in a selector — `.row .addr` grades as
 * `.addr`, and `.manifestStatus[data-status="ok"]` grades as
 * `.manifestStatus`. This is what lets the CHROME allowlist below match a new
 * selector variant (a descendant combinator, a hover scope, an attribute
 * modifier) by class name instead of needing one entry per exact selector
 * string.
 *
 * A selector whose right-most compound has no class of its own (`.note p`)
 * falls back to the last class named anywhere in the string. That case does
 * not arise for any selector below reading size in this panel today; a
 * genuine future need to distinguish it is a reason to revisit this
 * function, not to route around it here.
 */
function finalClassOf(selector) {
  const classes = selector.match(/\.[A-Za-z_-][\w-]*/g);
  return classes ? classes[classes.length - 1] : null;
}

// ---------------------------------------------------------------------------
// (a) The token arm
// ---------------------------------------------------------------------------
//
// The carve-out is a NAMED entry carrying its reason, never a silent skip: the
// next reader has to be able to see what was forgiven and why, and the entry
// pins the exact value so a change to it has to be re-argued rather than
// inherited.

const SANCTIONED = [
  {
    file: "MemoryChart.module.css",
    selector: ".apertureLabel",
    value: "9px",
    why:
      "GEOMETRY-PINNED, not an oversight. This label is drawn `rotate(-90)` " +
      "down the middle of its own aperture bar, and that bar is " +
      "APERTURE_W = 9 user units wide (MemoryChart.tsx). For a rotated label " +
      "the font size IS the bar's width, so `--font-size-base` (13px) would " +
      "push the glyphs out both sides of the aperture they name. This number " +
      "moves when APERTURE_W moves, and not before — see the companion test " +
      "below, which re-reads APERTURE_W rather than trusting this sentence.",
  },
];

const isSanctioned = (rule) =>
  SANCTIONED.some(
    (s) =>
      s.file === rule.file &&
      s.selector === rule.selector &&
      s.value === rule.value,
  );

test("every font-size in the Build Plan panel names a scale token, `inherit`, or the sanctioned literal", () => {
  const offenders = [];
  for (const rule of RULES) {
    const grade = gradeFontSize(rule);
    if (grade.kind !== "invalid") continue;
    if (isSanctioned(rule)) continue;
    offenders.push(
      `  ${rule.file}:${rule.line}  ${rule.selector} { ${rule.property}: ` +
        `${rule.value} }  — ${describeInvalid(grade.text)}`,
    );
  }

  assert.deepEqual(
    offenders.sort(),
    [],
    "these declarations set type with something other than an exact " +
      "--font-size-* token or `inherit`: a raw length, a keyword, a unit the " +
      "scale never anchors to the workbench font, or a calc() a scan cannot " +
      "verify by pattern-matching alone. This is how `font-size: 10px` " +
      "shipped on the memory chart's axis addresses and hover readout, and " +
      "how a keyword or an unenumerated unit (`x-small`, `0.8vw`) could pass " +
      "any check keyed on a denylist of known-bad shapes instead of an " +
      "allowlist of the two good ones. A literal or keyword is also " +
      "permanent — the scale is anchored to the WORKBENCH font size " +
      "(--vscode-font-size), so nothing the reader can change moves it. If " +
      "a size really is pinned by geometry rather than by the type scale, " +
      "add it to SANCTIONED above WITH the fact that pins it, the way " +
      ".apertureLabel names APERTURE_W.",
  );
});

// A carve-out that outlives its reason is just a hole. This re-derives the
// aperture label's from the drawing itself: if the bar grows, the label can
// take a real token and the exemption has to go.
test("the one sanctioned pixel size is still the geometry that justifies it", () => {
  const tsx = fs.readFileSync(path.join(PANEL, "MemoryChart.tsx"), "utf8");

  const width = /const APERTURE_W = (\d+);/.exec(tsx);
  assert.ok(
    width,
    "MemoryChart.tsx must declare `const APERTURE_W = <n>;` — it is the whole " +
      "justification for .apertureLabel's 9px. If the constant was renamed, " +
      "re-derive the carve-out rather than deleting this check.",
  );

  const rule = RULES.find(
    (r) =>
      r.file === "MemoryChart.module.css" && r.selector === ".apertureLabel",
  );
  assert.ok(
    rule,
    ".apertureLabel no longer sets a font-size in MemoryChart.module.css — if " +
      "the rotated label is gone, delete its SANCTIONED entry too; a dead " +
      "allowlist entry is a hole waiting for the next class of that name.",
  );

  const declared = Number.parseFloat(rule.value);
  const bar = Number.parseInt(width[1], 10);
  assert.ok(
    declared <= bar,
    `.apertureLabel is ${rule.value} inside a bar APERTURE_W = ${bar} units ` +
      "wide. A rotated label's font size is its bar's width, so this spills " +
      "out of the aperture it names.",
  );
  assert.ok(
    bar < 13,
    `APERTURE_W is now ${bar} units — wide enough for the panel's reading ` +
      "size (13px at the workbench default). The reason .apertureLabel is " +
      "exempt from the token scale no longer holds: give it " +
      "var(--font-size-base) and drop its SANCTIONED entry.",
  );

  const at = tsx.indexOf("styles.apertureLabel");
  assert.ok(
    at !== -1 && tsx.slice(at, at + 400).includes("rotate(-90)"),
    "the aperture label is no longer drawn rotate(-90) — an upright label is " +
      "bounded by the rail, not by APERTURE_W, so the carve-out's reasoning " +
      "does not apply to it and 9px is just small",
  );
});

// ---------------------------------------------------------------------------
// (b) The coverage arm
// ---------------------------------------------------------------------------
//
// Every rule in every `*.module.css` under this directory is graded, not a
// hand-picked list of "selectors that render primary content". A positive
// list needs one entry per selector AND per variant of that selector (`.addr`
// and a later `.row .addr` are two different exact strings), and it says
// nothing at all about a module that does not exist yet. CHROME below is the
// only list left, and it works the other way around: it names the selectors
// that are SMALL ON PURPOSE, by final class rather than by exact string, so a
// new selector inherits the same call its class already made.
//
// SUB-HEADINGS are graded here too — `.unresolvedTitle`, `.conflictsTitle` and
// MemoryNotes' `.title` are md, which trivially clears `>= base` — but
// `>= base` could never have PINNED them there: base also satisfies it, and
// base is exactly where all three sat before this panel was fixed. Their own
// arm below grades them against the body they actually head instead.

const CHROME = [
  {
    class: ".backend",
    why:
      "an uppercase, 0.04em-tracked, weight-600 pill naming the slice's OS " +
      "— a category, glanced at, and it shares its line with `.coreId`, " +
      "which is the name being read",
  },
  {
    class: ".manifestBadge",
    why:
      "the uppercase tracked freshness badge — one recoloured word read as " +
      "a state, not as a sentence",
  },
  {
    class: ".manifestSubTitle",
    why:
      "the LABEL register (uppercase, 0.04em tracked, weight 600) over the " +
      "IPC-link / helper-MCU chips, the same register `.sectionTitle` and " +
      "`.backend` are in — not a heading in the panel's four-rung ladder",
  },
  {
    class: ".sectionTitle",
    why:
      "uppercase + 0.04em + 600: a LABEL register, not a heading in this " +
      "panel's four-rung ladder, and a label set at body size shouts " +
      "instead of labelling",
  },
  {
    class: ".kind",
    why:
      "small deliberately, and NOT because it is a tracked badge: it has a " +
      "tinted background and nothing else — no uppercase, no " +
      "letter-spacing, no weight. It is small so that `.status` beside it, " +
      "at base, reads as the verdict while this reads as the category " +
      "('carve-out')",
  },
  {
    class: ".manifestAge",
    why:
      "rides the badge on the `.sectionTitle` line — raising it would " +
      "leave the age reading larger than the heading it sits inside",
  },
];

test("nothing outside the chrome allowlist is set below the reading size", () => {
  const offenders = [];
  for (const rule of RULES) {
    const grade = gradeFontSize(rule);
    // Invalid values are arm (a)'s failure to report, not this one's, and
    // `inherit` names no tier this arm can rank.
    if (grade.kind !== "token") continue;
    if (grade.tier >= BASE) continue;
    const cls = finalClassOf(rule.selector);
    if (CHROME.some((c) => c.class === cls)) continue;
    offenders.push(
      `  ${rule.file}:${rule.line}  ${rule.selector} { ${rule.property}: ` +
        `${rule.value} } sits at ${SCALE[grade.tier]}, below ` +
        `var(--font-size-base) (13px), and its final class ` +
        `(${cls ?? "none"}) is not on the CHROME allowlist below.`,
    );
  }

  assert.deepEqual(
    offenders.sort(),
    [],
    "these declarations render text below the panel's reading size without " +
      "being named on the CHROME allowlist. That was the whole complaint " +
      "this panel was fixed for: the scale is anchored to the workbench " +
      "font size, so a size below base is 11px or 12px permanently and no " +
      "reader setting moves it. This check walks every selector in every " +
      "`*.module.css` under this directory — a new selector variant " +
      "(`.row .addr`), a brand new module, or an existing chrome class " +
      "mutated to a smaller size are all covered the same way, unlike a " +
      'hand-maintained list of "primary" selectors. Monospace does not ' +
      "count as a reason to go smaller — the family buys column alignment, " +
      "not a size — and neither does a tinted pill: the shell is the " +
      "chrome, the word inside it is still read. If a class really is " +
      "chrome — small on purpose, with a reason — add it to CHROME above, " +
      "not here.",
  );
});

test("chrome stays below the reading size", () => {
  // A separate concern from "the type scan actually reads the panel" below,
  // which is about whether the SCAN works. This test is about whether the
  // PANEL still draws the distinction between what is read and what is
  // glanced at, and it covers every CHROME entry.
  assert.ok(
    CHROME.length > 0,
    "the CHROME allowlist is empty — either restore its entries or delete " +
      "the exemption from the coverage arm above",
  );

  const offenders = [];
  for (const entry of CHROME) {
    const matches = RULES.filter(
      (r) => finalClassOf(r.selector) === entry.class,
    );
    if (matches.length === 0) {
      offenders.push(
        `  CHROME names ${entry.class}, which no rule in the panel sets a ` +
          `font-size on any more. It was exempted because: ${entry.why}. ` +
          "Re-point or remove this entry rather than leaving it to forgive " +
          "a class that no longer exists.",
      );
      continue;
    }
    for (const rule of matches) {
      const grade = gradeFontSize(rule);
      if (grade.kind !== "token") continue; // graded (or exempted) elsewhere
      if (grade.tier < BASE) continue;
      offenders.push(
        `  ${rule.file}:${rule.line}  ${entry.class} is ${SCALE[grade.tier]}` +
          `, no longer below the reading size. It is ${entry.why}.`,
      );
    }
  }

  assert.deepEqual(
    offenders.sort(),
    [],
    "a CHROME entry has either gone stale (names a class the panel no " +
      "longer sets a font-size on) or grown back up to reading size (lost " +
      "the distinction it was exempted to keep). If the allowlist has grown " +
      "to cover every rule in the panel, it has stopped drawing the " +
      "distinction it exists to draw.",
  );
});

// ---------------------------------------------------------------------------
// (c) The sub-heading arm
// ---------------------------------------------------------------------------
//
// The four rungs, and the middle one is the one that keeps collapsing:
//
//   panel title   xl    20px   `.title` (BuildPlanView)
//   sub-heading   md    14px   this list
//   body / data   base  13px   the coverage arm above
//   chrome        xs/sm 11-12px the CHROME allowlist above
//
// `>= base` cannot hold a sub-heading, because base is precisely the mistake:
// all three of these sat AT the size of the list underneath them before this
// fix — a rung spent on nothing, with weight and colour left carrying a rank
// that size is the only signal for. So this arm grades a sub-heading against
// the body it actually heads and demands it be STRICTLY larger.
//
// Only the lower edge is graded here. The ceiling — that no sub-heading
// reaches the panel's own xl `.title` — is already held by the hierarchy test
// below, which ranks EVERY rule in the panel against that title, so restating
// it per-entry would be a second gate on one fact.
//
// `heads` names real markup, read off the components rather than assumed:
// `.unresolvedTitle` is the <p> over the `.unresolved` list whose rows carry
// `.rowName` and `.reason`; `.conflictsTitle` sits over `.conflictRow` items
// carrying `.rowName` and `.conflictKind`; MemoryNotes' `.title` is the <h4>
// of a `<section class=note>` whose paragraphs are `.note p`.

const SUB_HEADINGS = [
  {
    file: "MemoryRegions.module.css",
    selector: ".unresolvedTitle",
    heads: [".rowName", ".reason"],
    why: "'Declared, not placed (N)' — the heading over the extents the manifest never resolved",
  },
  {
    file: "MemoryRegions.module.css",
    selector: ".conflictsTitle",
    heads: [".rowName", ".conflictKind"],
    why: "'N extents land on others' — the heading over the one thing this view knows that the manifest does not",
  },
  {
    file: "MemoryNotes.module.css",
    selector: ".title",
    heads: [".note p"],
    why: "the <h4> over each note section, in a tab that is nothing but prose",
  },
];

/**
 * The tiers a selector is set to in one file, with anything that is not an
 * exact scale token dropped: an invalid value cannot be RANKED, and it is
 * already the token arm's failure to report.
 */
const tiersOf = (file, selector) =>
  RULES.filter((r) => r.file === file && r.selector === selector)
    .map((r) => gradeFontSize(r))
    .filter((g) => g.kind === "token")
    .map((g) => g.tier);

test("a sub-heading outranks the body it heads", () => {
  const offenders = [];
  for (const entry of SUB_HEADINGS) {
    // A selector set more than once is graded at its SMALLEST, and the body at
    // its LARGEST: the gap has to hold on every pairing, not on the flattering
    // one.
    const heading = tiersOf(entry.file, entry.selector);
    if (heading.length === 0) {
      offenders.push(
        `  ${entry.file}  ${entry.selector} sets no font-size the scale can ` +
          `rank — renamed, dropped, or given an invalid value. It is ${entry.why}; ` +
          `re-point this entry rather than deleting it.`,
      );
      continue;
    }
    const at = Math.min(...heading);
    for (const bodySelector of entry.heads) {
      const body = tiersOf(entry.file, bodySelector);
      if (body.length === 0) {
        offenders.push(
          `  ${entry.file}  ${entry.selector} claims to head ${bodySelector}, ` +
            `which sets no rankable font-size — the markup moved. Re-read the ` +
            `component and name the class that renders its body now.`,
        );
        continue;
      }
      const under = Math.max(...body);
      if (at > under) continue;
      offenders.push(
        `  ${entry.file}  ${entry.selector} is ${SCALE[at]} and ${bodySelector} ` +
          `beneath it is ${SCALE[under]} — a heading no larger than its own ` +
          `body. This is ${entry.why}.`,
      );
    }
  }

  assert.deepEqual(
    offenders.sort(),
    [],
    "a sub-heading has stopped outranking the text under it. This panel has " +
      "four rungs and three token steps between them — xl (20px) for the " +
      "panel title, md (14px) for a sub-heading inside it, base (13px) for " +
      "everything a person reads, xs/sm for chrome — so a sub-heading left " +
      "at base is the same size as the list it introduces and asks weight " +
      "and colour to carry a rank only size can signal. Fix it with " +
      "var(--font-size-md): do not raise the body to restore the gap, and do " +
      "not reach the panel's own title.",
  );
});

// ---------------------------------------------------------------------------
// Hierarchy
// ---------------------------------------------------------------------------
//
// Inverting the hierarchy was the single most common error while this panel
// was being resized: raise a sub-heading far enough and it starts reading as
// the panel's title. `.title` is DESIGN.md's Display size (xl, "panel titles
// only, one per view"), matching ModelsView's own editor-tab title
// (`src/models/panel.ts`) rather than sitting a rung below it. The floor below
// is `>= lg` rather than an equality on xl specifically — this test's job is
// that nothing else in the panel reaches the title, whatever tier the title
// itself sits at, not that the title is pinned to one exact value forever.

test("nothing inside the panel reaches the panel's own title", () => {
  const titleRule = RULES.find(
    (r) => r.file === "BuildPlanView.module.css" && r.selector === ".title",
  );
  assert.ok(
    titleRule,
    "BuildPlanView.module.css must set a font-size on `.title` — it is the " +
      "reference every other size in the panel is ranked against",
  );
  const titleGrade = gradeFontSize(titleRule);
  assert.equal(
    titleGrade.kind,
    "token",
    `the panel title is \`${titleRule.value}\` — it must be one of the ` +
      "scale's own tokens, not a literal or a calc(), or nothing else in " +
      "the panel can be ranked against it",
  );
  const titleTier = titleGrade.tier;
  assert.ok(
    titleTier >= SCALE.indexOf("--font-size-lg"),
    `the panel title is ${titleRule.value} — it has to outrank 13px body ` +
      "text by more than a step or the panel reads as one flat wall of text",
  );

  const offenders = RULES.filter((r) => r !== titleRule)
    .map((r) => ({ rule: r, grade: gradeFontSize(r) }))
    .filter(({ grade }) => grade.kind === "token" && grade.tier >= titleTier)
    .map(
      ({ rule, grade }) =>
        `  ${rule.file}:${rule.line}  ${rule.selector} { font-size: ` +
        `${rule.value} }  — the panel title is ${titleRule.value} ` +
        `(${SCALE[grade.tier]} reaches or passes it)`,
    );

  assert.deepEqual(
    offenders.sort(),
    [],
    "a sub-heading inside the panel has reached or passed the panel's own " +
      "title (`.title` in BuildPlanView.module.css). Size is the only signal " +
      "that says which of two headings contains the other, and a section " +
      "that reads as large as the page it sits on inverts that. A sub-heading " +
      "here is var(--font-size-md) — one rung under this title and one over " +
      "the base body it heads, which is what `.unresolvedTitle`, " +
      "`.conflictsTitle` and MemoryNotes' `.title` take; the arm above holds " +
      "that lower edge, this one holds the ceiling.",
  );
});

// ---------------------------------------------------------------------------
// The scan itself
// ---------------------------------------------------------------------------
//
// A gate that reads nothing passes forever. These pin the ways THIS scan
// could go quiet: no files, a rule pattern that matches nothing, or an
// allowlist with nothing real behind it. Whether CHROME itself still holds is
// a separate concern with its own test above — this one is about the scan's
// own health, not the panel's.

test("the type scan actually reads the panel", () => {
  assert.ok(
    FILES.length >= 4,
    `found only ${FILES.length} CSS modules under ${path.relative(
      path.join(__dirname, ".."),
      PANEL,
    )} — the walker is broken, not the panel`,
  );
  assert.ok(
    RULES.length >= 30,
    `parsed only ${RULES.length} font-size declarations — the rule pattern is ` +
      "broken and both arms are grading almost nothing",
  );
  assert.ok(
    RULES.some((r) => gradeFontSize(r).kind === "token"),
    "no tokenised font-size was seen at all — the token pattern is broken",
  );

  // The allowlist must have something real behind it. A dead entry is worse
  // than none: it silently forgives the next rule that inherits the name.
  for (const s of SANCTIONED) {
    assert.ok(
      RULES.some(
        (r) =>
          r.file === s.file && r.selector === s.selector && r.value === s.value,
      ),
      `SANCTIONED names ${s.file} ${s.selector} { ${s.value} }, which the ` +
        "scan does not find. Remove the entry rather than leaving it to " +
        "forgive something it was never written for.",
    );
  }
});

test("a token, a keyword, a calc, and a shorthand's size are graded correctly", () => {
  assert.deepEqual(
    gradeFontSize({ property: "font-size", value: "var(--font-size-base)" }),
    { kind: "token", tier: BASE },
    "a plain token must grade as that tier",
  );
  assert.deepEqual(
    gradeFontSize({ property: "font-size", value: "VAR(--font-size-base)" }),
    { kind: "token", tier: BASE },
    "CSS keywords are case-insensitive — an uppercase VAR( is still a token",
  );
  assert.deepEqual(
    gradeFontSize({ property: "font", value: "inherit" }),
    { kind: "inherit" },
    "`font: inherit` is how `.fileToggle` makes a <button> take its row's " +
      "size instead of the UA's, and it must pass",
  );

  for (const bad of [
    "calc(var(--font-size-base) * 0.8)",
    "x-small",
    "1.4ex",
    "0.8vw",
    "90%",
    "10px",
    "var(--font-size-base, 13px)",
    "var(--space-4)",
  ]) {
    assert.equal(
      gradeFontSize({ property: "font-size", value: bad }).kind,
      "invalid",
      `\`${bad}\` must not grade as a valid size — it is exactly the shape ` +
        "of regression this arm exists to catch (arithmetic, a keyword, an " +
        "unenumerated unit, a fallback that stops being 'exactly' the " +
        "token, or a token that names something other than a size)",
    );
  }

  assert.equal(
    gradeFontSize({ property: "font", value: "600 11px/1.4 monospace" }).kind,
    "invalid",
    "the `font` shorthand carries a size, and a gate that knew only " +
      "`font-size` could be walked straight around it",
  );
  assert.deepEqual(
    gradeFontSize({
      property: "font",
      value: "var(--font-size-base)/19px var(--text-mono)",
    }),
    { kind: "token", tier: BASE },
    "the size component is tokenised; the px AFTER THE SLASH is the " +
      "shorthand's line-height, not its font-size, and must not be graded " +
      "as one — that would fail a legitimately token-sized rule for a " +
      "reason that has nothing to do with its size",
  );
});

test("isolateSize strips a font shorthand's line-height and family, not its size", () => {
  assert.equal(
    isolateSize("font-size", "var(--font-size-base)"),
    "var(--font-size-base)",
    "font-size has no shorthand to unwrap",
  );
  assert.equal(
    isolateSize("font", "inherit"),
    "inherit",
    "a CSS-wide keyword covers the whole shorthand, not just the size slot",
  );
  assert.equal(
    isolateSize("font", "600 11px/1.4 monospace"),
    "11px",
    "the size is the token immediately before the slash, weight and style " +
      "keywords stripped off",
  );
  assert.equal(
    isolateSize("font", "var(--font-size-base)/19px var(--text-mono)"),
    "var(--font-size-base)",
    "the size is the token immediately before the slash even when the " +
      "line-height and family both follow it",
  );
});

test("finalClassOf matches the selector CHROME actually names", () => {
  assert.equal(finalClassOf(".backend"), ".backend");
  assert.equal(
    finalClassOf(".row .addr"),
    ".addr",
    "a descendant-combinator variant of an existing selector must resolve " +
      "to the same final class as the plain one",
  );
  assert.equal(
    finalClassOf('.manifestStatus[data-status="ok"]'),
    ".manifestStatus",
    "an attribute selector must not be read as part of the class name, and " +
      "the quoted value inside it must not be mistaken for one either",
  );
  assert.equal(
    finalClassOf(".scaleBtn:last-child"),
    ".scaleBtn",
    "a pseudo-class is not a class selector and must not change which class " +
      "is final",
  );
});

test("a token, a comma list, a shorthand-family and prose are told apart", () => {
  const sizes = (css) =>
    typeRulesIn(css).map((r) => `${r.selector}=${r.value}`);

  assert.deepEqual(
    sizes(".a { font-size: var(--font-size-base); }"),
    [".a=var(--font-size-base)"],
    "a plain tokenised rule must parse",
  );
  assert.deepEqual(
    sizes(".a,\n.b { font-size: var(--font-size-base); }"),
    [".a=var(--font-size-base)", ".b=var(--font-size-base)"],
    "a comma-separated selector list is reported under every name in it — " +
      "`.markerLabel, .bandLabel` is written that way in the real file",
  );
  assert.deepEqual(
    sizes(".a { font-family: var(--text-mono); color: red; }"),
    [],
    "font-family is not font-size, and must not be graded as type",
  );
  assert.deepEqual(
    sizes("/* font-size: 10px; before the fix */\n.a { color: red; }"),
    [],
    "these files ARGUE about pixel sizes in prose — a commented-out " +
      "declaration supplies both a colon and a semicolon, and reading it as " +
      "code would report the explanation as the defect",
  );
  assert.deepEqual(
    sizes('.a[data-status="ok"] { font-size: var(--font-size-sm); }'),
    ['.a[data-status="ok"]=var(--font-size-sm)'],
    "an attribute selector's quoted string must survive the comment strip",
  );
});
