const test = require("node:test");
const assert = require("node:assert/strict");

const {
  createWestFlashPlan,
  createWestNativeRunPlan,
} = require("../packages/alp-core/dist/west/service.js");

function createWestContext(overrides = {}) {
  return {
    workspaceRoot: "/workspace/app",
    westCwd: "/workspace/app",
    sdkRoot: "/workspace/sdk",
    boardYamlPath: "/workspace/app/board.yaml",
    pythonBinary: "python3",
    ...overrides,
  };
}

test("createWestFlashPlan preserves cwd and uses an empty env without sdkRoot", () => {
  const plan = createWestFlashPlan(createWestContext({ sdkRoot: null }));

  assert.deepEqual(plan, {
    terminalName: "alp · west flash",
    command: "west flash",
    westCwd: "/workspace/app",
    env: {},
  });
});

test("createWestNativeRunPlan uses west build -t run", () => {
  const plan = createWestNativeRunPlan(createWestContext());

  assert.equal(plan.terminalName, "alp · west run");
  assert.equal(plan.command, "west build -t run");
  assert.deepEqual(plan.env, {
    EXTRA_ZEPHYR_MODULES: "/workspace/sdk",
  });
});
