// SPDX-License-Identifier: Apache-2.0
//
// Every `tan` argv this extension SENDS must be argv the PINNED tan ACCEPTS.
//
// This is the gate that #522/#523 should have had. The Models panel drove nine
// `tan model` subcommands at a pin that implements exactly one (`build`), and
// it opened with four red alarms in front of a customer. Nothing was wrong with
// the panel when it was written — #520 moved `SUPPORTED_CLI_VERSION` underneath
// it and no part of this repo re-probed the CLI surface afterwards. A pin bump
// is a surface change, and until now it was an unmeasured one.
//
// Three pieces, and they only work together:
//
//   scripts/tan-surface/extract.mjs        every `tan` invocation in `src/`,
//                                          statically reduced to command +
//                                          flags + positionals. Emitted, never
//                                          committed: it must describe the tree
//                                          as it is right now.
//   test/golden/tan-surface/surface.json   what the pinned tan accepts, read
//                                          out of its own `--help`. Committed:
//                                          it is a fact about a binary, and it
//                                          moves only when the pin moves.
//   this file                              one is checked against the other.
//
// ── WHAT A GREEN RUN DOES NOT MEAN ─────────────────────────────────────────
//
// It means every flag we send is accepted and live. It does NOT mean our CLI
// usage is correct, and the difference is not academic:
//
//   `tan flash` at this pin needs `--confirm` to write anything. Without it
//   every slice is PREVIEWED, nothing is written, and the run exits non-zero
//   (tan-cli#719). Both flash sites omit it. That argv is completely legal —
//   nothing about `["flash", "--core", coreId]` is a surface violation — and
//   the shipped Flash button programs no board (#540).
//
// A missing flag is invisible to any comparison of the form "is what we send
// accepted?", because omitting an optional flag is what optional means. Only
// reading the help text finds that class. This gate closes the other class:
// flags that do not exist, and flags that exist and do nothing.
//
// ── THREE SCOPE LIMITS THAT ARE REAL, KNOWN, AND NOT FIXED HERE ────────────
//
// Written down because a gate whose limits are undocumented gets read as
// covering more than it does, and that misreading is worth more to an
// attacker of this codebase than any single missing assertion.
//
// (a) ROOT-POSITION FLAGS ARE NOT MODELLED AT ALL. `withSdkRoot`
//     (src/alpCli/vscodeAdapter.ts:135-148) PREPENDS `["--sdk-root", <path>]`
//     BEFORE the command, and `runAlp`/`runAlpAsync` APPEND `"--format",
//     "json"`. Neither appears in any extracted record — the extractor reads
//     the argv array at the CALL SITE, and these are added by the runner
//     afterwards. So assertion 3 does NOT literally check "every flag this
//     extension sends"; it checks every flag written at a call site. The
//     snapshot has no notion of a root-position flag either: `globalOptions`
//     is a flat name list with no position and no arity. Closing this needs
//     the extractor to model each runner's own contribution, which is a
//     bigger change than any of the seven fixes above.
//
// (b) `globalOptions` HAS NO PER-COMMAND GROUNDING. Assertion 3's fallback
//     ("not an option of this command, but it is global, so allow it") is
//     sourced from the `global_flags` name list inside the bash completion
//     script tan emits. That list asserts the flags exist SOMEWHERE; it does
//     not assert any particular command accepts them. A 384-probe sweep (12
//     global flags x 32 commands) at this pin found ZERO rejections, so there
//     is no live false-accept to fix — but "every command takes every global
//     flag" is a measured property of 0.6.0-rc1, NOT something the snapshot
//     records, and a future tan could narrow it without this gate noticing.
//
// (c) A FLAG INSIDE A NON-LITERAL SPREAD IS INVISIBLE TO EVERY ASSERTION
//     HERE, and it is a SECOND way a flag escapes the gate — distinct from
//     limit (a), which is about flags the runner adds. This one is about flags
//     written at the call site in a shape the extractor cannot reduce.
//
//     THE WORKED EXAMPLE IS GONE, THE LIMIT IS NOT. Until #584 this paragraph
//     cited `src/west.ts`'s Renode call:
//
//         const coreArg = core === null ? [] : ["--core", core];
//         await runAlpStreamed(context, ["renode", ...target.appArg, ...coreArg], …)
//
//     `coreArg` is a `const`, but its initializer is a TERNARY, not an array
//     literal, so the spread resolved to nothing and the record for that site
//     read `flags: []`: the SITE was pinned in `EXPECTED_PARTIAL` and could not
//     vanish quietly, but its `--core` was never checked against the pinned
//     CLI at all. tan v0.6.0 removed the `renode` verb (tan-cli#848) and that
//     call site went with it, so no site in the tree has this shape today.
//
//     Kept written down because the limit is a property of the EXTRACTOR, not
//     of that one call: the next conditional spread anywhere in the tree gets
//     the same silent treatment, and it will look green.
//
//     NOT FIXED HERE, deliberately. Resolving a ternary means picking a branch
//     or reporting both, and the extractor's whole discipline is that it
//     reports what it can prove and degrades what it cannot — a `flags:
//     ["--core"]` inferred from one arm of a conditional is the same class of
//     fabricated record that the spread-scope fix removed. The honest fix is
//     at the call site: write the flag literally and let only the VALUE vary.
//
// A fourth, narrower limit, noted where it bites rather than as a headline:
// assertion 5 runs on `resolution: "full"` sites only, so a `"partial"` site
// sending a non-subcommand positional (`["model", "add", id, …]`) is checked
// for its command, its flags and its INERTNESS, and for whether its
// subcommand REFUSES — but not against the subcommand vocabulary. The count
// arm cannot run there (an opaque element may be a positional or some flag's
// value) and the two arms share a test.
//
// One shape reaches `"partial"` by that route on purpose rather than by
// accident: an OPTIONAL-value flag (`--flag [PATH]` in the help) followed by a
// non-flag token. That token may be the flag's value or the first positional,
// and there is nothing in the argv that says which. Reading it as a positional
// is how a gate emits a false `Got unexpected extra argument(s)`; the
// extractor consumes it and marks the record opaque instead, which costs the
// site its arity check and lists it in `EXPECTED_PARTIAL` where the cost is
// visible. NO option in tan 0.6.0-rc1 uses a bracketed metavar — all 33 help
// pages were swept — so this path is unreachable at this pin. It is a parser
// that can read a spelling tan does not yet use, not a false RED that was
// observed and removed.
//
// ── WHY `inert` NEEDS A GATE AND A TYPO DOES NOT ───────────────────────────
//
// (The same defect exists in the SUBCOMMAND position and is checked the same
// way. `tan sdk`'s vocabulary is `list, current, install, switch`, and its own
// help says install/switch "are not yet ported and refuse in this build"
// (tan-cli#305) — `tan sdk switch <path>` exits 1 with `sdk.not-ported`. A
// membership check passes it. `refusingSubcommands` in the snapshot is what
// makes it fail here instead.)
//
// A misspelled flag is loud: click exits 2 with `No such option`, and the
// caller gets no envelope at all. You find it the first time you run it.
//
// An INERT flag is silent. Twelve of `tan build`'s twenty-two options carry the
// identical help string "Accepted by other commands; not implemented for
// `build` yet (tan-cli#427)". `tan build --plan` PARSES — the Build Plan panel
// sent exactly that and then rejected the result three layers from the cause
// (#541). `tan doctor --build` is the same shape under a different upstream
// number: "Accepted for compatibility (tan-cli#290)" — so the Dependencies
// report spawned doctor twice for one identical payload (#544). Both were
// FIXED by the run of this gate that first reported them; the wording stays in
// the past tense because the flags are still inert and the next call site to
// reach for one fails here the same way.
//
// That is why assertion 4 prints the `ref`. A reader who sees `--plan` reported
// and no issue number reaches for the spellchecker. A reader who sees
// `tan-cli#427` knows the flag is spelled right, the CLI is the gap, and the
// fix is a decision rather than an edit.
//
// ── WHY THE UNRESOLVABLE LIST IS PART OF THE CONTRACT ──────────────────────
//
// A static extractor can only read argv it can statically reduce. Rewrite
// `["build", "--plan"]` as `["build", ...planFlags]` and the site leaves this
// gate's reach entirely — no failure, no mention, nothing. Assertion 6 makes
// that move fail: the set of sites the extractor could not reduce is pinned, so
// a NEW one is a red test rather than a quiet exemption. It is the difference
// between a gate and a suggestion.
//
// The extractor must never drop an unreadable site on the floor. It emits every
// site with a `resolution` of `full`, `partial` or `none`, and this file
// decides what each means. `partial` exists because the two-state version
// discarded a site's readable half along with its unreadable one: eleven of the
// twenty-three then-unresolvable sites are array literals whose command and
// flags are perfectly legible and only a runtime VALUE is not. BOTH the
// `partial` and the `none` sets are pinned, one state apart, so neither
// demotion can happen quietly.
//
// ── NO ALLOWLIST ───────────────────────────────────────────────────────────
//
// Four defects were live on `dev` when this gate was written: #541 (`build
// --plan`, `--manifest`, `--manifest-from`), #543 (`model --model`, plus stray
// positionals on seven `model` calls), #544 (`doctor --build`), #546 (`sdk
// switch`). Every one was REPORTED HERE and then FIXED — the calls are gone,
// which is why this file is green. None of them was excused. An allowlist
// would have turned that list of defects into a list of things we had agreed
// to keep shipping, and the entries outlive the memory of why they were added
// — the failure this repo has already paid for twice. The gate goes green when
// the calls are fixed or the pin moves, and not before.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const { SUPPORTED_CLI_VERSION } = require("../out/alpCli/service.js");

