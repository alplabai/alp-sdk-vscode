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
// It also says nothing about prose that makes a capability claim without argv:
// `docs/CLI.md`'s "tan is feature-complete" is false at this pin and no
// assertion here reaches it.
//
// A FRESH WORKTREE runs this file with no setup — the snapshot is committed and
// the scanner reads the tree. Unlike the contract-corpus gates, nothing is
// fetched.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.join(__dirname, "..");
const SNAPSHOT_REL = "test/golden/tan-surface/surface.json";
const SCANNER_REL = "scripts/doc-cli-claims/scan.mjs";

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
test.before(async () => {
  const scanner = await import(`../${SCANNER_REL}`);
  CLAIMS = scanner.scan();
});

const invocations = () => CLAIMS.filter((c) => c.kind === "invocation");
const releaseTags = () => CLAIMS.filter((c) => c.kind === "releaseTag");
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
  // Files, not just lines: a scanner that reads one file well and skips the
  // rest passes the count above.
  const files = new Set(invocations().map((c) => c.file));
  assert.ok(
    files.size >= 5,
    `documented invocations came from only ${files.size} file(s): ` +
      `${[...files].join(", ")}`,
  );
});
