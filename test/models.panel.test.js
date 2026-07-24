// SPDX-License-Identifier: Apache-2.0

const { test } = require("node:test");
const assert = require("node:assert");
// toModelsData is pure (no `vscode`) so it lives in service.js, not panel.js
// (panel.js pulls in `vscode`, which isn't resolvable outside a VS Code host —
// see src/models/service.ts's header comment). panel.ts re-exports it too.
const { toModelsData } = require("../out/models/service.js");

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
  const msg = toModelsData(listEnv, doctorEnv);
  assert.equal(msg.type, "modelsData");
  assert.equal(msg.ok, true);
  assert.equal(msg.models[0].name, "demo");
  assert.equal(msg.toolchains[0].backend, "cpu");
});

test("toModelsData surfaces a null/failed envelope as ok:false with an actionable issue", () => {
  const msg = toModelsData(null, null); // e.g. `tan` too old / no model command
  assert.equal(msg.ok, false);
  assert.ok(msg.issues.some((i) => /tan|model|update/i.test(i.message)));
  assert.deepEqual(msg.models, []);
});
