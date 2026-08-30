// SPDX-License-Identifier: Apache-2.0
//
// Every `tan` command this repo's PROSE tells a reader to run must be a command
// the pinned tan accepts.
//
// `test/tan.surfaceContract.test.js` has proved that for argv the CODE sends
// since it was written. Documentation had no gate at all, and documentation is
// the copy-run surface: the `tan doctor --target-kind native-host --server none`
// recipe corrected in #556 sat inside a GitHub Actions step, a GitLab CI
// `script:` entry, and the troubleshooting page a user with an already-broken
// environment is told to open FIRST. `tan doctor` has never had either flag —
// they belong to `debug-config` and `support-bundle` — so every one of those
// readers got
//
//     │ No such option: --target-kind (Possible options: --target)                   │
//
// exit 2, and a `{"command":"cli",…,"issues":[{"code":"cli.parse-error"}]}`
// envelope instead of a doctor one. #544 named that argv and was CLOSED while
// five documentation sites still carried it, because the closing commit touched
// no `.md` file and nothing could tell it that mattered.
//
// ── The three pieces ────────────────────────────────────────────────────────
//
//   scripts/doc-cli-claims/scan.mjs        every CLI claim in the prose corpus,
//                                          extracted, never judged. Read its
//                                          header for how an INVOCATION is told
//                                          apart from a sentence that merely
//                                          mentions one, and for the three
//                                          claim classes it deliberately does
//                                          not extract.
//   test/golden/tan-surface/surface.json   what the pinned tan accepts, from its
//                                          own `--help`.
//   this file                              one checked against the other.
//
// Same shape, and the same reason, as the extractor/snapshot/contract trio for
// `src/`.
//
// ── WHAT A GREEN RUN DOES NOT MEAN ─────────────────────────────────────────
//
// It means every documented command exists and every documented flag exists and
// is live. It does NOT mean the recipe is CORRECT — a documented `tan flash`
// without `--confirm` previews and writes nothing (#540) while parsing
// perfectly, exactly as the same omission is invisible to the code-side gate.
// It also says nothing about MOST prose that makes a capability claim without
// argv: `docs/CLI.md`'s "tan is feature-complete" is false at this pin and no
// assertion here reaches it. One narrow slice of that class IS checked —
// section 4b below, "tan (VERSION) implements/publishes/accepts/takes" — see
// `scripts/doc-cli-claims/scan.mjs`'s header for why only that shape.
//
// This file needs `pnpm run compile` (or `pnpm run test`, which runs it first)
// before `node --test` alone will pass — `require("../out/alpCli/...")`
// below reads COMPILED output, same as every other `out/`-reading gate in
// this repo. What it does NOT need, unlike the contract-corpus gates, is
// `pnpm run contract:fetch`: the surface snapshot is committed and the
// scanner reads the source tree directly, so nothing is fetched over the
// network. ("Runs with no setup at all" overstated this; corrected — an
// adversarial review caught the overstatement being used to justify NOT
// gating a claim, which is the wrong use of it either way: a property this
// file does not have cannot excuse a missing gate.)

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const ROOT = path.join(__dirname, "..");
const SNAPSHOT_REL = "test/golden/tan-surface/surface.json";
const SCANNER_REL = "scripts/doc-cli-claims/scan.mjs";
const EXTRACTOR_REL = "scripts/tan-surface/extract.mjs";

const SNAPSHOT = JSON.parse(
  fs.readFileSync(path.join(ROOT, SNAPSHOT_REL), "utf8"),
);
const GLOBAL_OPTIONS = new Set(SNAPSHOT.globalOptions ?? []);
const { SUPPORTED_CLI_VERSION } = require("../out/alpCli/service.js");

// The scanner is ESM and this file is CJS. Imported rather than spawned: it
// exports `scan()` precisely so the gate does not have to parse a subprocess's
// stdout, and there is no "what CI measures" divergence to guard against here
// because nothing else runs it.
let CLAIMS;
let CORPUS;
test.before(async () => {
  const scanner = await import(`../${SCANNER_REL}`);
  CLAIMS = scanner.scan();
  CORPUS = scanner.corpus();
});

