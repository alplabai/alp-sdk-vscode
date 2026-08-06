// SPDX-License-Identifier: Apache-2.0
//
// "Activate and Deactivate don't work."
//
// They did run. Nothing they did was visible, for two independent reasons, and
// this file pins both:
//
//   1. The "Active" badge was derived from the RESOLVED sdkRoot, not from a pin.
//      With no `alpSdk.path` and a stale `.alp/sdk-path`, resolution fell
//      through to the newest install under ~/.alp/sdk — so an SDK nobody
//      selected wore the green "Active" badge, and the Deactivate next to it
//      cleared a pin that had never been written. `sdkRootSource` is what makes
//      the two states distinguishable.
//
//   2. `clearActiveSdk` cleared the `alpSdk.path` SETTING only. The
//      `.alp/sdk-path` pointer that `setActiveSdk` writes as its mirror sits
//      ABOVE auto-discovery in `resolveSdkRoot`, so it survived Deactivate and
//      kept resolving the same SDK. Same dead-button symptom, different cause —
//      fixing only the badge would have left this one live.
//
// The UI half is asserted at the source level: the webview bundle needs a DOM
// and the webview `vscode` API, so SdkView cannot be imported under node --test.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const {
  resolveProjectContext,
} = require("../packages/alp-core/dist/project/service.js");
const {
  clearActiveSdkPointer,
  switchActiveSdk,
} = require("../packages/alp-core/dist/sdk/service.js");

const root = path.join(__dirname, "..");
const read = (...parts) => fs.readFileSync(path.join(root, ...parts), "utf8");

const LOADER = "/workspace/alp-sdk/scripts/alp_project.py";

/** Resolution input with nothing pinned unless the caller pins it. */
function inputWith(overrides = {}) {
  return {
    workspaceFolders: ["/workspace/app"],
    settings: {
      sdkPath: "",
      pythonPath: "",
      boardYamlPath: "board.yaml",
      westCwd: "",
      ...(overrides.settings ?? {}),
    },
    platform: "darwin",
    installedSdkRoots: overrides.installedSdkRoots ?? [],
  };
}

test("a pinned alpSdk.path reports source `setting`", () => {
  const context = resolveProjectContext(
    inputWith({ settings: { sdkPath: "/workspace/alp-sdk" } }),
    (p) => p === LOADER,
  );

  assert.equal(context.sdkRoot, "/workspace/alp-sdk");
  assert.equal(context.sdkRootSource, "setting");
});

test("a `.alp/sdk-path` pointer reports source `pointer`", () => {
  const pointerPath = "/workspace/app/.alp/sdk-path";
  const context = resolveProjectContext(
    inputWith(),
    (p) => p === LOADER || p === pointerPath,
    (p) =>
      p === pointerPath
        ? JSON.stringify({
            sdkPath: "/workspace/alp-sdk",
            updatedAt: "2026-08-05T12:00:00.000Z",
          })
        : "",
  );

  assert.equal(context.sdkRoot, "/workspace/alp-sdk");
  assert.equal(context.sdkRootSource, "pointer");
});

test("the newest cache install reports source `installed`, not a pin", () => {
  // The exact machine state that produced the bug report: no setting, a
  // `.alp/sdk-path` naming a version that was deleted, one SDK left in the
  // cache. The stale pointer must NOT count as a pin — it doesn't resolve.
  const installed = "/home/u/.alp/sdk/v0.15.0-rc1";
  const stalePointer = "/workspace/app/.alp/sdk-path";
  const context = resolveProjectContext(
    inputWith({ installedSdkRoots: [installed] }),
    (p) => p === `${installed}/scripts/alp_project.py` || p === stalePointer,
    (p) =>
      p === stalePointer
        ? JSON.stringify({
            sdkPath: "/home/u/.alp/sdk/v0.11.0",
            updatedAt: "2026-07-17T10:18:02.492Z",
          })
        : "",
  );

  assert.equal(context.sdkRoot, installed);
  assert.equal(context.sdkRootSource, "installed");
});

test("no SDK at all reports a null source, not a stale one", () => {
  const context = resolveProjectContext(inputWith(), () => false);
  assert.equal(context.sdkRoot, null);
  assert.equal(context.sdkRootSource, null);
});

test("clearActiveSdkPointer removes exactly the pointer switchActiveSdk wrote", () => {
  // Arrange: activate, in memory, through the real writer.
  const written = new Map();
  switchActiveSdk(
    "/workspace/app",
    "/workspace/alp-sdk",
    (p, content) => written.set(p, content),
    () => {},
  );
  const pointerPath = path.join("/workspace/app", ".alp", "sdk-path");
  assert.ok(written.has(pointerPath));

  // Act: deactivate.
  const removed = [];
  const cleared = clearActiveSdkPointer(
    "/workspace/app",
    (p) => written.has(p),
    (p) => {
      removed.push(p);
      written.delete(p);
    },
  );

  // Assert: the one file, and a truthful answer.
  assert.equal(cleared, true);
  assert.deepEqual(removed, [pointerPath]);
  assert.equal(written.size, 0);
  // A second clear reports false rather than throwing on the missing file —
  // Deactivate is idempotent and must not surface an error on the second click.
  assert.equal(
    clearActiveSdkPointer(
      "/workspace/app",
      (p) => written.has(p),
      () => assert.fail("must not unlink a pointer that isn't there"),
    ),
    false,
  );
});

test("Deactivate clears the pointer, not just the setting", () => {
  const ACTIVE_SDK = read("src", "sdk", "activeSdk.ts");
  // The regression: `clearActiveSdk` used to touch `writeAlpSetting` only, so
  // the pointer it had written on activation outlived it and kept resolving.
  const clear = ACTIVE_SDK.slice(
    ACTIVE_SDK.indexOf("export async function clearActiveSdk("),
  );
  assert.match(clear, /clearActiveSdkPointer\(/);
  // ...and the "nothing to clear" early return must account for it, or a
  // pointer-only pin (setting never written) reports "no active SDK to clear"
  // and returns without clearing anything.
  assert.match(clear, /!hadWorkspace && !hadGlobal && !pointerCleared/);
});

test("the badge and the button both key off the pin, not off resolution", () => {
  const SDK_VIEW = read(
    "packages",
    "alp-webview",
    "src",
    "features",
    "sdk",
    "SdkView.tsx",
  );
  // Fallback-resolved rows say what they are...
  assert.match(SDK_VIEW, /Default \(auto-detected\)/);
  // ...and Deactivate is gated on the pin, NOT on `row.isActive`. Gating it on
  // isActive is what put a no-op button on an auto-detected row.
  assert.match(SDK_VIEW, /\{row\.activeSource === "pinned" \? \(/);
  assert.doesNotMatch(SDK_VIEW, /\{row\.isActive \? \(/);
});

test("the host stamps activeSource from the resolution source", () => {
  const ADAPTER = read("src", "ideHub", "vscodeAdapter.ts");
  // Only `setting` and `pointer` are pins. Adding "discovery" or "installed"
  // here would restore the original lie in one character.
  assert.match(
    ADAPTER,
    /projectContext\.sdkRootSource === "setting" \|\|\s*projectContext\.sdkRootSource === "pointer"/,
  );
  assert.match(ADAPTER, /activeSource: activeSdkIsPinned \?/);
});