const ROOT = path.join(__dirname, "..");
const EXTRACTOR_REL = "scripts/tan-surface/extract.mjs";
const SNAPSHOT_REL = "test/golden/tan-surface/surface.json";

// ---------------------------------------------------------------------------
// The two inputs
// ---------------------------------------------------------------------------

/**
 * The vendored surface of the pinned tan. Read eagerly and with a message that
 * says how to regenerate it: a `require` that throws `ENOENT` inside a test
 * file tells the next person nothing about where the file comes from.
 */
function loadSnapshot() {
  const file = path.join(ROOT, SNAPSHOT_REL);
  let text;
  try {
    text = fs.readFileSync(file, "utf8");
  } catch (error) {
    throw new Error(
      `${SNAPSHOT_REL} is missing (${error.code}). It is the recorded ` +
        "`--help` surface of the PINNED tan and is committed on purpose. " +
        "Re-capture it from the binary named by SUPPORTED_CLI_VERSION — not " +
        "from whatever `tan` is on PATH, which is routinely a different build.",
    );
  }
  let snapshot;
  try {
    snapshot = JSON.parse(text);
  } catch (error) {
    throw new Error(`${SNAPSHOT_REL} is not valid JSON: ${error.message}`);
  }
  // Validated here rather than at every use: a snapshot missing `commands`
  // would otherwise throw a `hasOwnProperty of undefined` deep inside one
  // assertion and read as a bug in this file.
  if (typeof snapshot.version !== "string") {
    throw new Error(`${SNAPSHOT_REL} has no \`version\` string`);
  }
  if (!Array.isArray(snapshot.globalOptions)) {
    throw new Error(`${SNAPSHOT_REL} has no \`globalOptions\` array`);
  }
  if (!snapshot.commands || typeof snapshot.commands !== "object") {
    throw new Error(`${SNAPSHOT_REL} has no \`commands\` object`);
  }
  return snapshot;
}

/** Values of `record.resolution`, mirrored from the extractor. Kept as
 *  constants so a typo here fails at reference rather than silently matching
 *  nothing and emptying a whole site partition. */
const FULL = "full";
const PARTIAL = "partial";
const NONE = "none";

/**
 * Every `tan` invocation in the tree, from the extractor. Run rather than
 * imported: the extractor is a script with its own resolution rules, and
 * driving it as a child is the only way this gate measures what CI measures.
 */
