// SPDX-License-Identifier: Apache-2.0
// Smoke tests for the IDE Hub message protocol contract.

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  PROTOCOL_VERSION,
  emptyAlpIdeState,
} = require("../out/ideHub/messages.js");

// ---------------------------------------------------------------------------
// PROTOCOL_VERSION
// ---------------------------------------------------------------------------

test("PROTOCOL_VERSION is a positive integer", () => {
  assert.equal(typeof PROTOCOL_VERSION, "number");
  assert.ok(PROTOCOL_VERSION >= 1);
});

// ---------------------------------------------------------------------------
// emptyAlpIdeState shape
// ---------------------------------------------------------------------------

test("emptyAlpIdeState returns all required top-level keys", () => {
  const state = emptyAlpIdeState();
  assert.ok("sdk" in state, "missing sdk");
  assert.ok("setup" in state, "missing setup");
  assert.ok("workspace" in state, "missing workspace");
});

test("emptyAlpIdeState sdk defaults", () => {
  const { sdk } = emptyAlpIdeState();
  assert.equal(sdk.activePath, null);
  assert.equal(sdk.version, null);
  assert.equal(sdk.readiness, "unknown");
  assert.deepEqual(sdk.localEntries, []);
});

test("emptyAlpIdeState setup defaults", () => {
  const { setup } = emptyAlpIdeState();
  assert.equal(setup.pythonAvailable, false);
  assert.equal(setup.westAvailable, false);
  assert.equal(setup.lastBootstrapAt, null);
});

test("emptyAlpIdeState workspace defaults", () => {
  const { workspace } = emptyAlpIdeState();
  assert.equal(workspace.workspaceRoot, null);
  assert.equal(workspace.boardYamlExists, false);
});

// ---------------------------------------------------------------------------
// Message type discriminants (structural contract)
// ---------------------------------------------------------------------------

test("stateUpdate message shape matches contract", () => {
  const state = emptyAlpIdeState();
  /** @type {import("../out/ideHub/messages.js").StateUpdateMessage} */
  const msg = { type: "stateUpdate", _v: PROTOCOL_VERSION, state };
  assert.equal(msg.type, "stateUpdate");
  assert.equal(msg._v, PROTOCOL_VERSION);
  assert.ok(msg.state);
});

test("sdkReleasesLoaded message shape matches contract", () => {
  /** @type {import("../out/ideHub/messages.js").SdkReleasesLoadedMessage} */
  const msg = { type: "sdkReleasesLoaded", releases: [] };
  assert.equal(msg.type, "sdkReleasesLoaded");
  assert.deepEqual(msg.releases, []);
});

test("sdkInstallProgress in-progress message shape matches contract", () => {
  /** @type {import("../out/ideHub/messages.js").SdkInstallProgressMessage} */
  const msg = { type: "sdkInstallProgress", log: "Cloning…", done: false };
  assert.equal(msg.type, "sdkInstallProgress");
  assert.equal(msg.done, false);
  assert.equal(msg.success, undefined);
});

test("sdkInstallProgress done+success message shape matches contract", () => {
  /** @type {import("../out/ideHub/messages.js").SdkInstallProgressMessage} */
  const msg = {
    type: "sdkInstallProgress",
    log: "SDK v1.0.0 installed successfully.",
    done: true,
    success: true,
  };
  assert.equal(msg.done, true);
  assert.equal(msg.success, true);
});

// ---------------------------------------------------------------------------
// Webview → Extension message type discriminants
// ---------------------------------------------------------------------------

test("requestSdkInstall message carries a version string", () => {
  const msg = { type: "requestSdkInstall", version: "v1.2.3" };
  assert.equal(msg.version, "v1.2.3");
});

test("switchSdk message carries an sdkPath string", () => {
  const msg = { type: "switchSdk", sdkPath: "/opt/alp-sdk" };
  assert.equal(msg.sdkPath, "/opt/alp-sdk");
});