const invocations = () => CLAIMS.filter((c) => c.kind === "invocation");
const releaseTags = () => CLAIMS.filter((c) => c.kind === "releaseTag");
const versionLabels = () => CLAIMS.filter((c) => c.kind === "versionLabel");
const at = (claim) => `${claim.file}:${claim.line}\n      ${claim.raw}`;

// ---------------------------------------------------------------------------
// 0. The snapshot describes the tan we pin
// ---------------------------------------------------------------------------

test("the surface this file checks against was captured from the pinned tan", () => {
  assert.equal(
    SNAPSHOT.version,
    SUPPORTED_CLI_VERSION,
    `${SNAPSHOT_REL} records tan ${SNAPSHOT.version} but SUPPORTED_CLI_VERSION ` +
      `is ${SUPPORTED_CLI_VERSION}. Re-capture it with ` +
      "`node scripts/tan-surface/fetch.mjs` against the newly pinned binary.",
  );
});

// ---------------------------------------------------------------------------
// 1. Every documented command exists
// ---------------------------------------------------------------------------

test("every command the docs tell a reader to run exists in the pinned tan", () => {
  const offenders = [];
  for (const claim of invocations()) {
    if (Object.prototype.hasOwnProperty.call(SNAPSHOT.commands, claim.verb)) {
      continue;
    }
    offenders.push(
      `${at(claim)}\n      \`tan ${claim.verb}\` is not a command in tan ${SNAPSHOT.version}`,
    );
  }
  assert.deepEqual(
    offenders,
    [],
    "these lines name a verb the pinned tan does not have. The reader gets a " +
      "usage error with no envelope at all.\n" +
      offenders.join("\n"),
  );
});

// ---------------------------------------------------------------------------
// 2. Every documented flag exists on the command it is written on
// ---------------------------------------------------------------------------

test("every flag the docs put on a command is one that command accepts", () => {
  const offenders = [];
  for (const claim of invocations()) {
    const command = SNAPSHOT.commands[claim.verb];
    if (!command) continue; // reported above; not re-reported here
    const options = command.options ?? {};
    for (const flag of claim.flags) {
      if (Object.prototype.hasOwnProperty.call(options, flag)) continue;
      if (GLOBAL_OPTIONS.has(flag)) continue;
      offenders.push(
        `${at(claim)}\n      \`${flag}\` is not an option of \`tan ${claim.verb}\` ` +
          `in tan ${SNAPSHOT.version}, and is not a global option`,
      );
    }
  }
  assert.deepEqual(
    offenders,
    [],
    "click exits 2 with `No such option` and prints NO envelope on stdout, so " +
      "a reader who pastes one of these gets a bare usage box — and in a CI " +
      "job, a red build on their first run.\n" +
      offenders.join("\n"),
  );
});

// ---------------------------------------------------------------------------
// 3. No documented flag is accepted-but-inert
// ---------------------------------------------------------------------------

test("no flag the docs teach is accepted-but-inert at this pin", () => {
  const offenders = [];
  for (const claim of invocations()) {
    const options = SNAPSHOT.commands[claim.verb]?.options ?? {};
    for (const flag of claim.flags) {
      const option = options[flag];
      if (!option || option.inert !== true) continue;
      offenders.push(
        `${at(claim)}\n      \`${flag}\` parses and does NOTHING — ` +
          `${option.ref ?? option.marker ?? "no issue named in the help text"}`,
      );
    }
  }
  assert.deepEqual(
    offenders,
    [],
    "an inert flag exits 0 and tells the reader nothing, so the documented " +
      "recipe reports success for work that never happened. Teaching one is " +
      "worse than teaching a flag that does not exist, which at least " +
      `fails loudly.\n${offenders.join("\n")}`,
  );
});

// ---------------------------------------------------------------------------
// 4. Every documented release tag is the one this extension pins
// ---------------------------------------------------------------------------

