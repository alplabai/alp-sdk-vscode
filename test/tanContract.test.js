// SPDX-License-Identifier: Apache-2.0
//
// Drift gate for tan's JSON envelope — the contract this extension parses on
// every `tan <cmd> --format json` call, and the one nothing here verified.
//
// Every match this extension makes against that envelope FAILS OPEN. Rename an
// issue code and `bootstrapHostVerdict` returns `{ refuse: false }`; rename a
// `data` field and a `?? []` yields an empty catalogue. No error, no log line,
// CI green on both sides, and the customer's first project scaffolds wrong. The
// version number was the only signal available, so this reads the producer's own
// published contract instead.
//
// Pure and offline. `scripts/fetch-tan-contract.mjs` does the network part and
// drops the artefact in `test/golden/tan-contract/` (gitignored — fetched, never
// hand-copied: a fixture copied into this repo drifts exactly the way the thing
// it is testing drifts).
//
// The artefact EXISTS as of tan v0.4.0, the first release to publish it
// (`alplabai/tan-cli#106` wired it into `release.yml`), and that is the pin. So
// a missing artefact is no longer a state of the world to be tolerated — it is
// a fetch that did not happen or did not work, and this file FAILS on it.
//
// The skip path survives for exactly one case: a pin listed in
// `RELEASES_PREDATING_CONTRACT_ASSET` (src/alpCli/service.ts), the closed set of
// tan tags cut before #106 landed. Nothing is published for those, so
// there is nothing to verify. Everything else that ends with no artefact on
// disk is red — see `the artefact is present` below, which is the one test in
// this file with no `{ skip }`.
//
// The offline developer's escape is `TAN_CONTRACT_OFFLINE=1`, which downgrades
// that red to a loud skip. It is ignored when `CI` is set, so it cannot green a
// pipeline. Typing it is the point: it is a deliberate statement that this run
// verified nothing, which is what an absent artefact has always meant and never
// said.
//
// The `not vacuous` test closes the other half of the same trap — an artefact
// that IS present but yields zero assertions (wrong shape, empty families, a
// layout tan changed) fails rather than passing quietly.
//
// What is asserted about a code depends on how tan DECLARES it, so `GATED_CODES`
// below maps each code this extension matches to the status the artefact
// must give it — including `null` for "tan does not declare this at all", which
// reds the moment tan starts to. That last case is the one that used to assert
// nothing whatsoever.
//
// Point `TAN_CONTRACT_DIR` at another directory to drive this against a
// hand-built artefact without committing one.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const {
  SUPPORTED_CLI_VERSION,
  RELEASES_PREDATING_CONTRACT_ASSET,
  parseEnvelope,
  classifyExitCode,
} = require("../out/alpCli/service.js");

const ASSET = "envelope-contract.json";
const ISSUE = "alplabai/tan-cli#106";
const URL = `https://github.com/alplabai/tan-cli/releases/download/v${SUPPORTED_CLI_VERSION}/${ASSET}`;
const OFFLINE_ENV = "TAN_CONTRACT_OFFLINE";

const dir =
  process.env.TAN_CONTRACT_DIR ??
  path.join(__dirname, "golden", "tan-contract");
const assetPath = path.join(dir, ASSET);

/**
 * Every issue code this extension matches by exact string, mapped to the
 * `status` tan's frozen list must give it — or `null` for "tan declares this
 * code at NO status".
 *
 * The `null` entries are the change that matters. They used to sit in a
 * `COMPAT_CODES` bucket whose stated contract was that nothing at all was
 * asserted about them, so tan's own `frozen_issue_codes` gate (which iterates
 * only `contract/issue-codes.json`) and this one were BOTH blind to them at
 * once: a rename of `python-too-old` was invisible on both sides of the seam.
 * Asserting ABSENCE is what fixes that. It costs nothing while tan leaves them
 * undeclared, and the day tan declares one this test goes red demanding the
 * entry be reclassified — instead of waiting for a human to remember to.
 *
 * Each entry names the tan site that emits it and the extension site that
 * matches it. Verified against the v0.4.0 artefact and tan's `contract/
 * issue-codes.json`, not against prose.
 */
