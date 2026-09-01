// SPDX-License-Identifier: Apache-2.0
//
// No emoji ships.
//
// The reason is not taste. An emoji in product chrome reads as machine-written
// filler, and this product's whole visual argument (DESIGN.md, "The Native
// Guest") is that a panel should be indistinguishable from VS Code's own
// surfaces — which contain none. The extension already carries a hand-drawn
// 27-icon stroke set for exactly this job.
//
// Why a test and not a review habit: an emoji is invisible to every gate this
// repo already runs. It type-checks, it lints, it renders. When this gate was
// written the tree carried offenders in seven files, and an adversarial review
// pass that was explicitly hunting for them still missed U+26A0 at
// `ConfiguratorView.tsx:1731` — sitting on the line BETWEEN two hits the same
// pass did confirm. That miss is the argument for a mechanical check.
//
// ── The boundary, and why it is drawn this tight ─────────────────────────────
//
// The ban stops at pictographs. `→ ⇒ ⇔ ↔ × · § ⊆ — …` and the Box Drawing set
// are typography and stay legal everywhere, in UI copy and in comments alike.
// This is load-bearing, not a nicety: roughly 150 `→` live in this repo's
// comments, JSDoc, and test names. A gate that reds on `a → b` is a gate
// someone disables inside a week, and then the emoji come back.
//
// So two ranges are deliberately NARROWER than the block they sit in:
//
//   * U+23E9-U+23FA, not the whole Miscellaneous Technical block (U+2300-):
//     catches the hourglass and alarm glyphs while leaving the keyboard
//     notation at U+2318/2325/232B legal.
//   * U+2196-U+21AA, not the whole Arrows block: catches the emoji-presentation
//     arrows while `→` (U+2192) sits just below the range and `⇒` (U+21D2) just
//     above it, so both survive.
//
// Widen either one and this file starts failing on correct code.
//
// `docs/` is excluded on purpose. Eight tracked files there — historical plans
// and specs, several of them dated — carry emoji. Reddening on documents nobody
// is going to rewrite is the other way a gate gets deleted.
//
// Escape hatch: a line containing `alp-no-emoji-ok` is skipped, so a fixture
// that must legitimately carry one (asserting that tan's own output passes
// through untouched, say) has a documented, greppable opt-out instead of a
// reason to delete this file.

const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

const REPO_ROOT = path.resolve(__dirname, "..");

/**
 * Every codepoint range that renders as an emoji.
 *
 * Built from `\u{...}` escapes, never from literal glyphs, so this file is not
 * itself an offender and cannot be broken by an editor normalising its source.
 */
const EMOJI = new RegExp(
  "[" +
    "\\u{1F000}-\\u{1FAFF}" + // pictographs: Emoticons, Transport, Supplemental, Extended-A
    "\\u{2600}-\\u{27BF}" + //  Miscellaneous Symbols + Dingbats (check, ballot X, warning)
    "\\u{2B00}-\\u{2BFF}" + //  Miscellaneous Symbols and Arrows
    "\\u{FE0F}" + //            variation selector-16, the emoji-presentation forcer
    "\\u{200D}" + //            ZWJ, so a joined sequence cannot slip through in parts
    "\\u{23E9}-\\u{23FA}" + //  media controls + hourglass/alarm (see note above)
    "\\u{2196}-\\u{21AA}" + //  emoji-presentation arrows only (see note above)
    "\\u{2934}\\u{2935}" +
    "\\u{3030}\\u{303D}" +
    "\\u{1F1E6}-\\u{1F1FF}" + // regional indicators, i.e. flags
    "]",
  "u",
);

/** Directories walked. Anything outside these is not this gate's business. */
const SCAN_DIRS = [
  "src",
  "scripts",
  "test",
  "snippets",
  "syntaxes",
  "schemas",
  path.join("packages", "alp-webview", "src"),
  path.join("packages", "alp-core", "src"),
];

/** Manifests scanned individually: contributed command titles are user-visible. */
const SCAN_FILES = [
  "package.json",
  path.join("packages", "alp-webview", "package.json"),
  path.join("packages", "alp-core", "package.json"),
];