test("every tan release the docs install is the pinned one", () => {
  const expected = `v${SUPPORTED_CLI_VERSION}`;
  const offenders = [];
  for (const claim of releaseTags()) {
    // Normalised: `TAN_VERSION=0.6.0-rc1` and `.../download/v0.6.0-rc1/` name
    // the same release, and the leading `v` is a tag convention rather than
    // part of the version.
    const tag = claim.tag.startsWith("v") ? claim.tag : `v${claim.tag}`;
    if (tag === expected) continue;
    offenders.push(`${at(claim)}\n      installs ${tag}, pin is ${expected}`);
  }
  assert.deepEqual(
    offenders,
    [],
    "a reader who follows these docs runs a DIFFERENT tan from the one every " +
      "gate in this repo measures, so every recipe verified here is verified " +
      "against a binary they do not have. `SUPPORTED_CLI_VERSION` " +
      `(src/alpCli/service.ts) is ${SUPPORTED_CLI_VERSION}.\n${offenders.join("\n")}`,
  );
});

// ---------------------------------------------------------------------------
// 4b. Every prose sentence that LABELS the pinned tan's version says the
//     version that is actually pinned (#609/#612 adversarial review)
// ---------------------------------------------------------------------------

// Unlike `releaseTags()`, which reads argv a reader copies verbatim,
// `versionLabels()` reads a CAPABILITY SENTENCE — "tan (VERSION) implements
// X" — that install-recipe check above never sees at all. Five sites in this
// exact corpus said `0.6.0-rc1` after the pin moved to `0.6.0`, entirely
// unnoticed by every gate that existed before this one. See
// `scripts/doc-cli-claims/scan.mjs`'s header for why the pattern is narrow
// (the two shapes actually found stale) rather than "any version near the
// word tan": the wider net also flags every legitimate historical mention
// this corpus carries, and a gate that reds on a correct sentence is worse
// than one with a narrower catch.
test("every prose sentence labelling the pinned tan's version names the pin", () => {
  const offenders = [];
  for (const claim of versionLabels()) {
    if (claim.version === SUPPORTED_CLI_VERSION) continue;
    offenders.push(
      `${at(claim)}\n      labels tan ${claim.version}, pin is ${SUPPORTED_CLI_VERSION}`,
    );
  }
  assert.deepEqual(
    offenders,
    [],
    "a prose sentence describing what the pinned tan implements/publishes/" +
      "accepts/takes names a DIFFERENT version than `SUPPORTED_CLI_VERSION` " +
      `(src/alpCli/service.ts) — re-measure the claim against the version ` +
      `actually pinned, ${SUPPORTED_CLI_VERSION}, and update the label; do ` +
      "not just change the digits.\n" +
      offenders.join("\n"),
  );
});

// ---------------------------------------------------------------------------
// 5. The gate actually read something
// ---------------------------------------------------------------------------

// Every assertion above is `deepEqual(offenders, [])`, which an empty claim
// list satisfies perfectly. A scanner that stops matching — a changed lead
// pattern, a corpus root renamed — turns this whole file green with no
// documentation change at all.
test("the scanner still reads the prose corpus", () => {
  assert.ok(
    invocations().length >= 40,
    `only ${invocations().length} documented tan invocations found. This ` +
      "corpus is 25 files of CLI instructions; a collapse means " +
      `${SCANNER_REL}'s line discriminator stopped matching, not that the ` +
      "documentation shrank.",
  );
  assert.ok(
    releaseTags().length > 0,
    "no tan release tag found in the docs at all — the install instructions " +
      "cannot have vanished, so the tag pattern stopped matching.",
  );
  assert.ok(
    versionLabels().length > 0,
    "no prose version label found in the docs at all — this corpus has " +
      "always carried at least one 'the pinned tan (VERSION) …' sentence, so " +
      "a collapse to zero means the pattern stopped matching, not that every " +
      "such sentence was rewritten away.",
  );
  // Files, not just lines: a scanner that reads one file well and skips the
  // rest passes the count above.
  const files = new Set(invocations().map((c) => c.file));
  assert.ok(
    files.size >= 5,
    `documented invocations came from only ${files.size} file(s): ` +
      `${[...files].join(", ")}`,
  );
});

