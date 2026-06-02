const test = require("node:test");
const assert = require("node:assert/strict");
const {
  planForHost,
  fixCommand,
} = require("@alp-sdk/core/toolchain/bootstrapPlan");

test("planForHost zephyr/win32 installs python deps + west", () => {
  const plan = planForHost("win32", "zephyr");
  assert.match(plan.title, /Zephyr/);
  assert.equal(plan.steps.length, 2);
  assert.match(plan.steps[0].command, /pip install --user pyyaml jsonschema/);
  assert.match(plan.steps[1].command, /pip install --user west/);
  assert.ok(plan.pointers.some((p) => /zephyr/i.test(p.url)));
});

test("planForHost yocto/linux uses apt; darwin warns linux-only", () => {
  assert.match(
    planForHost("linux", "yocto").steps[1].command,
    /apt-get install/,
  );
  assert.match(
    planForHost("darwin", "yocto").steps[1].description,
    /Linux-only/,
  );
});

test("planForHost baremetal lists vendor pointers", () => {
  const plan = planForHost("linux", "baremetal");
  assert.equal(plan.steps.length, 1);
  assert.ok(plan.pointers.some((p) => /alif|renesas|nxp/i.test(p.name)));
});

test("fixCommand maps fixIds to a command or pointer", () => {
  assert.equal(fixCommand("python-deps", "linux").kind, "command");
  assert.match(
    fixCommand("python-deps", "linux").step.command,
    /pyyaml jsonschema/,
  );
  assert.equal(fixCommand("west", "win32").kind, "command");
  assert.match(
    fixCommand("west", "win32").step.command,
    /pip install --user west/,
  );
  assert.equal(fixCommand("build-tools", "linux").kind, "pointer");
  assert.equal(fixCommand("zephyr-sdk", "linux").kind, "pointer");
});
