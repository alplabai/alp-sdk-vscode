// SPDX-License-Identifier: Apache-2.0
//
// The SDK Manager's Bootstrap button, checked at the source level: the webview
// bundle needs a DOM + the `vscode` webview API to render, and the host half
// (`src/ideHub/webviewHtml.ts`) imports `vscode`, so neither side can be
// imported here.
//
// Why it exists at all: installing an SDK does not make it buildable. `tan
// build` plans the slices and then skips every one —
//
//   warning: slice `m55_hp` skipped: tool `west` not found
//   skipped: m55_hp [zephyr] -- tool `west` not found
//   error: no slice was built -- every slice was skipped
//
// — because west lives in the workspace venv `tan bootstrap` creates. The
// button puts that step next to Install instead of leaving it in the palette.
//
// The assertion that actually earns its keep is the allowlist one: a webview
// button posting a command id the host does not allowlist is REFUSED at
// runtime (`runWebviewCommand` -> "This Alp IDE action isn't available in this
// version."), which looks like a dead button, not like a bug.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const read = (...parts) => fs.readFileSync(path.join(root, ...parts), "utf8");

const USE_SDK = read(
  "packages",
  "alp-webview",
  "src",
  "features",
  "sdk",
  "useSdk.ts",
);
const SDK_VIEW = read(
  "packages",
  "alp-webview",
  "src",
  "features",
  "sdk",
  "SdkView.tsx",
);
const WEBVIEW_HTML = read("src", "ideHub", "webviewHtml.ts");

test("the Bootstrap button posts a command the host allowlists", () => {
  assert.match(
    USE_SDK,
    /bootstrap: \(\) =>\s*postMessage\(\{ type: "runCommand", command: "alp\.installDependencies" \}\)/,
  );
  // Refused ids surface as "This Alp IDE action isn't available in this
  // version." and execute nothing — a dead button with a confusing toast.
  assert.match(WEBVIEW_HTML, /"alp\.installDependencies",/);
  // `isBootstrapCommand` is what makes the panel stamp `lastBootstrapAt` and
  // re-read status after the terminal exits. An id outside it would run
  // bootstrap and leave the panel showing the pre-bootstrap state.
  const isBootstrap = WEBVIEW_HTML.slice(
    WEBVIEW_HTML.indexOf("export function isBootstrapCommand("),
  );
  assert.match(isBootstrap, /command === "alp\.installDependencies"/);
});

test("the button disappears once the environment exists, not once it was tried", () => {
  // `westAvailable` is the honest signal. `lastBootstrapAt` records that
  // bootstrap was TRIGGERED, so gating on it would hide the one button that
  // repairs a run that failed half-way.
  assert.match(
    SDK_VIEW,
    /\{\(!setup\?\.westAvailable \|\| setup\?\.bootstrapRunning\) && \(/,
  );
  // No `doesNotMatch(/lastBootstrapAt/)` here: the comment above the gate names
  // that field on purpose, to say why it is the wrong signal. The positive
  // assertion on the gate expression is what pins the behaviour.
  // While the terminal run is in flight the button stays visible and spins:
  // west appears on PATH partway through, and vanishing at that moment would
  // read as "done" mid-fetch.
  assert.match(SDK_VIEW, /loading=\{setup\?\.bootstrapRunning \?\? false\}/);
});

test("the post-install offer names the disk cost and never runs on its own", () => {
  const MESSAGES = read("src", "ideHub", "sdkManagerMessages.ts");
  // Minutes of network and gigabytes of disk: the click stays the customer's.
  assert.match(MESSAGES, /const BOOTSTRAP_DISK_ESTIMATE = "about 3 GB";/);
  assert.match(MESSAGES, /\$\{BOOTSTRAP_DISK_ESTIMATE\} of disk\./);
  assert.match(MESSAGES, /\{ id: "custom", title: "Bootstrap now" \}/);
  // The command only runs behind the picked action — no unconditional dispatch
  // on the install path.
  assert.match(
    MESSAGES,
    /if \(picked === "custom"\)\s*void vscode\.commands\.executeCommand\("alp\.installDependencies"\);/,
  );
});

test("Bootstrap is disabled until an SDK is actually active", () => {
  // Bootstrap sets up the ACTIVE SDK's environment, so with none selected it
  // has nothing to act on. `activePath` is the host-decided pointer (#361) —
  // the same field the rest of this view reads, not a re-derivation.
  assert.match(
    SDK_VIEW,
    /disabled=\{!sdk\.activePath \|\| \(setup\?\.bootstrapRunning \?\? false\)\}/,
  );
  assert.match(SDK_VIEW, /onClick=\{\(\) => bootstrap\(\)\}/);
  // Both titles exist, so the disabled state explains itself rather than
  // greying out silently.
  assert.match(SDK_VIEW, /Set up this SDK's build environment/);
  assert.match(SDK_VIEW, /Install and activate an SDK first/);
});