const SKIP_DIRS = new Set([
  "node_modules",
  "dist",
  "out",
  ".git",
  "alp-sdk-upstream",
  "docs",
  "docs-scratch",
  "examples",
  "cli-rs",
  "fixtures",
]);

const SCAN_EXT = new Set([
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
  ".css",
  ".json",
  ".sh",
  ".html",
]);

const OPT_OUT = "alp-no-emoji-ok";

function walk(dir, out) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return out; // a scan dir that does not exist yet is not a failure
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      walk(full, out);
    } else if (entry.isFile() && SCAN_EXT.has(path.extname(entry.name))) {
      out.push(full);
    }
  }
  return out;
}

function scan(file) {
  const rel = path.relative(REPO_ROOT, file);
  const offenders = [];
  const lines = fs.readFileSync(file, "utf8").split("\n");
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    if (line.includes(OPT_OUT)) continue;
    // Iterate by code POINT, not by UTF-16 unit: a surrogate pair is one glyph
    // and must be reported once.
    for (const ch of line) {
      if (!EMOJI.test(ch)) continue;
      const cp = ch.codePointAt(0).toString(16).toUpperCase().padStart(4, "0");
      offenders.push(`${rel}:${i + 1}  ${ch}  U+${cp}`);
      break; // one report per line is enough to find and fix it
    }
  }
  return offenders;
}

test("no emoji anywhere in shipped source, scripts, tests or manifests", () => {
  const files = [];
  for (const dir of SCAN_DIRS) walk(path.join(REPO_ROOT, dir), files);
  for (const f of SCAN_FILES) {
    const full = path.join(REPO_ROOT, f);
    if (fs.existsSync(full)) files.push(full);
  }

  assert.ok(
    files.length > 100,
    `expected to scan a real tree, only found ${files.length} files — ` +
      `SCAN_DIRS is probably wrong, and a gate that scans nothing passes everything`,
  );

  const offenders = files.flatMap(scan).sort();

  assert.deepStrictEqual(
    offenders,
    [],
    `Emoji found in ${offenders.length} place(s). DESIGN.md, The No-Emoji Rule:\n` +
      `use the shared Icon component in the webview, a ThemeIcon or a codicon\n` +
      `reference on the four host surfaces that render one, and words or\n` +
      `[ok]/[fail] in notifications and output channels.\n\n` +
      offenders.map((o) => `  ${o}`).join("\n") +
      `\n\nIf one is genuinely required, put ${OPT_OUT} on that line with a reason.\n`,
  );
});

test("the gate rejects emoji and spares typography", () => {
  // The half that usually gets skipped. A regex that also flagged the plain
  // rightwards arrow would look just as green after the tree is cleaned, while
  // being unshippable. Everything here is written as an escape on purpose.
  const rejects = [
    "\u{1F680}", // rocket
    "\u{2713}", // check mark
    "\u{2717}", // ballot X
    "\u{26A0}", // warning sign
    "\u{23F3}", // hourglass
    "\u{FE0F}", // variation selector-16
  ];
  const spares = [
    "\u{2192}", // rightwards arrow
    "\u{21D2}", // rightwards double arrow
    "\u{2194}", // left right arrow
    "\u{00D7}", // multiplication sign
    "\u{00B7}", // middle dot
    "\u{00A7}", // section sign
    "\u{2286}", // subset of or equal to
    "\u{2514}", // box drawings up and right
    "\u{2318}", // place of interest (command key)
  ];

  for (const ch of rejects) {
    assert.ok(
      EMOJI.test(ch),
      `expected U+${ch.codePointAt(0).toString(16).toUpperCase()} to be rejected`,
    );
  }
  for (const ch of spares) {
    assert.ok(
      !EMOJI.test(ch),
      `U+${ch.codePointAt(0).toString(16).toUpperCase()} is typography and must stay legal — ` +
        `banning it is how this gate gets disabled`,
    );
  }
});

test("the opt-out works", () => {
  const tmp = path.join(REPO_ROOT, "test", ".noEmoji.probe.tmp.js");
  fs.writeFileSync(
    tmp,
    `const a = "\u{1F680}"; // ${OPT_OUT}: probe\n`,
    "utf8",
  );
  try {
    assert.deepStrictEqual(scan(tmp), []);
  } finally {
    fs.unlinkSync(tmp);
  }
});
