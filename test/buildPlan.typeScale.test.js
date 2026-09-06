// SPDX-License-Identifier: Apache-2.0
//
// The Build Plan panel's type scale.
//
// THE COMPLAINT was that this panel's fonts read too small. THE REASON it
// needs a gate rather than a review habit is that the scale it draws from is
// FIXED IN PRACTICE. `packages/alp-webview/src/styles/tokens.css` anchors every
// step to `--vscode-font-size`, which is VS Code's WORKBENCH font size — not
// `editor.fontSize`, which is a different variable (`--vscode-editor-font-size`)
// that nothing in this package reads. The webview injects no font variable of
// its own, so the host's value is the only input and it is 13px on practically
// every install:
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
// that says why Build is unavailable. So this file gates BOTH halves:
//
//   (a) THE LITERAL ARM. No `font-size` in the panel writes a bare length. The
//       one survivor is allowlisted BY NAME WITH ITS REASON below, and a
//       companion test re-derives that reason from the geometry it claims, so
//       the carve-out cannot outlive the fact that justified it.
//
//   (b) THE TIER ARM. The classes that render primary content — the text a
//       user READS rather than glances at — never sit below
//       `var(--font-size-base)`. Each entry carries WHY it is primary, and the
//       failure message prints it, so someone moving one back down reads the
//       argument instead of just a red test.
//
//   (c) THE SUB-HEADING ARM. The panel has four rungs — lg title, md
//       sub-heading, base body, xs chrome — and only the middle one cannot be
//       held by (b), because `>= base` is satisfied by exactly the mistake it
//       needs to catch: a sub-heading left at the size of the list underneath
//       it. So sub-headings are graded against the body they actually head.
//
// Chrome is deliberately NOT in the tier list, and it is two different shapes,
// so it is named as two rather than as one wrong generalisation. The LABEL
// register — uppercase, 0.04em tracked, weight 600 — is `.backend`,
// `.manifestBadge` and `.manifestSubTitle` at xs, and `.sectionTitle` at sm.
// The other two carry none of those three properties and are small for reasons
// of their own: `.kind` is xs so that `.status` beside it, at base, reads as
// the verdict while it reads as the category, and `.manifestAge` is xs because
// it rides the badge on a `.sectionTitle` line and must not out-read the
// heading it sits inside. A gate that reddened any of them would be a gate
// someone deletes — after which the readable text drifts back down.
//
// `.manifestStatus` is NOT chrome and IS in the tier list. It is the same
// construct as MemoryRegions' `.status` — a color-mix pill, weight 600,
// `1px var(--space-2)`, radius-full, neither uppercase nor tracked — wrapped
// around a status word taken verbatim from the manifest. The pill is the
// chrome; the word inside it is the verdict.
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
 * Remove every `var(...)` call, counting parens so a nested fallback comes out
 * whole. `/var\([^()]*\)/` would stop at the first inner `(` and leave the
 * fallback's literal standing — reporting the rule being FOLLOWED.
 */
