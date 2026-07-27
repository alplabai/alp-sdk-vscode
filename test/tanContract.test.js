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
// The artefact does not exist yet — `alplabai/tan-cli#106` will publish it. So
// the SKIP path is today's real path, and it is written to be impossible to read
// as a pass: every skip reason names the pin, the URL and the issue, so the
// runner's own `# SKIP` line carries all three. The `not vacuous` test below
// closes the other half of the same trap — an artefact that IS present but
// yields zero assertions (wrong shape, empty families, a layout tan changed)
// fails rather than passing quietly.
//
// What is asserted about a code depends on whether the PINNED tan emits it, so
// the codes are split in two below. Three of the six this extension matches are
// matched deliberately for a tan that is NOT the pin — one older, two newer — so
// a gate demanding all six be in the pinned release's frozen list would be red
// by construction the day the artefact lands, and the only ways to green it
// would be deleting a compatibility branch real users depend on or gutting the
// assertion. What the split forces is CLASSIFICATION, not membership.
//
// Point `TAN_CONTRACT_DIR` at another directory to drive this against a
// hand-built artefact without committing one.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const {
  SUPPORTED_CLI_VERSION,
  parseEnvelope,
  classifyExitCode,
} = require("../out/alpCli/service.js");

const ASSET = "envelope-contract.json";
const ISSUE = "alplabai/tan-cli#106";
const URL = `https://github.com/alplabai/tan-cli/releases/download/v${SUPPORTED_CLI_VERSION}/${ASSET}`;

const dir =
  process.env.TAN_CONTRACT_DIR ??
  path.join(__dirname, "golden", "tan-contract");
const assetPath = path.join(dir, ASSET);

/**
 * Codes the PINNED tan is expected to emit. Membership in the artefact's frozen
 * list is ASSERTED — this is the drift catcher the whole file exists for: a code
 * tan renames breaks the build here instead of failing open in the field.
 *
 * Each entry names the tan v0.3.1 site that emits it and the extension site that
 * matches it. Verified against the tag, not against tan's `dev`.
 */
const PINNED_CODES = [
  // tan: bootstrap/mod.rs `yocto_gate` → `failure(…, "yocto-host")`, prefixed by
  // that file's `format!("bootstrap.{code}")`. Ext: alpCli/service.ts
  // `bootstrapHostVerdict`.
  "bootstrap.yocto-host",
  // tan: bootstrap/mod.rs `check_prerequisites` Err → `failure(…,
  // "prerequisites-missing")`, same prefix. Ext: alpCli/service.ts
  // `BOOTSTRAP_PREREQUISITE_CODES`.
  "bootstrap.prerequisites-missing",
  // tan: commands/presets.rs emits this as a whole literal, no prefixing.
  // Ext: ideHub/newProjectFlowPanel.ts, preset catalogue fallback.
  "presets.sdk-root-unresolved",
];

/**
 * Codes matched on PURPOSE for a tan that is not the pin. NOTHING is asserted
 * about their membership in the frozen list, and both directions of that are
 * deliberate: asserting presence is wrong today (the pin does not emit them),
 * and asserting absence breaks the day the pin moves and one becomes a pinned
 * code. Their only gate is the exhaustiveness check below.
 */
const COMPAT_CODES = [
  // OLDER tan. Emitted by v0.1.1–v0.3.0 (`commands/bootstrap.rs`, `failure(…,
  // "windows-unsupported")`); REMOVED in v0.3.1, which replaced that file and
  // shipped native Windows bootstrap. Matched forever for a user pinned to an
  // old binary through `alpSdk.cliPath` — alpCli/service.ts calls it "a
  // permanent compatibility case, not transitional scaffolding". It will never
  // be in the pinned tan's frozen list again.
  "bootstrap.windows-unsupported",
  // NEWER tan. Absent at v0.3.1; emitted on tan `dev` from
  // tan-core/src/bootstrap/prerequisites.rs, prefixed by bootstrap/mod.rs's
  // `format!("bootstrap.{code}")`. MOVE BOTH TO PINNED_CODES when
  // SUPPORTED_CLI_VERSION reaches the release that ships them — until then this
  // gate cannot watch them, and after then it must.
  "bootstrap.python-not-runnable",
  "bootstrap.python-too-old",
];

/** What an issue code looks like: `family.kebab-name`. */
const ISSUE_CODE_SHAPE = /^[a-z][a-z0-9]*\.[a-z0-9-]+$/;

/** Every `"bootstrap.*"` / `"presets.*"` string LITERAL under a source root.
 *  Quoted only: the same codes appear in prose in `service.ts`'s doc comments
 *  inside backticks, and those are documentation, not a match site. */
