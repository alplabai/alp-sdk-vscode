#!/usr/bin/env node
/**
 * Walk the PINNED `tan` binary's own `--help` output and vendor it as
 * `test/golden/tan-surface/surface.json` — the snapshot the surface gate
 * checks every `tan …` invocation in this extension against.
 *
 * WHY A SNAPSHOT AT ALL: the extension spells tan argv by hand in a dozen
 * files. Nothing re-probed the CLI when the pin last moved, and the Models
 * panel shipped driving nine subcommands a pinned tan does not implement
 * (#522/#523). A vendored surface makes "does this flag exist, and does it
 * DO anything" a build-time question instead of a runtime alarm.
 *
 * ONLY READ-ONLY INVOCATIONS ARE EVER MADE: `--version`, `<cmd> --help`, and
 * `completion --shell bash`. `--help` is eager in Click and short-circuits
 * before any command body runs, so even `tan sdk install --help` writes
 * nothing. Do not add a probe here that omits `--help`.
 *
 * WHAT THE SNAPSHOT RECORDS BEYOND "DOES THIS FLAG EXIST":
 *   `options[].inert`          the flag parses and does nothing HERE
 *   `options[].marker`         the help wording that says so, verbatim
 *   `options[].valueOptional`  the flag's value is optional (`[PATH]`)
 *   `refusingSubcommands`      the verb is in the vocabulary and exits non-zero
 *   `sourceDigest`             sha256 of the raw help this was read from
 *   `contentDigest`            sha256 of the snapshot's own parsed content
 *
 * `inert` and `refusingSubcommands` are the same defect in two grammatical
 * positions, and both are invisible to any "is what we send accepted?"
 * comparison. `marker` is what makes an inert report readable when the help
 * text cites no issue number, which two of the four wordings do not.
 *
 * The two digests answer DIFFERENT questions and neither answers the other's.
 * `sourceDigest` ties the file to a binary — but nothing in this repo can
 * recompute it, because that needs the pinned tan, so the gate can only assert
 * its shape. `contentDigest` is recomputable from the committed file alone and
 * the gate DOES recompute it, so a hand-edited `"inert": false` fails there
 * even when no named anchor covers the flag that was edited.
 *
 *   node scripts/tan-surface/fetch.mjs          # write the snapshot
 *   node scripts/tan-surface/fetch.mjs --check  # parse + report, write nothing
 *
 * Override the binary with TAN_BIN=/path/to/tan (the default is the copy VS
 * Code manages, whose path contains spaces — always quote it).
 */

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = resolve(fileURLToPath(new URL("../..", import.meta.url)));
const SNAPSHOT_PATH = join(
  REPO_ROOT,
  "test",
  "golden",
  "tan-surface",
  "surface.json",
);
const SERVICE_TS = join(REPO_ROOT, "src", "alpCli", "service.ts");

const DEFAULT_TAN_BIN = join(
  process.env.HOME ?? "",
  "Library/Application Support/Code/User/globalStorage/alplabai.alp-sdk/cli/tan",
);

/** Rich wraps help text to the terminal width; a narrow width TRUNCATES the
 *  option column and whole flags go missing. Every invocation pins it. */
const HELP_COLUMNS = "200";

/** `maxPositionals` for a variadic `[ARGS...]` tail — unbounded, not zero. */
const VARIADIC_POSITIONALS = -1;

/** A positional SUBCOMMAND is a plain `<str>` here, not a Click group, so
 *  `tan model build --help` re-prints `tan model --help`. Recursion stops on
 *  that equality; the depth cap only guards a future tan that grows real
 *  groups. */
const MAX_SUBCOMMAND_DEPTH = 3;

const BOX_TOP = /^╭─+\s*(.*?)\s*─+╮\s*$/;
const BOX_BOTTOM = /^╰─+╯\s*$/;
const BOX_ROW = /^│(.*)│\s*$/;

/** The BODY of a metavar cell: `PATH`, `CORE_ID`, `HOST:PORT`, `ARGS...`,
 *  `<text|json>`, `<int>`, `{quick,pr,full,release}`. */
const METAVAR_BODY = /<[^>]*>|\{[^}]*\}|[A-Z][A-Z0-9_:.-]*(?:\.\.\.)?/;

/** A metavar cell: a body, or a body in SQUARE BRACKETS, either optionally
 *  followed by a range constraint (`SECS [x>=0]`). Anything else in that
 *  column is help text.
 *
 *  THE BRACKETED FORM IS THE OPTIONAL-VALUE SPELLING, and it used to be
 *  rejected. A `--flag [PATH]` was therefore recorded `metavar: null` — i.e.
 *  BOOLEAN — and the consequences compound in one direction: the extractor's
 *  arity walk then does not let the flag consume the token after it, that
 *  token is counted as a POSITIONAL, and assertion 5 reports a
 *  `Got unexpected extra argument(s)` the CLI would never have produced. A
 *  false RED is not a smaller failure than a false green; it is the failure
 *  that teaches people to stop reading the gate.
 *
 *  NOT A LIVE DEFECT AT THIS PIN. All 33 captured pages (root + 32 commands)
 *  were swept: no option uses a bracketed cell, and no option's metavar cell
 *  is rejected by this pattern at all. The single bracket anywhere in a
 *  metavar column is `renode --timeout`'s `SECS [x>=0]` range constraint,
 *  which the trailing group below already accepted. This is a parser that can
 *  now read a spelling tan does not yet use — not a false RED that was
 *  observed and removed.
 *
 *  A bare `[x>=0]` is NOT a metavar and must not become one: its body starts
 *  lowercase, so neither alternative matches, and a range constraint sitting
 *  alone in that column stays help text. */
const METAVAR_CELL = new RegExp(
  `^(?:(${METAVAR_BODY.source})|\\[(${METAVAR_BODY.source})\\])` +
    `(?:\\s+\\[[^\\]]*\\])?$`,
);

/**
 * Split a metavar cell into the metavar and whether its value is OPTIONAL, or
 * `null` when the cell is not a metavar at all.
 *
 * The two are recorded separately because they answer different questions and
 * only one of them is about spelling. `metavar` says the flag takes a value;
 * `valueOptional` says the token after it MAY be that value and may equally be
 * a positional. The arity walk cannot collapse those into one boolean without
 * choosing which false report to emit.
 */
