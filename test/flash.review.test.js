// SPDX-License-Identifier: Apache-2.0
//
// Regression cases from the adversarial review of #540's arming change. Each
// one is a way the first cut could have told a customer "nothing was written"
// or armed a write the modal did not describe. Real tan 0.7.0 captures
// (test/fixtures/tan-flash/), mutated by one field where a case cannot be
// captured without silicon.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

const {
  parseFlashEnvelope,
  classifyBackend,
} = require("../packages/alp-core/dist/flash/envelope.js");
const {
  decideFlashArming,
} = require("../packages/alp-core/dist/flash/arming.js");
const {
  classifyFlashOutcome,
  describeFlashOutcome,
} = require("../packages/alp-core/dist/flash/outcome.js");
const { readFlashArgv } = require("../packages/alp-core/dist/flash/argv.js");
const { posixLoginShellCommand } = require("../out/alpCli/service.js");

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

// ── 1, 12: outcome attribution ─────────────────────────────────────────────

test("a refusal is attributed to ITS entry: a Flow D refusal beside a west entry that died is a partial write", () => {
  const env = raw("confirm.flow-d.atoc-unacknowledged");
  env.data.entries.push({
    kind: "slice",
    id: "cm",
    method: "baremetal_cmake_flash",
    status: "failed",
    rc: 1,
    message: "cmake --build flash: target dropped mid-program",
  });
  assert.equal(classifyFlashOutcome(parse(env)).kind, "failed-during-write");
});

test("a non-Flow-D failure with no per-entry refusal is 'may have written', whatever codes the run carries", () => {
  const env = raw("confirm.flow-d.setools-untrusted");
  env.data.entries[0].method = "zephyr_west_flash";
  env.data.entries[0].message = "west flash: target lost during program";
  assert.equal(classifyFlashOutcome(parse(env)).kind, "failed-during-write");
});

test("a refusal that IS tied to its entry (and the co-slice that quotes it) stays 'refused'", () => {
  for (const name of [
    "confirm.flow-d.atoc-unacknowledged",
    "confirm.flow-d.setools-untrusted",
  ]) {
    assert.equal(classifyFlashOutcome(parse(raw(name))).kind, "refused", name);
  }
});

test("ok:false with error issues is never reported as a clean write", () => {
  const env = raw("dry-run.zephyr-west-flash");
  env.ok = false;
  env.exitCode = 1;
  env.issues.push({
    code: "flash.entry-failed",
    severity: "error",
    message: "x",
  });
  const outcome = classifyFlashOutcome(parse(env));
  assert.notEqual(outcome.kind, "written");
  assert.notEqual(describeFlashOutcome(outcome).severity, "info");
});

// ── 3, 4: arming ───────────────────────────────────────────────────────────

test("the writes-unasked class is an allow-list: anything else is unknown and refuses", () => {
  assert.equal(classifyBackend("swd_probe"), "unknown");
  assert.equal(classifyBackend("some_future_backend"), "unknown");
  assert.equal(classifyBackend(null), "unknown");

  const env = raw("dry-run.zephyr-west-flash");
  env.data.entries[0].method = "swd_probe";
  const decision = decideFlashArming(parse(env), UNSCOPED);
  assert.equal(decision.kind, "refuse");
  assert.equal(decision.reason, "unknown-backend");

  const nullMethod = raw("dry-run.zephyr-west-flash");
  delete nullMethod.data.entries[0].method;
  assert.equal(
    decideFlashArming(parse(nullMethod), UNSCOPED).reason,
    "unknown-backend",
  );
});

test("two Flow D entries each carrying their own ATOC are refused: one modal cannot cover two replacements", () => {
  const env = raw("dry-run.flow-d");
  const second = JSON.parse(JSON.stringify(env.data.entries[0]));
  second.id = "m55_x";
  env.data.entries.push(second);
  const decision = decideFlashArming(parse(env), UNSCOPED);
  assert.equal(decision.kind, "refuse");
  assert.equal(decision.reason, "multiple-atocs");
});

// ── 5: the scrub works in every login shell ────────────────────────────────

test("posixLoginShellCommand scrubs through `env -u`, which every login shell can run", () => {
  const command = posixLoginShellCommand("/usr/bin/env", [], undefined, [
    "ALP_FLASH_FORCE",
  ]);
  assert.equal(command, "exec env -u ALP_FLASH_FORCE '/usr/bin/env'");
  assert.doesNotMatch(command, /\bunset\b/, "fish has no `unset`");
  // Executed, not just compared: `env -u` must exist on this host's env.
  const out = execFileSync("/bin/sh", ["-c", command], {
    env: { PATH: process.env.PATH, ALP_FLASH_FORCE: "1", KEEP: "x" },
    encoding: "utf8",
  });
  assert.doesNotMatch(out, /ALP_FLASH_FORCE/);
  assert.match(out, /KEEP=x/);
  assert.throws(
    () => posixLoginShellCommand("/opt/tan", [], undefined, ["X; rm"]),
    /not an environment variable name/,
  );
});

// ── 8: flags Alp does not model ────────────────────────────────────────────

test("flags Alp does not model are surfaced by the argv reader", () => {
  for (const flag of [
    "--raw",
    "--ram",
    "--ram-console",
    "--replace-atoc",
    "--no-reset",
    "--watch",
    "--wait",
    "--readback",
    "--assume-he",
    "--no-device-config",
  ]) {
    assert.ok(
      readFlashArgv(["flash", flag, "x"]).unmodelledFlags.includes(flag),
      flag,
    );
  }
  assert.deepEqual(
    readFlashArgv(["flash", "--core", "m55_hp"]).unmodelledFlags,
    [],
  );
});
