const test = require("node:test");
const assert = require("node:assert/strict");
const { analyzeToolchain } = require("@alp-sdk/core/toolchain/doctor");

function allPresent() {
  return {
    tools: {
      python: { present: true, detail: "Python 3.11.0" },
      west: { present: true, detail: "v1.2" },
      cmake: { present: true }, ninja: { present: true },
      dtc: { present: true }, gdb: { present: true }, alp: { present: true },
    },
    pythonDeps: { pyyaml: true, jsonschema: true },
    env: { zephyrSdkDir: "/opt/zephyr-sdk", zephyrBase: "/z" },
    sdkConnected: true,
  };
}

test("all present → ok, zero missing required", () => {
  const r = analyzeToolchain(allPresent());
  assert.equal(r.ok, true);
  assert.equal(r.missingRequired, 0);
  assert.ok(r.checks.every((c) => c.status === "ok"));
});

test("missing required tool (cmake) → missing + fixId, not ok", () => {
  const inputs = allPresent();
  inputs.tools.cmake = { present: false };
  const r = analyzeToolchain(inputs);
  const cmake = r.checks.find((c) => c.id === "cmake");
  assert.equal(cmake.status, "missing");
  assert.equal(cmake.required, true);
  assert.equal(cmake.fixId, "build-tools");
  assert.equal(r.ok, false);
  assert.equal(r.missingRequired, 1);
});

test("missing recommended (alp CLI) → warn, still ok", () => {
  const inputs = allPresent();
  inputs.tools.alp = { present: false };
  const r = analyzeToolchain(inputs);
  const alp = r.checks.find((c) => c.id === "alp");
  assert.equal(alp.status, "warn");
  assert.equal(alp.required, false);
  assert.equal(r.ok, true);
});

test("missing python deps → missing with python-deps fixId", () => {
  const inputs = allPresent();
  inputs.pythonDeps = { pyyaml: true, jsonschema: false };
  const r = analyzeToolchain(inputs);
  const deps = r.checks.find((c) => c.id === "python-deps");
  assert.equal(deps.status, "missing");
  assert.equal(deps.fixId, "python-deps");
  assert.match(deps.detail, /jsonschema/);
});

test("missing zephyr sdk env → missing with zephyr-sdk fixId", () => {
  const inputs = allPresent();
  inputs.env = {};
  const r = analyzeToolchain(inputs);
  assert.equal(r.checks.find((c) => c.id === "zephyr-sdk").fixId, "zephyr-sdk");
  assert.equal(r.checks.find((c) => c.id === "zephyr-base").status, "warn");
});