export function parseMetavarCell(cell) {
  const match = METAVAR_CELL.exec(cell);
  if (!match) return null;
  const optional = match[2] !== undefined;
  return {
    metavar: optional ? match[2] : match[1],
    valueOptional: optional,
  };
}

/** `--flag` or `--flag,--alias` — tan renders aliases comma-joined with no
 *  space (`--board,--board-yaml`) and ships no short flags. */
const FLAG_CELL = /^--?[^\s,]+(?:,\s*--?[^\s,]+)*$/;

/** The wordings tan uses for "this flag parses here and does nothing here".
 *
 *  FOUR spellings at 0.6.0-rc1, not two, and the missing two were not
 *  cosmetic: `renode --board-yaml` and `--image-bundle` say "Accepted for
 *  parity …", `faultdecode --project` and `--sdk-root` say "(unused: …)" /
 *  "(unused; …)". All four were recorded `inert: false` — i.e. LIVE — while
 *  doing nothing, and `src/west.ts:338` already spawns `tan renode`.
 *
 *  The whole captured surface was swept for a fifth phrasing IN THIS SHAPE —
 *  an option's OWN help cell, inside its command's Options box (see the header
 *  note on the sweep): there is none at this pin. That sweep never looked at
 *  a command's DESCRIPTION (the prose above the boxes), which is a separate
 *  shape entirely — see `DESCRIPTION_INERT_CLAUSE` below (#602).
 *
 *  What the option-cell sweep does turn up is a different shape this list
 *  deliberately cannot express — CONDITIONAL inertness, where a flag is live
 *  except in the presence of another
 *  (`renode --sim-mode` ends "…; --expect is ignored", `run --flash` ends
 *  "Ignored for a native_sim/host target"). Those depend on the rest of the
 *  argv, and a per-flag boolean would have to call them either dead
 *  everywhere or live everywhere; both are wrong. They stay `inert: false`.
 *
 *  `ref` is scoped to THAT marker's own parenthesis on purpose — see
 *  `classifyInert`. The parity and unused wordings cite no issue at this pin,
 *  so their `ref` is null; null means "the help text names no ticket", NEVER
 *  "no upstream ticket exists". */
/*  EVERY PATTERN'S TAIL IS OPTIONAL, and that is deliberate.
 *
 *  The two wordings that cite no issue used to match a bare phrase, so the
 *  only thing a match could produce was `inert: true, ref: null` — and
 *  assertion 4 renders a null `ref` as "(no issue named in the help text)",
 *  which is the sentence a reader reaches for the spellchecker over. It threw
 *  away the one thing the help text did say: WHICH marker fired. The tails
 *  below capture the marker's own clause so it can be printed instead, and
 *  each is wrapped `(?:…)?` so it cannot change WHETHER a flag is inert — a
 *  reworded tail costs a fuller marker, never the detection. */