const GATED_CODES = {
  // FROZEN — the pinned tan emits it and promises the spelling.
  //
  // tan: commands/bootstrap/mod.rs `yocto_gate` → `failure(…, "yocto-host")`,
  // prefixed by that file's `format!("bootstrap.{code}")`. Ext:
  // alpCli/service.ts `bootstrapHostVerdict`.
  "bootstrap.yocto-host": "frozen",
  // tan: tan-core/src/bootstrap/prerequisites.rs `code: "prerequisites-missing"`,
  // same prefix. Ext: alpCli/service.ts `BOOTSTRAP_PREREQUISITE_CODES`.
  "bootstrap.prerequisites-missing": "frozen",
  // tan: commands/presets.rs emits this as a whole literal, no prefixing.
  // Ext: ideHub/newProjectFlowPanel.ts, preset catalogue fallback.
  "presets.sdk-root-unresolved": "frozen",

  // RETIRED — no current tan emits it, and tan reserves the spelling so it can
  // never come back meaning something else.
  //
  // Emitted by v0.1.1–v0.3.0 (`commands/bootstrap.rs`, `failure(…,
  // "windows-unsupported")`); REMOVED in v0.3.1, which replaced that file and
  // shipped native Windows bootstrap. Matched forever for a user pinned to an
  // old binary through `alpSdk.cliPath` — alpCli/service.ts calls it "a
  // permanent compatibility case, not transitional scaffolding". The artefact
  // agrees in writing: "RESERVED: this spelling must never be reused for a
  // different verdict, which is what the gate asserts." So assert it: the
  // back-compat branch is only safe while the spelling stays reserved.
  "bootstrap.windows-unsupported": "retired",

  // UNDECLARED — tan does not list these at any status, on `main` or `dev`.
  //
  // Both are LIVE on tan's wire (tan-core/src/bootstrap/prerequisites.rs,
  // prefixed by commands/bootstrap/mod.rs's `format!("bootstrap.{code}")`) and
  // LIVE in this extension (`BOOTSTRAP_PREREQUISITE_CODES`,
  // `prerequisitesMissingIssue`) — they are simply outside tan's frozen
  // contract, so a rename would break this extension with neither repo's CI
  // saying a word. tan's own artefact note points straight at the gap: "a
  // consumer wanting those two must match them by name". Filing an issue on
  // tan-cli to freeze them is the real fix; asserting absence here is what
  // makes the day they land unmissable.
  "bootstrap.python-not-runnable": null,
  "bootstrap.python-too-old": null,
};

/**
 * What an issue code looks like: `kebab-family.kebab-name`. Also what
 * `findFrozenCodes` holds tan's declared codes to, which is what lets the
 * source scan below use it as a filter without opening a hole: a tan code that
 * does not match this shape reds the frozen-list read instead.
 *
 * The FAMILY takes hyphens, and that is not cosmetic. It used to be
 * `[a-z][a-z0-9]*`, which rejects `debug-config.legacy-entry-migrated` and
 * `debug-config.comments-dropped` — two codes already sitting in tan's
 * `contract/issue-codes.json`. Under the old shape, the first tan release to
 * publish them would have made `findFrozenCodes` assert "issueCodes[] entry is
 * not an issue code" on a perfectly well-formed entry. Found by driving the
 * new-family demo below, not by reading.
 */
const ISSUE_CODE_SHAPE = /^[a-z][a-z0-9-]*\.[a-z0-9-]+$/;