function runExtractor() {
  const result = spawnSync(process.execPath, [EXTRACTOR_REL], {
    cwd: ROOT,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  if (result.error) {
    throw new Error(
      `could not run \`node ${EXTRACTOR_REL}\`: ${result.error.message}`,
    );
  }
  if (result.status !== 0) {
    throw new Error(
      `\`node ${EXTRACTOR_REL}\` exited ${result.status}. It refuses rather ` +
        "than guessing when it cannot parse a call site, so this is a real " +
        `failure, not a flake.\n${result.stderr}`,
    );
  }
  let sites;
  try {
    sites = JSON.parse(result.stdout);
  } catch (error) {
    throw new Error(
      `\`node ${EXTRACTOR_REL}\` did not emit JSON on stdout ` +
        `(${error.message}). First 400 bytes:\n${result.stdout.slice(0, 400)}`,
    );
  }
  if (!Array.isArray(sites)) {
    throw new Error(
      `\`node ${EXTRACTOR_REL}\` emitted ${typeof sites}, not an array of ` +
        "invocation records",
    );
  }
  return sites;
}

const SNAPSHOT = loadSnapshot();
const SITES = runExtractor();
const GLOBAL_OPTIONS = new Set(SNAPSHOT.globalOptions ?? []);

/** Fully reduced: every token is a literal. Every assertion applies. */
const RESOLVED = SITES.filter((site) => site.resolution === FULL);

/** Half reduced: the command is a leading string literal, something later is
 *  opaque. Eight sites when this file was written, and until the extractor grew
 *  a third state ALL EIGHT were invisible to every assertion here — including
 *  `["sdk", "switch", sdkPath]`, which sent a subcommand this pin refuses and
 *  was reported by this gate and removed (#546). An unreadable RUNTIME VALUE is
 *  not a reason to stop checking the command name and the flag spellings
 *  written right next to it. */
const PARTIAL_SITES = SITES.filter((site) => site.resolution === PARTIAL);

/** Everything the command name can be checked on: assertions 2, 3, 4 and the
 *  refusing-subcommand assertion read this. Assertion 5 reads `RESOLVED`
 *  alone — see limit (c) in the header. */
const CHECKABLE = [...RESOLVED, ...PARTIAL_SITES];

/** Not reduced at all: the command itself is unreadable. Pinned by name. */
const UNRESOLVABLE = SITES.filter((site) => site.resolution === NONE);

/**
 * The subcommand a site sends, or `undefined` when it sends none this gate may
 * read.
 *
 * Straight off the record now. It used to be re-derived here from `rawText` by
 * a small bracket-matching parser that took the element after the command and
 * gave up if it began with `-` — which raised a FALSE ALARM on legal argv:
 * `["sdk", "--format", "json", "list"]` is argv real tan accepts (exit 0,
 * `"subcommand": "list"`), and this file reported it as a subcommand that
 * "could not be read". Only a walk that knows each flag's arity can tell that
 * `json` is `--format`'s value and `list` is the first positional, and the
 * extractor already does that walk. It emits `positionalValues`; this reads
 * it.
 *
 * `positionalsAnchored` is honoured, not ignored. Index 0 is a claim about
 * ORDINAL as well as value, and a gap of unknown length before a positional
 * destroys the ordinal while leaving the value perfectly legible.
 */
function subcommandOf(site) {
  if (!Array.isArray(site.positionalValues)) return undefined;
  if ((site.positionalsAnchored ?? 0) < 1) return undefined;
  const first = site.positionalValues[0];
  return typeof first === "string" ? first : undefined;
}

// ---------------------------------------------------------------------------
// Reporting
// ---------------------------------------------------------------------------

/** `file:line` plus the argv exactly as it is written, because the only useful
 *  failure message here is one a developer can act on without opening the
 *  extractor to work out which call was meant. */
const at = (site) => `${site.file}:${site.line}`;
const report = (site, reason) =>
  `  ${at(site)}  ${site.rawText}\n      ${reason}`;

/** The unresolvable set, keyed WITHOUT the line number. A site's line moves
 *  every time something above it is edited; what identifies it is the file and
 *  the argv expression. Duplicates are kept (array, not Set) so two identical
 *  dynamic calls in one file cannot collapse into one and let a second slip in
 *  free. */
const unresolvableKey = (site) => `${site.file}  ${site.rawText}`;

// ---------------------------------------------------------------------------
// 1. The snapshot describes the tan we actually pin
// ---------------------------------------------------------------------------

// First, because every other assertion in this file is only as true as this
// one. A snapshot captured from a different tan is not a weaker check, it is a
// confident wrong answer: it would green-light flags this pin refuses and
// report flags this pin implements. #520 moved the pin under a shipped feature
// with nothing re-probing the surface — this is the tripwire for that move.
test("the vendored surface was captured from the pinned tan", () => {
  assert.equal(
    SNAPSHOT.version,
    SUPPORTED_CLI_VERSION,
    `${SNAPSHOT_REL} records tan ${SNAPSHOT.version}, but ` +
      `SUPPORTED_CLI_VERSION is ${SUPPORTED_CLI_VERSION}. A pin bump IS a ` +
      "surface change. Re-capture the snapshot from the newly pinned binary " +
      "(`--help` for every command, `COLUMNS=200` or the text wraps and " +
      "truncates) and re-run — flags that were inert may now be live, and " +
      "flags that were live may have been renamed.",
  );
});

// ---------------------------------------------------------------------------
// 2. Every command we call exists
// ---------------------------------------------------------------------------

test("every command this extension invokes exists in the pinned tan", () => {
  const offenders = [];
  for (const site of CHECKABLE) {
    if (Object.prototype.hasOwnProperty.call(SNAPSHOT.commands, site.command)) {
      continue;
    }
    offenders.push(
      report(
        site,
        `\`tan ${site.command}\` is not a command in tan ` +
          `${SNAPSHOT.version} — the run dies as a usage error with no ` +
          "envelope at all, so nothing downstream can classify it",
      ),
    );
  }
  assert.deepEqual(
    offenders,
    [],
    "these call sites name a command the pinned tan does not have. Either " +
      "the command was renamed upstream, or it was never in the Python port " +
      "we ship (the retired Rust CLI's surface was a superset and parts of " +
      "this tree were written against it).",
  );
});

// ---------------------------------------------------------------------------
// 3. Every flag we send is one the command accepts
// ---------------------------------------------------------------------------

test("every flag this extension sends is accepted by the command it is sent to", () => {
  const offenders = [];
  for (const site of CHECKABLE) {
    const command = SNAPSHOT.commands[site.command];
    if (!command) continue; // reported by the command test; not re-reported here
    const options = command.options ?? {};
    for (const flag of site.flags ?? []) {
      if (Object.prototype.hasOwnProperty.call(options, flag)) continue;
      if (GLOBAL_OPTIONS.has(flag)) continue;
      offenders.push(
        report(
          site,
          `\`${flag}\` is not an option of \`tan ${site.command}\` in tan ` +
            `${SNAPSHOT.version}, and is not a global option. click exits 2 ` +
            "with `No such option` and prints NO envelope on stdout, so the " +
            "refusal arrives as a generic failure rather than something the " +
            "UI can name",
        ),
      );
    }
  }
  assert.deepEqual(
    offenders,
    [],
    "these flags do not exist on the command they are sent to. Check the " +
      "vendored surface for the accepted spelling before assuming the CLI is " +
      "at fault — an alias listed as `--board,--board-yaml` in help means " +
      "BOTH spellings are accepted, and both are recorded.",
  );
});

// ---------------------------------------------------------------------------
// 4. No flag we send is inert
// ---------------------------------------------------------------------------

// Checked per COMMAND, never against the global list, and that ordering is
// load-bearing. `--verbose`, `--quiet`, `--no-color`, `--non-interactive` and
// `--ci` are all global options AND all inert on `build`. A check that let
// global membership pass first would clear every one of them and report
// nothing, on a command where twelve options do nothing.
/**
 * What to print as the REASON a flag is dead.
 *
 * `ref` first: an issue number is the strongest form, because it says the
 * spelling is right, the CLI is the gap, and the fix is a decision waiting
 * upstream rather than an edit here.
 *
 * When `ref` is null the old message read "(no issue named in the help text)"
 * and stopped — which is indistinguishable from a flag nobody has looked at,
 * and it discards what the CLI itself said. Two inert wordings cite no issue
 * at this pin (`faultdecode --project`, `faultdecode --sdk-root`), so this is
 * not a corner: it is two of fifteen. It was four of seventeen until tan
 * v0.6.0 removed the `renode` verb, which took `renode --board-yaml` and
 * `renode --image-bundle` with it (#584). `marker` carries that wording
 * verbatim, and quoting
 * it restores the whole point of `ref` — the reader can tell "this CLI's own
 * help declares the flag dead" from "somebody may have typed it wrong".
 */
const inertReason = (option) => {
  if (typeof option.ref === "string") return `upstream gap ${option.ref}`;
  if (typeof option.marker === "string" && option.marker.length > 0) {
    return (
      "no issue named in the help text, which says " +
      `${JSON.stringify(option.marker)} — the CLI declares it dead itself`
    );
  }
  return "no issue named in the help text, and no marker recorded either";
};

test("no flag this extension sends is accepted-but-inert at this pin", () => {
  const offenders = [];
  for (const site of CHECKABLE) {
    const command = SNAPSHOT.commands[site.command];
    if (!command) continue;
    const options = command.options ?? {};
    for (const flag of site.flags ?? []) {
      const option = options[flag];
      if (!option || option.inert !== true) continue;
      offenders.push(
        report(
          site,
          `\`${flag}\` is accepted by \`tan ${site.command}\` and does ` +
            `NOTHING in tan ${SNAPSHOT.version} — ${inertReason(option)}. ` +
            "It parses, so the run exits 0 and the caller is told nothing. " +
            "This is not a typo: the spelling is correct and the behaviour " +
            "is absent",
        ),
      );
    }
  }
  assert.deepEqual(
    offenders,
    [],
    "these flags are accepted and inert. Each names the upstream issue that " +
      "tracks it — quote that number, do not re-file it. A call that cannot " +
      "work should say so on the flag surface (`this tan does not implement " +
      "X — <ref>`), not fail three layers later on a payload shape.",
  );
});

// ---------------------------------------------------------------------------
// 5. Positionals: how many, and which values
// ---------------------------------------------------------------------------

// An extra positional is the second half of the same failure as a bad flag:
// click exits 2 with `Got unexpected extra argument(s)` and, again, no
// envelope. `packages/alp-webview/src/features/models/cliSurface.ts`
// classifies refusals on `issues[].code`, and a parse error has no `issues[]`
// — so these refusals are structurally unclassifiable no matter how good the
// classifier gets (#543).
/* ── 4b. No subcommand we send is accepted-but-refusing ────────────────────
 *
 * The subcommand-position twin of assertion 4, and it fails identically: the
 * verb IS in the vocabulary, so the membership arm of assertion 5 clears it,
 * and the CLI then exits non-zero with an issue code because the port never
 * landed. Runs on PARTIAL sites too — `["sdk", "switch", sdkPath]` is exactly
 * this defect, and it was invisible to every assertion here until the
 * extractor learned to half-read a site. */
test("no subcommand this extension sends refuses at this pin", () => {
  const offenders = [];
  for (const site of CHECKABLE) {
    const command = SNAPSHOT.commands[site.command];
    if (!command) continue;
    const refusing = command.refusingSubcommands ?? {};
    const subcommand = subcommandOf(site);
    if (subcommand === undefined) continue;
    if (!Object.prototype.hasOwnProperty.call(refusing, subcommand)) continue;
    offenders.push(
      report(
        site,
        `\`tan ${site.command} ${subcommand}\` is in this pin's vocabulary ` +
          `and REFUSES in tan ${SNAPSHOT.version} — upstream gap ` +
          `${refusing[subcommand]?.ref ?? "(no issue named in the help text)"}. ` +
          "It parses, it is spelled right, and it exits non-zero with an " +
          "issue code rather than doing the work. This is not a typo: the " +
          "verb is correct and the behaviour is absent",
      ),
    );
  }
  assert.deepEqual(
    offenders,
    [],
    "these calls send a subcommand the pinned tan accepts into its parser " +
      "and then refuses. Each names the upstream issue that tracks it — " +
      "quote that number, do not re-file it. A call that cannot work should " +
      "say so before it spawns anything, not arrive as a failed run the UI " +
      "has to classify.",
  );
});

/* ── 4c. No value-taking flag is sent with its value missing ───────────────
 *
 * `["model", "--board"]` reduces cleanly, names a real command, names a real
 * flag, and sends zero positionals — it passes assertions 2, 3, 4 and 5. Real
 * tan exits 2 with `Option '--board' requires an argument`, before any
 * envelope. The extractor knows the arity from the snapshot's `metavar` and
 * now says so instead of walking off the end of the token stream in silence.
 */
test("no value-taking flag is sent without its value", () => {
  const offenders = [];
  for (const site of CHECKABLE) {
    for (const flag of site.danglingFlags ?? []) {
      offenders.push(
        report(
          site,
          `\`${flag}\` takes a value (its metavar is recorded in the ` +
            "vendored surface) and nothing follows it in this argv. click " +
            "exits 2 with `Option '" +
            flag +
            "' requires an argument` and prints no envelope at all",
        ),
      );
    }
  }
  assert.deepEqual(
    offenders,
    [],
    "these calls end on a flag that needs an argument. The value was " +
      "probably dropped by an edit above the array; the CLI cannot guess it " +
      "and neither can this gate.",
  );
});

// An extra positional is the second half of the same failure as a bad flag:
// click exits 2 with `Got unexpected extra argument(s)` and, again, no
// envelope. `packages/alp-webview/src/features/models/cliSurface.ts`
// classifies refusals on `issues[].code`, and a parse error has no `issues[]`
// — so these refusals are structurally unclassifiable no matter how good the
// classifier gets (#543).
test("positional arguments match what the command declares", () => {
  const offenders = [];
  const unreadable = [];
  for (const site of RESOLVED) {
    const command = SNAPSHOT.commands[site.command];
    if (!command) continue;

    // A NEGATIVE `maxPositionals` is the snapshot's spelling for a variadic
    // `[ARGS...]` tail: unbounded, not zero. Read naively, `count > -1` is true
    // for every call and this arm would report a violation on every variadic
    // command in the tree — noise that trains people to skip the whole gate.
    const unbounded = command.maxPositionals < 0;
    if (!unbounded && site.positionalCount > command.maxPositionals) {
      offenders.push(
        report(
          site,
          `\`tan ${site.command}\` accepts ${command.maxPositionals} ` +
            `positional argument(s) and this sends ${site.positionalCount}. ` +
            "click exits 2 with `Got unexpected extra argument(s)` and prints " +
            "no envelope, so the failure cannot be classified on an issue code",
        ),
      );
      // No subcommand report on top: the parse dies before the subcommand is
      // ever looked at, so "unknown subcommand" would describe a refusal that
      // never happens.
      continue;
    }

    const allowed = command.subcommandValues ?? [];
    if (allowed.length === 0 || site.positionalCount === 0) continue;

    const subcommand = subcommandOf(site);
    if (subcommand === undefined) {
      // NOT skipped quietly. This site sends a positional to a command whose
      // vocabulary is fixed, and the value could not be read — exactly the
      // shape of hole that lets an unknown subcommand ship. Reported as a gate
      // defect rather than a code defect, because that is what it is.
      unreadable.push(
        `  ${at(site)}  ${site.rawText}\n      sends ${site.positionalCount} ` +
          `positional(s) to \`tan ${site.command}\`, whose subcommands are ` +
          `${allowed.map((value) => `\`${value}\``).join(", ")}, but the ` +
          "value could not be read from the argv expression",
      );
      continue;
    }
    if (allowed.includes(subcommand)) continue;
    offenders.push(
      report(
        site,
        `\`${subcommand}\` is not a subcommand of \`tan ${site.command}\` ` +
          `in tan ${SNAPSHOT.version} — it implements ` +
          `${allowed.map((value) => `\`${value}\``).join(", ")} and nothing ` +
          "else",
      ),
    );
  }

  assert.deepEqual(
    unreadable,
    [],
    "the subcommand these calls send could not be determined, so they were " +
      "checked against nothing. Fix `subcommandOf` — or better, have the " +
      "extractor emit the positional VALUES alongside `positionalCount`, " +
      "which is where that knowledge belongs. This is a hole in the gate, not " +
      "a defect in the calls.",
  );
  assert.deepEqual(
    offenders,
    [],
    "these calls send positionals the pinned tan does not take. A refusal " +
      "carried by an envelope (`model.unknown-subcommand`) is classifiable " +
      "and survives a version skew; a click usage error is neither. Argv the " +
      "CLI can at least PARSE is worth more than argv that is merely close.",
  );
});

// ---------------------------------------------------------------------------
// 6. The dynamic call sites are the ones we know about
// ---------------------------------------------------------------------------

/**
 * Call sites whose COMMAND cannot be read at all — a bare identifier, a
 * conditional, a leading spread that does not resolve. Each one is a hole in
 * every assertion above, which is why the list is checked-in and exact rather
 * than merely counted.
 *
 * Keyed `file  argv-expression`, no line number: lines churn, the expression
 * identifies the site. Sorted; keep it sorted.
 *
 * ADDING AN ENTRY IS A DECISION, not a formality. It says: this argv is built
 * at runtime and nothing verifies it against the CLI. Prefer reshaping the
 * call so the command and its flags are literal and only the VALUES vary —
 * that keeps the site inside the gate.
 *
 * THESE ENTRIES ARE NOT HARMLESS. Twelve of thirty-four invocations are in
 * here, and each is a hole. Three entries LEFT the list with the four fixes
 * this gate's first red run produced, and both ways out are worth recording:
 *
 *   buildPlanPanel.ts `args`   was a ternary between `["build",
 *                              "--manifest-from", built]` and `["build",
 *                              "--manifest"]`. BOTH flags are inert
 *                              (tan-cli#427) — half of #541, invisible here
 *                              purely because of the ternary. The CALL is
 *                              gone: the panel reports the deferral from the
 *                              pin instead of spawning for it.
 *   models/panel.ts `args` x2  one was a ternary between `["model", "build",
 *                              "--model", name]` and `["model", "build"]`
 *                              (`--model` does not exist on this CLI at all,
 *                              #543 — the call died at exit 2 with no
 *                              envelope); it is now the literal `["model",
 *                              "build"]` and is CHECKED. The other was `model
 *                              prep`, a subcommand this pin does not have, and
 *                              is gone with the rest of #543.
 *
 * It USED to be twenty-three of forty-six, because a single opaque element
 * demoted a whole site. Eight of those then reduced far enough to be checked
 * (`EXPECTED_PARTIAL` below) — including the three `models/panel.ts`
 * add/run/ab calls and `sdk switch`, which stopped being unmeasurable and
 * started being reported. All four have since been fixed and are gone from the
 * tree; the four west.ts sites are what is left.
 *
 * The four `newProjectFlowPanel.ts` sites that used to be here have LEFT this
 * list for `EXPECTED_PARTIAL`. `root` is still `sdkPath ? ["--sdk-root",
 * sdkPath] : []` — a CONDITIONAL, so the leading-spread rule still declines to
 * resolve it — but the spread moved to the TAIL (`["explain", ...root]`), which
 * leaves the command a leading literal and puts the command, the flags and the
 * inertness back under assertions 2, 3, 4 and 4b. `--sdk-root` itself stays
 * unchecked, which is limit (c) and is the same state it is in at every site
 * where `withSdkRoot` prepends it (limit (a)).
 */
const EXPECTED_UNRESOLVABLE = [
  "src/alpCli/doctor.ts  args",
  // Was `src/lsp/client.ts  args` until the envelope runner was extracted so
  // the Configurator could share it. Same single pass-through site, new home.
  //
  // Measured, so that nobody reads this entry as narrower than it is: the
  // extractor does NOT follow a pass-through into its callers. It records one
  // site here with `command: null, resolution: "none"`, which means the argv
  // its callers actually pass — `["presets"]`, `["kconfig", "--core", <id>]`,
  // and now the Configurator's own `["presets"]` — is unverified against the
  // pinned CLI's surface. That was equally true while the function lived in
  // client.ts; extracting it moved the blind spot without widening it.
  "src/alpCli/envelope.ts  args",
  "src/alpCli/vscodeAdapter.ts  args",
  "src/alpCli/vscodeAdapter.ts  finalArgs",
  "src/debug.ts  args",
  "src/ideHub/newProjectFlowPanel.ts  initArgs",
  "src/loader.ts  args",
  "src/west.ts  args",
];

/**
 * The `initArgs` entry above is the wizard's `tan init`, and it is the one
 * unresolvable site in that list that IS checked — just not here.
 *
 * Its argv is genuinely conditional (a template or an example, `--cores` or
 * not, an SDK or not), so no call-site shape makes it a literal array. It moved
 * into `packages/alp-core/src/project/initArgv.ts` as a pure function, and
 * `test/wizard.initArgv.test.js` enumerates every branch through
 * `reduceLiteralArgv` — the extractor's own reducer, against this same
 * snapshot. The other four wizard sites went the other way and are now
 * literal-first (`["explain", ...root]` rather than `[...root, "explain"]`), so
 * they appear in `EXPECTED_PARTIAL` below.
 *
 * Written down because the entry alone reads as "unchecked", and for this one
 * site that is no longer true. Delete this note with the entry if the argv ever
 * becomes static; do not delete the note while the entry stands.
 */

/**
 * Half-readable sites, pinned for the same reason as the list above.
 *
 * Without this, a `"full"` site could quietly become `"partial"` — replace one
 * literal positional with a variable and assertion 5 stops running on it — and
 * assertion 6 would say nothing, because the site never entered the
 * unresolvable list. That is the exact "quiet exemption" this section exists
 * to prevent, one state further in.
 *
 * Moving an entry from here to nowhere (all literal) is the good direction.
 * Moving one from EXPECTED_UNRESOLVABLE to here is also progress: it means a
 * site that was checked against NOTHING is now checked against its command,
 * its flags, its inertness and its subcommand's refusal.
 */
const EXPECTED_PARTIAL = [
  'src/ideHub/newProjectFlowPanel.ts  ["examples", ...root]',
  'src/ideHub/newProjectFlowPanel.ts  ["explain", "--template", id, ...root]',
  'src/ideHub/newProjectFlowPanel.ts  ["explain", ...root]',
  'src/ideHub/newProjectFlowPanel.ts  ["presets", ...root]',
  'src/west.ts  ["clean", ...target.appArg]',
  'src/west.ts  ["flash", ...target.appArg]',
  'src/west.ts  ["image", ...target.appArg]',
];

/** One pinned-list check, run twice. A multiset diff, not a set diff: two
 *  identical dynamic calls in one file are two holes, and collapsing them
 *  would let a second one in for free. */
function assertPinnedSites(sites, expectedKeys, label, guidance) {
  const actual = sites.map(unresolvableKey).sort();
  const expected = [...expectedKeys].sort();

  const tally = (keys) => {
    const counts = new Map();
    for (const key of keys) counts.set(key, (counts.get(key) ?? 0) + 1);
    return counts;
  };
  const actualCounts = tally(actual);
  const expectedCounts = tally(expected);
  const surplus = (from, against) =>
    [...from].flatMap(([key, count]) =>
      Array.from(
        { length: Math.max(0, count - (against.get(key) ?? 0)) },
        () => key,
      ),
    );
  const added = surplus(actualCounts, expectedCounts);
  const removed = surplus(expectedCounts, actualCounts);

  // Reported with a line number even though the KEY has none: the list is
  // keyed on the argv expression so it survives edits above it, but the person
  // reading the failure wants somewhere to put the cursor.
  const lineFor = (key) => {
    const site = sites.find((s) => unresolvableKey(s) === key);
    return site ? `${at(site)}  ${site.rawText}` : key;
  };
  const rendered = [
    ...added.map((key) => `  NEW       ${lineFor(key)}`),
    ...removed.map((key) => `  NO LONGER ${key}`),
  ].join("\n");

  assert.deepEqual(actual, expected, `${label}\n${rendered}\n${guidance}`);
}

test("the set of dynamically-built tan invocations is the expected one", () => {
  assertPinnedSites(
    UNRESOLVABLE,
    EXPECTED_UNRESOLVABLE,
    "the tan call sites whose COMMAND cannot be read have changed.",
    "A NEW one is the failure this assertion exists for: rewriting " +
      '`["build", "--plan"]` as `[...flags, "build"]` removes the site ' +
      "from every check above and reports nothing. Reshape the call so the " +
      "command and flag names are literal and only the values vary. If it " +
      "genuinely cannot be — add it to EXPECTED_UNRESOLVABLE and know that " +
      "this argv is now unverified against the CLI. A site that DISAPPEARED " +
      "is good news and still fails: delete its entry, so the list keeps " +
      "meaning what it says.",
  );
});

test("the set of half-readable tan invocations is the expected one", () => {
  assertPinnedSites(
    PARTIAL_SITES,
    EXPECTED_PARTIAL,
    "the tan call sites the extractor could only half-read have changed.",
    "This list is pinned for the same reason as EXPECTED_UNRESOLVABLE, one " +
      "state further in: replacing a literal positional with a variable turns " +
      "a `full` site `partial`, which silently stops the positional-arity " +
      "check running on it. A NEW entry means a site lost that check — " +
      "confirm that is what you meant. A site that LEFT this list either " +
      "became fully literal (good, delete the entry) or lost its command " +
      "(bad: it should now be in EXPECTED_UNRESOLVABLE, checked against " +
      "nothing at all).",
  );
});

// ---------------------------------------------------------------------------
// The extraction itself
// ---------------------------------------------------------------------------

// A gate that reads nothing passes forever, and this one has more ways to go
// quiet than most: the extractor could stop finding call sites, the snapshot
// could parse to an empty object, `inert` could stop being emitted. Each of
// those turns six red assertions green with no code change anywhere.
test("the surface contract actually reads both halves", () => {
  assert.ok(
    SITES.length >= 25,
    `the extractor found only ${SITES.length} tan invocations. This tree has ` +
      "call sites in west.ts, loader.ts, bootstrap.ts, toolchain.ts, " +
      "buildPlanPanel.ts, newProjectFlowPanel.ts, sdkManagerMessages.ts, " +
      "models/panel.ts, deps/, debug.ts, lsp/client.ts and sdk/activeSdk.ts — " +
      "the walker is broken, not the tree",
  );
  assert.ok(
    CHECKABLE.length >= 20,
    `only ${CHECKABLE.length} of ${SITES.length} sites reduced far enough to ` +
      "check (`full` or `partial`). If most of the tree is unreadable, every " +
      "assertion above is checking almost nothing",
  );

  const commands = Object.keys(SNAPSHOT.commands ?? {});
  assert.ok(
    commands.length >= 20,
    `the snapshot describes only ${commands.length} commands — tan ` +
      `${SNAPSHOT.version} has well over twenty`,
  );
  assert.ok(
    GLOBAL_OPTIONS.has("--format") && GLOBAL_OPTIONS.has("--project"),
    "the global option list is missing `--format`/`--project`, which every " +
      "runner appends or passes — with those absent the flag check would " +
      "report false violations on almost every site",
  );
});

// ---------------------------------------------------------------------------
// The snapshot is a recording of a binary, not a file we may edit
// ---------------------------------------------------------------------------

// WHY THIS IS NOT A COUNT.
//
// It used to be: `inert.length >= 12`, against a snapshot holding thirteen.
// That is exactly one entry of slack, and the entry it covered was the only
// inert flag OUTSIDE `build` — `doctor --build`, the whole of #544. Editing
// that one field to `"inert": false` by hand dropped the count to twelve, left
// every guard in this file green, and made a reported defect disappear with no
// trace anywhere. A count cannot say WHICH entry vanished, so it cannot
// protect any particular one.
//
// THREE things replace it, and each answers a question the other two cannot.
// Stated precisely, because a digest whose meaning is vague gets cited for
// guarantees it does not provide:
//
//   sourceDigest    sha256 over the raw `--help` TEXT of the root and every
//                   command.
//                   PROVES: the file was produced by a fetcher run against
//                   some binary whose help text hashed to this.
//                   DOES NOT PROVE: anything checkable here. Reproducing that
//                   text requires the pinned tan, which no test in this repo
//                   spawns, so the only assertion possible is its SHAPE — that
//                   a 64-character hex string is a 64-character hex string. It
//                   is provenance for a human, not a gate. That is why it was
//                   not enough: flipping `renode --image-bundle` and
//                   `build --manifest` from `inert: true` to `inert: false` by
//                   hand left this whole file at exactly its baseline.
//   contentDigest   sha256 over a canonical serialisation of `commands` and
//                   `globalOptions` — key order normalised, so it is a
//                   function of the content and not of the writer.
//                   PROVES: the parsed surface in this file is byte-for-byte
//                   the surface the fetcher computed. ANY hand edit to ANY
//                   command, option, flag, `inert`, `ref`, `marker`,
//                   `metavar`, `valueOptional` or refusing subcommand breaks
//                   it, including the four the anchors below do not name.
//                   DOES NOT PROVE: that the content describes the pinned tan,
//                   or any tan at all. Re-running the fetcher against a
//                   DIFFERENT binary regenerates it happily — that is
//                   assertion 1's job, and `sourceDigest`'s.
//                   It is recomputed below from the bytes just read, using the
//                   fetcher's own exported function so the two cannot drift
//                   into agreeing by coincidence.
//   the anchors     named, individually. Each says one specific fact is still
//                   recorded.
//                   PROVE: a re-capture that legitimately regenerated BOTH
//                   digests did not silently lose one of these facts, and when
//                   one fails it names the exact flag that changed.
//                   DO NOT PROVE: anything about the facts they do not name.
//                   A count cannot say WHICH entry vanished; nor can a digest.
//                   Only a name can, which is why they are named.
test("the vendored surface is a faithful recording, not an edited file", async () => {
  assert.match(
    String(SNAPSHOT.sourceDigest),
    /^[0-9a-f]{64}$/,
    `${SNAPSHOT_REL} carries no \`sourceDigest\`. It is a sha256 over the raw ` +
      "`--help` text every command in it was read from, and it is what ties " +
      "this file to a binary rather than to whoever last edited it. Re-run " +
      "`node scripts/tan-surface/fetch.mjs` against the pinned tan.",
  );

  // Imported here rather than at the top of the file: the fetcher is ESM and
  // this file is CommonJS, so the only way in is a dynamic import inside an
  // async test. Importing it does NOT spawn tan — `fetch.mjs` guards its own
  // `main()` behind an `import.meta.url` check.
  const { contentDigestOf } = await import("../scripts/tan-surface/fetch.mjs");
  assert.equal(
    SNAPSHOT.contentDigest,
    contentDigestOf(SNAPSHOT),
    `${SNAPSHOT_REL} does not hash to its own \`contentDigest\`. Something in ` +
      "`commands` or `globalOptions` was edited after the fetcher wrote the " +
      "file — a flag's `inert`, a `ref`, a `metavar`, a whole option, a " +
      "refusing subcommand. That is the edit the named anchors below cannot " +
      "enumerate: they cover nine facts and this file records several " +
      "hundred. Restore it with `node scripts/tan-surface/fetch.mjs` against " +
      "the pinned tan; do not recompute the digest by hand, which would " +
      "certify the edit instead of reverting it.",
  );

  const option = (command, flag) =>
    SNAPSHOT.commands?.[command]?.options?.[flag];

  // Each anchor: [description, actual, expected]. Kept as data so a failure
  // names the anchor rather than pointing at an anonymous `assert.equal`.
  const anchors = [
    [
      "`build --plan` is inert (tan-cli#427) — the whole of #541's first half",
      option("build", "--plan")?.inert,
      true,
    ],
    [
      "`doctor --build` is inert (tan-cli#290) — the whole of #544, and the " +
        "only inert flag outside `build`",
      option("doctor", "--build")?.inert,
      true,
    ],
    // RETIRED with the verb, deliberately (#584). This anchor named
    // `renode --board-yaml` as inert while `src/west.ts` spawned `tan renode`
    // anyway. tan v0.6.0 removed the verb entirely (tan-cli#848) along with
    // all 27 `renode.*` issue codes, so there is no flag left to be inert and
    // no call site left to care: the recording drops from 32 commands to 31
    // and from 17 inert options to 15. Retired here rather than left to fail,
    // because this gate's own message says a moved pin that resolves an anchor
    // upstream is good news and the anchor should go in the commit that says
    // so.
    [
      '`faultdecode --project` is inert ("(unused: faultdecode is HW-free)")',
      option("faultdecode", "--project")?.inert,
      true,
    ],
    [
      "`flash --confirm` is LIVE — the anchor that catches a blanket " +
        "`inert: true`, which would pass every anchor above",
      option("flash", "--confirm")?.inert,
      false,
    ],
    [
      "`tan model` has NO `--model` option (#543): the Models panel sends one " +
        "and click exits 2 with no envelope",
      option("model", "--model"),
      undefined,
    ],
    [
      "`tan sdk switch` is recorded as REFUSING (tan-cli#305)",
      SNAPSHOT.commands?.sdk?.refusingSubcommands?.switch?.ref,
      "tan-cli#305",
    ],
    [
      "`tan sdk install` is recorded as REFUSING (tan-cli#305)",
      SNAPSHOT.commands?.sdk?.refusingSubcommands?.install?.ref,
      "tan-cli#305",
    ],
    [
      "`tan sdk list` is NOT refusing — the anchor that catches a blanket " +
        "refusal map",
      SNAPSHOT.commands?.sdk?.refusingSubcommands?.list,
      undefined,
    ],
  ];

  const broken = anchors
    .filter(([, actual, expected]) => actual !== expected)
    .map(
      ([what, actual, expected]) =>
        `  ${what}\n      recorded ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)}`,
    );

  assert.deepEqual(
    broken,
    [],
    `${SNAPSHOT_REL} no longer records facts this gate depends on. If the pin ` +
      "did not move, this file was edited by hand and the defect it hid is " +
      "still shipping — restore it with `node scripts/tan-surface/fetch.mjs`. " +
      "If the pin DID move, assertion 1 would have failed first; a moved pin " +
      "that fixes one of these upstream is good news and the anchor should be " +
      "retired DELIBERATELY, in the same commit that closes the issue it names.",
  );

  // `ref` is what makes an inert report readable as an upstream gap. A
  // snapshot that dropped it would still fail the right calls, with a message
  // that reads like a spelling mistake.
  const inertOptions = Object.values(SNAPSHOT.commands ?? {}).flatMap((spec) =>
    Object.values(spec.options ?? {}).filter((option) => option.inert === true),
  );
  assert.ok(
    inertOptions.some(
      (option) =>
        typeof option.ref === "string" && /^tan-cli#\d+$/.test(option.ref),
    ),
    "no inert option names an upstream issue. The `ref` is the difference " +
      "between `--plan is inert` (reads as a typo) and `--plan is inert — " +
      "tan-cli#427` (reads as a decision waiting upstream)",
  );

  // …and `marker` is what carries that difference for the ones with no issue
  // number, which at this pin is four of seventeen. An inert option with
  // NEITHER is a report that reads as a typo and cannot be argued with, so it
  // is a defect in the fetcher's classifier, not in the CLI.
  const unexplained = inertOptions.filter(
    (option) =>
      typeof option.ref !== "string" &&
      !(typeof option.marker === "string" && option.marker.length > 0),
  );
  assert.deepEqual(
    unexplained,
    [],
    "these options are recorded inert with no `ref` AND no `marker`, so the " +
      "gate can only say they do nothing and not why. `marker` is the help " +
      "wording the fetcher matched on, kept verbatim — if it is missing, " +
      "`classifyInert` matched something it did not record, and the report " +
      "loses the spellchecker-versus-decision distinction the whole inert " +
      "dimension exists to provide.",
  );
});

