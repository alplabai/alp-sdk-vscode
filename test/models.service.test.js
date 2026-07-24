// SPDX-License-Identifier: Apache-2.0

const { test } = require("node:test");
const assert = require("node:assert");
// toModelsData is pure (no `vscode`) so it lives in service.js, not panel.js
// (panel.js pulls in `vscode`, which isn't resolvable outside a VS Code host —
// see src/models/service.ts's header comment). panel.ts re-exports it too.
const {
  toModelsData,
  cliFailureMessage,
  toModelFitData,
  toModelPrepResult,
} = require("../out/models/service.js");

function okOutcome(envelope) {
  return {
    exitCode: envelope.exitCode,
    kind: "success",
    ok: envelope.ok,
    severity: envelope.ok ? "info" : "error",
    message: envelope.ok ? "Command completed." : "Validation reported issues.",
    envelope,
  };
}

test("toModelsData merges list + doctor envelopes", () => {
  const listEnv = {
    command: "model",
    ok: true,
    exitCode: 0,
    project: { root: null, boardYaml: null },
    data: {
      models: [
        {
          name: "demo",
          source: "m.tflite",
          artifact: { exists: true, stale: false },
        },
      ],
    },
    issues: [],
  };
  const doctorEnv = {
    command: "model",
    ok: true,
    exitCode: 0,
    project: { root: null, boardYaml: null },
    data: { toolchains: [{ backend: "cpu", tool: "", available: true }] },
    issues: [],
  };
  const msg = toModelsData(okOutcome(listEnv), okOutcome(doctorEnv));
  assert.equal(msg.type, "modelsData");
  assert.equal(msg.ok, true);
  assert.equal(msg.models[0].name, "demo");
  assert.equal(msg.toolchains[0].backend, "cpu");
});

test("toModelsData: a genuinely old tan (ran, real exit code, no parseable envelope) surfaces 'update tan'", () => {
  // exitCode !== -1: the process actually ran and returned a real exit code
  // (e.g. clap's arg-parsing failure on an unrecognized `model` subcommand),
  // it just didn't print a parseable envelope — the old-tan case.
  const oldTanOutcome = {
    exitCode: 2,
    kind: "validation",
    ok: false,
    severity: "warning",
    message: "Validation reported issues.",
    envelope: null,
  };
  const msg = toModelsData(oldTanOutcome, oldTanOutcome);
  assert.equal(msg.ok, false);
  assert.ok(msg.issues.some((i) => i.code === "models.tan-outdated"));
  assert.ok(msg.issues.some((i) => /tan|model|update/i.test(i.message)));
  assert.deepEqual(msg.models, []);
});

test("toModelsData: a binary-missing/spawn failure (exitCode -1) surfaces outcome.message, NOT 'update tan'", () => {
  // exitCode === -1: the command never ran at all (binary unresolved, ENOENT,
  // or the spawn timeout) — outcome.message already carries the real cause.
  const missingBinaryOutcome = {
    exitCode: -1,
    kind: "unknown",
    ok: false,
    severity: "error",
    message: "tan CLI unavailable: ENOENT (no such file or directory)",
    envelope: null,
  };
  const okDoctor = okOutcome({
    command: "model",
    ok: true,
    exitCode: 0,
    project: { root: null, boardYaml: null },
    data: { toolchains: [] },
    issues: [],
  });
  const msg = toModelsData(missingBinaryOutcome, okDoctor);
  assert.equal(msg.ok, false);
  assert.ok(
    msg.issues.some((i) => i.message === missingBinaryOutcome.message),
    "the real spawn-failure message must be surfaced",
  );
  assert.ok(
    !msg.issues.some((i) => i.code === "models.tan-outdated"),
    "a binary-missing failure is not the old-tan case and must not say 'update tan'",
  );
  assert.deepEqual(msg.models, []);
});

test("cliFailureMessage: old-tan outcome (envelope null, real exit code) says 'update tan'", () => {
  const oldTanOutcome = {
    exitCode: 2,
    kind: "validation",
    ok: false,
    severity: "warning",
    message: "Validation reported issues.",
    envelope: null,
  };
  assert.match(cliFailureMessage(oldTanOutcome), /update tan/i);
});