/**
 * Every issue code this extension MATCHES ON, found in source, by the two
 * idioms it uses to match one — not by family.
 *
 * The family alternation (idiom 3) was the whole scan, and it recognised only
 * `bootstrap.*` and `presets.*`. A new `===` against any other family — the
 * `debug-config.*` and `sdk.*` families tan already declares among them — was
 * invisible to it, so an unclassified code could be added and this file's
 * exhaustiveness assertion would never notice. The two idioms are
 * family-agnostic and close that; the alternation stays so the scan is a strict
 * superset of what it caught before.
 *
 * Quoted literals only: the same codes appear in prose in `service.ts`'s doc
 * comments inside backticks, and those are documentation, not a match site.
 *
 * ISSUE_CODE_SHAPE filters the comparison idiom, which would otherwise collect
 * `error.code === "ENOENT"` and friends. That is not a hole: tan cannot ship a
 * code outside this shape without `findFrozenCodes` redding first.
 *
 * Ceiling: a match neither idiom spells — `["x"].includes(i.code)`, a code
 * built by concatenation — is still invisible outside `bootstrap.*`/`presets.*`.
 * Add the idiom here when someone writes one; do not widen the shape filter.
 */
function scanGatedCodes(roots) {
  const found = new Set();
  const add = (code) => {
    if (ISSUE_CODE_SHAPE.test(code)) found.add(code);
  };
  for (const root of roots) {
    if (!fs.existsSync(root)) continue;
    for (const rel of fs.readdirSync(root, { recursive: true })) {
      const file = path.join(root, String(rel));
      if (!/\.tsx?$/.test(file) || !fs.statSync(file).isFile()) continue;
      const text = fs.readFileSync(file, "utf8");
      // 1. A direct comparison: `issue.code === "…"`, either operand order,
      //    `===` or `!==`.
      for (const m of text.matchAll(/\.code\s*[!=]==\s*"([^"]*)"/g)) add(m[1]);
      for (const m of text.matchAll(/"([^"]*)"\s*[!=]==\s*[\w$.]*\.code\b/g)) {
        add(m[1]);
      }
      // 2. A declared code set/array — `const FOO_CODES … = new Set([…])`,
      //    membership-tested with `.has(issue.code)`.
      for (const decl of text.matchAll(
        /\b[A-Z][A-Z0-9_]*CODES?\b[^=\n]*=\s*(?:new Set\s*\(\s*)?\[([^\]]*)\]/g,
      )) {
        for (const m of decl[1].matchAll(/"([^"]*)"/g)) add(m[1]);
      }
      // 3. The original family alternation, kept so this scan can only ever
      //    see MORE than it used to.
      for (const m of text.matchAll(/"((?:bootstrap|presets)\.[a-z0-9-]+)"/g)) {
        add(m[1]);
      }
    }
  }
  return found;
}

/**
 * Objects in the artefact that are MEANT to be envelopes, found by a predicate
 * deliberately WEAKER than the shape under test: a string `command` and a
 * numeric `exitCode`, and nothing else. Discovering them by "looks like a valid
 * envelope" and then asserting they are valid envelopes would be a tautology
 * that passes on any drift, so the predicate stays far short of the six-key
 * shape, `ok`/`exitCode` agreement and `parseEnvelope` the tests below assert.
 *
 * `exitCode` is in the predicate purely to exclude documentation prose: a block
 * like `"commands": {"build": {"command": "tan build", "description": "…"}}` is
 * a plausible neighbour in the artefact, and
 * `command`-alone would drag it in and red the gate over a doc string.
 *
 * `issues` was ADDED here and then REVERTED, and the reason is the rule for
 * anything else anyone is tempted to add. It did close a false red — a docs
 * block that documents its own exit code clears `command`+`exitCode`. But
 * `isEnvelope` requires exactly `command`/`ok`/`exitCode`/`issues`, so putting
 * `issues` in the *discovery* predicate meant an envelope whose `issues` tan
 * had renamed was no longer discovered at all: the family read as absent, the
 * assertion SKIPPED, the gate went green, and the skip line blamed #106's open
 * layout for a rename tan actually made. Driven: renaming `issues` to
 * `problems` in a golden went `fail 1` to `pass 5 skipped 1`. That is the exact
 * fail-open this file exists to catch, and it is the whole-envelope case, not
 * one field — `envelope?.issues ?? []` at three sites in `src/alpCli/service.ts`
 * silently yields `[]`.
 *
 * **A discovery key can never be an asserted key.** Whatever discovery filters
 * on becomes invisible to every assertion downstream, so the cost of closing a
 * false red that way is a false green. For a drift gate that trade is always
 * wrong: a false red is a bug report, a false green is a silent regression.
 * The docs-block false red stays until #106 freezes the layout and discovery
 * can be anchored to the declared container key instead of a shape guess.
 *
 * A candidate is not descended into, so a nested `data` never double-counts.
 */
