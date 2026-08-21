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
// The artefact EXISTS as of tan v0.4.0-rc1, the first tag to publish it
// (`alplabai/tan-cli#106` wired it into `release.yml`); every tag from there on
// carries it, and v0.4.0 is the pin. So
// a missing artefact is no longer a state of the world to be tolerated — it is
// a fetch that did not happen or did not work, and this file FAILS on it.
//
// The skip path survives for exactly one case: a pin listed in
// `RELEASES_PREDATING_CONTRACT_ASSET` (src/alpCli/service.ts), the closed set of
// tan tags cut before #106 landed. Nothing is published for those, so
// there is nothing to verify. Everything else that ends with no artefact on
// disk is red — see `the artefact is present` below. It is one of the two tests
// here that carry no `{ skip }`; the other is the source scan, which asserts
// against this repo's own files and needs no artefact either way.
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

  // FROZEN as of tan v0.4.1 — and this pair is why the `null` status exists.
  //
  // Both are LIVE on tan's wire (tan-core/src/bootstrap/prerequisites.rs,
  // prefixed by commands/bootstrap/mod.rs's `format!("bootstrap.{code}")`) and
  // LIVE in this extension (`BOOTSTRAP_PREREQUISITE_CODES`,
  // `prerequisitesMissingIssue`), but through v0.4.0 they were outside tan's
  // frozen contract — so a rename would have broken this extension with neither
  // repo's CI saying a word. They were pinned here as `null` ("tan declares
  // this at no status") precisely so that the day tan declared them, this gate
  // went red and said so, instead of the gap closing unnoticed.
  //
  // That day is this pin. tan v0.4.1's published `envelope-contract.json`
  // declares both `frozen` (verified against the release asset, not tan's
  // `dev`: `tanVersion: 0.4.1`, 68 issue codes), so the assertion moves from
  // "absent" to "frozen" and the spelling is now tan's promise rather than this
  // extension's hope.
  "bootstrap.python-not-runnable": "frozen",
  "bootstrap.python-too-old": "frozen",

  // RESERVED — and this repo is now on BOTH ends of it, which is why it is
  // here at all.
  //
  // tan: python/tan/commands/model_cmd.py, registered by tan-cli#224. The
  // artefact declares it `"status": "reserved", "consumer": "none"`, with the
  // standing note "Promote to `frozen` (filling in consumer/consumerEffect for
  // real) the moment a consumer binds to it".
  //
  // A CONSUMER HAS BOUND TO IT, twice. #522 made
  // `packages/alp-webview/src/features/models/cliSurface.ts` classify on this
  // exact code — that whole module exists to match it and nothing else — and
  // #544 added a PRODUCER, `src/alpCli/pinnedSurface.ts`, which synthesises
  // the refusal rather than spawning nine subcommands to hear it. So the
  // extension both emits and matches a spelling tan reserves the right to
  // rename, and until now nothing on either side of the seam watched it: this
  // gate did not list it, and the two in-repo spellings were pinned equal to
  // EACH OTHER, which is circular — rename both and every test stays green.
  //
  // The status stays `reserved` here because that is what tan declares TODAY,
  // and this file asserts tan's declaration rather than the one we would
  // prefer. Promoting it to `frozen` is an upstream ask against tan-cli, not
  // an edit to the vendored corpus; the day tan promotes it, the status
  // assertion below reds and this entry is updated to match.
  "model.unknown-subcommand": "reserved",

  // UNDECLARED, and never going to be: this extension MANUFACTURES it
  // (`src/alpCli/pinnedSurface.ts`) for "the pinned tan can do this and this
  // panel does not call it" — a statement about this repo's wiring that no CLI
  // could make. It is in the `models.` family for that reason, next to
  // `models.cli-error` and `models.tan-outdated` (`src/models/service.ts`),
  // and deliberately NOT in tan's `model.` one.
  //
  // Pinned at `null` rather than left out because the entry is cheap and the
  // day tan declares a `models.panel-not-wired` of its own is the day two
  // different verdicts share one spelling on the same wire. The assertion
  // above turns that collision into a red instead of a silent overlap.
  "models.panel-not-wired": null,
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
 * Every issue code this extension BINDS TO, found in source, by the idioms it
 * uses to bind one — not by family.
 *
 * "Binds to" and not "matches on", since idiom 4 below: a one-code constant is
 * a binding whether it is compared against or emitted through, and both
 * deserve a decision. A code this repo MANUFACTURES is classified `null`
 * ("tan declares this nowhere"), which is not a formality — it is what turns
 * a future collision, tan shipping the same spelling for a different verdict,
 * into a red rather than a silent overlap on one wire.
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
      // 4. A SINGLE declared code — `const FOO_CODE = "…"` — membership-tested
      //    through the constant (`issue.code === UNKNOWN_SUBCOMMAND_CODE`) or
      //    emitted through it. Idiom 2 requires an ARRAY, idiom 1 requires a
      //    LITERAL at the comparison, and a one-code constant is neither: it
      //    was invisible to this scan at both of its sites (the webview
      //    classifier that matches it and `pinnedSurface.ts` that produces
      //    it), so `model.unknown-subcommand` could be renamed on both sides
      //    at once with nothing going red.
      for (const m of text.matchAll(
        /\b[A-Z][A-Z0-9_]*CODE\b[^=\n]*=\s*"([^"]*)"/g,
      )) {
        add(m[1]);
      }
    }
  }
  return found;
}

