// SPDX-License-Identifier: Apache-2.0
//
// `readOnlyProjectCwd()` (src/project/vscodeAdapter.ts, #605) direct, against
// the REAL function — not a stub of it.
//
// Every consumer test (test/deps.adapter.test.js, test/
// ideHub.sdkReleasesOnline.test.js) stubs `"../project/vscodeAdapter"`
// wholesale, so the real body — `collectProjectContext().workspaceRoot ??
// os.tmpdir()` — never runs in either of them. A mutation that changed the
// fallback to `?? ""` (the exact value the function's own doc comment calls
// out as wrong: "empty is not 'no preference', it can resolve to a directory
// of its own") left the full suite at 1818/1816/0 fail, proving those tests
// give no coverage of this function at all.
//
// Same shape as test/project.vscodeAdapter.svdPath.test.js: loads the REAL
// `out/project/vscodeAdapter.js`, stubbing only `vscode` — `fs`/`os`/`path`/
// `@alp-sdk/core/project/service` are the genuine modules.

const test = require("node:test");
const assert = require("node:assert/strict");
const os = require("node:os");
const path = require("node:path");
const Module = require("node:module");

const root = path.join(__dirname, "..");

/** `readOnlyProjectCwd()` against a fake `vscode.workspace`.
 *  `workspaceFolders` is `undefined` for "no folder open", matching what VS
 *  Code really reports (never `[]`). */
function readOnlyProjectCwdWith(workspaceFolders) {
  const modPath = require.resolve(
    path.join(root, "out", "project", "vscodeAdapter.js"),
  );
  delete require.cache[modPath];
  const originalLoad = Module._load;
  Module._load = function (request, ...rest) {
    if (request === "vscode") {
      return {
        workspace: {
          workspaceFolders,
          // Every `alpSdk.*` setting defaults to what `readProjectSettings`
          // itself falls back to (`""`, except `boardYamlPath: "board.yaml"`)
          // — a customer with nothing configured, which is the ordinary case
          // this function's own callers (`sdk list --online`) run under.
          getConfiguration: () => ({
            get: (_key, fallback) => fallback,
          }),
        },
        window: { activeTextEditor: undefined },
      };
    }
    return originalLoad.call(this, request, ...rest);
  };
  try {
    const { readOnlyProjectCwd } = require(modPath);
    return readOnlyProjectCwd();
  } finally {
    Module._load = originalLoad;
    delete require.cache[modPath];
  }
}

test("with a folder open, it is the resolved workspace root", () => {
  const folder = path.join(
    root,
    "examples",
    "peripheral-io",
    "gpio-button-led",
  );
  const cwd = readOnlyProjectCwdWith([{ uri: { fsPath: folder } }]);

  // POSIX-separated, NOT `fsPath` verbatim: `resolveWorkspaceRoot`
  // (packages/alp-core/src/project/service.ts) ends in `toPosix(...)`, so on
  // win32 the resolved root uses `/` while the `path.join` above produced
  // `\`. Comparing against the native spelling passes on macOS and fails on
  // Windows only — which is exactly how this first shipped.
  const expected = folder.split(path.sep).join("/");
  assert.equal(cwd, expected);
  assert.ok(
    !cwd.includes("\\"),
    "the resolved root must stay POSIX-separated; a native-separator answer " +
      "here would diverge from every other consumer of collectProjectContext",
  );
  assert.notEqual(
    cwd,
    os.tmpdir(),
    "a real workspace root must never fall through to the no-project answer",
  );
});

test("with no folder open, it is os.tmpdir() — never undefined and never empty", () => {
  const cwd = readOnlyProjectCwdWith(undefined);

  assert.equal(cwd, os.tmpdir());
  // Spelled out, not just `assert.ok(cwd)`: `""` is truthy-adjacent-looking
  // in a lot of contexts but is NOT "no preference" to `child_process.spawn`
  // — an empty string can resolve to a directory of its own. This is the
  // exact wrong value the function's own doc comment names.
  assert.notEqual(cwd, "");
  assert.notEqual(cwd, undefined);
});