function findEnvelopes(node, out = []) {
  if (Array.isArray(node)) {
    for (const v of node) findEnvelopes(v, out);
  } else if (node && typeof node === "object") {
    if (typeof node.command === "string" && typeof node.exitCode === "number") {
      out.push(node);
    } else {
      for (const v of Object.values(node)) findEnvelopes(v, out);
    }
  }
  return out;
}

/**
 * The artefact's FROZEN issue-code list as `code → status` (status `null` when
 * the entry is a plain string), or null when it carries none.
 *
 * This used to DISCOVER the list by shape — walk the whole document for any key
 * ending in `code`/`codes` whose value looked like issue codes — because no
 * published artefact existed to read the layout off. That stopgap carried its
 * own instruction: "when the layout is frozen, replace this with the one
 * declared key and delete the heuristic rather than hardening it further."
 *
 * v0.4.0 is the first release to publish the asset, and the heuristic could not
 * read it. `issueCodes` is an array of OBJECTS (`{code, status, severity,
 * consumer, consumerEffect, note}`), while the walker only accepted an array of
 * STRINGS or an object keyed by them — so it collected nothing, `frozenCodes`
 * came back null, and the one assertion that matters (every code the pinned tan
 * emits is in tan's frozen list) SKIPPED on the very first artefact it was
 * given. Loudly, to its credit, but skipped.
 *
 * So: the declared key, and the declared shape. A layout change now REDS this
 * gate instead of silently disarming it, which is the whole point of pinning to
 * a producer artefact. Plain strings are still accepted because that is a
 * strictly narrower shape the walker also handled and it costs one branch.
 *
 * Codes scraped out of golden envelopes remain excluded — a golden carrying a
 * code is tan DEMONSTRATING it, not the producer PROMISING to keep it.
 */
function findFrozenCodes(doc) {
  const list = doc?.issueCodes;
  if (!Array.isArray(list) || list.length === 0) return null;

  const codes = new Map();
  for (const entry of list) {
    const code = typeof entry === "string" ? entry : entry?.code;
    // A non-conforming ENTRY is a layout change, not something to skip past:
    // silently dropping it would shrink the frozen set and turn a producer-side
    // rename into a green run.
    assert.ok(
      typeof code === "string" && ISSUE_CODE_SHAPE.test(code),
      `${ASSET} issueCodes[] entry is not an issue code or a {code} object: ` +
        `${JSON.stringify(entry)?.slice(0, 120)}`,
    );
    codes.set(code, typeof entry?.status === "string" ? entry.status : null);
  }
  return codes;
}

const present = fs.existsSync(assetPath);

/** Is the PINNED release expected to publish the asset at all? Read off the one
 *  in-tree declaration, in `src/alpCli/service.ts`, that the fetch script reads
 *  too — never re-derived from a version comparison here. */
const expected = !RELEASES_PREDATING_CONTRACT_ASSET.includes(
  SUPPORTED_CLI_VERSION,
);

/** The offline developer's opt-out. Ignored under `CI` — an env var that can
 *  green a pipeline is not an opt-out, it is the fail-open with extra steps. */
const offlineOptOut = !process.env.CI && process.env[OFFLINE_ENV] === "1";