function scanGatedCodes(roots) {
  const found = new Set();
  for (const root of roots) {
    if (!fs.existsSync(root)) continue;
    for (const rel of fs.readdirSync(root, { recursive: true })) {
      const file = path.join(root, String(rel));
      if (!/\.tsx?$/.test(file) || !fs.statSync(file).isFile()) continue;
      const text = fs.readFileSync(file, "utf8");
      for (const m of text.matchAll(/"((?:bootstrap|presets)\.[a-z0-9-]+)"/g)) {
        found.add(m[1]);
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
 * a plausible neighbour in an artefact whose layout #106 has not frozen, and
 * `command`-alone would drag it in and red the gate over a doc string.
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
 * The artefact's FROZEN issue-code list, or null when it carries none. Accepts
 * any key ending in `code`/`codes` holding a non-empty array of issue codes or
 * an object keyed by them — #106 is still open and the layout is not frozen, so
 * this is tolerant by design. Codes scraped out of golden envelopes are
 * deliberately NOT included: a golden that happens to carry one code is not the
 * producer promising to keep it.
 *
 * The entries must LOOK like issue codes, not merely live under a `*code(s)`
 * key. docs/CLI.md pins six exit codes as well, so an `exitCodes` map keyed
 * `"0".."5"` is a plausible sibling here — and `Object.entries` insertion order
 * would otherwise decide which one wins, reddening the gate on a perfectly
 * correct artefact and blaming tan for a rename that never happened.
 */
function findFrozenCodes(node) {
  if (Array.isArray(node)) {
    for (const v of node) {
      const hit = findFrozenCodes(v);
      if (hit) return hit;
    }
    return null;
  }
  if (!node || typeof node !== "object") return null;
  for (const [key, value] of Object.entries(node)) {
    if (/codes?$/i.test(key)) {
      const codes = Array.isArray(value)
        ? value
        : value && typeof value === "object"
          ? Object.keys(value)
          : null;
      if (
        codes?.length &&
        codes.every((c) => typeof c === "string" && ISSUE_CODE_SHAPE.test(c))
      ) {
        return new Set(codes);
      }
    }
    const hit = findFrozenCodes(value);
    if (hit) return hit;
  }
  return null;
}

const present = fs.existsSync(assetPath);
const skip =
  !present &&
  `NOT CHECKED — no ${ASSET} is published for the pinned tan v${SUPPORTED_CLI_VERSION} ` +
    `at ${URL}. The producer is ${ISSUE} (open). Run \`pnpm run contract:fetch\` once it ships. ` +
    `Nothing here verified that tan still emits the envelope this extension parses.`;

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

// Runs with or without the artefact: it is about THIS repo's source. It is also
// the assertion that gives the split above its teeth — a new match site cannot
// be added without someone deciding which kind it is.
test("gated issue codes: every code matched in src/ is classified exactly once", () => {
  const scanned = scanGatedCodes([
    path.join(__dirname, "..", "src"),
    path.join(__dirname, "..", "packages", "alp-core", "src"),
  ]);
  assert.deepEqual(
    PINNED_CODES.filter((code) => COMPAT_CODES.includes(code)),
    [],
    "a code is in BOTH PINNED_CODES and COMPAT_CODES. It is one or the other: " +
      "either the pinned tan emits it (assert it) or it does not (assert nothing).",
  );
  assert.deepEqual(
    [...scanned].sort(),
    [...PINNED_CODES, ...COMPAT_CODES].sort(),
    "a `bootstrap.*`/`presets.*` issue code is matched by exact string in src/ but is " +
      "in neither PINNED_CODES nor COMPAT_CODES (or vice versa). Every one of these " +
      "fails open, so an unclassified code is a match nobody decided the fate of: " +
      "either the pinned tan emits it — PINNED_CODES, and this gate watches it — or it " +
      "is there for an older/newer binary — COMPAT_CODES, and this gate cannot.",
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
          `version/tanVersion/cliVersion field (${ISSUE} has not frozen the layout). ` +
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

// Only PINNED_CODES. COMPAT_CODES are matched for a tan that is NOT this pin,
// so neither their presence nor their absence here says anything at all.
test(
  "tan contract: every pinned issue code is in the frozen code list",
  { skip },
  (t) => {
    if (!frozenCodes) {
      t.skip(
        `the ${ASSET} published for v${SUPPORTED_CLI_VERSION} at ${URL} carries no ` +
          `frozen issue-code list (${ISSUE} has not frozen the layout). The ` +
          `${PINNED_CODES.length} codes the pinned tan emits are UNVERIFIED.`,
      );
      return;
    }
    for (const code of PINNED_CODES) {
      assert.ok(
        frozenCodes.has(code),
        `\`${code}\` is matched by exact string in this extension and tan ` +
          `v${SUPPORTED_CLI_VERSION} is expected to emit it, but it is not in that ` +
          `release's frozen code list. The match fails open — it will never fire and ` +
          `nothing will say so. Either tan renamed it, or it belongs in COMPAT_CODES ` +
          `because this pin does not emit it after all.`,
      );
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
          `golden envelopes (${ISSUE} has not frozen the layout). The envelope shape is UNVERIFIED.`,
      );
      return;
    }
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