const INERT_PATTERNS = [
  // `tan build`'s twelve (tan-cli#427).
  /Accepted by other commands; not implemented for `[^`]*` yet(?:\s*\((tan-cli#\d+)\))?/,
  // `tan doctor --build` (tan-cli#290).
  /Accepted for compatibility(?:\s*\((tan-cli#\d+)\))?/,
  // `tan renode --board-yaml`, `tan renode --image-bundle`. The tail stops at
  // the clause's own punctuation: one of these two sentences reads "…derives
  // `project.boardYaml` from --project", so a tail that ran to the first
  // PERIOD would cut mid-identifier.
  /Accepted for parity with\b(?:[^.;]*[.;])?/,
  // `tan faultdecode --project`, `tan faultdecode --sdk-root`. Anchored on the
  // punctuation so the word "unused" inside a sentence about something else
  // cannot condemn a live flag.
  /\(unused[:;](?:[^)]*\))?/,
];

// --------------------------------------------------------- description text
//
// (#602) `diff`, `inspect`, `pinmux`, `support-bundle` and `trace` each carry
// a paragraph ABOVE their Options box — outside any box `parseBoxEntries`
// ever looks at — that names specific global flags as inert FOR THAT COMMAND.
// The per-option help cell for these flags says nothing (it is the same live
// help text every command shows, e.g. "--target EMIT  Generation target …"),
// so `optionsFromEntries` alone recorded all of them `inert: false`. This is
// the SAME defect `INERT_PATTERNS` closes, one prose location over.

/** Everything rich prints between the `Usage:` line and the first box — the
 *  free-text paragraph(s) a command's own description occupies. Lines are
 *  trimmed and rejoined with a single space, same as a wrapped option cell's
 *  continuation (`parseBoxEntries`) — including at a hard line-break inside
 *  an unbroken `` `--a`/`--b`/… `` list, where rich has nowhere better to
 *  wrap and the join reinserts a space the source text never had. That stray
 *  space is why `DESCRIPTION_INERT_CLAUSE`'s flag list tolerates whitespace
 *  around `/`: correctness of flag DETECTION does not depend on reproducing
 *  rich's exact wrap byte-for-byte, only `marker`'s cosmetics do. */
export function parseDescription(helpText) {
  const lines = helpText.split("\n");
  const usageIndex = lines.findIndex((line) => /^\s*Usage:\s+tan\b/.test(line));
  if (usageIndex === -1) return "";
  let boxIndex = lines.length;
  for (let i = usageIndex + 1; i < lines.length; i++) {
    if (BOX_TOP.test(lines[i])) {
      boxIndex = i;
      break;
    }
  }
  return lines
    .slice(usageIndex + 1, boxIndex)
    .map((line) => line.trim())
    .filter(Boolean)
    .join(" ");
}

/** One backtick-quoted long flag, e.g. `` `--no-color` ``. */
const DESCRIPTION_FLAG = "`--[a-z0-9-]+`";

/** A run of one or more `DESCRIPTION_FLAG`s slash-joined with NO other text
 *  between them — `` `--a`/`--b`/`--c` ``. Whitespace is tolerated around
 *  each `/` for the wrap reason `parseDescription` documents; it is not
 *  tolerated ANYWHERE ELSE, so a flag named earlier in the same sentence for
 *  an unrelated reason (`diff`'s own paragraph names `--sdk-root` as LIVE,
 *  three clauses after the inert list) cannot be swept in — only a flag
 *  directly adjacent, via `/`, to the flag immediately before the verb. */
const DESCRIPTION_FLAG_LIST = `(?:${DESCRIPTION_FLAG}\\s*/\\s*)*${DESCRIPTION_FLAG}`;

/** The description-level wordings tan uses for "this flag is accepted here
 *  and does nothing here" — three so far, none citing an issue number (`ref`
 *  is always null for a match of this pattern; that is a fact about this pin,
 *  not a design choice, and a future wording that does cite one should carry
 *  it the same way `INERT_PATTERNS` does).
 *
 *  Anchored on `is`/`are` immediately after the flag list, exactly like
 *  `classifyInert` anchors on the marker's own clause: the tail is what makes
 *  a match, not proximity, so prose that merely MENTIONS a flag near one of
 *  these phrases (there is none observed, but nothing rules it out) cannot
 *  false-positive.
 *
 *  THIS PATTERN ALONE CANNOT TELL ABSOLUTE FROM CONDITIONAL, and that gap is
 *  real, not hypothetical: `run --flash` at this pin reads "`--flash` is
 *  accepted and ignored for a native_sim/host target" and `renode
 *  --sim-mode` reads "...; --expect is ignored" — conditional on the REST OF
 *  THE ARGV, exactly the shape the header comment on `INERT_PATTERNS` (the
 *  per-option sibling of this pattern) already refuses to call universally
 *  dead. A bare match of this regex against either sentence WOULD mark
 *  `--flash`/`--expect` inert unconditionally, which is false — `run --flash`
 *  is a flag this extension actually spawns. `isHedged` below is the guard;
 *  it is applied in `classifyDescriptionInert`, not baked into this regex,
 *  because the regex's job is finding the CANDIDATE clause and the guard's is
 *  deciding whether that candidate is unconditional. */
const DESCRIPTION_INERT_CLAUSE = new RegExp(
  `(${DESCRIPTION_FLAG_LIST})\\s+(?:is|are)\\s+` +
    "(declared, not consumed" +
    "|accepted and ignored" +
    "|`global = true` clap options `[a-z0-9_]+\\.rs` never reads)",
  "g",
);

/** A sentence-ish boundary: `;`, `:`, or a `.` NOT between two digits — so
 *  "0.6.0" inside a clause does not masquerade as three sentences. Used to
 *  bound the clause `isHedged` inspects on each side of a candidate match,
 *  so a hedge word two SENTENCES away (an unrelated `for`/`when` elsewhere in
 *  a long paragraph) cannot condemn a genuinely unconditional claim. */
const CLAUSE_BOUNDARY = /[;:]|\.(?!\d)/g;

/** A qualifier immediately AFTER the matched clause, before its own sentence
 *  ends, that turns "is accepted and ignored" from absolute into conditional:
 *  "...for a native_sim/host target", "...when `--sim-mode` is given",
 *  "...only when `--offline` is also passed". */
const CONDITIONAL_TAIL = /\b(for|when|unless|only|except|provided|given|if)\b/i;

/** A qualifier BEFORE the matched clause, in the same sentence, that makes it
 *  a claim about a PAST or FUTURE pin rather than this one: "Until 0.5.0
 *  `--verbose`/`--quiet` are accepted and ignored; since 0.6.0 both work." A
 *  tail-only guard misses this shape — the sentence ends at the semicolon
 *  right after "ignored", with nothing conditional AFTER the match at all;
 *  the hedge is entirely in what precedes it. */
const TEMPORAL_PREFIX =
  /\b(until|before|previously|historically|used to|no longer)\b/i;

/** Whether the `DESCRIPTION_INERT_CLAUSE` match at `[index, index + length)`
 *  in `description` is CONDITIONAL or HISTORICAL rather than an absolute,
 *  every-invocation claim — see the two regexes above for the shapes this
 *  catches, both measured against a real upstream wording (`run --flash`,
 *  `renode --sim-mode`) that this pattern would otherwise misread. Bounded to
 *  the match's OWN clause on each side (`CLAUSE_BOUNDARY`) so a hedge word
 *  belonging to a neighbouring sentence cannot reach in. */
export function isHedged(description, index, length) {
  const after = description.slice(index + length);
  let afterBoundary = -1;
  for (const boundary of after.matchAll(CLAUSE_BOUNDARY)) {
    afterBoundary = boundary.index;
    break;
  }
  const tailClause =
    afterBoundary === -1 ? after : after.slice(0, afterBoundary);
  if (CONDITIONAL_TAIL.test(tailClause)) return true;

  // Bounded to 80 chars back rather than to the previous CLAUSE_BOUNDARY
  // unconditionally: a paragraph's OPENING sentence has no boundary before
  // it at all, and slicing from 0 every time is cheap and always safe.
  const before = description.slice(Math.max(0, index - 80), index);
  let lastBoundary = -1;
  for (const boundary of before.matchAll(CLAUSE_BOUNDARY)) {
    lastBoundary = boundary.index;
  }
  const precedingClause =
    lastBoundary === -1 ? before : before.slice(lastBoundary + 1);
  return TEMPORAL_PREFIX.test(precedingClause);
}

/** `trace`'s own paragraph names `--all` explicitly, then disposes of the
 *  rest of the global surface it does not read in one sentence that names no
 *  flag at all: "The other hidden flags are `global = true` clap options
 *  `trace.rs` never reads." This is still a verbatim, per-command claim —
 *  just one whose object is "whatever `globalOptions` this command has not
 *  already accounted for" rather than a named list. `applyDescriptionInert`
 *  resolves that against `globalOptions` for the one command whose own help
 *  says it, never as a default for a command that says nothing (`new-som`
 *  has no sentence in this shape, or any other — see the fetcher's own
 *  report for what that means for its still-unrecorded global flags). */
const DESCRIPTION_RESIDUAL_HIDDEN =
  /The other hidden flags are (`global = true` clap options `[a-z0-9_]+\.rs` never reads)/;

/**
 * `description` → `{ named, residual }`.
 *
 * `named` maps a flag spelled out in an inert clause to `{ ref, marker }` —
 * skipping any clause `isHedged` calls conditional or historical, so a
 * hedged flag falls through to whatever the OPTIONS BOX already says about
 * it (live, unless a per-option `INERT_PATTERNS` marker says otherwise),
 * never to a guessed absolute inertness this pattern cannot support.
 * `residual` is `{ marker }` when the command's own description carries the
 * "other hidden flags" sentence, else `null` — never guessed from another
 * command's wording.
 */
export function classifyDescriptionInert(description) {
  const named = new Map();
  for (const match of description.matchAll(DESCRIPTION_INERT_CLAUSE)) {
    if (isHedged(description, match.index, match[0].length)) continue;
    const marker = match[0].trim();
    for (const flagMatch of match[1].matchAll(/`(--[a-z0-9-]+)`/g)) {
      named.set(flagMatch[1], { ref: null, marker });
    }
  }
  const residualMatch = DESCRIPTION_RESIDUAL_HIDDEN.exec(description);
  const residual = residualMatch ? { marker: residualMatch[0].trim() } : null;
  return { named, residual };
}

// ---------------------------------------------------------------- binary I/O

/** Run tan read-only. Throws on a spawn failure; returns the raw result so
 *  callers can decide what a non-zero exit means. */
function runTan(binary, args) {
  const result = spawnSync(binary, args, {
    encoding: "utf8",
    env: { ...process.env, COLUMNS: HELP_COLUMNS, NO_COLOR: "1" },
    maxBuffer: 32 * 1024 * 1024,
  });
  if (result.error) {
    throw new Error(
      `could not run "${binary} ${args.join(" ")}": ${result.error.message}`,
    );
  }
  return result;
}

function helpFor(binary, argv) {
  const result = runTan(binary, [...argv, "--help"]);
  if (result.status !== 0) {
    throw new Error(
      `"tan ${argv.join(" ")} --help" exited ${result.status}: ${(result.stderr || result.stdout).trim()}`,
    );
  }
  return result.stdout;
}

function probeVersion(binary) {
  const result = runTan(binary, ["--version"]);
  if (result.status !== 0) {
    throw new Error(
      `"tan --version" exited ${result.status}: ${(result.stderr || result.stdout).trim()}`,
    );
  }
  const match = /(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)/.exec(result.stdout);
  if (!match) {
    throw new Error(
      `"tan --version" printed no version: ${JSON.stringify(result.stdout.trim())}`,
    );
  }
  return match[1];
}

function readSupportedCliVersion() {
  const source = readFileSync(SERVICE_TS, "utf8");
  const match = /SUPPORTED_CLI_VERSION\s*=\s*"([^"]+)"/.exec(source);
  if (!match) {
    throw new Error(`no SUPPORTED_CLI_VERSION found in ${SERVICE_TS}`);
  }
  return match[1];
}

// ------------------------------------------------------------- box splitting

/** Split a rich help page into its `╭─ Title ─╮ … ╰─╯` boxes, keeping each
 *  row's INTERIOR COLUMNS intact — column position is what tells a metavar
 *  from help text and a wrapped continuation from a new entry. */
export function parseBoxes(text) {
  const boxes = [];
  let current = null;
  for (const line of text.split("\n")) {
    const top = BOX_TOP.exec(line);
    if (top) {
      current = { title: top[1], rows: [] };
      continue;
    }
    if (BOX_BOTTOM.test(line)) {
      if (current) boxes.push(current);
      current = null;
      continue;
    }
    const row = BOX_ROW.exec(line);
    if (row && current) current.rows.push(row[1].replace(/\s+$/, ""));
  }
  return boxes;
}

const indentOf = (row) => row.length - row.trimStart().length;

/** Column where the help text of every row in this box begins.
 *
 *  Voted, not guessed: a row with a metavar contributes the start of its
 *  THIRD cell, a row without one the start of its second — rich pads both to
 *  the same column, so every row votes for the same number, and one oddly
 *  shaped row (`--ci  CI mode: …`, whose help opens with a bare capital)
 *  cannot outvote the box. */
/*  NO ROW VOTING IS A HARD FAILURE, not a -1.
 *
 *  Returning -1 was the quietest bug in this file: `parseBoxEntries` then took
 *  the `helpCol > nameCol` false branch, set `right = ""`, and every option in
 *  that box was recorded with `help: ""`. Empty help matches no INERT_PATTERN,
 *  so the entire box came out `inert: false` — INDISTINGUISHABLE from a box of
 *  genuinely live flags. A rich layout change would have zeroed the inert
 *  dimension of the snapshot and left the gate green. Every box in tan
 *  0.6.0-rc1 votes; if one stops, the fetcher must stop with it. */
function findHelpColumn(rows, nameCol, context) {
  const votes = new Map();
  for (const row of rows) {
    if (!row.trim() || indentOf(row) !== nameCol) continue;
    const cells = [...row.matchAll(/\S(?:.*?\S)?(?=\s\s|$)/g)];
    if (cells.length < 2) continue;
    const isMetavar = cells.length >= 3 && METAVAR_CELL.test(cells[1][0]);
    const helpCell = isMetavar ? cells[2] : cells[1];
    votes.set(helpCell.index, (votes.get(helpCell.index) ?? 0) + 1);
  }
  if (votes.size === 0) {
    throw new Error(
      `${context}: no row in this box has a help column, so every entry in it ` +
        `would be recorded with empty help — and empty help reads as "this ` +
        `flag is live". Refusing to write a snapshot whose inert dimension is ` +
        `silently zero. The help layout changed; fix the box parser first.`,
    );
  }
  // A DISAGREEMENT IS A HARD FAILURE TOO, and the majority vote that used to
  // resolve it was quieter than the -1 above.
  //
  // rich pads every row of a box to the same help column, so a box whose rows
  // disagree has a row this parser read wrong — in practice a row whose
  // metavar cell `METAVAR_CELL` rejected, which then votes for the METAVAR
  // column instead of the help column. The old tie-break took the smallest
  // column, i.e. the wrong one, for the WHOLE box: every option in it had its
  // metavar folded into `help` and recorded `metavar: null`, every
  // value-taking flag read as boolean, and every one of their values became a
  // stray positional in assertion 5. In a two-row box one bad row is half the
  // votes and wins outright.
  //
  // No box in tan 0.6.0-rc1 splits (all 33 pages swept), so this cannot fire
  // on a correct capture. If it fires, one row is being misread and the fix is
  // in the parser, not in the vote.
  if (votes.size > 1) {
    const tally = [...votes]
      .sort((a, b) => a[0] - b[0])
      .map(([column, count]) => `column ${column}: ${count} row(s)`)
      .join(", ");
    throw new Error(
      `${context}: the rows of this box disagree about where the help text ` +
        `starts (${tally}). rich pads them all to the same column, so a split ` +
        `means a row was misread — usually a metavar cell this parser does ` +
        `not recognise, which votes for the metavar column instead. Picking ` +
        `the majority would apply one row's mistake to every entry in the ` +
        `box: their metavars would be swallowed into the help text, every ` +
        `value-taking flag would be recorded as boolean, and the gate would ` +
        `then report each of their VALUES as a stray positional. Refusing to ` +
        `write a snapshot built on a guess.`,
    );
  }
  return [...votes.keys()][0];
}