const skip =
  !present &&
  (expected
    ? `NOT CHECKED — ${OFFLINE_ENV}=1 was set, so the missing ${ASSET} for the pinned tan ` +
      `v${SUPPORTED_CLI_VERSION} is a skip rather than the failure it otherwise is. That ` +
      `release DOES publish one, at ${URL}; it was never fetched here. Nothing below ` +
      `verified that tan still emits the envelope this extension parses. ` +
      `Run \`pnpm run contract:fetch\` when back online.`
    : `NOT CHECKED — tan v${SUPPORTED_CLI_VERSION} predates ${ASSET}: it is listed in ` +
      `RELEASES_PREDATING_CONTRACT_ASSET (src/alpCli/service.ts), the closed set of tags cut ` +
      `before ${ISSUE} added the asset to release.yml. Nothing is published at ${URL} to ` +
      `check against, so nothing below verified that tan still emits the envelope this ` +
      `extension parses.`);

const doc = present ? JSON.parse(fs.readFileSync(assetPath, "utf8")) : null;
const envelopes = present ? findEnvelopes(doc) : [];
const frozenCodes = present ? findFrozenCodes(doc) : null;

/**
 * Assertions made against a SUBSTANTIVE family of the artefact's content —
 * frozen codes or golden envelopes, the two things only tan can be the source
 * of. The `not vacuous` test reads it.
 *
 * Three things deliberately do NOT count, because none of them can distinguish
 * a real artefact from a stub:
 *  - the source scan below, which needs no artefact at all;
 *  - the VERSION stamp, which `scripts/fetch-tan-contract.mjs` writes from this
 *    repo's own pin;
 *  - the artefact's own `version` field, which the same script fetched from a
 *    URL BUILT out of that pin — so `{"version":"0.3.1"}` under tag v0.3.1 is a
 *    tautology, and counting it let a one-key stub satisfy the guard whose
 *    entire job is catching a present-but-vacuous artefact.
 */
let artefactChecks = 0;

// The ONE test in this file with no `{ skip }`: it is what makes a missing
// artefact a failure instead of a skip that reads like a pass. Everything below
// it skips when the artefact is absent — that is fine precisely because getting
// there at all now requires this to have passed.
test("tan contract: the artefact is present for a pin that publishes one", () => {
  assert.ok(
    present || !expected || offlineOptOut,
    `No ${ASSET} at ${assetPath}, but tan v${SUPPORTED_CLI_VERSION} publishes one at ` +
      `${URL} — it is not in RELEASES_PREDATING_CONTRACT_ASSET (src/alpCli/service.ts). ` +
      `So this run verified NOTHING about the envelope tan emits and this extension parses, ` +
      `and that is a failure, not a skip: the whole point of pinning to a producer artefact ` +
      `is lost the moment its absence is tolerated.\n` +
      `  • CI: \`node scripts/fetch-tan-contract.mjs\` runs before the tests and should have ` +
      `left it here. If it did not, read ITS log — it exits 1 and names why.\n` +
      `  • Locally: run \`pnpm run contract:fetch\` (the corpus is gitignored, so a fresh ` +
      `clone has none).\n` +
      `  • Offline: \`${OFFLINE_ENV}=1 pnpm test\` downgrades this to a loud skip. It is ` +
      `ignored when CI is set.`,
  );
});

// Runs with or without the artefact: it is about THIS repo's source. It is also
// the assertion that gives `GATED_CODES` its teeth — a new match site cannot be
// added without someone deciding what tan declares about it.
test("gated issue codes: every code matched in src/ is classified exactly once", () => {
  const scanned = scanGatedCodes([
    path.join(__dirname, "..", "src"),
    path.join(__dirname, "..", "packages", "alp-core", "src"),
  ]);
  assert.deepEqual(
    [...scanned].sort(),
    Object.keys(GATED_CODES).sort(),
    "an issue code is matched by exact string in src/ but is not in GATED_CODES (or vice " +
      "versa). Every one of these matches fails open — rename the code and the branch " +
      "simply never fires, with no error and no log line — so an unclassified code is a " +
      "match nobody decided the fate of. Add it to GATED_CODES with the status tan's " +
      "frozen list gives it, or `null` if tan declares it nowhere.",
  );
});

