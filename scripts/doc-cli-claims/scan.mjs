#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
//
// Extract every CLI CLAIM this repo's prose makes, and emit it as a record the
// documentation gate can check against the pinned tan.
//
// ── Why this exists ─────────────────────────────────────────────────────────
//
// `test/tan.surfaceContract.test.js` proves every argv the CODE sends is argv
// the pinned tan accepts. Nothing proved the same about the argv the DOCS tell
// a customer to type, and the docs are the copy-run surface: two of the
// recipes corrected in #556 sat inside GitHub Actions and GitLab CI blocks that
// a reader pastes verbatim, and one sat in the troubleshooting page a user with
// an already-broken environment is told to run FIRST.
//
// That recipe had been wrong for the whole life of the pin. `tan doctor` has
// never had `--target-kind` or `--server`; the flags belong to `debug-config`
// and `support-bundle`. It exited 2 with `No such option: --target-kind
// (Possible options: --target)` and a `cli.parse-error` envelope, and #544 was
// CLOSED without any documentation file being touched. A gate is the only thing
// that would have noticed.
//
// ── The hard problem: prose mentions a command, a recipe RUNS one ───────────
//
// This corpus says `tan` 300-odd times and only a fraction are argv. "the tan
// binary", "tan owns the topology", "tan does not declare" — all prose. Worse,
// some real-looking argv is DESIGN rather than instruction:
//
//     - `tan build [app] [--core <id>] [--board <b>]` → drives the per-core
//
// sits under the words "not yet implemented" in
// `docs/EXTENSION_CLI_INTEGRATION.md`. Flagging that would force a design
// document to lie about the design.
//
// THE DISCRIMINATOR IS POSITION, NOT CONTENT. A line is read as argv only when,
// after stripping indentation, a shell prompt (`$`/`>`) and a list marker
// (`- `), it BEGINS with `tan `. A reader runs lines that are commands; a
// sentence that mentions one has words in front of it, and the design line
// above begins with a backtick. Measured on this corpus: 300+ raw mentions
// reduce to 59 invocations, and the one prose line that still slipped through
// ("tan does not declare is a hard red, and …") is rejected by the
// `looksLikeProse` rule below rather than by a word list, which would rot.
//
// Bracketed tokens are dropped before flags are read, for the same reason:
// `[--core <id>]` is optional-syntax notation, not an argument.
//
// ── What is deliberately NOT extracted ──────────────────────────────────────
//
// (a) `docs/plans/**` and `docs/superpowers/**`. Dated design records. Editing
//     them to match a later pin falsifies what was known when they were
//     written, and they are not instructions to anyone.
//
// (b) VIEW AND PANEL NAMES IN PROSE. Two docs currently tell a reader to open
//     the Models panel from the Activity Bar, which contributes exactly one
//     view (`alp-ide.hub`, "Alp IDE"). That is a real defect and it is fixed by
//     hand, not here: deciding whether a sentence is an instruction to open a
//     view needs prose parsing, and a gate that guesses at English is a gate
//     nobody trusts the next time it fires. The limit is written down rather
//     than left for someone to discover.
//
// (c) CAPABILITY CLAIMS IN PROSE. `docs/CLI.md`'s "tan is feature-complete" is
//     false at this pin and no argv check reaches it.
//
// (d) AN INVOCATION `looksLikeProse` CANNOT TELL FROM A SENTENCE. The rule
//     below reads a line beginning `tan ` as English when it carries no flag
//     and runs past four words — so `tan bogusverb one two three four five` is
//     documented, runnable, wrong, and green. Proved by injection, not
//     supposed: appended to `docs/TASK_RECIPES.md` it passes, while
//     `tan bogusverb` on its own is caught.
//
//     It is a LIMIT rather than a bug to fix, because the two cases are
//     structurally identical. `tan does not declare is a hard red, and …` —
//     the real prose line this corpus contains — has an unknown second token
//     and more than four words, exactly like the bad command above.
//     Separating them needs English parsing, which is the thing this file
//     refuses to do anywhere else. Two ways out were considered and rejected:
//     a word list (the rot this rule exists to avoid, and it would pass the
//     first sentence it had not seen), and letting the scanner ask
//     `surface.json` whether the second token is a real command (it would
//     still not separate them — `bogusverb` and `does` are both unknown — and
//     it would cost this script the property stated just below).
//
//     What bounds the damage: the line must ALSO begin at column zero after
//     the prompt and list-marker strip, carry no flag at all, and name a verb
//     the reader would have to have invented. Every real recipe in this corpus
//     that is longer than four words carries a flag and is checked.
//
// Records are emitted, never judged: this script knows nothing about
// `surface.json`. `test/docs.cliClaims.test.js` is where a claim meets the pin,
// exactly as `scripts/tan-surface/extract.mjs` feeds `tan.surfaceContract`.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = path.resolve(fileURLToPath(import.meta.url), "../../..");

/** Prose that is instruction to a reader. */
const ROOTS = ["README.md", "docs", "media"];

