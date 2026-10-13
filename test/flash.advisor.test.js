// SPDX-License-Identifier: Apache-2.0
//
// Cases from the independent verify pass over #540's arming change. Each one is
// a way an invariant — "nothing was written" only when that is provable, one
// consent per boot table, the customer told WHICH board — could be broken.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const {
  parseFlashEnvelope,
} = require("../packages/alp-core/dist/flash/envelope.js");
const {
  decideFlashArming,
} = require("../packages/alp-core/dist/flash/arming.js");
const {
  classifyFlashOutcome,
  describeFlashOutcome,
} = require("../packages/alp-core/dist/flash/outcome.js");

const raw = (name) =>
  JSON.parse(
    fs.readFileSync(
      path.join(
        __dirname,
        "fixtures",
        "tan-flash",
        `tan-flash.v0.7.0.${name}.json`,
      ),
      "utf8",
    ),
  );
const parse = (obj) => parseFlashEnvelope(JSON.stringify(obj));
const UNSCOPED = { scoped: false, wholeBoard: null };

// ── M1 ─────────────────────────────────────────────────────────────────────

test("tan's catch-all `flash.internal-failure` is never 'nothing was written'", () => {
  // tan wraps ANY exception from its run in this envelope, including one raised
  // after the MRAM write (record, read-back, boot confirmation).
  const env = {
    command: "flash",
    ok: false,
    exitCode: 1,
    project: {},
    data: { entries: [] },
    issues: [
      { code: "flash.internal-failure", severity: "error", message: "boom" },
    ],
  };
  const outcome = classifyFlashOutcome(parse(env));
  assert.equal(outcome.kind, "unknown");
  const text = describeFlashOutcome(outcome);
  assert.equal(text.severity, "warning");
  assert.doesNotMatch(text.message, /nothing was written/i);
  assert.match(text.message, /partly programmed|may/i);
});

test("an ok:false run with no entries at all is unknown, not refused", () => {
  const env = raw("dry-run.zephyr-west-flash");
  env.ok = false;
  env.exitCode = 1;
  env.data.entries = [];
  env.issues = [];
  assert.equal(classifyFlashOutcome(parse(env)).kind, "unknown");
});

test("internal-failure beside entries that wrote is still not 'refused'", () => {
  const env = raw("confirm.flow-d.atoc-unacknowledged");
  env.issues.push({
    code: "flash.internal-failure",
    severity: "error",
    message: "x",
  });
  assert.notEqual(classifyFlashOutcome(parse(env)).kind, "refused");
});

// ── S1 ─────────────────────────────────────────────────────────────────────

test("only an ERROR issue can tie an entry to a refusal; a warning/info with the same text cannot", () => {
  const env = raw("confirm.flow-d.setools-untrusted");
  const entry = env.data.entries[0];
  entry.method = "zephyr_west_flash";
  entry.message = "west flash: target lost during program";
  env.issues = [
    {
      code: "flash.probe-isolation-required",
      severity: "info",
      message: entry.message,
    },
    {
      code: "flash.device-config-mismatch",
      severity: "warning",
      message: entry.message,
    },
  ];
  assert.equal(classifyFlashOutcome(parse(env)).kind, "failed-during-write");
});

// ── M2 ─────────────────────────────────────────────────────────────────────

test("a Flow D entry that writes its OWN boot table without a tan-signed `atoc` block still counts", () => {
  const env = raw("dry-run.flow-d");
  const lead = env.data.entries[0];
  env.data.entries.push({
    kind: "slice",
    id: "m55_own",
    method: "alif_mram_jlink",
    methodDeclared: "zephyr_west_flash",
    status: "ok",
    rc: 0,
    message: `would run JLinkExe ... ${lead.message.slice(lead.message.indexOf("NOTE:"))}`,
  });
  const decision = decideFlashArming(parse(env), UNSCOPED);
  assert.equal(decision.kind, "refuse");
  assert.equal(decision.reason, "multiple-atocs");
});

test("a co-slice that merely quotes its lead's note is NOT a second boot table", () => {
  assert.equal(
    decideFlashArming(parse(raw("dry-run.flow-d")), UNSCOPED).kind,
    "arm-flow-d",
  );
});

// ── S2 ─────────────────────────────────────────────────────────────────────

test("the armed decision carries tan's probe-selection sentence verbatim", () => {
  const decision = decideFlashArming(parse(raw("dry-run.flow-d")), UNSCOPED);
  assert.equal(decision.kind, "arm-flow-d");
  assert.match(decision.probeSelection, /^\(probe selection: serial/);
  assert.doesNotMatch(decision.replacementNote, /probe selection/);
});

// ── S4: a noisy login profile ──────────────────────────────────────────────

test("leading profile noise before the JSON line does not blind the preview", () => {
  const compact = JSON.stringify(raw("dry-run.flow-d"));
  const noisy = `Welcome back!\nnvm: using node 20\n${compact}\n`;
  assert.notEqual(parseFlashEnvelope(noisy), null);
  assert.equal(parseFlashEnvelope(noisy).ok, true);
  // …and noise that is not followed by an envelope is still no envelope.
  assert.equal(parseFlashEnvelope("Welcome back!\n{not json}\n"), null);
});
