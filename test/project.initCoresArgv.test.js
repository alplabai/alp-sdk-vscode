// SPDX-License-Identifier: Apache-2.0
//
// The New Project flow must send `planInitCores`' output to `tan init --cores`,
// not the SoM's declared topology (#528).
//
// There was NO gate on this argument at all before — which is how a flow that
// fails on six of eleven SoMs, including the entire Alif Ensemble line, shipped
// and stayed shipped. `test/project.initCores.test.js` pins the filter itself;
// without this file the filter could sit in core, fully green, while the panel
// went on building the argument by hand.
//
// SPLIT, and the split is the point.
//
// The argv used to be assembled inside a private method of
// `NewProjectFlowPanel`, whose constructor builds a live webview, so this file
// could only reach it with REGEXES OVER THE SOURCE TEXT. A regex gate checks
// the spelling of one branch; it cannot check what the other branches produce,
// and it goes green the moment the code is reformatted around it.
//
// The assembly now lives in `packages/alp-core/src/project/initArgv.ts` as a
// pure function, so the BEHAVIOUR is checked by calling it —
// `test/wizard.initArgv.test.js` enumerates every branch against the pinned
// tan's recorded surface, and the three argv assertions that used to be regexes
// here are gone with it.
//
// What is left here is genuinely source-level and stays that way: the WIRING
// (the panel must call the shared planner, not re-derive one) and the NOTICE
// (a toast, not a status-bar line), both of which live in that un-instantiable
// panel.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const SOURCE = fs.readFileSync(
  path.join(__dirname, "..", "src", "ideHub", "newProjectFlowPanel.ts"),
  "utf8",
);

test("the panel builds its init argv with the shared planner", () => {
  // Arrange / Act / Assert
  assert.match(
    SOURCE,
    /import \{ planInitArgv \} from "@alp-sdk\/core\/project\/initArgv"/,
    "the panel must use the shared planner, not assemble argv locally",
  );
  assert.match(
    SOURCE,
    /planInitArgv\(\{/,
    "planInitArgv must actually be called",
  );
  // The SoM's declared cores must REACH it. `planInitArgv` filters them through
  // `planInitCores` itself; a panel that stopped passing them would send no
  // `--cores` at all, which scaffolds a heterogeneous SoM as if it were
  // single-core and is exactly as wrong as sending the wrong value.
  assert.match(
    SOURCE,
    /cores: this\.somModules\.find\(\(m\) => m\.id === moduleId\)\?\.cores \?\? \[\]/,
    "the SoM's declared cores must be handed to the planner",
  );
});

test("the panel never assembles init argv of its own", () => {
  // The failure this exists for: someone appends one more flag at the call site
  // instead of in the planner. A flag pushed onto the argv here is a flag
  // `test/wizard.initArgv.test.js` cannot enumerate and the static gate cannot
  // read — it is unchecked by construction, which is the state this whole
  // change removed.
  assert.doesNotMatch(
    SOURCE,
    /initArgs\.push\(/,
    "add the flag to planInitArgv in core, where the gate can enumerate it",
  );
});

test("a SoM with more than one Zephyr core is reported, not silently downgraded", () => {
  // Arrange -- exactly one Zephyr core gets the app; the rest are absent from
  // the generated board.yaml. A dual-M55 customer handed a single-core project
  // with no notice is the failure this half exists to prevent.
  assert.match(SOURCE, /unscaffolded\.length > 1/);
  assert.match(
    SOURCE,
    /multicore\/mproc-mailbox/,
    "the notice must name the example that DOES scaffold two Zephyr cores",
  );
  // A bare `planSuccess` with no actions is a transient status-bar line, and
  // its `detail` never leaves the output channel — the fact would not reach
  // the screen at all.
  assert.match(
    SOURCE,
    /planSuccess\(\s*`Project "\$\{projectName\}" created with one Zephyr core[\s\S]*?actions: \[\{ id: "showOutput" \}\]/,
    "the notice must be a toast, not the default statusBar plan",
  );
});