/** Rows of one box → `[{ name, metavar, help }]`.
 *
 *  An entry starts at the box's own name column; anything further right is a
 *  wrapped continuation of the entry above — including a continuation that
 *  itself opens with a flag spelling (`build`'s `--native` wraps onto a line
 *  starting `--plan-from -- use --execute for that.`), which is exactly the
 *  line a "starts with `--`" parser invents a phantom option from. */
export function parseBoxEntries(rows, context = "a help box") {
  const populated = rows.filter((row) => row.trim().length > 0);
  if (populated.length === 0) return [];
  const nameCol = Math.min(...populated.map(indentOf));
  const helpCol = findHelpColumn(populated, nameCol, context);
  const entries = [];
  for (const row of populated) {
    if (indentOf(row) === nameCol) {
      const left = helpCol > nameCol ? row.slice(0, helpCol) : row;
      const right = helpCol > nameCol ? row.slice(helpCol) : "";
      const tokens = left.trim().split(/\s+/);
      // Split on whitespace, so a range constraint (`SECS [x>=0]`) arrives as
      // two tokens and only the first is offered here — the same metavar the
      // cell-level pattern reads when it sees the whole cell.
      const cell = tokens.length > 1 ? parseMetavarCell(tokens[1]) : null;
      entries.push({
        name: tokens[0],
        metavar: cell?.metavar ?? null,
        valueOptional: cell?.valueOptional ?? false,
        help: right.trim(),
      });
      continue;
    }
    const previous = entries[entries.length - 1];
    if (previous) previous.help = `${previous.help} ${row.trim()}`.trim();
  }
  return entries;
}