// ---------------------------------------------------------------------------
// The doctor envelope's key set (#466 §3)
// ---------------------------------------------------------------------------
//
// The dependency panel renders `tan doctor --build`'s `data`, and until now
// nothing here mentioned `doctor`, `checks` or `missingPrerequisites` at all: a
// producer-side rename landed as an EMPTY PANEL, not a failing test. Same
// fail-open as everything else in this file — rename `data.checks` and
// `planDependencyReport` maps over `undefined`; rename `missingPrerequisites`
// and `prerequisites ?? []` finds nothing, so every Fix button quietly
// disappears while CI stays green on both sides.
//
// #466 ruled out a golden fixture, and `docs/EXTENSION_CLI_INTEGRATION.md` had
// already ruled it out for this exact output: doctor output is
// machine-dependent, so a recorded run reds on every host but the one that made
// it. What it asked for instead is a key-set conformance gate.
//
// tan got there first. Of the entries in the artefact's `envelopes` block, 17
// publish a golden `envelope`; `doctor` alone publishes `dataKeys` — a
// declarative schema of required/optional keys and their kinds, carrying no
// values at all. So this gate does not restate the shape in TypeScript. It
// reads tan's own declaration and compares it against the extension's own
// declaration (`packages/alp-core/src/cli/doctorEnvelope.ts`), which is the
// same "tan owns the facts" rule `deps/planner.ts` is built on, applied to the
// gate itself.
//
// The two directions get different rules, for the same reason
// `test/webview.payloadMirror.test.js` splits them (#497):
//
//   * a key the EXTENSION declares that tan does not — a hard red, no
//     allowlist. That is the direction that empties the panel.
//   * a key TAN declares that the extension does not model — allowed only when
//     `UNMODELLED_DOCTOR_KEYS` names it with a reason, and the entry must still
//     describe a live omission or it reds as stale.

const DOCTOR_ENVELOPE_MODELS = "packages/alp-core/src/cli/doctorEnvelope.ts";

/**
 * Keys tan's `dataKeys` declares that `doctorEnvelope.ts` deliberately does not
 * model, with the reason. Both are additive keys nothing renders.
 */
const UNMODELLED_DOCTOR_KEYS = {
  generatedAt:
    "The run's timestamp. Nothing renders it — the panel shows the report it " +
    "just fetched, so a stamp would only ever say 'now'. Modelling it would " +
    "invite a surface to print a time that is not the one on screen after a " +
    "refresh races.",
};

/** Field names of `export interface <name>`, each keeping its `?`. Nested brace
 *  groups are blanked first so a `;` inside an inline object type (the
 *  `summary` field) cannot split a field in two. */
