// SPDX-License-Identifier: Apache-2.0
//
// `src/alpCli/doctor.ts` — the ONE `tan doctor` spawn path shared by the
// Dependencies panel (`src/deps/vscodeAdapter.ts`) and the debug-doctor
// consumers (`src/debug/vscodeAdapter.ts`, #376). Extracted out of
// `src/deps/vscodeAdapter.ts`, where its behaviour used to be covered
// implicitly through `test/deps.adapter.test.js`; this file now covers it
// directly, at its own module boundary.
//
// Loaded through the same `Module._load` swap the other adapter tests use
// (test/deps.adapter.test.js), stubbing `./vscodeAdapter` so `runAlpCommand`
// never actually spawns anything.

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const Module = require("node:module");

const root = path.join(__dirname, "..");

function loadDoctor(stubs) {
  const modPath = require.resolve(
    path.join(root, "out", "alpCli", "doctor.js"),
  );
  delete require.cache[modPath];
  const originalLoad = Module._load;
  Module._load = function (request, ...rest) {
    return Object.prototype.hasOwnProperty.call(stubs, request)
      ? stubs[request]
      : originalLoad.call(this, request, ...rest);
  };
  try {
    return require(modPath);
  } finally {
    Module._load = originalLoad;
    delete require.cache[modPath];
  }
}

function loadWithFakeRun(runAlpCommand) {
  return loadDoctor({
    vscode: {},
    "./vscodeAdapter": { runAlpCommand },
    "../util": { log() {} },
  });
}

test("runDoctor passes args/cwd/signal/interactive through to runAlpCommand verbatim", async () => {
  const calls = [];
  const { runDoctor } = loadWithFakeRun(async (context, args, cwd, options) => {
    calls.push({ context, args, cwd, options });
    return {
      outcome: {
        ok: true,
        message: "ok",
        envelope: {
          ok: true,
          data: { checks: [], summary: { pass: 0, warn: 0, fail: 0 } },
        },
      },
    };
  });

  const signal = new AbortController().signal;
  await runDoctor(
    { marker: "ctx" },
    ["doctor"],
    "/home/dev/proj",
    signal,
    true,
  );

  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].context, { marker: "ctx" });
  assert.deepEqual(calls[0].args, ["doctor"]);
  assert.equal(calls[0].cwd, "/home/dev/proj");
  assert.equal(calls[0].options.signal, signal);
  assert.equal(calls[0].options.interactive, true);
});

test("a valid envelope's data reaches the caller verbatim, including an `unknown` status", async () => {
  const data = {
    checks: [
      { name: "sdk", status: "pass", detail: "alp-sdk v0.6.0" },
      {
        name: "codeLLDBExtension",
        status: "unknown",
        detail:
          "unknown — the standalone tan binary cannot see VS Code's installed extensions.",
      },
    ],
    summary: { pass: 1, warn: 0, fail: 0 },
  };
  const { runDoctor } = loadWithFakeRun(async () => ({
    outcome: { ok: true, message: "ok", envelope: { ok: true, data } },
  }));

  const result = await runDoctor({}, ["doctor"], "/w", undefined, false);

  assert.deepEqual(result.data, data);
  assert.equal(
    result.data.checks.find((c) => c.name === "codeLLDBExtension").status,
    "unknown",
    "an `unknown` status is passed through, never coerced or dropped",
  );
});

// #376 decision 9 / docs/CLI.md's exit-code contract: exit 4 is a FAILING
// DOCTOR REPORT, not a failed retrieval. `classifyOutcome` still attaches the
// parsed envelope on a nonzero exit, and this must read `data` off it exactly
// as it would on exit 0.
test("exit 4 (a failing doctor) still returns the report, not `data: null`", async () => {
  const data = {
    checks: [{ name: "ninja", status: "fail", detail: "ninja not found" }],
    summary: { pass: 0, warn: 0, fail: 1 },
  };
  const { runDoctor } = loadWithFakeRun(async () => ({
    outcome: {
      ok: false,
      exitCode: 4,
      severity: "warning",
      message: "doctor found problems",
      envelope: { ok: false, exitCode: 4, data },
    },
  }));

  const result = await runDoctor({}, ["doctor"], "/w", undefined, false);

  assert.notEqual(
    result.data,
    null,
    "exit 4 must not be treated as unavailable",
  );
  assert.deepEqual(result.data, data);
  assert.equal(result.data.checks[0].status, "fail");
});

test("no envelope at all (tan unresolvable / unparsable output) returns data: null with the outcome's message", async () => {
  const { runDoctor } = loadWithFakeRun(async () => ({
    outcome: {
      ok: false,
      message: "tan could not be resolved.",
      envelope: null,
    },
  }));

  const result = await runDoctor({}, ["doctor"], "/w", undefined, false);

  assert.equal(result.data, null);
  assert.equal(result.message, "tan could not be resolved.");
});

test("an envelope whose data does not shape-check as a doctor payload returns data: null", async () => {
  const { runDoctor } = loadWithFakeRun(async () => ({
    outcome: {
      ok: true,
      message: "Command completed.",
      envelope: { ok: true, data: { unrelated: true } },
    },
  }));

  const result = await runDoctor({}, ["doctor"], "/w", undefined, false);

  assert.equal(result.data, null);
});

test("isDoctorEnvelopeData accepts a well-shaped payload and rejects a malformed one", () => {
  const { isDoctorEnvelopeData } = loadDoctor({
    vscode: {},
    "./vscodeAdapter": {},
    "../util": { log() {} },
  });

  assert.equal(
    isDoctorEnvelopeData({
      checks: [{ name: "sdk", status: "pass", detail: "ok" }],
      summary: { pass: 1, warn: 0, fail: 0 },
    }),
    true,
  );
  assert.equal(isDoctorEnvelopeData(null), false);
  assert.equal(isDoctorEnvelopeData({ checks: [], summary: {} }), false);
  assert.equal(
    isDoctorEnvelopeData({
      checks: [{ name: "sdk" }],
      summary: { pass: 0, warn: 0, fail: 0 },
    }),
    false,
    "a check missing status/detail must not pass",
  );
});
