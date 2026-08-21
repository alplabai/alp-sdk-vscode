// SPDX-License-Identifier: Apache-2.0
//
// `model build` runs a real NPU compile that can outlast the 60s default
// envelope timeout (spawnAlpAsync's ALP_SPAWN_TIMEOUT_MS in
// src/alpCli/vscodeAdapter.ts) — killing it there would falsely report
// "Build failed" and orphan the in-progress compile. spawnAlpAsync lives in
// vscodeAdapter.ts, which imports `vscode` and so can't be exercised directly
// by node:test outside a VS Code host (see test/alpCli.installTanCli.test.js
// for the same constraint); this is a cheap source-level wiring check instead.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");

test("runAlpCommand accepts a per-call timeoutMs override, threaded to spawnAlpAsync", () => {
  const src = fs.readFileSync(
    path.join(root, "src", "alpCli", "vscodeAdapter.ts"),
    "utf-8",
  );
  // Read the options block out FIRST, then assert membership inside it. The
  // original form pinned `timeoutMs` as the last member before `}`, so merely
  // adding a sibling option (e.g. `interactive`) reddened a correct signature.
  // What this gate owes the reader is that `timeoutMs` IS an option — not the
  // order the members happen to be written in.
  const optionsBlock =
    /export async function runAlpCommand\([\s\S]*?options\?:\s*\{([\s\S]*?)\}/.exec(
      src,
    );
  assert.ok(optionsBlock, "runAlpCommand must take an options object");
  assert.match(
    optionsBlock[1],
    /timeoutMs\?:\s*number/,
    "runAlpCommand's options must accept an optional timeoutMs override",
  );
  assert.match(
    src,
    /spawnAlpAsync\(\s*command,\s*spawnArgs,\s*spawnCwd,\s*options\?\.signal,\s*options\?\.timeoutMs,?\s*\)/,
    "runAlpCommand must forward options.timeoutMs to spawnAlpAsync",
  );
});

test("model build passes a timeout well past the 60s envelope default", () => {
  const src = fs.readFileSync(
    path.join(root, "src", "models", "panel.ts"),
    "utf-8",
  );
  const match = src.match(/MODEL_BUILD_TIMEOUT_MS\s*=\s*([0-9_*\s]+);/);
  assert.ok(match, "panel.ts must define MODEL_BUILD_TIMEOUT_MS");
  const timeoutMs = match[1]
    .replace(/_/g, "")
    .split("*")
    .map((n) => Number(n.trim()))
    .reduce((a, b) => a * b, 1);
  assert.ok(
    timeoutMs > 60_000,
    `MODEL_BUILD_TIMEOUT_MS (${timeoutMs}ms) must exceed the 60s envelope default`,
  );
  // Matched on the LITERAL argv, not on an `args` variable. `buildModel` used
  // to build its argv with a ternary — `["model", "build", "--model", name]`
  // or `["model", "build"]` — and `--model` does not exist on `tan model` at
  // all, so the one model subcommand this pin implements died at click exit 2
  // with no envelope (#543). The literal is what keeps that call inside
  // test/tan.surfaceContract.test.js's reach.
  assert.match(
    src,
    /runAlpCommand\(\s*this\.context,\s*\["model",\s*"build"\],\s*cwd,\s*\{\s*timeoutMs:\s*MODEL_BUILD_TIMEOUT_MS,?\s*\},?\s*\)/,
    'buildModel must spawn the literal `["model", "build"]` with ' +
      "{ timeoutMs: MODEL_BUILD_TIMEOUT_MS }",
  );
  // Comments stripped first: the paragraph on `buildModel` NAMES the retired
  // argv on purpose, and a scan that could not tell prose from code would
  // force the explanation out of the file to stay green.
  const code = src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
  assert.doesNotMatch(
    code,
    /"--model"/,
    "`tan model` has no `--model` option at this pin (its options are " +
      "--board/--board-yaml --out --metadata-root --project --sdk-root " +
      "--format), so sending one is a usage error with no envelope behind it",
  );
});
