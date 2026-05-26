const test = require("node:test");
const assert = require("node:assert/strict");
const {
  buildAlpWestTasks,
  createTasksJsonWritePlan,
} = require("@alp-sdk/core/west/tasksJsonCore");

const target = { board: "alp_e1m_evk_aen", example: "examples/blinky" };

test("buildAlpWestTasks produces build + flash tasks", () => {
  const tasks = buildAlpWestTasks(target);
  assert.equal(tasks.length, 2);

  const build = tasks.find((t) => t.label === "alp: west build");
  assert.equal(build.type, "shell");
  assert.equal(
    build.command,
    "alp generate --all && west build -b alp_e1m_evk_aen examples/blinky -p auto",
  );
  assert.deepEqual(build.problemMatcher, ["$alp-west"]);
  assert.deepEqual(build.group, { kind: "build", isDefault: true });

  const flash = tasks.find((t) => t.label === "alp: west flash");
  assert.equal(flash.command, "west flash");
  assert.equal(flash.problemMatcher, undefined);
});

test("createTasksJsonWritePlan creates a new document when none exists", () => {
  const plan = createTasksJsonWritePlan(null, buildAlpWestTasks(target));
  const doc = JSON.parse(plan.content);
  assert.equal(plan.replaced, false);
  assert.equal(doc.version, "2.0.0");
  assert.deepEqual(doc.tasks.map((t) => t.label), ["alp: west build", "alp: west flash"]);
});

test("createTasksJsonWritePlan replaces same-label tasks and preserves others", () => {
  const existing = JSON.stringify({
    version: "2.0.0",
    tasks: [
      { label: "alp: west build", type: "shell", command: "OLD" },
      { label: "my custom task", type: "shell", command: "echo hi" },
    ],
    inputs: [{ id: "x" }],
  });
  const plan = createTasksJsonWritePlan(existing, buildAlpWestTasks(target));
  const doc = JSON.parse(plan.content);
  assert.equal(plan.replaced, true);
  assert.ok(doc.tasks.some((t) => t.label === "my custom task"));
  assert.deepEqual(doc.inputs, [{ id: "x" }]);
  const builds = doc.tasks.filter((t) => t.label === "alp: west build");
  assert.equal(builds.length, 1);
  assert.notEqual(builds[0].command, "OLD");
});

test("createTasksJsonWritePlan throws on invalid JSON", () => {
  assert.throws(() => createTasksJsonWritePlan("{not json", buildAlpWestTasks(target)), /tasks\.json/);
});