// ------------------------------------------------------------ field decoding

/** A flag is inert when its help says so in one of tan's four fixed wordings.
 *
 *  `ref` is scoped to THAT marker's own parenthesis on purpose. Plenty of
 *  live options cite issues in passing (`--pre-launch-task` names two), and a
 *  single-slot `ref` filled from the first `tan-cli#NNN` anywhere in the help
 *  would report an unrelated ticket as the reason a working flag is dead.
 *
 *  `marker` is the matched text VERBATIM, and it is what a null `ref` leaves
 *  the reader without. Two of the four wordings cite no issue at this pin, so
 *  for `renode --board-yaml`, `renode --image-bundle`, `faultdecode --project`
 *  and `faultdecode --sdk-root` the `ref` is null and the report would
 *  otherwise read "(no issue named in the help text)" — indistinguishable from
 *  a flag nobody has looked at. The marker says the CLI's own help text
 *  declares the flag dead, which is the spellchecker-versus-decision
 *  distinction `ref` was added for, arriving by the other route. */
export function classifyInert(help) {
  for (const pattern of INERT_PATTERNS) {
    const match = pattern.exec(help);
    if (match) {
      return { inert: true, ref: match[1] ?? null, marker: match[0].trim() };
    }
  }
  return { inert: false, ref: null, marker: null };
}

/** `--board,--board-yaml` is ONE option with TWO accepted spellings; the gate
 *  looks up whichever spelling a call site used, so both become keys. */
function optionsFromEntries(entries) {
  const options = {};
  for (const entry of entries) {
    if (!FLAG_CELL.test(entry.name)) continue;
    const { inert, ref, marker } = classifyInert(entry.help);
    for (const spelling of entry.name.split(",")) {
      const flag = spelling.trim();
      // `valueOptional` is written even when false. An absent key is
      // indistinguishable from a key the fetcher stopped emitting, and the one
      // thing a contract file must never do is lose a dimension quietly.
      if (flag) {
        options[flag] = {
          inert,
          ref,
          marker,
          metavar: entry.metavar,
          valueOptional: entry.valueOptional === true,
        };
      }
    }
  }
  return options;
}

/** Positional count from the usage line: `[APP_PATH]` is 1, `[SUBCOMMAND]
 *  [ARG]` is 2, and a variadic `[ARGS...]` tail is unbounded (-1). */
export function parsePositionals(helpText) {
  const usage = helpText
    .split("\n")
    .find((line) => /^\s*Usage:\s+tan\b/.test(line));
  if (!usage) throw new Error("help page carries no Usage line");
  const tail = usage.replace(/^\s*Usage:\s+tan\b/, "").trim();
  const tokens = tail.split(/\s+/).filter(Boolean);
  const positionals = tokens.filter(
    (token) => token !== "[OPTIONS]" && !/^[a-z][a-z0-9-]*$/.test(token),
  );
  if (positionals.some((token) => token.includes("...")))
    return VARIADIC_POSITIONALS;
  return positionals.length;
}

/** Allowed values for a positional SUBCOMMAND, read off its own help cell:
 *  "build." and "list, current, install, or switch. install/switch are not
 *  yet ported …" — only the leading enumeration, never the caveat sentence
 *  behind it.
 *
 *  The Oxford comma is normalised BEFORE splitting: an alternation that tries
 *  `,` first eats the comma and leaves the piece "or switch", which then
 *  fails a shape filter and silently drops `switch` — a snapshot short one
 *  verb makes the gate reject a call that tan accepts. A piece that is still
 *  not a verb throws instead of being filtered away, so a reworded help page
 *  surfaces as a build failure rather than a quietly smaller surface. */
