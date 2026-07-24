// SPDX-License-Identifier: Apache-2.0
//
// consoleRecommendation.ts is a plain, import-free TS module in the webview
// package (no vite/JSX needed to run it) — transform it with esbuild (already
// a devDependency) and require the result, same technique test/webview/run.mjs
// uses for the full render harness.
const test = require("node:test");
const assert = require("node:assert/strict");
const esbuild = require("esbuild");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const srcPath = path.join(
  __dirname,
  "../packages/alp-webview/src/features/configurator/consoleRecommendation.ts",
);
const { code } = esbuild.transformSync(fs.readFileSync(srcPath, "utf8"), {
  loader: "ts",
  format: "cjs",
});
const outFile = path.join(
  fs.mkdtempSync(path.join(os.tmpdir(), "alp-console-rec-")),
  "consoleRecommendation.cjs",
);
fs.writeFileSync(outFile, code);
const { consoleRecommendation } = require(outFile);

test("consoleRecommendation: no cores marked headless -> silent", () => {
  const cores = [{ id: "hp" }, { id: "hs", hwConsole: true }];
  const r = consoleRecommendation(cores, undefined);
  assert.deepEqual(r.headlessIds, []);
  assert.equal(r.recommendation, undefined);
  assert.equal(r.warning, undefined);
});

test("consoleRecommendation: headless core -> recommends ram, no warning by default", () => {
  const cores = [{ id: "hp" }, { id: "sysmgr", hwConsole: false }];
  const r = consoleRecommendation(cores, undefined);
  assert.deepEqual(r.headlessIds, ["sysmgr"]);
  assert.match(r.recommendation, /sysmgr/);
  assert.match(r.recommendation, /ram/);
  assert.equal(r.warning, undefined);
});

test("consoleRecommendation: headless core + uart/alp backend -> warns", () => {
  const cores = [{ id: "sysmgr", hwConsole: false }];
  assert.match(consoleRecommendation(cores, "uart").warning, /sysmgr/);
  assert.match(consoleRecommendation(cores, "alp").warning, /sysmgr/);
});

test("consoleRecommendation: headless core + ram/auto backend -> no warning", () => {
  const cores = [{ id: "sysmgr", hwConsole: false }];
  assert.equal(consoleRecommendation(cores, "ram").warning, undefined);
  assert.equal(consoleRecommendation(cores, undefined).warning, undefined);
});

test("consoleRecommendation: already on ram -> no redundant recommendation, badge kept", () => {
  const cores = [{ id: "sysmgr", hwConsole: false }];
  const r = consoleRecommendation(cores, "ram");
  assert.equal(r.recommendation, undefined); // don't nag when already ram
  assert.equal(r.warning, undefined);
  assert.deepEqual(r.headlessIds, ["sysmgr"]); // per-core badge still shows
});

test("consoleRecommendation: mixed SoM names only the headless cores", () => {
  const cores = [
    { id: "hp", hwConsole: true },
    { id: "hs" },
    { id: "sysmgr", hwConsole: false },
  ];
  const r = consoleRecommendation(cores, "uart");
  assert.deepEqual(r.headlessIds, ["sysmgr"]);
  assert.doesNotMatch(r.warning, /\bhp\b/);
  assert.doesNotMatch(r.warning, /\bhs\b/);
});
