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
// SOURCE-LEVEL on purpose: the argument is assembled inside a private method of
// `NewProjectFlowPanel`, whose constructor builds a live webview. Instantiating
// it would test the webview harness rather than the argv.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const SOURCE = fs.readFileSync(
  path.join(__dirname, "..", "src", "ideHub", "newProjectFlowPanel.ts"),
  "utf8",
);

test("the cores argument comes from planInitCores", () => {
  // Arrange / Act / Assert
  assert.match(
    SOURCE,
    /import \{ planInitCores \} from "@alp-sdk\/core\/project\/initCores"/,
    "the panel must use the shared filter, not a local one",
  );
  assert.match(
    SOURCE,
    /planInitCores\(cores\)/,
    "planInitCores must be called with the SoM's declared cores",
  );
  assert.match(
    SOURCE,
    /initArgs\.push\("--cores", coresPlan\.arg\)/,
    "the filtered value is what reaches tan",
  );
});

test("the SoM's declared topology is never mapped into --cores verbatim", () => {
  // Arrange -- the exact shape of the bug: `cores.map((c) => `${c.id}:${c.os}`)`
  // sends `m55_he:zephyr`, which `tan init` refuses because `--cores` splices
  // companions in APP-LESS and an app-less `os: zephyr` slice cannot exist.
  // Written as a search for the DEFECT rather than for its absence in one
  // spelling, so a re-introduction anywhere in this file trips it.
  assert.doesNotMatch(
    SOURCE,
    /\$\{\s*\w+\.id\s*\}\s*:\s*\$\{\s*\w+\.os\s*\}/,
    "a core's declared os must never be interpolated straight into --cores",
  );
});

test("the flag is omitted entirely when there is nothing to send", () => {
  // Arrange -- `planInitCores` answers `null` for a SoM with no companion
  // (E1M-AEN301 is two Zephyr cores and nothing else). Pushing an empty
  // `--cores` would be a different refusal, not a fix.
  assert.match(
    SOURCE,
    /if \(coresPlan\.arg\) \{\s*initArgs\.push\("--cores", coresPlan\.arg\);/,
    "--cores must be pushed only when the filter produced a value",
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