export function parseSubcommandValues(argumentEntries) {
  const entry = argumentEntries.find(
    (candidate) => candidate.name.replace(/[[\]]/g, "") === "SUBCOMMAND",
  );
  if (!entry) return [];
  const enumeration = (entry.help.split(/\.(?:\s|$)/)[0] ?? "").replace(
    /,?\s+or\s+/g,
    ", ",
  );
  const values = enumeration
    .split(/\s*,\s*/)
    .map((value) => value.trim())
    .filter(Boolean);
  const malformed = values.filter((value) => !/^[a-z][a-z0-9-]*$/.test(value));
  if (malformed.length > 0) {
    throw new Error(
      `could not read the SUBCOMMAND values from ${JSON.stringify(entry.help)} — ` +
        `${JSON.stringify(malformed)} is not a verb`,
    );
  }
  return values;
}

/** Subcommands that are IN the vocabulary and REFUSE when you send them.
 *
 *  This is the sentence `parseSubcommandValues` throws away, and throwing it
 *  away is what made `sdk` look healthier than it is. Its SUBCOMMAND help
 *  reads "list, current, install, or switch. install/switch are not yet
 *  ported and refuse in this build -- use --sdk-root instead (tan-cli#305)."
 *  The enumeration alone says four verbs are accepted; two of them exit 1
 *  with `sdk.not-ported`. `src/sdk/activeSdk.ts:171` sends one of those two.
 *
 *  This is the SUBCOMMAND analogue of an inert flag and it fails the same
 *  way: the spelling is right, the vocabulary check passes, and the behaviour
 *  is absent — so a gate that only checks membership reports nothing.
 *
 *  A verb named here that is NOT in the enumeration throws. The two readings
 *  come from one sentence; if they disagree, the sentence was misparsed, and
 *  a misparse that quietly produces an empty refusal map restores exactly the
 *  blind spot this closes. */
const REFUSAL_SENTENCE =
  /\b([a-z][a-z0-9-]*(?:\s*(?:[/,]|\bor\b)\s*[a-z][a-z0-9-]*)*)\s+(?:is|are)\s+not\s+yet\s+ported\s+and\s+refuses?\b/;

export function parseRefusingSubcommands(argumentEntries, allowedValues) {
  const entry = argumentEntries.find(
    (candidate) => candidate.name.replace(/[[\]]/g, "") === "SUBCOMMAND",
  );
  if (!entry) return {};
  const match = REFUSAL_SENTENCE.exec(entry.help);
  if (!match) return {};

  // The ref is read from the refusal clause only — from the marker to the end
  // of its own sentence — for the same reason `classifyInert` scopes its own:
  // a `tan-cli#NNN` cited elsewhere in the help would name an unrelated
  // ticket as the reason a verb refuses.
  const clause = entry.help.slice(match.index).split(/\.(?:\s|$)/)[0] ?? "";
  const ref = /(tan-cli#\d+)/.exec(clause)?.[1] ?? null;

  const verbs = match[1]
    .split(/\s*(?:[/,]|\bor\b)\s*/)
    .map((verb) => verb.trim())
    .filter(Boolean);
  const unknown = verbs.filter((verb) => !allowedValues.includes(verb));
  if (unknown.length > 0) {
    throw new Error(
      `the SUBCOMMAND help says ${JSON.stringify(unknown)} refuse, but the ` +
        `enumeration lists ${JSON.stringify(allowedValues)} — the two halves ` +
        `of ${JSON.stringify(entry.help)} were read inconsistently. An empty ` +
        `refusal map here is a blind spot, not a clean result.`,
    );
  }
  return Object.fromEntries(verbs.sort().map((verb) => [verb, { ref }]));
}

// ------------------------------------------------------------- surface walk

function boxNamed(boxes, title) {
  return boxes.find((box) => box.title === title)?.rows ?? [];
}

function describeCommand(helpText, label) {
  const boxes = parseBoxes(helpText);
  const argumentEntries = parseBoxEntries(
    boxNamed(boxes, "Arguments"),
    `${label} [Arguments]`,
  );
  const subcommandValues = parseSubcommandValues(argumentEntries);
  return {
    maxPositionals: parsePositionals(helpText),
    subcommandValues,
    refusingSubcommands: parseRefusingSubcommands(
      argumentEntries,
      subcommandValues,
    ),
    options: optionsFromEntries(
      parseBoxEntries(boxNamed(boxes, "Options"), `${label} [Options]`),
    ),
  };
}

/** Command names from the root help's category boxes (Setup, Build & run, …).
 *  The Options box is skipped: its rows are flags, not commands. */
export function parseCommandNames(rootHelp) {
  const names = new Set();
  for (const box of parseBoxes(rootHelp)) {
    if (box.title === "Options") continue;
    for (const entry of parseBoxEntries(
      box.rows,
      `tan --help [${box.title}]`,
    )) {
      if (/^[a-z][a-z0-9-]*$/.test(entry.name)) names.add(entry.name);
    }
  }
  return [...names].sort();
}

/** The 12 flags tan accepts BEFORE any subcommand. `tan --help` does not list
 *  them — only the completion script it emits does, so that is where they
 *  come from. */
export function parseGlobalOptions(completionScript) {
  const match = /local global_flags="([^"]*)"/.exec(completionScript);
  if (!match) {
    throw new Error(
      "the emitted bash completion script declares no global_flags",
    );
  }
  const flags = match[1].split(/\s+/).filter(Boolean);
  if (flags.length === 0) throw new Error("global_flags is empty");
  return flags;
}

/** Walk one command, then any positional subcommand that turns out to have a
 *  help page of its own. In 0.6.0-rc1 none do — `tan model build --help` is
 *  byte-identical to `tan model --help` — so the walk records `model` and
 *  `sdk` once each and adds no phantom `model build` entry. */
function walkCommand(binary, path, commands, depth, rawHelp) {
  const helpText = helpFor(binary, path);
  const key = path.join(" ");
  rawHelp.set(key, helpText);
  commands[key] = describeCommand(helpText, `tan ${key} --help`);
  if (depth >= MAX_SUBCOMMAND_DEPTH) return;
  for (const value of commands[key].subcommandValues) {
    const childHelp = helpFor(binary, [...path, value]);
    if (childHelp === helpText) continue;
    walkCommand(binary, [...path, value], commands, depth + 1, rawHelp);
  }
}