// ---------------------------------------------------------------------------
// 6. Prose claims about CLI BEHAVIOR, not just argv syntax (#608)
// ---------------------------------------------------------------------------
//
// Assertions 1-5 only reach claims `scan.mjs` can extract as `tan <verb>
// --flag` SYNTAX. A recipe can be syntactically perfect and still teach a
// false fact about what the CLI does or what this extension does with it —
// this file's own header names the standing example it cannot reach
// ("tan is feature-complete"). #608 found nine such prose claims across five
// files, all syntactically valid, all wrong, and none caught by anything
// above.
//
// An adversarial review of the FIRST version of this section found five of
// its seven checks were spelling gates, not fact gates: a re-wrap, a
// one-word synonym swap, a paraphrase, a claim planted in an unlisted file,
// and a reshaped citation all restored the exact defects #608 fixed while
// this file stayed green. Every check below is redesigned against that
// review — normalized text (backticks and run-together whitespace stripped,
// so markdown formatting and a line-wrap cannot hide a phrase), the WHOLE
// prose corpus `scan.mjs` already walks (not a hand-picked file list), and a
// structural anchor wherever the false claim's WORDING could plausibly vary
// without its MEANING changing. Every assertion is anchored to a MEASURED
// fact — the pinned surface, the AST extractor that already grounds
// `test/tan.surfaceContract.test.js`, or the compiled source a doc is
// describing — never to a snapshot of what the doc used to say.

function readDoc(relPath) {
  return fs.readFileSync(path.join(ROOT, relPath), "utf8");
}

/** Strip markdown backticks and collapse every run of whitespace (including
 *  a line-wrap's newline + indent) to a single space. A prose CLAIM's
 *  MEANING does not depend on which word rich/prettier wrapped onto the next
 *  line or whether a term is backtick-quoted, so a regex checking for that
 *  meaning should not either — an adversarial review found a literal-space
 *  regex missed the exact false sentence re-wrapped at 80 columns, and
 *  `*.md` is in `.prettierignore` so nothing normalises a doc's own wrapping
 *  back for us. */
function normalize(text) {
  return text.replace(/`/g, "").replace(/\s+/g, " ");
}

/** `{ rel, raw, normalized }` for every file `scan.mjs` treats as a reader
 *  instruction — the SAME corpus the argv checks above walk, via the SAME
 *  `corpus()` export, so a claim planted in ANY of those files (not just the
 *  one or two this section originally hard-coded) is checked. */
function corpusTexts() {
  return CORPUS.map(({ rel, abs }) => {
    const raw = fs.readFileSync(abs, "utf8");
    return { rel, raw, normalized: normalize(raw) };
  });
}

/**
 * Every `tan` command with a real call site in `src/`, from the SAME AST
 * extractor `test/tan.surfaceContract.test.js` holds the code side to.
 * Ground truth for "is this command actually spawned anywhere", not a
 * second guess at it — a doc claiming a command is wired is checked against
 * the same fact the code gate is.
 */
function callSiteCommands() {
  const result = spawnSync(process.execPath, [EXTRACTOR_REL], {
    cwd: ROOT,
    encoding: "utf8",
    maxBuffer: 16 * 1024 * 1024,
  });
  if (result.error || result.status !== 0) {
    throw new Error(
      `could not run \`node ${EXTRACTOR_REL}\`: ` +
        (result.error?.message ?? result.stderr),
    );
  }
  const records = JSON.parse(result.stdout);
  return new Set(records.map((r) => r.command).filter(Boolean));
}

/** A match is the phrase being QUOTED in order to REFUTE it (this file's own
 *  corrections do exactly that, wrapping the old wrong sentence in literal
 *  double quotes) rather than the doc asserting it, when a `"` sits directly
 *  before the match in the NORMALIZED text. Quoting survives normalization —
 *  only backticks and whitespace are stripped — so this check is unaffected
 *  by the re-wrap/backtick concerns above. */
function assertsUnquoted(normalized, pattern) {
  for (const match of normalized.matchAll(pattern)) {
    if (normalized[match.index - 1] !== '"') return true;
  }
  return false;
}