test("cliFailureMessage: a real spawn/timeout outcome (exitCode -1) surfaces outcome.message", () => {
  const spawnFailureOutcome = {
    exitCode: -1,
    kind: "unknown",
    ok: false,
    severity: "error",
    message: "tan CLI unavailable: ENOENT (no such file or directory)",
    envelope: null,
  };
  assert.equal(
    cliFailureMessage(spawnFailureOutcome),
    spawnFailureOutcome.message,
  );
});

test("toModelFitData: ok envelope -> models + sku passthrough", () => {
  const outcome = {
    exitCode: 0,
    message: "",
    envelope: {
      command: "model",
      ok: true,
      exitCode: 0,
      project: {},
      data: {
        board: "board.yaml",
        sku: "E1M-AEN801",
        models: [
          {
            name: "tiny",
            source: "m.tflite",
            backends: [{ backend: "cpu", verdict: "fits" }],
            suggestion: null,
          },
        ],
      },
      issues: [],
    },
  };
  const msg = toModelFitData(outcome);
  assert.equal(msg.type, "modelFitData");
  assert.equal(msg.ok, true);
  assert.equal(msg.sku, "E1M-AEN801");
  assert.equal(msg.models.length, 1);
  assert.equal(msg.models[0].name, "tiny");
});

test("toModelFitData: null envelope -> ok:false + real cause (not 'update tan')", () => {
  const outcome = {
    exitCode: -1,
    message: "tan binary not found",
    envelope: null,
  };
  const msg = toModelFitData(outcome);
  assert.equal(msg.ok, false);
  assert.equal(msg.models.length, 0);
  assert.ok(msg.issues.some((i) => i.message.includes("tan binary not found")));
});

test("toModelFitData: !ok envelope -> ok:false, surfaces envelope issues", () => {
  const outcome = {
    exitCode: 1,
    message: "model failed",
    envelope: {
      command: "model",
      ok: false,
      exitCode: 1,
      project: {},
      data: null,
      issues: [
        {
          code: "model.failed",
          severity: "error",
          message: "error: static check supports .tflite",
        },
      ],
    },
  };
  const msg = toModelFitData(outcome);
  assert.equal(msg.ok, false);
  assert.ok(msg.issues.some((i) => i.code === "model.failed"));
});

test("toModelPrepResult: ok envelope -> quantized + accuracy passthrough", () => {
  const outcome = {
    exitCode: 0,
    message: "",
    envelope: {
      command: "model",
      ok: true,
      exitCode: 0,
      project: {},
      data: {
        raw: "m.onnx",
        quantized: "m.int8.onnx",
        accuracy: {
          samples: 8,
          top1_agreement_pct: 100.0,
          mean_cosine: 0.999,
          max_abs_err: 0.01,
          verdict: "good",
          guidance: null,
        },
      },
      issues: [],
    },
  };
  const msg = toModelPrepResult(outcome);
  assert.equal(msg.type, "modelPrepResult");
  assert.equal(msg.ok, true);
  assert.equal(msg.quantized, "m.int8.onnx");
  assert.equal(msg.accuracy.verdict, "good");
});

test("toModelPrepResult: null envelope -> ok:false + real cause", () => {
  const outcome = {
    exitCode: -1,
    message: "tan binary not found",
    envelope: null,
  };
  const msg = toModelPrepResult(outcome);
  assert.equal(msg.ok, false);
  assert.ok(msg.issues.some((i) => i.message.includes("tan binary not found")));
});

test("toModelPrepResult: !ok envelope -> ok:false, surfaces model.failed", () => {
  const outcome = {
    exitCode: 1,
    message: "prep failed",
    envelope: {
      command: "model",
      ok: false,
      exitCode: 1,
      project: {},
      data: null,
      issues: [
        {
          code: "model.failed",
          severity: "error",
          message: "error: calibration set has 2 samples",
        },
      ],
    },
  };
  const msg = toModelPrepResult(outcome);
  assert.equal(msg.ok, false);
  assert.ok(msg.issues.some((i) => i.code === "model.failed"));
});