// ---------------------------------------------------------------------------
// The extractor resolves a spread by BINDING, not by name
// ---------------------------------------------------------------------------

/**
 * A spread inlined from the wrong binding is the worst output this gate can
 * have, because it is not a missed site — it is a FABRICATED one, and a
 * fabricated record is checked against the CLI and passes.
 *
 * The extractor used to collect every `const <name> = [ … ]` anywhere in a
 * file into one flat name→array table with no scope model, and inline it into
 * any `...<name>` spread in that file. Its only guard was "a second `const` of
 * the same name poisons the entry", which nothing else trips: a parameter, a
 * `let`, a `var`, a catch binding, a destructured binding and an import are
 * none of them a `const … = [ … ]`. A spread binding to a PARAMETER was
 * therefore inlined from an unrelated array and emitted `resolution: "full"`
 * with that array's flags in it.
 *
 * `test/fixtures/tan-surface/const-scope.ts` is one exported function per
 * binding shape, extracted here through the real script via `--include` — the
 * same code path CI runs, not a re-implementation of it. Two of the ten cases
 * are CONTROLS that must still resolve: without them a "fix" that refused
 * every spread would pass every other case in this table.
 */
const SCOPE_FIXTURE_REL = "test/fixtures/tan-surface/const-scope.ts";