test("docs/CLI.md's pinmux SKU->family mapping matches the loader that actually resolves it", () => {
  const { pinmuxFamilyForSku } = require("../out/pinmux/loader.js");
  const cli = readDoc("docs/CLI.md");
  const sectionStart = cli.indexOf("### 4.11 `tan pinmux`");
  const sectionEnd = cli.indexOf("### 4.12", sectionStart);
  assert.ok(
    sectionStart !== -1 && sectionEnd !== -1,
    "docs/CLI.md's `tan pinmux` section (§4.11) is gone or renumbered — " +
      "update this anchor",
  );
  const section = normalize(cli.slice(sectionStart, sectionEnd));
  const bulletMatch = /resolve the family from[\s\S]*? -\S/.exec(section);
  assert.ok(
    bulletMatch,
    "§4.11 no longer has a family-mapping bullet starting " +
      '"resolve the family from" — update this anchor',
  );
  const pairs = [
    ...section.matchAll(/(E1M-[A-Z0-9]+)\*\s*→\s*([a-z0-9-]+)/g),
  ].map((m) => [m[1], m[2]]);
  assert.ok(
    pairs.length >= 3,
    `found only ${pairs.length} SKU-prefix -> family pairs in §4.11 — the ` +
      `mapping moved or the arrow spelling changed:\n${section}`,
  );
  const offenders = [];
  for (const [prefix, docFamily] of pairs) {
    // Any SKU sharing the documented prefix probes the same regex branch
    // `pinmuxFamilyForSku` would match a real one against.
    const sku = `${prefix}999`;
    const realFamily = pinmuxFamilyForSku(sku);
    if (realFamily !== docFamily) {
      offenders.push(
        `docs/CLI.md says \`${prefix}*\` -> \`${docFamily}\`, but ` +
          `src/pinmux/loader.ts's pinmuxFamilyForSku(${JSON.stringify(sku)}) ` +
          `returns ${JSON.stringify(realFamily)}`,
      );
    }
  }
  assert.deepEqual(
    offenders,
    [],
    "the documented SKU->family mapping disagrees with the loader that " +
      "actually resolves it for this extension (and, measured separately " +
      `against the pinned binary, with tan itself).\n${offenders.join("\n")}`,
  );
});

test("no doc claims `tan pinmux` is a source this extension actually reads from", () => {
  // Ground truth, not an assumption: measured every run of this test, so a
  // future PR that actually wires `tan pinmux` turns this from a
  // never-fires regression guard into a real failure the day the doc is NOT
  // updated alongside it, rather than silently going stale in the other
  // direction.
  const loaderReadsYamlDirectly = /fs\.readFileSync/.test(
    fs.readFileSync(path.join(ROOT, "src/pinmux/loader.ts"), "utf8"),
  );
  const hasCallSite = callSiteCommands().has("pinmux");
  if (!loaderReadsYamlDirectly || hasCallSite) return; // claim would be true now

  // Structural, not lexical: the false claim's WORDS varied under review
  // ("the single source ..." -> "the one source ... instead of reading ...
  // directly") while its MEANING did not — it always asserts an indirect
  // path (through tan) is used INSTEAD OF the direct one this extension
  // actually takes. That "instead of reading X directly" shape is the part
  // that cannot vary without the sentence stopping being this claim.
  const PATTERN = /instead of reading[\s\S]{0,150}directly/gi;
  const offenders = [];
  for (const { rel, normalized } of corpusTexts()) {
    for (const match of normalized.matchAll(PATTERN)) {
      const windowStart = Math.max(0, match.index - 300);
      const context = normalized.slice(
        windowStart,
        match.index + match[0].length,
      );
      if (/\bpinmux\b/i.test(context)) {
        offenders.push(`${rel}: "${match[0]}"`);
      }
    }
  }
  assert.deepEqual(
    offenders,
    [],
    "a doc claims pinmux data is reached indirectly (through tan) instead " +
      "of read directly, but measured: src/pinmux/loader.ts still reads " +
      "metadata/pinmux/<family>.yaml with fs directly, and the AST " +
      "extractor (scripts/tan-surface/extract.mjs) finds no `pinmux` call " +
      `site anywhere in src/.\n${offenders.join("\n")}`,
  );
});

