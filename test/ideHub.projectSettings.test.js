// SPDX-License-Identifier: Apache-2.0

const test = require("node:test");
const assert = require("node:assert/strict");
const { buildProjectSettings } = require("../out/ideHub/projectSettings.js");

test("buildProjectSettings pins the SDK and wires C/C++ IntelliSense at the build compile DB", () => {
  const s = buildProjectSettings({}, "/home/x/.alp/sdk/v0.13.0");
  assert.equal(s["alpSdk.path"], "/home/x/.alp/sdk/v0.13.0");
  assert.equal(
    s["C_Cpp.default.compileCommands"],
    "${workspaceFolder}/build/compile_commands.json",
  );
});

test("buildProjectSettings merges without clobbering existing keys", () => {
  const existing = { "editor.tabSize": 4, "files.eol": "\n" };
  const s = buildProjectSettings(existing, "/sdk");
  assert.equal(s["editor.tabSize"], 4); // preserved
  assert.equal(s["files.eol"], "\n"); // preserved
  assert.equal(s["alpSdk.path"], "/sdk"); // pinned
});

test("buildProjectSettings never overrides a compileCommands the scaffold/user set", () => {
  const existing = { "C_Cpp.default.compileCommands": "custom/path.json" };
  const s = buildProjectSettings(existing, "/sdk");
  assert.equal(s["C_Cpp.default.compileCommands"], "custom/path.json");
});
