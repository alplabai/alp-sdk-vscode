const test = require("node:test");
const assert = require("node:assert/strict");

const {
  createLaunchJsonWritePlan,
} = require("../packages/alp-core/dist/debug/launchJsonCore.js");
const {
  createLaunchPreview,
} = require("../packages/alp-core/dist/debug/service.js");

function createConfiguration(name = "ALP: Zephyr Debug (J-Link)") {
  return {
    name,
    type: "cortex-debug",
    request: "launch",
    servertype: "jlink",
    executable: "${workspaceFolder}/build/app/zephyr/zephyr.elf",
  };
}

test("createLaunchJsonWritePlan creates a new launch.json content when none exists", () => {
  const plan = createLaunchJsonWritePlan(null, createConfiguration());
  const parsed = JSON.parse(plan.content);

  assert.equal(plan.replaced, false);
  assert.equal(parsed.version, "0.2.0");
  assert.equal(parsed.configurations.length, 1);
  assert.equal(parsed.configurations[0].name, "ALP: Zephyr Debug (J-Link)");
});

test("createLaunchJsonWritePlan replaces an existing configuration by name", () => {
  const existing = {
    version: "0.2.0",
    configurations: [
      createConfiguration("ALP: Zephyr Debug (J-Link)"),
      {
        name: "Unrelated Debug",
        type: "cppdbg",
        request: "launch",
      },
    ],
  };

  const updated = createConfiguration("ALP: Zephyr Debug (J-Link)");
  updated.interface = "swd";

  const plan = createLaunchJsonWritePlan(JSON.stringify(existing), updated);
  const parsed = JSON.parse(plan.content);

  assert.equal(plan.replaced, true);
  assert.equal(parsed.configurations.length, 2);
  assert.equal(parsed.configurations[0].interface, "swd");
  assert.equal(parsed.configurations[1].name, "Unrelated Debug");
});

test("createLaunchJsonWritePlan throws on invalid launch.json content", () => {
  assert.throws(
    () => createLaunchJsonWritePlan("{invalid", createConfiguration()),
    /not valid JSON/,
  );
});

test("createLaunchPreview output can be persisted into launch.json", () => {
  const preview = createLaunchPreview(
    "2026-05-14T00:00:00.000Z",
    "zephyr-mcu",
    "jlink",
  );

  const plan = createLaunchJsonWritePlan(
    null,
    preview.launch.configurations[0],
  );
  const parsed = JSON.parse(plan.content);

  assert.equal(parsed.configurations.length, 1);
  assert.equal(parsed.configurations[0].type, "cortex-debug");
  assert.match(parsed.configurations[0].name, /Zephyr Debug/);
});

test("createLaunchJsonWritePlan accepts JSONC comments and trailing commas", () => {
  const jsonc = [
    "{",
    "  // Use IntelliSense to learn about possible attributes.",
    '  "version": "0.2.0",',
    "  /* block comment */",
    '  "configurations": [',
    "    {",
    '      "name": "Unrelated Debug",',
    '      "type": "cppdbg",',
    '      "request": "launch",',
    "    },",
    "  ],",
    "}",
  ].join("\n");

  const plan = createLaunchJsonWritePlan(jsonc, createConfiguration());
  const parsed = JSON.parse(plan.content);

  assert.equal(plan.replaced, false);
  assert.equal(parsed.configurations.length, 2);
  assert.equal(parsed.configurations[0].name, "Unrelated Debug");
  assert.equal(parsed.configurations[1].name, "ALP: Zephyr Debug (J-Link)");
});

test("createLaunchJsonWritePlan preserves // sequences inside string values", () => {
  const existing = JSON.stringify({
    version: "0.2.0",
    configurations: [
      {
        name: "Web",
        type: "chrome",
        request: "launch",
        url: "http://localhost:3000",
      },
    ],
  });

  const plan = createLaunchJsonWritePlan(existing, createConfiguration());
  const parsed = JSON.parse(plan.content);

  assert.equal(parsed.configurations[0].url, "http://localhost:3000");
});