/** `[rawText, resolution, command, flags]`, in fixture order. */
const EXPECTED_SCOPE_RECORDS = [
  // CONTROL: binds to the module-scope const. Must still inline.
  ['["build", ...PLAN_FLAGS]', FULL, "build", ["--plan"]],
  // The demonstrated defect: `PLAN_FLAGS` here is a PARAMETER.
  ['["build", ...PLAN_FLAGS]', PARTIAL, "build", []],
  // A `let` in an inner block — rebindable, so not readable.
  ['["build", ...PLAN_FLAGS]', PARTIAL, "build", []],
  // Inside the try, so that the catch below has something to catch.
  ['["doctor"]', FULL, "doctor", []],
  // A catch binding: a `VariableDeclaration` whose parent is the CatchClause.
  ['["build", ...PLAN_FLAGS]', PARTIAL, "build", []],
  // `const { PLAN_FLAGS } = opts` — a const, and still not an array literal.
  ['["build", ...PLAN_FLAGS]', PARTIAL, "build", []],
  // CONTROL: a function-local const, spread inside that same function.
  ['["build", ...SIBLING_FLAGS]', FULL, "build", ["--native"]],
  // The same name, reached from a function where it is a parameter.
  ['["build", ...SIBLING_FLAGS]', PARTIAL, "build", []],
  // A LEADING spread that does not resolve: the COMMAND is unreadable, which
  // is the only degradation the pinned unresolvable list can catch.
  ["[...WHOLE_ARGV]", NONE, null, []],
  // CONTROL for the leading position.
  ["[...WHOLE_ARGV]", FULL, "build", ["--plan"]],
];