function stripVarCalls(value) {
  let out = "";
  let i = 0;
  while (i < value.length) {
    // CSS keywords are case-insensitive: `VAR(--font-size-base)` is tokenised.
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
 * be named in the tier list below.
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

/** The `--font-size-*` token a value names, or null when it names none. */
function tokenOf(value) {
  const m = value.match(/var\(\s*(--font-size-[a-z]+)/i);
  return m ? m[1].toLowerCase() : null;
}

/**
 * What is wrong with a type value, or null when nothing is.
 *
 * Two ways to leave the scale, and the second is the sneakier: a `var()` that
 * names a token which is not a SIZE token ships a font the scale does not
 * contain while wearing a token's clothes.
 */
function untokenisedType(value) {
  for (const ref of value.matchAll(/var\(\s*(--[a-z0-9-]+)/gi)) {
    if (!/^--font-size-/i.test(ref[1])) {
      return {
        kind: "a token that is not a size token",
        text: `var(${ref[1]})`,
      };
    }
  }
  const remainder = stripVarCalls(value)
    .replace(/!\s*important/gi, " ")
    .trim();
  // Absolute units AND the relative ones: `0.9em` under-sizes exactly as
  // permanently as `11px` does, since the parent it is relative to is itself
  // pinned to the workbench's 13px. Keywords (`inherit`, and the `font:
  // inherit` on `.fileToggle` that makes a <button> take its row's size) carry
  // no length and are left alone.
  const literal = remainder.match(
    /-?(?:\d+\.?\d*|\.\d+)\s*(?:px|pt|pc|in|cm|mm|q|rem|em|%)/i,
  );
  return literal ? { kind: "a bare length", text: literal[0].trim() } : null;
}

// ---------------------------------------------------------------------------
// (a) The literal arm
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

test("no font-size in the Build Plan panel writes a bare length", () => {
  const offenders = [];
  for (const rule of RULES) {
    const problem = untokenisedType(rule.value);
    if (!problem) continue;
    if (isSanctioned(rule)) continue;
    offenders.push(
      `  ${rule.file}:${rule.line}  ${rule.selector} { ${rule.property}: ` +
        `${rule.value} }  — ${problem.kind}: ${problem.text}`,
    );
  }

  assert.deepEqual(
    offenders.sort(),
    [],
    "these declarations set type with a raw length instead of naming a " +
      "--font-size-* token. This is how `font-size: 10px` shipped on the " +
      "memory chart's axis addresses and hover readout: every existing gate " +
      "checks tokens that ARE named, so a rule that names none is invisible " +
      "to all of them. A literal is also permanent — the scale is anchored to " +
      "the WORKBENCH font size (--vscode-font-size), so nothing the reader " +
      "can change moves it. If a size really is pinned by geometry rather " +
      "than by the type scale, add it to SANCTIONED above WITH the fact that " +
      "pins it, the way .apertureLabel names APERTURE_W.",
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
// (b) The tier arm
// ---------------------------------------------------------------------------
//
// Derived from the applied fix, selector by selector — not from a rule of
// thumb. `why` is printed on failure: the point is that someone moving one of
// these back down reads the argument, not a diff of two token names.
//
// A note on what is ABSENT, and it is three things, each for its own reason.
//
// Mono is a FAMILY decision and never on its own a reason to drop a size,
// which is why `.addr`, `.reason`, `.rowName`, `.manifestTarget`,
// `.manifestFlash`, `.manifestChip` and `.fileContent` are all in this list
// despite being monospace. A tinted shell is not a reason either:
// `.manifestChip`, `.manifestStatus` and `.status` sit here with their
// backgrounds intact, because a pill is a shell and the words inside one are
// still read character by character.
//
// SUB-HEADINGS are not here. `.unresolvedTitle`, `.conflictsTitle` and
// MemoryNotes' `.title` are md, which this arm's `>= base` could never pin —
// base satisfies it, and base is exactly where all three sat before the fix.
// They have their own arm below.
//
// CHROME is not here either, and the guard at the bottom of this file asserts
// it stays out: a tier list that grew to cover every rule in the panel would
// have stopped drawing the distinction it exists to draw.

const PRIMARY = [
  // ── BuildPlanView.module.css ──
  {
    file: "BuildPlanView.module.css",
    selector: ".subtitle",
    why: "the sentence explaining what the panel is showing",
  },
  {
    file: "BuildPlanView.module.css",
    selector: ".sku",
    why: "the SoM part number this plan was resolved for — one character apart from a different module",
  },
  {
    file: "BuildPlanView.module.css",
    selector: ".boardYaml",
    why: "the path to the board.yaml this plan was read from, i.e. the file the user opens to change any of it",
  },
  {
    file: "BuildPlanView.module.css",
    selector: ".buildNote",
    why: "the sentence saying WHY Build is unavailable and which cores have no command — a warning nobody bothers to read is a warning that did not happen",
  },
  {
    file: "BuildPlanView.module.css",
    selector: ".coreId",
    why: "the core the slice builds for (m55_he vs m55_hp is one letter)",
  },
  {
    file: "BuildPlanView.module.css",
    selector: ".cmd",
    why: "the exact command line the panel says it will run — the user copies it into a terminal, so a misread flag is a wrong build",
  },
  {
    file: "BuildPlanView.module.css",
    selector: ".sliceMeta",
    why: "the build directory the slice's artefacts land in",
  },
  {
    file: "BuildPlanView.module.css",
    selector: ".envRow",
    why: "the environment the build runs with, key and value — an env value read wrong is a build nobody can reproduce",
  },
  {
    file: "BuildPlanView.module.css",
    selector: ".fileRow",
    why: "the generated artefact's path; `.filePath` has no size of its own and inherits through this row (via `font: inherit` on the <button>)",
  },
  {
    file: "BuildPlanView.module.css",
    selector: ".fileContent",
    why: "the generated KConfig / overlay text itself, in a <pre> — the whole reason the row expands",
  },
  {
    file: "BuildPlanView.module.css",
    selector: ".warning",
    why: "an ALP warning: its code, the core it belongs to, and its message",
  },
  {
    file: "BuildPlanView.module.css",
    selector: ".manifestStaleNote",
    why: "the sentence saying the manifest is stale and why — the reason every number under it may be describing an older build",
  },
  {
    file: "BuildPlanView.module.css",
    selector: ".manifestNote",
    why: "the manifest / `tan size` error text, verbatim",
  },
  {
    file: "BuildPlanView.module.css",
    selector: ".manifestStatus",
    why: "`s.status` verbatim from the manifest, on the same row as `.backend` — the same construct as MemoryRegions' `.status` (color-mix pill, weight 600, neither uppercase nor tracked), and identical constructs do not get opposite calls",
  },
  {
    file: "BuildPlanView.module.css",
    selector: ".manifestFlash",
    why: "`flash_method` verbatim from the manifest — which channel a Flash actually writes over",
  },
  {
    file: "BuildPlanView.module.css",
    selector: ".manifestTarget",
    why: "the slice's build_dir / board / machine / image / app, verbatim from the manifest",
  },
  {
    file: "BuildPlanView.module.css",
    selector: ".manifestDetail",
    why: "why a slice ended the way it did, plus its footprint numbers and the path to its log (#331)",
  },
  {
    file: "BuildPlanView.module.css",
    selector: ".sliceBtn",
    why: "the Flash control — the one thing on this row you click, and it writes to a board",
  },
  {
    file: "BuildPlanView.module.css",
    selector: ".manifestChip",
    why: "an IPC link or a helper MCU, verbatim: `link.name`, `link.kind`, the endpoint pair, `link.status`/`link.reason`, and `mcu.name` + `mcu.chip` — a PART NUMBER, and a part number misread by one character is different silicon",
  },
  {
    file: "BuildPlanView.module.css",
    selector: ".tab",
    why: "the strip that switches between Slices, Memory and Notes — a control, not a label",
  },

  // ── MemoryChart.module.css ──
  {
    file: "MemoryChart.module.css",
    selector: ".tickLabel",
    why: "the rail's axis addresses, eight hex digits from `formatAddress`, compared against a linker map",
  },
  {
    file: "MemoryChart.module.css",
    selector: ".bandLabel",
    why: "the extent's own name, read straight off the picture",
  },
  {
    file: "MemoryChart.module.css",
    selector: ".markerLabel",
    why: "the name of a base with no size — the same name as a band, drawn against a line instead of a block",
  },
  {
    file: "MemoryChart.module.css",
    selector: ".hoverLabel",
    why: "the live address readout under the pointer: the number the reader opened the chart for",
  },
  {
    file: "MemoryChart.module.css",
    selector: ".caption",
    why: "which ruler this is — 'true scale' vs 'not to scale' decides whether a distance may be measured off the picture at all",
  },

  // ── MemoryRegions.module.css ──
  {
    file: "MemoryRegions.module.css",
    selector: ".empty",
    why: "the paragraph that REPLACES the picture when this manifest pins no address — two sentences that are the whole answer, read the way the map they stand in for would have been",
  },
  {
    file: "MemoryRegions.module.css",
    selector: ".scaleBtn",
    why: "the True scale / Equalized control that decides what the picture means",
  },
  {
    file: "MemoryRegions.module.css",
    selector: ".legend",
    why: "the one line that decodes the drawing — what a band is, what a line is, what the colours group by, or that the scale has been thrown away; a reader who cannot decode the picture cannot use it",
  },
  {
    file: "MemoryRegions.module.css",
    selector: ".rowName",
    why: "the extent's own name — the identifier the whole row is about and the label its band carries in the picture; a row whose name reads smaller than its own address inverts itself",
  },
  {
    file: "MemoryRegions.module.css",
    selector: ".addr",
    why: "the extent's hex base and end — 0x80000000 and 0x800b0000 differ in one place",
  },
  {
    file: "MemoryRegions.module.css",
    selector: ".rowSize",
    why: "the extent's size, including the `· tan size` branch where the number came from a different measurement than the extent",
  },
  {
    file: "MemoryRegions.module.css",
    selector: ".rowMeta",
    why: "region, filesystem and the cores that share the extent",
  },
  {
    file: "MemoryRegions.module.css",
    selector: ".status",
    why: "`entry.status` verbatim from the emitter (pending / blocked / unresolved) — the pill around it is chrome, the word inside it is the verdict on whether the extent exists",
  },
  {
    file: "MemoryRegions.module.css",
    selector: ".reason",
    why: "why a declared extent did not resolve: it names the file and the field to change, and it is the only actionable half of that row",
  },
  {
    file: "MemoryRegions.module.css",
    selector: ".conflictKind",
    why: "what went wrong with the pair named beside it ('share addresses', 'covers an image load address')",
  },

  // ── MemoryNotes.module.css ──
  {
    file: "MemoryNotes.module.css",
    selector: ".note p",
    why: "the Notes tab is nothing but prose — it exists so the map does not have to carry four paragraphs of it",
  },
];

/** Every rule setting type for a selector, or [] when the selector sets none. */
const rulesFor = (entry) =>
  RULES.filter((r) => r.file === entry.file && r.selector === entry.selector);

test("the panel's primary content is never set below the reading size", () => {
  const offenders = [];
  for (const entry of PRIMARY) {
    const rules = rulesFor(entry);
    // A renamed selector is the way this arm goes quiet, so it is a failure,
    // not a skip.
    if (rules.length === 0) {
      offenders.push(
        `  ${entry.file}  ${entry.selector} sets no font-size at all — the ` +
          `selector was renamed or the rule was dropped. Re-point this entry ` +
          `at whatever renders it now; do not delete it. It carries: ` +
          `${entry.why}.`,
      );
      continue;
    }
    for (const rule of rules) {
      const token = tokenOf(rule.value);
      if (token === null) {
        offenders.push(
          `  ${entry.file}:${rule.line}  ${entry.selector} is set to ` +
            `\`${rule.value}\`, which names no token at all. This is ` +
            `${entry.why} — it takes var(--font-size-base).`,
        );
        continue;
      }
      const tier = SCALE.indexOf(token);
      if (tier >= BASE) continue;
      offenders.push(
        `  ${entry.file}:${rule.line}  ${entry.selector} sits at ` +
          `${token} (${token === "--font-size-xs" ? "11px" : "12px"}), below ` +
          `var(--font-size-base) (13px). This is ${entry.why}.`,
      );
    }
  }

  assert.deepEqual(
    offenders.sort(),
    [],
    "these classes render text a user READS — hex addresses, region names, " +
      "commands, paths, env values, footprint numbers, status words and the " +
      "reasons a thing did not resolve — and they have been set below the " +
      "panel's reading size. That was the whole complaint this panel was " +
      "fixed for: the scale is anchored to the workbench font size, so xs is " +
      "11px permanently and no reader setting moves it. Monospace does not " +
      "count as a reason to go smaller — the family buys column alignment, " +
      "not a size — and neither does a tinted pill: the shell is the chrome, " +
      "the word inside it is still read. What IS chrome is the label register " +
      "(uppercase + 0.04em tracking + weight 600), which is correctly xs/sm " +
      "and deliberately absent from this list.",
  );
});

// ---------------------------------------------------------------------------
// (c) The sub-heading arm
// ---------------------------------------------------------------------------
//
// The four rungs, and the middle one is the one that keeps collapsing:
//
//   panel title   lg    16px   `.title` (BuildPlanView)
//   sub-heading   md    14px   this list
//   body / data   base  13px   the tier arm above
//   chrome        xs    11px   the guard at the bottom of this file
//
// `>= base` cannot hold a sub-heading, because base is precisely the mistake:
// all three of these sat AT the size of the list underneath them before this
// fix — a rung spent on nothing, with weight and colour left carrying a rank
// that size is the only signal for. So this arm grades a sub-heading against
// the body it actually heads and demands it be STRICTLY larger.
//
// Only the lower edge is graded here. The ceiling — that no sub-heading
// reaches the panel's own lg `.title` — is already held by the hierarchy test
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

/** The tier a rule sits at, or -1 when its value names no size token. */
const tierOf = (rule) => SCALE.indexOf(tokenOf(rule.value) ?? "");

/**
 * The tiers a selector is set to in one file, with untokenised rules dropped:
 * a bare length cannot be RANKED, and it is already the literal arm's failure.
 * Reporting it twice would make one defect look like two.
 */
const tiersOf = (file, selector) =>
  RULES.filter((r) => r.file === file && r.selector === selector)
    .map(tierOf)
    .filter((tier) => tier !== -1);

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
          `rank — renamed, dropped, or given a bare length. It is ${entry.why}; ` +
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
      "four rungs and three token steps between them — lg (16px) for the " +
      "panel title, md (14px) for a sub-heading inside it, base (13px) for " +
      "everything a person reads, xs (11px) for chrome — so a sub-heading " +
      "left at base is the same size as the list it introduces and asks " +
      "weight and colour to carry a rank only size can signal. Fix it with " +
      "var(--font-size-md): do not raise the body to restore the gap, and do " +
      "not reach lg, which is the panel's own `.title`.",
  );
});

// ---------------------------------------------------------------------------
// Hierarchy
// ---------------------------------------------------------------------------
//
// Inverting the hierarchy was the single most common error while this panel
// was being resized: raise a sub-heading far enough and it starts reading as
// the panel's title. `.title` is `lg` (16px) rather than `xl` (20px) on
// purpose — four other full-tab panels (Dependencies, SetupFlow,
// NewProjectFlow, ExistingProjectFlow) still hardcode an untokenised 18px
// title, and xl here would make this the largest title in the product. That
// choice is a floor here, not an equality, so tokenising that 18px cluster
// later does not red this gate.

test("nothing inside the panel reaches the panel's own title", () => {
  const title = RULES.find(
    (r) => r.file === "BuildPlanView.module.css" && r.selector === ".title",
  );
  assert.ok(
    title,
    "BuildPlanView.module.css must set a font-size on `.title` — it is the " +
      "reference every other size in the panel is ranked against",
  );
  const titleTier = SCALE.indexOf(tokenOf(title.value) ?? "");
  assert.ok(
    titleTier >= SCALE.indexOf("--font-size-lg"),
    `the panel title is ${title.value} — it has to outrank 13px body text by ` +
      "more than a step or the panel reads as one flat wall of text",
  );

  const offenders = RULES.filter((r) => r !== title)
    .filter((r) => SCALE.indexOf(tokenOf(r.value) ?? "") >= titleTier)
    .map(
      (r) =>
        `  ${r.file}:${r.line}  ${r.selector} { font-size: ${r.value} }  — ` +
        `the panel title is ${title.value}`,
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
// A gate that reads nothing passes forever. These pin every way this one could
// go quiet: no files, a rule pattern that matches nothing, an allowlist with
// nothing real behind it, and a tier list so broad it has quietly become
// "every rule in the panel" — at which point the chrome that is correctly
// small has no protection from the next well-meaning sweep.

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
    RULES.some((r) => tokenOf(r.value) !== null),
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

  // Chrome the tier list must NOT have swallowed. If any of these comes back
  // at base, the panel lost the distinction between what is read and what is
  // glanced at, and this gate would have been the thing that let it.
  //
  // Each carries its OWN reason, because they are not all small for the same
  // one — three are the uppercase-tracked label register, and `.kind` is not
  // uppercase, not tracked and not weighted. A shared "it is a tracked badge"
  // message would have printed something the stylesheet does not say.
  for (const [file, selector, why] of [
    [
      "BuildPlanView.module.css",
      ".backend",
      "an uppercase, 0.04em-tracked, weight-600 pill naming the slice's OS — a category, glanced at, and it shares its line with `.coreId`, which is the name being read",
    ],
    [
      "BuildPlanView.module.css",
      ".sectionTitle",
      "uppercase + 0.04em + 600 at sm: a LABEL register, not a heading in this panel's four-rung ladder, and a label set at body size shouts instead of labelling",
    ],
    [
      "BuildPlanView.module.css",
      ".manifestBadge",
      "the uppercase tracked freshness badge — one recoloured word read as a state, not as a sentence",
    ],
    [
      "MemoryRegions.module.css",
      ".kind",
      "xs deliberately, and NOT because it is a tracked badge: it has a tinted background and nothing else — no uppercase, no letter-spacing, no weight. It is small so that `.status` beside it, at base, reads as the verdict while this reads as the category ('carve-out'). The size difference IS that rank, which is why the CSS evens the two pills' line box instead of letting the shells disagree too",
    ],
  ]) {
    const rule = RULES.find((r) => r.file === file && r.selector === selector);
    assert.ok(
      rule && SCALE.indexOf(tokenOf(rule.value) ?? "") < BASE,
      `${file} ${selector} is no longer below the reading size. It is ${why}. ` +
        "If the tier list has grown to cover every rule in the panel, it has " +
        "stopped drawing the distinction it exists to draw.",
    );
  }

  // Every tier entry must resolve, or the list is a list of names for rules
  // that no longer exist.
  const unresolved = PRIMARY.filter((e) => rulesFor(e).length === 0);
  assert.deepEqual(
    unresolved.map((e) => `${e.file} ${e.selector}`),
    [],
    "these tier-list entries match no rule — re-point them at whatever " +
      "renders that text now",
  );
});

test("a token, a literal, a shorthand and prose are told apart", () => {
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

  assert.equal(
    untokenisedType("var(--font-size-base)"),
    null,
    "a token is the rule being followed",
  );
  assert.equal(
    untokenisedType("var(--font-size-base, 13px)"),
    null,
    "a literal inside a var() fallback is the rule being followed too",
  );
  assert.equal(
    untokenisedType("VAR(--font-size-base)"),
    null,
    "CSS keywords are case-insensitive — an uppercase VAR( is still a token",
  );
  assert.equal(
    untokenisedType("inherit"),
    null,
    "`font: inherit` carries no length; it is how `.fileToggle` makes a " +
      "<button> take its row's size instead of the UA's",
  );
  assert.equal(untokenisedType("10px").kind, "a bare length");
  assert.equal(untokenisedType("0.9em").kind, "a bare length");
  assert.equal(
    untokenisedType("90%").kind,
    "a bare length",
    "a percentage under-sizes exactly as permanently as a px does — the " +
      "parent it is relative to is itself pinned to the workbench's 13px",
  );
  assert.equal(
    untokenisedType("600 11px/1.4 monospace").kind,
    "a bare length",
    "the `font` shorthand carries a size, and a gate that knew only " +
      "`font-size` could be walked straight around it",
  );
  assert.equal(
    untokenisedType("var(--space-4)").kind,
    "a token that is not a size token",
    "a var() naming a NON-size token ships a font the scale does not " +
      "contain, wearing a token's clothes",
  );

  assert.equal(tokenOf("var(--font-size-xs)"), "--font-size-xs");
  assert.equal(tokenOf("11px"), null);
});
