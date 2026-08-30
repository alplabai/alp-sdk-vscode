// SPDX-License-Identifier: Apache-2.0
//
// The old `fetchEnvelopeData` returned `outcome.envelope?.data` and nothing
// else, swallowing a non-ok result and any exception to `undefined` — so a
// caller could never tell "ok, empty" from "failed" from "ok, but tan
// flagged something in `issues[]`" (#611).
//
// `fetchEnvelopeResult` replaces it, keeping `data` alongside `ok` and
// `issues` so dropping them becomes a decision at the call site instead of
// the default. `fetchEnvelopeData` itself is DELETED, not kept as a
// wrapper: adversarial review (#611 follow-up) found it had zero production
// callers left once all three sites migrated, and this repo's no-legacy-
// compat rule says delete rather than keep a shim nothing calls.

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const Module = require("node:module");

const root = path.join(__dirname, "..");

function loadWithStubs(relPath, stubs) {
  const modPath = require.resolve(path.join(root, "out", relPath));
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

function loadEnvelope(runAlpCommand) {
  return loadWithStubs("alpCli/envelope.js", {
    vscode: {},
    "./vscodeAdapter": { runAlpCommand },
  });
}

test("fetchEnvelopeResult carries data, ok and issues through from a successful-with-warnings envelope", async () => {
  const { fetchEnvelopeResult } = loadEnvelope(async () => ({
    outcome: {
      envelope: {
        command: "presets",
        ok: true,
        exitCode: 0,
        data: { soms: [] },
        issues: [
          {
            code: "presets.sdk-root-unresolved",
            severity: "warning",
            message: "alp-sdk root is unresolved.",
          },
        ],
      },
    },
  }));

  const result = await fetchEnvelopeResult({}, ["presets"]);

  assert.deepEqual(result, {
    data: { soms: [] },
    ok: true,
    issues: [
      {
        code: "presets.sdk-root-unresolved",
        severity: "warning",
        message: "alp-sdk root is unresolved.",
      },
    ],
  });
});

test("fetchEnvelopeResult degrades to ok:false and no issues on a thrown exception", async () => {
  const { fetchEnvelopeResult } = loadEnvelope(async () => {
    throw new Error("spawn failed");
  });

  const result = await fetchEnvelopeResult({}, ["presets"]);

  assert.deepEqual(result, { data: undefined, ok: false, issues: [] });
});