/** Dated records, not instructions — see (a) above. */
const EXCLUDED = [/^docs\/plans\//, /^docs\/superpowers\//];

/**
 * Indentation, a shell prompt, and one list marker. Everything this strips is
 * decoration a reader ignores when typing the line.
 */
const LINE_LEAD = /^\s*(?:[-*]\s+)?(?:[$>]\s*)?/;

/**
 * A line that begins `tan ` and still reads as English rather than argv.
 *
 * The rule is deliberately structural: no flag, no option-looking token, and
 * long enough to be a sentence. A word list ("does", "owns", "is") would need
 * extending every time someone writes a new sentence, and would silently pass
 * the one it had not seen.
 */
function looksLikeProse(rest) {
  if (/(?<![\w-])--[a-z]/.test(rest)) return false;
  return rest.trim().split(/\s+/).filter(Boolean).length > 4;
}

function markdownFiles(target) {
  const abs = path.join(REPO_ROOT, target);
  if (!fs.existsSync(abs)) return [];
  if (fs.statSync(abs).isFile()) return abs.endsWith(".md") ? [abs] : [];
  const out = [];
  for (const entry of fs.readdirSync(abs, { withFileTypes: true })) {
    out.push(...markdownFiles(path.join(target, entry.name)));
  }
  return out;
}

function corpus() {
  const seen = new Set();
  const files = [];
  for (const root of ROOTS) {
    for (const file of markdownFiles(root)) {
      const rel = path.relative(REPO_ROOT, file).split(path.sep).join("/");
      if (EXCLUDED.some((re) => re.test(rel))) continue;
      if (seen.has(rel)) continue;
      seen.add(rel);
      files.push({ rel, abs: file });
    }
  }
  return files.sort((a, b) => a.rel.localeCompare(b.rel));
}

/** Every `tan …` a reader is told to run, plus every pinned release tag. */
export function scan() {
  const records = [];
  for (const { rel, abs } of corpus()) {
    const lines = fs.readFileSync(abs, "utf8").split("\n");
    let continued = "";
    let continuedLine = 0;

    for (let i = 0; i < lines.length; i++) {
      const raw = lines[i];

      // A release tag is a claim wherever it appears — inside a URL, an env
      // assignment, or prose — because a reader copies the whole line.
      // The optional quote is load-bearing: `TAN_VERSION: "v0.5.1"` is a real
      // form in this corpus and an unquoted pattern walked straight past it,
      // leaving one of three pinned tags in docs/CI_EXAMPLES.md unreported
      // while the gate went green on the other two.
      for (const match of raw.matchAll(
        /(?:TAN_VERSION\s*[=:]\s*|tan-cli\/releases\/download\/)["']?(v?[0-9][0-9A-Za-z.\-+]*)/g,
      )) {
        records.push({
          kind: "releaseTag",
          file: rel,
          line: i + 1,
          tag: match[1],
          raw: raw.trim(),
        });
      }

      if (/^\s*```/.test(raw)) {
        continued = "";
        continuedLine = 0;
        continue;
      }

      let body = raw.replace(LINE_LEAD, "");
      if (body.startsWith("#")) continue;
      body = body.replace(/\s+#\s.*$/, "").trimEnd();

      if (continued) body = `${continued} ${body.trim()}`;
      else if (!body.startsWith("tan ")) continue;

      // A trailing backslash continues the command onto the next line; the
      // record is attributed to where it STARTED.
      if (/\\$/.test(body)) {
        continued = body.replace(/\\$/, "").trim();
        continuedLine = continuedLine || i + 1;
        continue;
      }
      const line = continuedLine || i + 1;
      continued = "";
      continuedLine = 0;

      const match = body.match(/^tan\s+([a-z][a-z0-9-]*)\b([\s\S]*)$/);
      if (!match) continue;
      const [, verb, rest] = match;
      // `tan v0.5.1 publishes …` — a version, not a verb.
      if (/^v\d/.test(verb)) continue;
      if (looksLikeProse(rest)) continue;

      // Optional-syntax notation is not argv.
      const argv = rest.replace(/\[[^\]]*\]/g, " ");
      const flags = [
        ...new Set(
          [...argv.matchAll(/(?<![\w-])(--[a-z][a-z0-9-]*)/g)].map((m) => m[1]),
        ),
      ];
      records.push({
        kind: "invocation",
        file: rel,
        line,
        verb,
        flags,
        raw: body.trim(),
      });
    }
  }
  return records;
}

function main() {
  const records = scan();
  if (records.length === 0) {
    // Zero claims is not a clean bill of health: this corpus is 25 files of
    // CLI instructions. It means the walk broke, and a gate fed nothing passes
    // everything.
    process.stderr.write(
      "[docs:scan] found 0 CLI claims across the prose corpus — the walk is " +
        "broken, not the documentation\n",
    );
    process.exit(2);
  }
  process.stdout.write(`${JSON.stringify(records, null, 2)}\n`);
  const count = (kind) => records.filter((r) => r.kind === kind).length;
  process.stderr.write(
    `[docs:scan] ${count("invocation")} invocations, ` +
      `${count("releaseTag")} release tags\n`,
  );
}

// Guarded so the gate can import `scan()` without this writing to its stdout.
function invokedAsScript() {
  if (!process.argv[1]) return false;
  const real = (target) => {
    try {
      return fs.realpathSync(target);
    } catch {
      return path.resolve(target);
    }
  };
  return (
    real(path.resolve(process.argv[1])) === real(fileURLToPath(import.meta.url))
  );
}

if (invokedAsScript()) main();
