// SPDX-License-Identifier: Apache-2.0

const test = require("node:test");
const assert = require("node:assert");
const {
  envReadinessPresentation,
} = require("../packages/alp-core/dist/statusReadiness/service.js");

const base = {
  sdk: {
    activePath: "/x",
    version: "0.6.0",
    readiness: "ready",
    localEntries: [],
  },
  setup: {
    pythonAvailable: true,
    westAvailable: true,
    lastBootstrapAt: null,
    toolVersions: {
      python: "3.12",
      west: "1.2",
      tan: "0.1.0",
      cmake: null,
      ninja: null,
    },
  },
  workspace: {
    workspaceRoot: "/w",
    boardYamlExists: true,
    westInitialized: true,
  },
};

test("all ready → check + full tooltip", () => {
  const p = envReadinessPresentation(base);
  assert.strictEqual(p.ready, true);
  assert.match(p.text, /Alp/);
  assert.match(p.tooltip, /tan 0\.1\.0/);
  assert.match(p.tooltip, /Alp SDK v0\.6\.0/);
});

test("missing west → not ready + warning", () => {
  const s = JSON.parse(JSON.stringify(base));
  s.setup.westAvailable = false;
  s.setup.toolVersions.west = null;
  const p = envReadinessPresentation(s);
  assert.strictEqual(p.ready, false);
  assert.match(p.text, /setup/i);
  assert.match(p.tooltip, /west .*(not found|—)/i);
});

test("tan absent → managed marker, still not gating", () => {
  const s = JSON.parse(JSON.stringify(base));
  s.setup.toolVersions.tan = null;
  const p = envReadinessPresentation(s);
  assert.strictEqual(p.ready, true); // tan does not gate
  assert.match(p.tooltip, /tan managed/i);
});
