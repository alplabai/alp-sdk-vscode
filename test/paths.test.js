// SPDX-License-Identifier: Apache-2.0

const test = require("node:test");
const assert = require("node:assert/strict");

const { toPosix, samePath } = require("../packages/alp-core/dist/paths.js");

test("toPosix forward-slashes a native Windows path", () => {
  assert.equal(toPosix("C:\\work\\proj"), "C:/work/proj");
  assert.equal(toPosix("/work/proj"), "/work/proj");
});

// The #303 seam: ProjectContext.workspaceRoot is toPosix'd, VS Code's
// uri.fsPath is not. A raw `===` is never true on Windows.
test("samePath matches a native Windows path against a toPosix'd one", () => {
  assert.ok(samePath("C:\\work\\proj", "C:/work/proj"));
  assert.ok(!("C:\\work\\proj" === "C:/work/proj"));
});

test("samePath still separates genuinely different folders", () => {
  assert.ok(!samePath("C:\\work\\docs", "C:/work/firmware"));
  assert.ok(!samePath("/workspace/docs", "/workspace/firmware"));
});

// Deliberate: WSL-created directories carry Windows' per-directory
// case-sensitivity flag, so these can be two distinct real folders. Matching
// them would attach the debug session to the wrong workspace folder.
test("samePath does not fold case", () => {
  assert.ok(!samePath("C:\\ws\\App", "C:/ws/app"));
  assert.ok(!samePath("/work/Proj", "/work/proj"));
});

// Deliberate: path.win32.normalize("\\\\server\\share") appends a separator,
// so normalizing here would manufacture a mismatch on UNC paths.
test("samePath leaves UNC paths intact", () => {
  assert.ok(samePath("\\\\server\\share\\proj", "//server/share/proj"));
});

test("samePath is unchanged on posix hosts, where fsPath is already posix", () => {
  assert.ok(samePath("/workspace/app", "/workspace/app"));
});
