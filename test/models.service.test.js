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
  toModelRunResult,
  toModelAbResult,
  toZooData,
  toZooAddResult,
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

// The `data` block below is a REAL `tan model check --board board.yaml
// --format json` envelope, captured against a tiny int8 .tflite on
// E1M-AEN801 with metadata table
// metadata/npu_ops/ethos_u/u85@vela-5.1.0.json — not a hand-written
// approximation. It is the ADR-0028 vocabulary the boundary must carry
// through untouched: `npuCoverage`/`basis`/`confidence`/`computeOnNpuPctMax`
// /`npuPlacementPctReal`/`uncostedCpuOpCount`/`notes`/`ops[]`, and none of
// the retired `fits | cpu-fallback | no-fit` verdict field.
test("toModelFitData: ok envelope -> models + sku passthrough (ADR-0028 shape)", () => {
  const outcome = {
    exitCode: 0,
    message: "",
    envelope: {
      command: "model",
      ok: true,
      exitCode: 0,
      project: {},
      data: {
        schemaVersion: "1",
        sku: "E1M-AEN801",
        exact: false,
        models: [
          {
            name: "tiny",
            source: "/w/tiny_int8.tflite",
            backends: [
              {
                backend: "ethos_u",
                variant: "u85",
                table: "/sdk/metadata/npu_ops/ethos_u/u85@vela-5.1.0.json",
                npuCoverage: "full-eligible",
                computeOnNpuPctMax: 100.0,
                npuPlacementPctReal: null,
                uncostedCpuOpCount: 0,
                basis: "static-screen",
                confidence: "screening",
                notes: [
                  "static screen (screening): operator-name membership against u85@vela-5.1.0.json only.",
                ],
                ops: [
                  {
                    op: "FULLY_CONNECTED",
                    status: "npu-eligible",
                    reason: "constraint-unchecked",
                    macs: 8,
                  },
                ],
              },
            ],
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
  // The boundary is a passthrough: every field the webview's coverage.ts
  // narrows must survive it, or the panel silently renders less than tan said.
  const backend = msg.models[0].backends[0];
  assert.equal(backend.npuCoverage, "full-eligible");
  assert.equal(backend.basis, "static-screen");
  assert.equal(backend.confidence, "screening");
  assert.equal(backend.computeOnNpuPctMax, 100.0);
  assert.equal(backend.npuPlacementPctReal, null);
  assert.equal(backend.uncostedCpuOpCount, 0);
  assert.equal(backend.ops[0].status, "npu-eligible");
  assert.equal(backend.notes.length, 1);
});

// Semantics 1: `undetermined` is NOT `cpu-only`. Captured from a real run on
// E1M-V2M101 — DEEPX DX-M1 is that SKU's headline NPU and ships no op table
// BY DECISION, so it reports `undetermined` on every model. The boundary must
// carry that word through verbatim; a consumer that collapsed it to a
// negative would report a false "won't run" on the flagship part.
test("toModelFitData: `undetermined` survives the boundary verbatim (E1M-V2M101 / DEEPX)", () => {
  const outcome = {
    exitCode: 0,
    message: "",
    envelope: {
      command: "model",
      ok: true,
      exitCode: 0,
      project: {},
      data: {
        schemaVersion: "1",
        sku: "E1M-V2M101",
        exact: false,
        models: [
          {
            name: "tiny",
            source: "/w/tiny_int8.tflite",
            backends: [
              {
                backend: "deepx_dxm1",
                variant: null,
                table: null,
                npuCoverage: "undetermined",
                computeOnNpuPctMax: null,
                npuPlacementPctReal: null,
                uncostedCpuOpCount: 0,
                basis: "static-screen",
                confidence: "screening",
                notes: [
                  "deepx_dxm1 does not ingest 'tflite' source models; no score computed. This is not a verdict on the model, only on the format/backend pairing.",
                ],
                ops: [
                  {
                    op: "FULLY_CONNECTED",
                    status: "unknown",
                    reason: "format-not-accepted",
                    macs: 0,
                  },
                ],
              },
            ],
          },
        ],
      },
      issues: [],
    },
  };
  const msg = toModelFitData(outcome);
  assert.equal(msg.ok, true);
  assert.equal(msg.sku, "E1M-V2M101");
  const backend = msg.models[0].backends[0];
  assert.equal(backend.npuCoverage, "undetermined");
  assert.equal(backend.ops[0].status, "unknown");
  assert.equal(backend.ops[0].reason, "format-not-accepted");
});

// Semantics 3: only `basis: "compiled"` (or `"bench"`) may present a result as
// proven, and a compiled report is the ONLY place `npuCoverage: "fits"` can
// still appear. Both entries below are from one real `--exact` run against
// vela 5.1.0 on E1M-AEN801.
//
// The second entry is the trap: a real compile keeps the STATIC per-op
// verdicts, so `ops[0].status` reads `npu-eligible` while the compiler
// actually placed 0 % on the NPU. Any consumer that recomputes a coverage
// figure from `ops` on a compiled report contradicts the measured placement
// sitting next to it.
test("toModelFitData: compiled basis carries the real placement, not an op-derived one", () => {
  const outcome = {
    exitCode: 0,
    message: "",
    envelope: {
      command: "model",
      ok: true,
      exitCode: 0,
      project: {},
      data: {
        schemaVersion: "1",
        sku: "E1M-AEN801",
        exact: true,
        models: [
          {
            name: "person_detect",
            source: "/w/person_detect_int8.tflite",
            backends: [
              {
                backend: "ethos_u",
                variant: "u85",
                table: "/sdk/metadata/npu_ops/ethos_u/u85@vela-5.1.0.json",
                npuCoverage: "fits",
                computeOnNpuPctMax: null,
                npuPlacementPctReal: 100.0,
                uncostedCpuOpCount: 0,
                basis: "compiled",
                confidence: "certain",
                notes: [
                  "vela compiled for ethos-u85-256: 44/44 operators placed on the NPU (100%); arena 74480 bytes, SRAM 73 KiB.",
                ],
                ops: [],
              },
            ],
          },
          {
            name: "float_fc",
            source: "/w/float32_fc.tflite",
            backends: [
              {
                backend: "ethos_u",
                variant: "u85",
                table: "/sdk/metadata/npu_ops/ethos_u/u85@vela-5.1.0.json",
                npuCoverage: "cpu-only",
                computeOnNpuPctMax: null,
                npuPlacementPctReal: 0.0,
                uncostedCpuOpCount: 0,
                basis: "compiled",
                confidence: "certain",
                notes: [
                  "vela compiled for ethos-u85-256: 0/1 operators placed on the NPU (0%); arena 0 bytes, SRAM 0 KiB.",
                ],
                ops: [
                  {
                    op: "FULLY_CONNECTED",
                    status: "npu-eligible",
                    reason: "constraint-unchecked",
                    macs: 8,
                  },
                ],
              },
            ],
          },
        ],
      },
      issues: [],
    },
  };
  const msg = toModelFitData(outcome);
  assert.equal(msg.models.length, 2);
  const proven = msg.models[0].backends[0];
  assert.equal(proven.basis, "compiled");
  assert.equal(proven.confidence, "certain");
  assert.equal(proven.npuCoverage, "fits");
  assert.equal(proven.npuPlacementPctReal, 100.0);
  assert.equal(proven.computeOnNpuPctMax, null);
  const contradictory = msg.models[1].backends[0];
  assert.equal(contradictory.basis, "compiled");
  assert.equal(contradictory.npuCoverage, "cpu-only");
  assert.equal(contradictory.npuPlacementPctReal, 0.0);
  assert.equal(contradictory.ops[0].status, "npu-eligible");
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

test("toModelRunResult: ok -> run passthrough", () => {
  const outcome = {
    exitCode: 0,
    message: "",
    envelope: {
      command: "model",
      ok: true,
      exitCode: 0,
      project: {},
      data: {
        model: "m.onnx",
        backend: "cpu-host",
        latency_ms: 0.3,
        output_argmax: 5,
        peak_sram_kib: null,
        power_mj: null,
        runs: 5,
        random_input: true,
        note: "host reference",
      },
      issues: [],
    },
  };
  const msg = toModelRunResult(outcome);
  assert.equal(msg.ok, true);
  assert.equal(msg.run.backend, "cpu-host");
  assert.equal(msg.run.power_mj, null);
});

test("toModelRunResult: null envelope -> ok:false + real cause", () => {
  const msg = toModelRunResult({
    exitCode: -1,
    message: "tan binary not found",
    envelope: null,
  });
  assert.equal(msg.ok, false);
  assert.ok(msg.issues.some((i) => i.message.includes("tan binary not found")));
});

test("toModelAbResult: ok -> comparison passthrough", () => {
  const outcome = {
    exitCode: 0,
    message: "",
    envelope: {
      command: "model",
      ok: true,
      exitCode: 0,
      project: {},
      data: {
        a: { model: "a", backend: "cpu-host", latency_ms: 1 },
        b: { model: "b", backend: "cpu-host", latency_ms: 2 },
        comparison: {
          faster: "a",
          latency_ratio: 2,
          a_latency_ms: 1,
          b_latency_ms: 2,
          size_delta_bytes: 0,
        },
        note: "host reference",
      },
      issues: [],
    },
  };
  const msg = toModelAbResult(outcome);
  assert.equal(msg.ok, true);
  assert.equal(msg.ab.comparison.faster, "a");
});

test("toModelAbResult: !ok -> surfaces model.failed", () => {
  const msg = toModelAbResult({
    exitCode: 1,
    message: "x",
    envelope: {
      command: "model",
      ok: false,
      exitCode: 1,
      project: {},
      data: null,
      issues: [
        { code: "model.failed", severity: "error", message: "error: bad" },
      ],
    },
  });
  assert.equal(msg.ok, false);
  assert.ok(msg.issues.some((i) => i.code === "model.failed"));
});

test("toZooData: ok -> entries passthrough", () => {
  const outcome = {
    exitCode: 0,
    message: "",
    envelope: {
      command: "model",
      ok: true,
      exitCode: 0,
      project: {},
      data: {
        entries: [
          {
            id: "example-tiny",
            task: "example",
            description: "d",
            license: "Apache-2.0",
            validated_soms: ["E1M-AEN801"],
            runs_here: true,
          },
        ],
      },
      issues: [],
    },
  };
  const msg = toZooData(outcome);
  assert.equal(msg.ok, true);
  assert.equal(msg.entries.length, 1);
  assert.equal(msg.entries[0].runs_here, true);
});

test("toZooData: null envelope -> ok:false + real cause", () => {
  const msg = toZooData({
    exitCode: -1,
    message: "tan binary not found",
    envelope: null,
  });
  assert.equal(msg.ok, false);
  assert.equal(msg.entries.length, 0);
  assert.ok(msg.issues.some((i) => i.message.includes("tan binary not found")));
});

test("toZooAddResult: ok -> added passthrough", () => {
  const outcome = {
    exitCode: 0,
    message: "",
    envelope: {
      command: "model",
      ok: true,
      exitCode: 0,
      project: {},
      data: {
        added: "example-tiny",
        source: "models/example-tiny.tflite",
        from: "example-tiny",
      },
      issues: [],
    },
  };
  const msg = toZooAddResult(outcome);
  assert.equal(msg.ok, true);
  assert.equal(msg.added, "example-tiny");
});

test("toZooAddResult: !ok -> surfaces model.failed", () => {
  const msg = toZooAddResult({
    exitCode: 1,
    message: "x",
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
          message: "error: already has a model named X",
        },
      ],
    },
  });
  assert.equal(msg.ok, false);
  assert.ok(msg.issues.some((i) => i.code === "model.failed"));
});
