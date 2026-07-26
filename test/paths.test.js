// SPDX-License-Identifier: Apache-2.0

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  toPosix,
  samePath,
  canonicalPath,
  sameUserPath,
} = require("../packages/alp-core/dist/paths.js");

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

// --- canonicalPath / sameUserPath (#361) ----------------------------------
// These compare a HAND-TYPED path against a discovered one — two producers,
// unlike samePath's one. See the docstrings for why the rules differ.

test("sameUserPath folds case on win32 — the dangling-pointer case", () => {
  // A user typing alpSdk.path with a lowercase drive vs what discovery found.
  assert.ok(
    sameUserPath(
      "c:/users/me/.alp/sdk/v0.13.0",
      "C:/Users/Me/.alp/sdk/v0.13.0",
      "win32",
    ),
  );
  // Same directory, native separators on the typed side.
  assert.ok(
    sameUserPath(
      "C:\\Users\\Me\\.alp\\sdk\\v0.13.0",
      "c:/users/me/.alp/sdk/v0.13.0",
      "win32",
    ),
  );
});

test("sameUserPath ignores a trailing separator on every platform", () => {
  assert.ok(sameUserPath("/opt/alp-sdk/", "/opt/alp-sdk", "linux"));
  assert.ok(sameUserPath("C:/sdk/v1/", "C:/sdk/v1", "win32"));
});

// The direction where a fold does damage: two genuinely different directories
// must never match, or uninstall clears a pointer to an SDK that still exists.
test("sameUserPath still separates different directories", () => {
  assert.ok(!sameUserPath("/opt/alp-sdk", "/opt/alp-sdk-old", "linux"));
  assert.ok(!sameUserPath("C:/sdk/v0.13.0", "C:/sdk/v0.12.0", "win32"));
});

test("sameUserPath does NOT fold case off win32", () => {
  assert.ok(!sameUserPath("/opt/Alp-SDK", "/opt/alp-sdk", "linux"));
  assert.ok(!sameUserPath("/opt/Alp-SDK", "/opt/alp-sdk", "darwin"));
});

// A bare root IS the separator — stripping it would leave `C:` (drive-relative,
// a different thing) or the empty string.
test("canonicalPath keeps the separator on a bare root", () => {
  assert.equal(canonicalPath("C:/", "win32"), "c:/");
  assert.equal(canonicalPath("/", "linux"), "/");
});

// The result is a KEY, never a value to store or show.
test("canonicalPath lowercases only on win32", () => {
  assert.equal(canonicalPath("C:/Users/Me", "win32"), "c:/users/me");
  assert.equal(canonicalPath("/Users/Me", "linux"), "/Users/Me");
});

// samePath must NOT have acquired the fold — the two helpers stay distinct.
test("samePath is unaffected by the #361 helpers", () => {
  assert.ok(!samePath("C:/ws/App", "C:/ws/app"));
});