test("a spread resolves to the binding it reaches, never to a matching name", () => {
  const result = spawnSync(
    process.execPath,
    [EXTRACTOR_REL, "--include", "test/fixtures/tan-surface"],
    { cwd: ROOT, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 },
  );
  assert.equal(
    result.status,
    0,
    `\`node ${EXTRACTOR_REL} --include test/fixtures/tan-surface\` exited ` +
      `${result.status}:\n${result.stderr}`,
  );

  const records = JSON.parse(result.stdout)
    .filter((site) => site.file === SCOPE_FIXTURE_REL)
    .sort((a, b) => a.line - b.line)
    .map((site) => [site.rawText, site.resolution, site.command, site.flags]);

  assert.deepEqual(
    records,
    EXPECTED_SCOPE_RECORDS,
    `${SCOPE_FIXTURE_REL} did not extract as expected. Each row is one binding ` +
      "shape. A row that came back `full` where this table says `partial` or " +
      "`none` is the fabrication this test exists for: the extractor inlined " +
      "an array the spread does not reach, and every assertion above then " +
      "checked argv that call may never send. A row that came back `partial` " +
      "where the table says `full` is the opposite failure and matters too — " +
      "it means resolution was traded away wholesale rather than made " +
      "correct, and real sites silently left the gate's reach.",
  );
});