test("EXTENSION_CLI_INTEGRATION.md's §3 envelope-commands list names only commands this repo actually spawns", () => {
  const doc = readDoc("docs/EXTENSION_CLI_INTEGRATION.md");
  const marker = "Envelope commands:";
  const start = doc.indexOf(marker);
  assert.ok(
    start !== -1,
    "§3's 'Envelope commands:' line is gone from " +
      "docs/EXTENSION_CLI_INTEGRATION.md — update this anchor",
  );
  const listText = doc.slice(start, doc.indexOf("\n\n", start));
  // Bare `` `word` `` tokens only — a multi-word span like `` `sdk
  // list/current` `` or `` `debug-config --preview` `` never matches, which
  // is deliberate: those are not plain command names this check can look up.
  const named = [...listText.matchAll(/`([a-z][a-z-]*)`/g)].map((m) => m[1]);
  const sites = callSiteCommands();
  const offenders = named.filter(
    (cmd) =>
      Object.prototype.hasOwnProperty.call(SNAPSHOT.commands, cmd) &&
      !sites.has(cmd),
  );
  assert.deepEqual(
    offenders,
    [],
    "§3 lists these as spawned envelope commands, but the AST extractor " +
      "(scripts/tan-surface/extract.mjs) finds no call site for them " +
      `anywhere in src/: ${offenders.join(", ")}. Either wire the spawn or ` +
      "move the command out of this list (and say in prose, as §B3 " +
      "already does for some of them, that it is declared but not called).",
  );
});

test("no doc still claims setActiveSdk shells `tan sdk switch`, now that #546 removed the call", () => {
  const activeSdkSource = fs.readFileSync(
    path.join(ROOT, "src/sdk/activeSdk.ts"),
    "utf8",
  );
  const stillCallsSwitch = /\[\s*"sdk"\s*,\s*"switch"/.test(activeSdkSource);
  if (stillCallsSwitch) return; // the call came back; the claim would be true

  const PATTERN = /setactivesdk[\s\S]{0,80}shells[\s\S]{0,40}tan sdk switch/gi;
  const offenders = [];
  for (const { rel, normalized } of corpusTexts()) {
    if (assertsUnquoted(normalized, PATTERN)) offenders.push(rel);
  }
  assert.deepEqual(
    offenders,
    [],
    `${offenders.join(", ")} claims setActiveSdk shells tan sdk switch ` +
      "<absolute path>, but src/sdk/activeSdk.ts contains no " +
      '`["sdk", "switch"` call at all — that verb refuses with ' +
      "`sdk.not-ported` (tan-cli#305) at SUPPORTED_CLI_VERSION and #546 " +
      "removed the call rather than keep sending an argv that always fails.",
  );
});

test("no doc still claims `tan doctor --build` changes doctor's output, now that it is recorded inert", () => {
  const { inertKindOf } = require("../out/alpCli/pinnedSurface.js");
  if (inertKindOf("doctor", "--build") === null) return; // live at this pin

  const FALSE_CLAIMS = [
    /tan doctor --build[\s\S]{0,60}omits it by design/gi,
    /the default tan doctor \(no --build\) is unchanged/gi,
  ];
  const offenders = [];
  for (const { rel, normalized } of corpusTexts()) {
    for (const phrase of FALSE_CLAIMS) {
      if (assertsUnquoted(normalized, phrase)) {
        offenders.push(rel);
        break;
      }
    }
  }
  assert.deepEqual(
    offenders,
    [],
    `${offenders.join(", ")} still claims \`--build\` changes doctor's ` +
      "output, but pinnedSurface.ts's INERT_OPTIONS records \"doctor " +
      '--build": "compatibility" — measured, both invocations return a ' +
      "byte-identical check set and summary.",
  );
});

test("no doc calls an already-shipped tan command an aspiration ('eventually expose')", () => {
  // Word-list-free on purpose: an earlier version required the specific
  // word "should", and swapping it for "will" restored the exact #608
  // defect while staying green. "Eventually" is the part of the sentence
  // that MEANS "not yet, but planned" regardless of which modal verb (or
  // none) precedes it, so nothing before "eventually expose" is checked.
  const offenders = [];
  for (const { rel, raw } of corpusTexts()) {
    const backtickless = raw.replace(/`/g, "");
    const blocks = [
      ...backtickless.matchAll(
        /eventually expose:?\n\n((?:-\s*tan\s+[a-z-]+.*\n)+)/gi,
      ),
    ];
    for (const block of blocks) {
      const verbs = [...block[1].matchAll(/\btan\s+([a-z-]+)/g)].map(
        (m) => m[1],
      );
      for (const verb of verbs) {
        if (Object.prototype.hasOwnProperty.call(SNAPSHOT.commands, verb)) {
          offenders.push(
            `${rel} calls \`tan ${verb}\` an aspiration ("...eventually ` +
              `expose"), but it is a real command in tan ${SNAPSHOT.version} ` +
              "today",
          );
        }
      }
    }
  }
  assert.deepEqual(offenders, [], offenders.join("\n"));
});

