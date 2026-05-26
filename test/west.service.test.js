const test = require("node:test");
const assert = require("node:assert/strict");

const {
  createWestBuildPreparation,
  createWestBuildPlan,
  createWestFlashPlan,
  createWestNativeRunPlan,
} = require("@alp-sdk/core/west/service");

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
    kind: "build",
  });
});

test("createWestFlashPlan preserves cwd and uses an empty env without sdkRoot", () => {
  const plan = createWestFlashPlan(createWestContext({ sdkRoot: null }));

  assert.deepEqual(plan, {
    terminalName: "alp · west flash",
    command: "west flash",
    westCwd: "/workspace/app",
    env: {},
    kind: "flash",
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

test("createWestBuildPreparation creates validator + generation plans", () => {
  const preparation = createWestBuildPreparation(createWestContext(), {
    board: "alp_e1m_evk_aen",
    example: "examples/gpio-button-led",
  });

  assert.equal(
    preparation.validatorPlan.inputPath,
    "/workspace/app/board.yaml",
  );
  assert.equal(preparation.loaderPlans.length, 4);
  assert.equal(
    preparation.westPlan.command,
    "west build -b alp_e1m_evk_aen examples/gpio-button-led -p auto",
  );
});

test("createWestBuildPreparation fails when board.yaml path is unresolved", () => {
  assert.throws(
    () =>
      createWestBuildPreparation(createWestContext({ boardYamlPath: null }), {
        board: "alp_e1m_evk_aen",
        example: "examples/gpio-button-led",
      }),
    /board.yaml path is unresolved/,
  );
});