// The invocation record is this gate's only input, and a malformed one fails
// OPEN: a site missing `command` skips every check silently. Validate at the
// boundary, once, loudly.
test("every invocation record is well formed", () => {
  const offenders = [];
  SITES.forEach((site, index) => {
    const problems = [];
    if (typeof site.file !== "string") problems.push("file");
    if (typeof site.line !== "number") problems.push("line");
    if (typeof site.rawText !== "string") problems.push("rawText");
    if (![FULL, PARTIAL, NONE].includes(site.resolution)) {
      problems.push("resolution");
    }
    if (site.resolution === FULL || site.resolution === PARTIAL) {
      if (typeof site.command !== "string") problems.push("command");
      if (!Array.isArray(site.flags)) problems.push("flags");
      if (typeof site.positionalCount !== "number") {
        problems.push("positionalCount");
      }
      if (!Array.isArray(site.positionalValues)) {
        problems.push("positionalValues");
      } else if (site.positionalValues.length !== site.positionalCount) {
        // The count and the values are two readings of one walk. If they
        // disagree, the walk is wrong, and every arity report built on the
        // count is a confident wrong answer.
        problems.push("positionalValues (length disagrees with count)");
      }
      if (typeof site.positionalsAnchored !== "number") {
        problems.push("positionalsAnchored");
      }
      if (!Array.isArray(site.danglingFlags)) problems.push("danglingFlags");
      if (typeof site.runner !== "string") problems.push("runner");
    }
    if (problems.length > 0) {
      offenders.push(
        `  record #${index} (${site.file ?? "?"}:${site.line ?? "?"}) is ` +
          `missing or mistyped: ${problems.join(", ")}`,
      );
    }
  });
  assert.deepEqual(
    offenders,
    [],
    "the extractor emitted records this gate cannot read. Every missing " +
      "field is a site that quietly skips a check — the one failure mode a " +
      "contract gate must not have.",
  );
});