function declaredFields(source, name) {
  const header = new RegExp(`export interface ${name}\\b[^{]*\\{`, "m").exec(
    source,
  );
  if (!header) return null;

  let depth = 1;
  let body = null;
  const start = header.index + header[0].length;
  for (let i = start; i < source.length; i += 1) {
    if (source[i] === "{") depth += 1;
    else if (source[i] === "}") {
      depth -= 1;
      if (depth === 0) {
        body = source.slice(start, i);
        break;
      }
    }
  }
  if (body === null) return null;

  let flat = "";
  let nesting = 0;
  for (const ch of body) {
    if (ch === "{") {
      nesting += 1;
      flat += " ";
    } else if (ch === "}") {
      nesting -= 1;
      flat += " ";
    } else {
      flat += nesting > 0 ? " " : ch;
    }
  }
  return new Set(
    flat
      .split(";")
      .map((entry) => /^\s*(\w+)(\?)?\s*:/.exec(entry))
      .filter(Boolean)
      .map((m) => `${m[1]}${m[2] ?? ""}`),
  );
}

/** Strip comments so prose in a doc block cannot be read as a field. */
function stripTsComments(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .map((line) => {
      const at = line.indexOf("//");
      if (at < 0) return line;
      const quotes = (line.slice(0, at).match(/"/g) ?? []).length;
      return quotes % 2 === 0 ? line.slice(0, at) : line;
    })
    .join("\n");
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
 * v0.4.0 publishes the asset, and the heuristic could not read it.
 * `issueCodes` is an array of OBJECTS (`{code, status, severity,
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

// Three ways to arrive with no artefact, three reasons. The opt-out branch is
// NOT the default: a run that never set OFFLINE_ENV must not be told it did.
// A skip that misreports why it skipped is the same class of defect as a gate
// that passes without verifying — it puts a false fact in the log, and the log
// is all anyone reads.
const skip =
  !present &&
  (!expected
    ? `NOT CHECKED — tan v${SUPPORTED_CLI_VERSION} predates ${ASSET}: it is listed in ` +
      `RELEASES_PREDATING_CONTRACT_ASSET (src/alpCli/service.ts), the closed set of tags cut ` +
      `before ${ISSUE} added the asset to release.yml. Nothing is published at ${URL} to ` +
      `check against, so nothing below verified that tan still emits the envelope this ` +
      `extension parses.`
    : offlineOptOut
      ? `NOT CHECKED — ${OFFLINE_ENV}=1 was set, so the missing ${ASSET} for the pinned tan ` +
        `v${SUPPORTED_CLI_VERSION} is a skip rather than the failure it otherwise is. That ` +
        `release DOES publish one, at ${URL}; it was never fetched here. Nothing below ` +
        `verified that tan still emits the envelope this extension parses. ` +
        `Run \`pnpm run contract:fetch\` when back online.`
      : `NOT CHECKED — no ${ASSET} for the pinned tan v${SUPPORTED_CLI_VERSION}, and ` +
        `${OFFLINE_ENV}=1 was NOT set${process.env.CI ? " (or was, and is ignored under CI)" : ""}. ` +
        `That release DOES publish one, at ${URL}; it was never fetched here. This is not a ` +
        `tolerated absence — \`the artefact is present\` above has already FAILED this run, ` +
        `and these skips are the downstream of that failure, not a reason it was excused. ` +
        `Fix the fetch (\`pnpm run contract:fetch\`), do not read past this.`);

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

// The test that makes a missing artefact a failure instead of a skip that reads
// like a pass. Every ARTEFACT-reading test below skips when it is absent — that
// is fine precisely because getting there at all now requires this to have
// passed. (Two tests in this file carry no `{ skip }`: this one and the source
// scan below it, which reads src/ rather than the artefact.)
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
  // The shape this scan filters on, pinned against the family it was widened
  // for. Without this the ISSUE_CODE_SHAPE fix is UNGATED: reverting the family
  // to `[a-z][a-z0-9]*` passes every test here today, because the v0.4.0
  // artefact happens to declare no hyphenated family. The day tan publishes
  // `debug-config.*` — already in its `contract/issue-codes.json` on `dev` —
  // the old shape makes `findFrozenCodes` throw at module scope and takes the
  // whole file down with it. Asserted here, not in the artefact tests, because
  // it is a fact about this file's regex and must hold with no artefact on disk.
  assert.ok(
    ISSUE_CODE_SHAPE.test("debug-config.legacy-entry-migrated"),
    "ISSUE_CODE_SHAPE rejects a hyphenated family. tan already declares " +
      "`debug-config.legacy-entry-migrated` and `debug-config.comments-dropped`; " +
      "findFrozenCodes asserts every issueCodes[] entry matches this shape, so the " +
      "first release to publish one would fail the frozen-list read at module scope " +
      "and kill every test in this file.",
  );
  const scanned = scanGatedCodes([
    path.join(__dirname, "..", "src"),
    path.join(__dirname, "..", "packages", "alp-core", "src"),
    // The webview is a separate package and was outside this scan entirely.
    // It is not a lesser consumer: `features/models/cliSurface.ts` is the ONLY
    // thing in this repo that classifies a tan issue code into a different
    // banner, and it shipped in #522 with nothing watching the spelling it
    // binds to.
    path.join(__dirname, "..", "packages", "alp-webview", "src"),
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

// ---------------------------------------------------------------------------
// doctor envelope conformance (#466 §3)
// ---------------------------------------------------------------------------

const doctorEntry = present ? doc?.envelopes?.doctor : undefined;
const doctorKeys = doctorEntry?.dataKeys;

const models = present
  ? stripTsComments(
      fs.readFileSync(
        path.join(__dirname, "..", DOCTOR_ENVELOPE_MODELS),
        "utf8",
      ),
    )
  : "";

/** `pass` / `warn` / `fail` off `DoctorEnvelopeData`'s inline `summary` type —
 *  `declaredFields` blanks nested braces, so those three need their own read. */
function modelledSummaryKeys() {
  const match = /summary:\s*\{([^}]*)\}/.exec(models);
  if (!match) return null;
  return new Set([...match[1].matchAll(/(\w+)\s*:/g)].map((m) => m[1]));
}

const bare = (field) => field.replace(/\?$/, "");

test("doctor: tan still publishes a dataKeys schema for it", { skip }, () => {
  // The whole gate below hangs off this. `doctor` is the one entry that carries
  // a schema instead of a golden, precisely because its output is
  // machine-dependent; if tan ever drops it or swaps it for a recorded run,
  // every assertion after this would skip and the panel would be back to
  // unverified — so the absence is a failure, not a skip.
  assert.ok(
    doctorEntry,
    `${ASSET} for v${SUPPORTED_CLI_VERSION} publishes no \`envelopes.doctor\` ` +
      `entry. The dependency panel renders that envelope and nothing else here ` +
      `gates it — see ${ISSUE}.`,
  );
  assert.ok(
    doctorKeys && typeof doctorKeys === "object",
    `\`envelopes.doctor\` carries no \`dataKeys\` schema (keys: ` +
      `${Object.keys(doctorEntry ?? {}).join(", ")}). A golden envelope cannot ` +
      `replace it: doctor output is machine-dependent, which is why ` +
      `docs/EXTENSION_CLI_INTEGRATION.md rules a fixture out for this command.`,
  );
  assert.deepEqual(
    doctorEntry.args?.slice(0, 1),
    ["doctor"],
    `\`envelopes.doctor.args\` does not start with \`doctor\` — this entry ` +
      `describes some other command`,
  );
  artefactChecks += 1;
});

test(
  "doctor: every key the extension reads is one tan declares",
  { skip },
  (t) => {
    if (!doctorKeys) {
      t.skip("no dataKeys — reported by the test above");
      return;
    }
    /** The extension's declaration vs tan's, per nesting level. */
    const groups = [
      {
        interface: "DoctorEnvelopeData",
        declared: () => new Set(Object.keys(doctorKeys)),
        where: "data",
      },
      {
        interface: "DoctorCheckEnvelope",
        declared: () =>
          new Set([
            ...Object.keys(doctorKeys.checks?.requiredKeys ?? {}),
            ...Object.keys(doctorKeys.checks?.optionalKeys ?? {}),
          ]),
        where: "data.checks[]",
      },
      {
        interface: "MissingPrerequisite",
        declared: () =>
          new Set(Object.keys(doctorKeys.missingPrerequisites?.items ?? {})),
        where: "data.missingPrerequisites[]",
      },
    ];

    for (const group of groups) {
      const modelled = declaredFields(models, group.interface);
      assert.ok(
        modelled,
        `${DOCTOR_ENVELOPE_MODELS}: no \`export interface ${group.interface}\``,
      );
      const declared = group.declared();
      assert.ok(
        declared.size > 0,
        `tan declares no keys at all for \`${group.where}\` — the schema is ` +
          `present but empty, so this comparison would assert nothing`,
      );

      for (const field of modelled) {
        assert.ok(
          declared.has(bare(field)),
          `\`${group.interface}.${field}\` reads \`${group.where}.${bare(field)}\`, ` +
            `which tan v${SUPPORTED_CLI_VERSION} does not declare. Every read of ` +
            `it FAILS OPEN — the panel renders an empty table or drops every Fix ` +
            `button, with nothing on any surface saying why. There is no ` +
            `allowlist for this direction.`,
        );
      }
      artefactChecks += 1;
    }

    // `summary` is an inline object in the model, so it needs its own read.
    const summary = modelledSummaryKeys();
    assert.ok(summary, `${DOCTOR_ENVELOPE_MODELS}: no inline \`summary\` type`);
    for (const key of summary) {
      assert.ok(
        key in (doctorKeys.summary ?? {}),
        `\`DoctorEnvelopeData.summary.${key}\` is read but tan declares only ` +
          `${Object.keys(doctorKeys.summary ?? {}).join(", ")}. \`counts\` is ` +
          `forwarded to the panel verbatim, so a missing member renders as ` +
          `\`undefined\` in the summary line.`,
      );
    }
    artefactChecks += 1;
  },
);

test(
  "doctor: every key tan declares is modelled, or recorded as deliberately not",
  { skip },
  (t) => {
    if (!doctorKeys) {
      t.skip("no dataKeys — reported above");
      return;
    }
    const unmodelled = [];
    const check = (declared, modelled, prefix) => {
      for (const key of declared) {
        if (modelled.has(key) || modelled.has(`${key}?`)) continue;
        unmodelled.push(`${prefix}${key}`);
      }
    };

    check(
      Object.keys(doctorKeys),
      declaredFields(models, "DoctorEnvelopeData") ?? new Set(),
      "",
    );
    check(
      [
        ...Object.keys(doctorKeys.checks?.requiredKeys ?? {}),
        ...Object.keys(doctorKeys.checks?.optionalKeys ?? {}),
      ],
      declaredFields(models, "DoctorCheckEnvelope") ?? new Set(),
      "checks[].",
    );
    check(
      Object.keys(doctorKeys.missingPrerequisites?.items ?? {}),
      declaredFields(models, "MissingPrerequisite") ?? new Set(),
      "missingPrerequisites[].",
    );

    const unrecorded = unmodelled.filter(
      (key) =>
        !Object.prototype.hasOwnProperty.call(UNMODELLED_DOCTOR_KEYS, key),
    );
    assert.deepEqual(
      unrecorded,
      [],
      `tan v${SUPPORTED_CLI_VERSION} declares ${unrecorded.join(", ")} in the ` +
        `doctor envelope and ${DOCTOR_ENVELOPE_MODELS} does not model it.\n\n` +
        `If a surface should render it, model it. If not, add it to ` +
        `UNMODELLED_DOCTOR_KEYS in this file with the reason — a key nobody ` +
        `decided about is how a producer-side addition sits unnoticed for a ` +
        `release.`,
    );
    artefactChecks += 1;
  },
);

test(
  "doctor: every recorded omission is still a live omission",
  { skip },
  (t) => {
    if (!doctorKeys) {
      t.skip("no dataKeys — reported above");
      return;
    }
    // Same rot rule as test/webview.payloadMirror.test.js: an allowlist nothing
    // re-checks empties the gate one merge at a time.
    const declaredEverywhere = new Set([
      ...Object.keys(doctorKeys),
      ...Object.keys(doctorKeys.checks?.requiredKeys ?? {}).map(
        (k) => `checks[].${k}`,
      ),
      ...Object.keys(doctorKeys.checks?.optionalKeys ?? {}).map(
        (k) => `checks[].${k}`,
      ),
      ...Object.keys(doctorKeys.missingPrerequisites?.items ?? {}).map(
        (k) => `missingPrerequisites[].${k}`,
      ),
    ]);
    const modelledEverywhere = new Set([
      ...[...(declaredFields(models, "DoctorEnvelopeData") ?? [])].map(bare),
      ...[...(declaredFields(models, "DoctorCheckEnvelope") ?? [])].map(
        (f) => `checks[].${bare(f)}`,
      ),
      ...[...(declaredFields(models, "MissingPrerequisite") ?? [])].map(
        (f) => `missingPrerequisites[].${bare(f)}`,
      ),
    ]);

    for (const [key, reason] of Object.entries(UNMODELLED_DOCTOR_KEYS)) {
      assert.ok(
        typeof reason === "string" && reason.trim().length >= 40,
        `UNMODELLED_DOCTOR_KEYS["${key}"] has no real reason`,
      );
      assert.ok(
        declaredEverywhere.has(key),
        `UNMODELLED_DOCTOR_KEYS["${key}"] is stale: tan v${SUPPORTED_CLI_VERSION} ` +
          `no longer declares it. Delete the entry.`,
      );
      assert.ok(
        !modelledEverywhere.has(key),
        `UNMODELLED_DOCTOR_KEYS["${key}"] is stale: ${DOCTOR_ENVELOPE_MODELS} now ` +
          `DOES model it. Delete the entry so the key is gated like every other ` +
          `modelled one.`,
      );
    }
    artefactChecks += 1;
  },
);

test(
  "doctor: a check key tan marks optional is optional in the model too",
  { skip },
  (t) => {
    if (!doctorKeys?.checks) {
      t.skip("no checks schema — reported above");
      return;
    }
    // Only `checks` is compared for optionality, because it is the only place
    // tan SPLITS required from optional. At the top level the model's `?` marks
    // are a tolerant-reader decision about older binaries reachable through
    // `alpSdk.cliPath` (`missingPrerequisites`, `nextSteps`), not a claim about
    // today's contract — asserting them against tan would red on a difference
    // that is deliberate.
    const modelled = declaredFields(models, "DoctorCheckEnvelope") ?? new Set();
    for (const key of Object.keys(doctorKeys.checks.requiredKeys ?? {})) {
      if (!modelled.has(key) && !modelled.has(`${key}?`)) continue; // unmodelled: reported above
      assert.ok(
        modelled.has(key),
        `tan declares \`checks[].${key}\` REQUIRED, but ` +
          `${DOCTOR_ENVELOPE_MODELS} marks it optional. A reader that treats a ` +
          `guaranteed field as absent writes a \`?? fallback\` branch that can ` +
          `never be right.`,
      );
    }
    for (const key of Object.keys(doctorKeys.checks.optionalKeys ?? {})) {
      if (!modelled.has(key) && !modelled.has(`${key}?`)) continue; // unmodelled
      assert.ok(
        modelled.has(`${key}?`),
        `tan declares \`checks[].${key}\` OPTIONAL, but ` +
          `${DOCTOR_ENVELOPE_MODELS} marks it required. Every check tan emits ` +
          `without it then reads as \`undefined\` through a type that promised ` +
          `a value.`,
      );
    }
    artefactChecks += 1;
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
