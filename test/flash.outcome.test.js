// SPDX-License-Identifier: Apache-2.0
//
// What a finished `tan flash` run MEANS, read from its JSON envelope and not
// from its exit code (#540). The exit code cannot tell these five apart:
//
//   previewed, not written   exits 1 (every entry planned) or 0 (a mixed run)
//   refused before writing   exits 1
//   failed during the write  exits 1
//
// The envelopes are real tan 0.7.0 captures (test/fixtures/tan-flash/
// PROVENANCE.md). Cases the captures cannot cover without silicon — a clean
// write, a mixed run — are built from a capture with one field changed, and
// each such test says so.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const {
  parseFlashEnvelope,
} = require("../packages/alp-core/dist/flash/envelope.js");
const {
  classifyFlashOutcome,
  describeFlashOutcome,
} = require("../packages/alp-core/dist/flash/outcome.js");

const FIXTURES = path.join(__dirname, "fixtures", "tan-flash");
const raw = (name) =>
  JSON.parse(
    fs.readFileSync(
      path.join(FIXTURES, `tan-flash.v0.7.0.${name}.json`),
      "utf8",
    ),
  );
const parse = (obj) => parseFlashEnvelope(JSON.stringify(obj));
const load = (name) => parse(raw(name));

test("every entry planned (exit 1): previewed, nothing written", () => {
  for (const name of ["unconfirmed.flow-d", "unconfirmed.mixed-yocto-flow-d"]) {
    const outcome = classifyFlashOutcome(load(name));
    assert.equal(outcome.kind, "previewed", name);
    assert.deepEqual(outcome.written, [], name);
    const text = describeFlashOutcome(outcome);
    assert.equal(text.severity, "info");
    assert.match(text.message, /nothing was written/i);
  }
});

test("a MIXED run that exits 0 is still a preview for the planned entries", () => {
  // Built, not captured: one entry of a real all-planned capture is flipped to
  // `ok` and the run to exit 0, which is the shape tan 0.7.0 documents for a
  // mixed run (a per-entry `flash.confirm-required` warning, exit 0).
  const env = raw("unconfirmed.mixed-yocto-flow-d");
  env.data.entries.find((e) => e.id === "a32_cluster").status = "ok";
  env.issues = env.issues.filter((i) => i.code !== "flash.nothing-flashed");
  env.ok = true;
  env.exitCode = 0;
  const outcome = classifyFlashOutcome(parse(env));
  assert.equal(outcome.kind, "previewed");
  assert.deepEqual(outcome.written, ["a32_cluster"]);
  assert.deepEqual(outcome.previewedOnly, ["m55_he", "m55_hp"]);
  const text = describeFlashOutcome(outcome);
  assert.match(text.message, /a32_cluster/);
  assert.match(text.message, /m55_he/);
  // A partial write is a warning, not a green toast.
  assert.equal(text.severity, "warning");
});

test("a refusal tan raised before writing is refused, with its code", () => {
  const ack = classifyFlashOutcome(load("confirm.flow-d.atoc-unacknowledged"));
  assert.equal(ack.kind, "refused");
  assert.ok(ack.codes.includes("flash.atoc-replacement-unacknowledged"));

  const untrusted = classifyFlashOutcome(
    load("confirm.flow-d.setools-untrusted"),
  );
  assert.equal(untrusted.kind, "refused");
  assert.ok(untrusted.codes.includes("flash.setools-untrusted-source"));

  const text = describeFlashOutcome(ack);
  assert.equal(text.severity, "warning");
  assert.match(text.message, /nothing was written/i);
  // tan's own reason is carried for the log, not paraphrased.
  assert.match(text.detail, /REPLACES the ENTIRE ATOC/);
});

test("a Flow D entry that failed without ever opening a write session is refused, not partly written", () => {
  // Built from the write-failed capture with the write-session evidence
  // removed: this is the DPIDR / probe-preflight shape (`flash.entry-failed`
  // with no transcript), which refuses before the first byte.
  const env = raw("confirm.flow-d.write-failed");
  for (const entry of env.data.entries) {
    if (entry.jlink) {
      delete entry.jlink.transcriptPath;
      delete entry.jlink.transcriptTail;
    }
  }
  const outcome = classifyFlashOutcome(parse(env));
  assert.equal(outcome.kind, "refused");
});

test("a Flow D write that started and failed carries the partial-write warning", () => {
  const outcome = classifyFlashOutcome(load("confirm.flow-d.write-failed"));
  assert.equal(outcome.kind, "failed-during-write");
  const text = describeFlashOutcome(outcome);
  assert.equal(text.severity, "error");
  assert.match(text.message, /partly|part-way|partially/i);
  assert.match(text.message, /before (re-)?flashing|re-flash/i);
});

test("an entry that wrote, beside one that failed, is a partial write whatever the failure was", () => {
  const env = raw("dry-run.mixed-yocto-flow-d");
  env.data.entries.find((e) => e.id === "m55_he").status = "failed";
  env.ok = false;
  env.exitCode = 1;
  assert.equal(classifyFlashOutcome(parse(env)).kind, "failed-during-write");
});

test("all entries ok is written; a reset J-Link could not confirm is info only", () => {
  // Built from a dry-run capture: its `ok` entries have the shape of a real
  // one, and a clean write cannot be captured without silicon.
  const env = raw("dry-run.zephyr-west-flash");
  const clean = classifyFlashOutcome(parse(env));
  assert.equal(clean.kind, "written");
  assert.deepEqual(clean.written, ["m33"]);
  assert.equal(describeFlashOutcome(clean).severity, "info");

  env.issues.push({
    code: "flash.jlink-reset-unconfirmed",
    severity: "warning",
    message: "m33: J-Link did not confirm the reset",
  });
  const reset = classifyFlashOutcome(parse(env));
  assert.equal(reset.kind, "written");
  assert.equal(reset.resetUnconfirmed, true);
  const text = describeFlashOutcome(reset);
  assert.equal(text.severity, "info");
  assert.match(text.detail, /reset/i);
});

test("no envelope at all: the state is unknown, and the words say so", () => {
  const outcome = classifyFlashOutcome(null);
  assert.equal(outcome.kind, "unknown");
  const text = describeFlashOutcome(outcome);
  assert.equal(text.severity, "warning");
  assert.match(text.message, /does not say whether any slice was written/i);
});
