// SPDX-License-Identifier: Apache-2.0
//
// Pins the four `preLaunchTask` strings tan-cli's debug_launch.rs writes
// verbatim (crates/tan-core/src/debug_launch.rs:49,62,75,93,107,115; also
// docs/DEBUG.md §10.1-10.5) against what src/tasks/service.ts actually
// produces. This is the whole point of that file: VS Code renders a provided
// task's label as `${source}: ${name}`, so a rename on either side of this
// contract breaks `preLaunchTask` resolution silently at debug time (PR
// #342) — this test fails loudly instead, at build time.

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  TASK_SOURCE,
  TASK_SPECS,
  taskLabel,
} = require("../out/tasks/service.js");

// Verbatim. Order carries no meaning — every comparison below sorts both
// sides; only the SET of labels is the contract.
const EXPECTED_LABELS = [
  "alp: build active target", // zephyr-mcu, all three servers
  "alp: build baremetal target", // baremetal-mcu
  "alp: deploy and start gdbserver", // yocto-userspace
  "alp: build native_sim target", // native-host
];

test("TASK_SOURCE is the lowercase source tan's preLaunchTask strings expect", () => {
  assert.equal(TASK_SOURCE, "alp");
});

test("every contributed task label is byte-identical to a tan preLaunchTask string", () => {
  const produced = TASK_SPECS.map(taskLabel).slice().sort();
  assert.deepEqual(produced, EXPECTED_LABELS.slice().sort());
});

test("the three build-task labels are exactly the three tan build-target names", () => {
  const buildLabels = TASK_SPECS.filter((spec) => spec.kind === "build")
    .map(taskLabel)
    .sort();
  assert.deepEqual(buildLabels, [
    "alp: build active target",
    "alp: build baremetal target",
    "alp: build native_sim target",
  ]);
});

test("deploy-gdbserver has no tan equivalent and gets its own kind", () => {
  const deploy = TASK_SPECS.filter((spec) => spec.kind === "deployGdbserver");
  assert.equal(deploy.length, 1);
  assert.equal(taskLabel(deploy[0]), "alp: deploy and start gdbserver");
});

// The manifest half of the same contract. A provider whose tasks nobody can
// fetch contributes nothing: VS Code needs BOTH a `taskDefinitions` entry for
// the type and an activation event that gets the extension loaded when a task
// of that type is wanted — otherwise `preLaunchTask` resolution finds no
// provider and Debug aborts exactly as it did before this provider existed.
// (`src/tasks/vscodeAdapter.ts`'s registered type is proven to match only in
// the extension-host run, `test/e2e/suite/index.js` — `node --test` cannot
// import a file that imports `vscode`.)
test("package.json contributes the alp task type and its activation event", () => {
  const manifest = JSON.parse(
    require("node:fs").readFileSync(
      require("node:path").resolve(__dirname, "../package.json"),
      "utf8",
    ),
  );
  const types = (manifest.contributes.taskDefinitions || []).map((d) => d.type);
  assert.ok(
    types.includes(TASK_SOURCE),
    `taskDefinitions has no "${TASK_SOURCE}" type: ${types.join(", ")}`,
  );
  assert.ok(
    manifest.activationEvents.includes(`onTaskType:${TASK_SOURCE}`),
    `activationEvents has no onTaskType:${TASK_SOURCE}`,
  );
});
