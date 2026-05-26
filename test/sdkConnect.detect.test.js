const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const {
  SDK_MARKER,
  candidateSdkPaths,
  isSdkRoot,
  detectSdkRoots,
} = require("@alp-sdk/core/sdkConnect/detect");

test("SDK_MARKER is the loader script path", () => {
  assert.equal(SDK_MARKER, path.join("scripts", "alp_project.py"));
});

test("candidateSdkPaths: workspace, siblings, then common dev roots, in order", () => {
  const ws = path.join("C:", "repos", "alp-sdk-vscode");
  const home = path.join("C:", "Users", "dev");
  const got = candidateSdkPaths(ws, home);
  assert.deepEqual(got, [
    ws,
    path.join("C:", "repos", "alp-sdk"),
    path.join("C:", "repos", "alp_sdk"),
    path.join(home, "Documents", "GitHub", "alp-sdk"),
    path.join(home, "GitHub", "alp-sdk"),
    path.join(home, "src", "alp-sdk"),
  ]);
});

test("candidateSdkPaths: null workspace yields only home roots", () => {
  const home = path.join("C:", "Users", "dev");
  assert.deepEqual(candidateSdkPaths(null, home), [
    path.join(home, "Documents", "GitHub", "alp-sdk"),
    path.join(home, "GitHub", "alp-sdk"),
    path.join(home, "src", "alp-sdk"),
  ]);
});

test("isSdkRoot: true only when the loader script exists", () => {
  const root = path.join("x", "alp-sdk");
  const present = (p) => p === path.join(root, SDK_MARKER);
  assert.equal(isSdkRoot(root, present), true);
  assert.equal(isSdkRoot(root, () => false), false);
  const onlyDir = (p) => p === path.join(root, "scripts");
  assert.equal(isSdkRoot(root, onlyDir), false);
});

test("detectSdkRoots: keeps only valid candidates, preserving order", () => {
  const a = path.join("a", "alp-sdk");
  const b = path.join("b", "alp-sdk");
  const valid = new Set([path.join(b, SDK_MARKER)]);
  assert.deepEqual(detectSdkRoots([a, b], (p) => valid.has(p)), [b]);
});