/** The shape (`metavar`/`valueOptional`) a global flag was captured with on
 *  WHATEVER command's own Options box declares it explicitly — `diff` and
 *  `pinmux` alone restate all ten, so this always resolves for a real global
 *  flag. Never invented: a flag no command's box ever shows falls back to the
 *  boolean shape (`metavar: null`), which is what every flag in this file
 *  that takes no value already looks like. */
function globalShapeOf(commands, flag) {
  for (const command of Object.values(commands)) {
    const option = command.options[flag];
    if (option)
      return { metavar: option.metavar, valueOptional: option.valueOptional };
  }
  return { metavar: null, valueOptional: false };
}

/** (#602) Fold each command's own DESCRIPTION-level inert claims into its
 *  `options` — reclassifying a flag the Options box already lists (`diff`,
 *  `pinmux`: all ten global flags are restated there, live per the box,
 *  inert per the paragraph above it) and ADDING one the box never lists at
 *  all (`inspect`, `support-bundle`, `trace`: the box omits exactly the
 *  flags the paragraph says are ignored).
 *
 *  `faultdecode` carries BOTH shapes on the SAME two flags: its own
 *  per-option help cells already say `--project`/`--sdk-root` are unused
 *  ("(unused: faultdecode is HW-free)" / "(unused; see below)"), which
 *  `optionsFromEntries` + `INERT_PATTERNS` already classified inert with
 *  THAT wording as `marker`. The description paragraph repeats the same
 *  fact about those two flags in coarser, command-wide prose. The per-option
 *  wording is strictly more specific — it is about ONE flag, not nine — so an
 *  already-inert entry is left alone here; the description pass only ever
 *  RAISES `inert: false` to `true`, never replaces one true classification
 *  with a blunter one.
 *
 *  Deliberately NOT a blanket "every command accepts every `globalOptions`
 *  flag, so mark whatever is missing inert" rule. `new-som` is missing eight
 *  of the same global flags and its help — box AND paragraph — says nothing
 *  about any of them; nothing here adds an entry for those eight, because
 *  nothing in tan's own text supports classifying them either way. Recording
 *  a guessed `inert: true` would trade the false-live defect this closes for
 *  a false-inert one with the same cause: a claim `test/tan.surfaceContract
 *  .test.js`'s own gate ("an inert option with neither `ref` nor `marker` is
 *  a defect in the fetcher's classifier, not in the CLI") already refuses to
 *  accept without a marker.
 *
 *  `new-som` IS NOT THE ONLY COMMAND LEFT WITH THIS GAP, and naming only it
 *  understates the remainder by an order of magnitude. Measured against the
 *  pinned binary (every accepted flag probed with `tan <cmd> <flag> --help`,
 *  0 rejections): 147 accepted `(command, global-flag)` pairs across 23
 *  commands are STILL entirely absent from this snapshot after this fix —
 *  `monitor` (10), `sdk` (8), `new-som` (8), and `bootstrap`/`completion`/
 *  `flash`/`image`/`lock`/`model`/`quality`/`run`/`validate` (7 each) among
 *  them, plus a smaller remainder on `clean`/`debug-config`/`doctor`/
 *  `examples`/`explain`/`generate`/`init`/`kconfig`/`migrate`/`presets`/
 *  `size`. This fetcher is LESS WRONG than it was, not complete:
 *  `applyDescriptionInert` only recovers a flag when tan's OWN help text says
 *  something about it, and most commands' help says nothing about their
 *  global flags at all — the six this pass fixes are the exception, not the
 *  rule. `test/tan.surfaceContract.test.js:470-478`'s inert assertion reads
 *  `options[flag]` and silently `continue`s past a missing key, so all 147
 *  remaining pairs are structurally invisible to it: an upstream rewording
 *  of any of those 23 commands' help that made a currently-missing flag
 *  conditionally inert (the `isHedged` shape above) would go unnoticed the
 *  same way the original 36 did. */
function applyDescriptionInert(commands, rawHelp, globalOptions) {
  for (const [key, helpText] of rawHelp) {
    const command = commands[key];
    if (!command) continue;
    const { named, residual } = classifyDescriptionInert(
      parseDescription(helpText),
    );
    for (const [flag, { ref, marker }] of named) {
      const existing = command.options[flag];
      if (existing?.inert === true) continue;
      const shape = existing ?? globalShapeOf(commands, flag);
      command.options[flag] = {
        inert: true,
        ref,
        marker,
        metavar: shape.metavar,
        valueOptional: shape.valueOptional,
      };
    }
    if (!residual) continue;
    for (const flag of globalOptions) {
      if (flag in command.options) continue;
      const shape = globalShapeOf(commands, flag);
      command.options[flag] = {
        inert: true,
        ref: null,
        marker: residual.marker,
        metavar: shape.metavar,
        valueOptional: shape.valueOptional,
      };
    }
  }
}

function sortedByKey(record) {
  return Object.fromEntries(
    Object.keys(record)
      .sort()
      .map((key) => [key, record[key]]),
  );
}

/** sha256 over the RAW `--help` text of the root and of every command, each
 *  prefixed by its own key so a rename moves the digest even when the two
 *  pages are byte-identical.
 *
 *  This exists because the anti-tamper floor it replaces had exactly one entry
 *  of slack: the test asserted `inert.length >= 12` and the snapshot held 13.
 *  Hand-editing `doctor --build` to `"inert": false` — the only inert flag
 *  outside `build`, and the whole of #544 — dropped the count to exactly 12,
 *  every guard stayed green, and the defect vanished from the report. A count
 *  cannot say WHICH entry disappeared. This digest plus the gate's named
 *  anchors can: the digest says the snapshot no longer matches any text a
 *  binary produced, and the anchors say which specific fact was lost.
 *
 *  The separator is NUL because no `--help` page can contain one, so no help
 *  text can forge a part boundary. SPELLED `\u0000`, never as a raw byte: a
 *  literal NUL in the source makes grep classify this whole file as binary and
 *  SKIP it in `-r` sweeps — the file drops out of every source-wide search
 *  with no error anywhere. The escape hashes identically (verified by
 *  comparing `--check`'s source/content digests across the respelling), so the
 *  only thing it changes is whether this file can be found. */
