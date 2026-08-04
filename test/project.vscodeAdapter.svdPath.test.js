// SPDX-License-Identifier: Apache-2.0
//
// #340 review finding (MAJOR): `readSvdPath` (`src/project/vscodeAdapter.ts`)
// must trim what it reads, matching every sibling human-typed path setting
// (`configuredSdkPath.trim()` / `configuredWestCwd.trim()` /
// `configuredPythonPath.trim()` in `packages/alp-core/src/project/
// service.ts`). Measured against the pinned tan 0.5.0-rc4:
//
//   * `--svd "   "` exits 5, `"Alp: --svd was given an empty path."`, no
//     `.vscode/launch.json` written;
//   * `--svd "dummy.svd "` (one trailing space — the copy-paste case) exits 5
//     on the literal padded, unreadable filename.
//
// So a whitespace-only value must read back empty (a customer clearing the
// setting by typing a space must not send `--svd`), and a padded one must
// read back trimmed (a copy-pasted trailing space must not become part of the
// path tan is asked to open).
//
// Loads the REAL `out/project/vscodeAdapter.js`, stubbing only `vscode` —
// `fs`/`os`/`path`/`@alp-sdk/core/project/service` are the genuine modules,
// same shape as `loadAdapter` in test/alpCli.cachedVerification.test.js.

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const Module = require("node:module");

const root = path.join(__dirname, "..");

/** `readSvdPath()` against a fake `alpSdk.svdPath` config value. */
function readSvdPathWith(configuredValue) {
  const modPath = require.resolve(
    path.join(root, "out", "project", "vscodeAdapter.js"),
  );
  delete require.cache[modPath];
  const originalLoad = Module._load;
  Module._load = function (request, ...rest) {
    if (request === "vscode") {
      return {
        workspace: {
          // Mirrors VS Code's real `WorkspaceConfiguration.get`: an unset key
          // (`configuredValue === undefined`, the "nothing typed" case) falls
          // back to the caller's default rather than returning `undefined` —
          // the same contract `readSvdPath`'s `.get<string>("svdPath", "")`
          // relies on.
          getConfiguration: (section) => ({
            get: (key, fallback) =>
              section === "alpSdk" &&
              key === "svdPath" &&
              configuredValue !== undefined
                ? configuredValue
                : fallback,
          }),
          workspaceFolders: undefined,
        },
        window: { activeTextEditor: undefined },
      };
    }
    return originalLoad.call(this, request, ...rest);
  };
  try {
    const { readSvdPath } = require(modPath);
    return readSvdPath();
  } finally {
    Module._load = originalLoad;
    delete require.cache[modPath];
  }
}

test("readSvdPath trims a whitespace-only value down to empty", () => {
  assert.equal(readSvdPathWith("   "), "");
  assert.equal(readSvdPathWith("\t\n "), "");
});

test("readSvdPath trims leading/trailing whitespace off an otherwise real path", () => {
  assert.equal(readSvdPathWith("dummy.svd "), "dummy.svd");
  assert.equal(readSvdPathWith("  vendor/E8.svd"), "vendor/E8.svd");
});

test("readSvdPath passes a clean value through unchanged", () => {
  assert.equal(readSvdPathWith("vendor/E8.svd"), "vendor/E8.svd");
});

test("readSvdPath defaults an unset setting to empty", () => {
  assert.equal(readSvdPathWith(undefined), "");
});
