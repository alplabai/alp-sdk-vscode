const test = require("node:test");
const assert = require("node:assert/strict");

const {
  createWestBuildPlan,
  createWestFlashPlan,
  createWestNativeRunPlan,
} = require("../out/west/service.js");

function createWestContext(overrides = {}) {
  return {
    westCwd: "/workspace/app",
    sdkRoot: "/workspace/sdk",
    ...overrides,
  };
}

test("createWestBuildPlan builds the expected west command", () => {
  const plan = createWestBuildPlan(createWestContext(), {
    board: "alp_e1m_evk_aen",
    example: "examples/gpio-button-led",
  });

  assert.deepEqual(plan, {
    terminalName: "alp · west build",
    command: "west build -b alp_e1m_evk_aen examples/gpio-button-led -p auto",
    westCwd: "/workspace/app",
    env: {
      EXTRA_ZEPHYR_MODULES: "/workspace/sdk",
    },
  });
});

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