test('PRODUCT.md\'s `CONST = "value"` (`file:line`) citations match the line they cite', () => {
  // An earlier version required a SINGLE backtick span shaped exactly
  // `` `CONST = "value"` ``. Reshaping the citation into `` `CONST` is
  // `"value"` (see `file:line`) `` split the const/value pair across two
  // spans, made that pattern match nothing, and left
  // `assert.ok(citations.length > 0)` satisfied by the OTHER,
  // still-correctly-shaped citation — silently dropping the reshaped one
  // from the check entirely. Matching `IDENTIFIER (= | is) "VALUE"`
  // adjacently, THEN a bounded run of connective prose, THEN the file:line
  // citation survives both punctuation shapes without caring which one was
  // used, because it never anchors to a specific span boundary.
  const doc = readDoc("PRODUCT.md");
  const backtickless = doc.replace(/`/g, "");
  // ONE regex, not two independent "nearest match" scans: `IDENTIFIER`,
  // then `=` or `is`, then the quoted `"VALUE"` it names, ADJACENT to each
  // other (only whitespace between), then up to 60 chars of connective
  // prose ("(see ", " at "), then the file:line citation. Tight enough that
  // an unrelated CONST and an unrelated quoted string that both happen to
  // precede some other citation in the same paragraph (measured: this
  // section also cites a "45 ahead / 0 behind" MEASUREMENT next to the
  // identifier `CONFIG_ALP_SDK_CHIP_NONE`, which names no value for that
  // identifier and must not be read as one) cannot satisfy it — the earlier,
  // two-scan version did exactly that and manufactured a false citation
  // claim neither sentence makes.
  const CITATION_CLAIM =
    /([A-Z][A-Z0-9_]{2,})\s*(?:=|is)\s*"([^"]*)"[^"]{0,60}?((?:[\w-]+\/)+[\w.-]+):(\d+)/g;
  const citations = [...backtickless.matchAll(CITATION_CLAIM)];
  assert.ok(
    citations.length > 0,
    'no `CONST = "value"` (`file:line`) citation found in PRODUCT.md — ' +
      "the pattern this checks for moved",
  );
  const offenders = [];
  for (const match of citations) {
    const [, name, value, file, lineStr] = match;
    const lineNo = Number(lineStr);
    const filePath = path.join(ROOT, file);
    if (!fs.existsSync(filePath)) {
      offenders.push(
        `PRODUCT.md cites ${file}:${lineNo} for ${name}, but that file ` +
          "does not exist",
      );
      continue;
    }
    const lines = fs.readFileSync(filePath, "utf8").split("\n");
    const cited = lines[lineNo - 1] ?? "";
    if (!cited.includes(name) || !cited.includes(JSON.stringify(value))) {
      offenders.push(
        `PRODUCT.md cites \`${name} = ${JSON.stringify(value)}\` at ` +
          `${file}:${lineNo}, but that line reads: ${JSON.stringify(cited.trim())}`,
      );
    }
  }
  assert.deepEqual(
    offenders,
    [],
    "a file:line citation is worth less than no citation at all when it " +
      `contradicts the line it points at.\n${offenders.join("\n")}`,
  );
});