test(
  "tan contract: VERSION stamp matches SUPPORTED_CLI_VERSION",
  { skip },
  () => {
    const stamp = fs.readFileSync(path.join(dir, "VERSION"), "utf8").trim();
    assert.equal(
      stamp,
      SUPPORTED_CLI_VERSION,
      `the fetched corpus is for tan v${stamp} but this build pins ` +
        `v${SUPPORTED_CLI_VERSION} — re-run \`pnpm run contract:fetch\`. A pin bump ` +
        `with a stale corpus verifies the OLD contract and says nothing about the new one.`,
    );
    // No `artefactChecks += 1` — see the counter's comment. This compares two
    // values this repo produced; it proves freshness, not that tan emits anything.
  },
);

test(
  "tan contract: the artefact's own version claim matches the pin",
  { skip },
  (t) => {
    const key = ["version", "tanVersion", "cliVersion"].find(
      (k) => typeof doc?.[k] === "string",
    );
    if (!key) {
      t.skip(
        `the ${ASSET} published for v${SUPPORTED_CLI_VERSION} carries no top-level ` +
          `version/tanVersion/cliVersion field (no published artefact has pinned the layout). ` +
          `The VERSION stamp is checked instead; the asset's own claim is not.`,
      );
      return;
    }
    assert.equal(
      doc[key].replace(/^v/, ""),
      SUPPORTED_CLI_VERSION,
      `${ASSET} says it describes tan ${doc[key]}, but this build pins v${SUPPORTED_CLI_VERSION}`,
    );
    // No `artefactChecks += 1` — see the counter's comment. `fetch-tan-contract
    // .mjs` builds the download URL FROM the pin, so "the asset published under
    // tag v0.3.1 says 0.3.1" holds by construction in every real run.
  },
);

test(
  "tan contract: every matched issue code is declared exactly as GATED_CODES says",
  { skip },
  (t) => {
    if (!frozenCodes) {
      t.skip(
        `the ${ASSET} published for v${SUPPORTED_CLI_VERSION} at ${URL} carries no ` +
          `frozen issue-code list. All ${Object.keys(GATED_CODES).length} codes this ` +
          `extension matches are UNVERIFIED.`,
      );
      return;
    }
    for (const [code, status] of Object.entries(GATED_CODES)) {
      if (status === null) {
        // The half that used to assert nothing. tan declaring a code this
        // extension already matches is GOOD news — but it changes what this
        // gate can watch, and nobody finds that out unless it says so.
        assert.ok(
          !frozenCodes.has(code),
          `\`${code}\` is now in tan v${SUPPORTED_CLI_VERSION}'s frozen code list ` +
            `(status: ${frozenCodes.get(code)}), but GATED_CODES still files it as ` +
            `undeclared. This is not a regression — it is the thing that was waited on. ` +
            `Change its entry from \`null\` to that status so this gate starts watching ` +
            `the rename it could not watch before.`,
        );
        continue;
      }
      assert.ok(
        frozenCodes.has(code),
        `\`${code}\` is matched by exact string in this extension and tan ` +
          `v${SUPPORTED_CLI_VERSION} is expected to declare it "${status}", but it is not ` +
          `in that release's frozen code list at all. The match fails open — it will never ` +
          `fire and nothing will say so. Either tan renamed it, or it dropped the ` +
          `declaration and the entry belongs at \`null\`.`,
      );
      // A plain-string entry carries no status, which is a strictly narrower
      // artefact shape than the published one; assert what is there.
      const declared = frozenCodes.get(code);
      if (declared !== null) {
        assert.equal(
          declared,
          status,
          `tan v${SUPPORTED_CLI_VERSION} declares \`${code}\` "${declared}", not ` +
            `"${status}". A "frozen"→"retired" flip means the pinned tan stopped emitting ` +
            `a code this extension still branches on; the reverse means a back-compat-only ` +
            `branch is live again. Either way the classification here is stale.`,
        );
      }
      artefactChecks += 1;
    }
  },
);

