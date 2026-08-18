// SPDX-License-Identifier: Apache-2.0
//
// Fresh-host onboarding manifest guards. The walkthrough is the ONLY thing a
// customer with an empty VS Code sees, and every defect it can carry is
// invisible at runtime: a mistyped command link renders as a button that does
// nothing, `featuredFor` hides the walkthrough from the people who need it, a
// backwards step order tells them to bootstrap before they have a folder, and a
// missing `capabilities` block silently disables the whole extension in
// Restricted Mode. None of that fails a build — so it fails here.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const pkg = JSON.parse(
  fs.readFileSync(path.join(root, "package.json"), "utf8"),
);

const walkthrough = pkg.contributes.walkthroughs.find(
  (w) => w.id === "alpGettingStarted",
);

test("the getting-started walkthrough is contributed", () => {
  assert.ok(
    walkthrough,
    "contributes.walkthroughs must define alpGettingStarted",
  );
});

test("every command: link in the walkthrough resolves to a contributed command", () => {
  const declared = new Set(pkg.contributes.commands.map((c) => c.command));
  const texts = [
    walkthrough.description,
    ...walkthrough.steps.map((s) => s.description),
  ];

  const found = [];
  for (const text of texts) {
    // `command:alp.foo` optionally followed by ?args — take the id only.
    for (const m of String(text ?? "").matchAll(/\]\(command:([^)?\s]+)/g)) {
      found.push(m[1]);
      assert.ok(
        declared.has(m[1]),
        `walkthrough links command:${m[1]}, which is not in contributes.commands — the button would do nothing`,
      );
    }
  }
  // Guard the guard: if the descriptions ever lose their links this test must
  // not pass vacuously.
  assert.ok(
    found.length >= 6,
    `expected the walkthrough to link commands, found ${found.length}`,
  );
});

test("the build step's Flash button runs the tan-backed flash, not the legacy plain-west one", () => {
  // `alp.westFlash` is the LEGACY command — src/west.ts registers it under
  // "legacy plain-west commands (no CLI equivalent yet)" and it shells literal
  // ["west","flash"]. The tan-backed flash (`tan flash`) is `alp.westAlpFlash`,
  // which is what the status bar and the Build & Flash view run. Both ids are
  // contributed, so the "resolves to a contributed command" test above CANNOT
  // catch this: the wrong one resolves too. A customer who clicks [Build]
  // (`tan build`) and then a legacy [Flash] shells raw west against a build dir
  // tan did not necessarily produce, and tan stops being the sole executor.
  const buildStep = walkthrough.steps.find(
    (s) => s.id === "alp.walkthrough.build",
  );
  assert.ok(buildStep, "the build step must exist");
  const linked = [
    ...String(buildStep.description).matchAll(/\]\(command:([^)?\s]+)/g),
  ].map((m) => m[1]);
  assert.ok(
    linked.includes("alp.westAlpFlash"),
    `the build step must link command:alp.westAlpFlash (tan flash) — got ${linked.join(", ")}`,
  );
  assert.ok(
    !linked.includes("alp.westFlash"),
    "the build step must not link command:alp.westFlash — that is the legacy plain-`west flash`, which bypasses tan",
  );
});

test("the SDK step tells the customer about the second click that actually activates", () => {
  // The step completes on `onSettingChanged:alpSdk.path`, which only fires on
  // ACTIVATION. In the SDK Manager, Install and Use are two separate buttons
  // (packages/alp-webview/src/features/sdk/SdkView.tsx) — Install alone never
  // writes the setting. Without naming the Use click, a customer installs an
  // SDK, the step stays grey, and the walkthrough is stuck on step 1 (and the
  // New Project wizard falls back to a static catalogue).
  const sdkStep = walkthrough.steps.find(
    (s) => s.id === "alp.walkthrough.installSdk",
  );
  const md = fs.readFileSync(path.join(root, sdkStep.media.markdown), "utf8");
  assert.match(
    sdkStep.description,
    /\*\*Use\*\*/,
    "the step description must name the **Use** click that activates an installed SDK",
  );
  assert.match(
    md,
    /\*\*Use\*\*/,
    `${sdkStep.media.markdown} must name the **Use** click that activates an installed SDK`,
  );
});

test("the walkthrough is offered to everyone, not only to workspaces that already have a board.yaml", () => {
  // `featuredFor: ["**/board.yaml"]` promoted the walkthrough ONLY to people who
  // had already completed its project step — i.e. never to a new customer.
  assert.equal(walkthrough.featuredFor, undefined);
});

test("the project step precedes the bootstrap step", () => {
  const order = walkthrough.steps.map((s) => s.id);
  const project = order.indexOf("alp.walkthrough.project");
  const bootstrap = order.indexOf("alp.walkthrough.bootstrap");
  assert.ok(
    project >= 0 && bootstrap >= 0,
    `both steps must exist: ${order.join(", ")}`,
  );
  assert.ok(
    project < bootstrap,
    `bootstrap needs an open folder, so the project step must come first — got ${order.join(", ")}`,
  );
});

test("every walkthrough step's markdown media file exists", () => {
  for (const step of walkthrough.steps) {
    const md = step.media?.markdown;
    assert.ok(md, `${step.id} must have markdown media`);
    assert.ok(
      fs.existsSync(path.join(root, md)),
      `${step.id} points at ${md}, which does not exist`,
    );
  }
});

test("the extension declares that it does not support untrusted workspaces, with a reason", () => {
  // The extension spawns the tan CLI, west and the toolchain against workspace
  // files. Without this block VS Code makes its own guess and the customer gets
  // no explanation in Restricted Mode.
  const untrusted = pkg.capabilities?.untrustedWorkspaces;
  assert.ok(
    untrusted,
    "package.json must declare capabilities.untrustedWorkspaces",
  );
  assert.equal(untrusted.supported, false);
  assert.equal(typeof untrusted.description, "string");
  assert.ok(
    untrusted.description.trim().length > 0,
    "untrustedWorkspaces.description must explain WHY, not be empty",
  );
});

test("the SDK step completes on the setting the extension actually writes", () => {
  // `onCommand:` fires on EXECUTION, not success — opening the SDK Manager and
  // closing it used to tick this step green with no SDK installed. Activation
  // writes alpSdk.path (src/sdk/activeSdk.ts -> writeAlpSetting("path", ...)),
  // so that setting is the honest signal.
  const sdkStep = walkthrough.steps.find(
    (s) => s.id === "alp.walkthrough.installSdk",
  );
  assert.ok(sdkStep, "the installSdk step must exist");
  assert.deepEqual(sdkStep.completionEvents, ["onSettingChanged:alpSdk.path"]);
  // Stated as its own assertion so a regression that ADDS an onCommand: back
  // alongside the setting is caught by name.
  for (const ev of sdkStep.completionEvents) {
    assert.ok(
      !ev.startsWith("onCommand:"),
      `installSdk must not complete on command execution (got ${ev})`,
    );
  }
  // The setting it names must be a real contributed setting.
  const setting = sdkStep.completionEvents[0].slice("onSettingChanged:".length);
  assert.ok(
    Object.prototype.hasOwnProperty.call(
      pkg.contributes.configuration.properties,
      setting,
    ),
    `${setting} is not a contributed setting`,
  );
});