function digestOf(rootHelp, rawHelp) {
  const parts = [`tan --help\n${rootHelp}`];
  for (const key of [...rawHelp.keys()].sort()) {
    parts.push(`tan ${key} --help\n${rawHelp.get(key)}`);
  }
  return createHash("sha256")
    .update(parts.join("\n\u0000\n"), "utf8")
    .digest("hex");
}

/** JSON with every object's keys in sorted order, so the digest below is a
 *  function of the CONTENT and not of the writer's insertion order. Arrays
 *  keep their order — `globalOptions` is a sequence tan emits, and reordering
 *  it is a change, not a re-spelling. */
function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value ?? null);
}

/**
 * sha256 over the snapshot's OWN semantic content — every command, every
 * option, every flag's `inert`/`ref`/`marker`/`metavar`/`valueOptional`, every
 * refusing subcommand, and the global option list.
 *
 * `sourceDigest` cannot do this job, and the gap was not theoretical.
 * `sourceDigest` covers the raw `--help` TEXT, which nothing in this repo
 * holds — reproducing it needs the pinned binary. So the only thing the gate
 * could assert about it was its SHAPE, `/^[0-9a-f]{64}$/`, which checks that a
 * 64-character hex string is a 64-character hex string. Flipping two
 * NON-ANCHORED facts by hand — `renode --image-bundle` and `build --manifest`,
 * both `inert: true` to `inert: false` — left the whole gate at exactly its
 * baseline: no anchor names either flag, and nothing recomputed anything.
 *
 * This digest IS recomputable from the committed file alone, and the test
 * recomputes it from the bytes it just read, so a hand edit to any command
 * anywhere fails. It says NOTHING about which binary produced the file; that
 * is `sourceDigest`'s job, and the two are separate because they answer
 * different questions and neither answers the other's.
 *
 * `version` and `capturedAt` are excluded on purpose: `version` has its own
 * assertion against `SUPPORTED_CLI_VERSION`, and a digest that moved with the
 * capture DATE would break on every re-capture for no reason at all.
 */
export function contentDigestOf(snapshot) {
  return createHash("sha256")
    .update(
      canonicalJson({
        commands: snapshot?.commands ?? {},
        globalOptions: snapshot?.globalOptions ?? [],
      }),
      "utf8",
    )
    .digest("hex");
}

export function buildSnapshot(binary, capturedAt) {
  const rootHelp = helpFor(binary, []);
  const completion = runTan(binary, ["completion", "--shell", "bash"]);
  if (completion.status !== 0) {
    throw new Error(
      `"tan completion --shell bash" exited ${completion.status}`,
    );
  }
  const globalOptions = parseGlobalOptions(completion.stdout);

  const commands = {};
  const rawHelp = new Map();
  for (const name of parseCommandNames(rootHelp)) {
    walkCommand(binary, [name], commands, 1, rawHelp);
  }

  applyDescriptionInert(commands, rawHelp, globalOptions);

  for (const key of Object.keys(commands)) {
    // (#602) A command with zero captured options is indistinguishable from
    // "this command genuinely has no options" UNLESS something checks —
    // every real tan command has at least `--help`, so an empty result here
    // means a box the parser should have read produced nothing, silently.
    // Refusing to write that snapshot is cheaper than shipping a green gate
    // over a command nobody can prove was read at all.
    if (Object.keys(commands[key].options).length === 0) {
      throw new Error(
        `tan ${key} --help parsed to ZERO options. Every real tan command ` +
          "has at least --help, so this is a parser failure, not an empty " +
          "surface — refusing to write a snapshot that cannot be told apart " +
          "from a command with no options at all.",
      );
    }
    commands[key] = {
      ...commands[key],
      options: sortedByKey(commands[key].options),
    };
  }
  const snapshot = {
    version: probeVersion(binary),
    capturedAt,
    sourceDigest: digestOf(rootHelp, rawHelp),
    // Filled in below: it is a digest OF this object, so it cannot be one of
    // the inputs to itself. Declared here to fix its position in the written
    // JSON, next to the digest it is routinely confused with.
    contentDigest: null,
    globalOptions,
    commands: sortedByKey(commands),
  };
  return { ...snapshot, contentDigest: contentDigestOf(snapshot) };
}

// -------------------------------------------------------------------- driver

function countOptions(snapshot) {
  let total = 0;
  let inert = 0;
  let refusing = 0;
  for (const command of Object.values(snapshot.commands)) {
    for (const option of Object.values(command.options)) {
      total += 1;
      if (option.inert) inert += 1;
    }
    refusing += Object.keys(command.refusingSubcommands ?? {}).length;
  }
  return { total, inert, refusing };
}

function main(argv) {
  const checkOnly = argv.includes("--check");
  const binary = process.env.TAN_BIN || DEFAULT_TAN_BIN;

  const supported = readSupportedCliVersion();
  const reported = probeVersion(binary);
  if (reported !== supported) {
    throw new Error(
      `refusing to write the snapshot: ${binary} reports ${reported}, but ` +
        `SUPPORTED_CLI_VERSION is ${supported}. Point TAN_BIN at the pinned ` +
        `binary (or re-run "Alp: Update CLI") and try again.`,
    );
  }

  const snapshot = buildSnapshot(binary, new Date().toISOString().slice(0, 10));
  const { total, inert, refusing } = countOptions(snapshot);
  const summary =
    `tan ${snapshot.version}: ${Object.keys(snapshot.commands).length} commands, ` +
    `${total} options (${inert} inert), ${refusing} refusing subcommand(s), ` +
    `${snapshot.globalOptions.length} global options, ` +
    `source ${snapshot.sourceDigest.slice(0, 12)}, ` +
    `content ${snapshot.contentDigest.slice(0, 12)}`;

  if (checkOnly) {
    console.log(`[surface] ${summary} (--check: nothing written)`);
    return;
  }
  mkdirSync(dirname(SNAPSHOT_PATH), { recursive: true });
  writeFileSync(
    SNAPSHOT_PATH,
    `${JSON.stringify(snapshot, null, 2)}\n`,
    "utf8",
  );
  console.log(`[surface] ${summary}`);
  console.log(`[surface] wrote ${SNAPSHOT_PATH}`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    main(process.argv.slice(2));
  } catch (error) {
    console.error(
      `[surface] ${error instanceof Error ? error.message : String(error)}`,
    );
    process.exit(1);
  }
}