test(
  "tan contract: every golden envelope is one this repo can parse",
  { skip },
  (t) => {
    if (envelopes.length === 0) {
      t.skip(
        `the ${ASSET} published for v${SUPPORTED_CLI_VERSION} at ${URL} carries no ` +
          `golden envelopes (no published artefact has pinned the layout). The envelope shape is UNVERIFIED.`,
      );
      return;
    }
    /** Goldens carrying the optional 7th key. Counted so the `sdk` assertion
     *  below cannot be vacuous: tan dropping the key from every envelope would
     *  otherwise satisfy an `if ("sdk" in envelope)` loop in perfect silence. */
    let withSdk = 0;
    for (const envelope of envelopes) {
      const where = `envelope for \`tan ${envelope.command}\``;
      // The repo's OWN parser, not a restatement of the shape: whatever this
      // rejects, every envelope-reading surface in the extension also rejects
      // (`parseEnvelope` → null → the caller falls back and says nothing).
      assert.notEqual(
        parseEnvelope(JSON.stringify(envelope)),
        null,
        `${where} does not satisfy parseEnvelope — the extension would read it as no ` +
          `envelope at all and silently fall back`,
      );
      // `project` and `data` complete the six-key envelope docs/CLI.md pins.
      // `isEnvelope` does not check them, so nothing else here would notice.
      for (const key of ["project", "data"]) {
        assert.ok(
          key in envelope,
          `${where} has no \`${key}\` key — docs/CLI.md pins the envelope as ` +
            `{command, ok, exitCode, project, data, issues}`,
        );
      }
      // The SEVENTH key (tan-cli#129). Optional by construction, not by
      // version: tan skips serializing it whenever the command resolved no SDK,
      // so its absence on a given envelope is correct and asserting presence
      // per-envelope would be wrong. What IS asserted is the shape whenever it
      // is there, matching `AlpSdkInfo` in src/alpCli/models.ts — and, after
      // the loop, that at least one golden still carries it at all.
      if ("sdk" in envelope) {
        withSdk += 1;
        assert.equal(
          typeof envelope.sdk?.root,
          "string",
          `${where} carries \`sdk\` with no string \`root\` — ` +
            `${JSON.stringify(envelope.sdk)?.slice(0, 120)}`,
        );
        assert.equal(
          typeof envelope.sdk?.sourceTier,
          "string",
          `${where} carries \`sdk\` with no string \`sourceTier\` — ` +
            `${JSON.stringify(envelope.sdk)?.slice(0, 120)}`,
        );
      }
      assert.notEqual(
        classifyExitCode(envelope.exitCode),
        "unknown",
        `${where} exits ${envelope.exitCode}, which classifyExitCode does not know — ` +
          `tan added an exit code this extension cannot classify`,
      );
      // classifyOutcome derives `ok` from the exit code and ignores the envelope's
      // own field, so the two disagreeing is a real, silent split.
      assert.equal(
        envelope.ok,
        envelope.exitCode === 0,
        `${where} reports ok=${envelope.ok} at exitCode ${envelope.exitCode}; ` +
          `classifyOutcome derives ok from the exit code alone and would disagree`,
      );
      artefactChecks += 1;
    }
    assert.ok(
      withSdk > 0,
      `not one of the ${envelopes.length} goldens tan v${SUPPORTED_CLI_VERSION} publishes ` +
        `carries the \`sdk\` key (tan-cli#129), so the shape assertions above ran zero ` +
        `times. Either tan stopped emitting it — which is a contract regression this ` +
        `extension's \`AlpEnvelope.sdk\` still declares — or the goldens no longer cover a ` +
        `command that resolves an SDK, which leaves the key untested on the wire.`,
    );
  },
);

// The other half of the skip trap: present-but-vacuous is the same defect
// wearing a different hat. Last so every test above has had its turn.
test("tan contract: the assertions above were not vacuous", { skip }, () => {
  assert.ok(
    artefactChecks > 0,
    `${ASSET} is present but produced ZERO assertions against anything only tan can ` +
      `be the source of — both substantive families (frozen issue codes, golden ` +
      `envelopes) were absent or the wrong shape. That is a failure, not a pass: the ` +
      `contract is unverified either way, and only a red says so. See ${ISSUE}.`,
  );
});
