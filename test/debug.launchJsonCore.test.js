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

test("createLaunchJsonWritePlan merges into an existing configuration by name", () => {
  const existing = {
    version: "0.2.0",
    configurations: [
      {
        ...createConfiguration("ALP: Zephyr Debug (J-Link)"),
        // A key we never write. It has to come through the merge untouched --
        // the whole-entry replacement this used to do dropped it silently.
        serverArgs: ["-select", "usb=000440123456"],
      },
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
  assert.deepEqual(parsed.configurations[0].serverArgs, [
    "-select",
    "usb=000440123456",
  ]);
  assert.equal(parsed.configurations[1].name, "Unrelated Debug");
});

// The customer story this whole merge exists for. Every debug command rewrites
// launch.json before the session starts, and the configuration names are fixed
// per target/server, so this entry is rewritten on EVERY F5. Wholesale
// replacement therefore reset `"device": "AE822F4M55_HP"` -- a value the
// extension had just told the customer to go and type -- back to
// `"<resolved-device>"`, with no confirm, no backup and no way out of the loop.
test("a hand-filled device survives the next write while stale fields refresh", () => {
  const zephyr = createLaunchPreview(
    "2026-05-14T00:00:00.000Z",
    "zephyr-mcu",
    "jlink",
  ).launch.configurations[0];
  const native = createLaunchPreview(
    "2026-05-14T00:00:00.000Z",
    "native-host",
    "none",
  ).launch.configurations[0];

  // The draft really does carry the placeholder; that is what makes the merge
  // rule load-bearing rather than decorative.
  assert.equal(zephyr.device, "<resolved-device>");

  const existing = JSON.stringify({
    version: "0.2.0",
    configurations: [
      {
        ...zephyr,
        device: "AE822F4M55_HP",
        executable: "${workspaceFolder}/build/stale/zephyr/zephyr.elf",
        preLaunchTask: "west build",
      },
      // The entry the `codelldb` bug wrote before it was fixed. A repair has to
      // still land on an existing file, or the fix only reaches new projects.
      { ...native, type: "codelldb" },
    ],
  });

  const afterZephyr = JSON.parse(
    createLaunchJsonWritePlan(existing, zephyr).content,
  );
  const entry = afterZephyr.configurations[0];

  assert.equal(entry.device, "AE822F4M55_HP");
  assert.equal(entry.executable, zephyr.executable);
  assert.equal(entry.type, "cortex-debug");
  assert.equal(entry.preLaunchTask, "west build");
  // A write aimed at one name leaves every other entry alone.
  assert.equal(afterZephyr.configurations[1].type, "codelldb");

  const afterNative = JSON.parse(
    createLaunchJsonWritePlan(existing, native).content,
  );
  assert.equal(afterNative.configurations[1].type, "lldb");
  assert.equal(afterNative.configurations[0].device, "AE822F4M55_HP");
});

test("an all-placeholder configFiles list never eats a hand-added .cfg", () => {
  const draft = createLaunchPreview(
    "2026-05-14T00:00:00.000Z",
    "zephyr-mcu",
    "openocd",
  ).launch.configurations[0];
  assert.deepEqual(draft.configFiles, ["<resolved-openocd-board-cfg>"]);

  // OpenOCD sessions normally need an interface .cfg AND a target .cfg, so the
  // customer's list is longer than our one-element draft. Merging per index
  // would keep entry 0 and drop the target file with it.
  const existing = JSON.stringify({
    version: "0.2.0",
    configurations: [
      {
        ...draft,
        configFiles: ["interface/jlink.cfg", "target/alif_e8.cfg"],
      },
    ],
  });

  const config = JSON.parse(createLaunchJsonWritePlan(existing, draft).content)
    .configurations[0];
  assert.deepEqual(config.configFiles, [
    "interface/jlink.cfg",
    "target/alif_e8.cfg",
  ]);
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
