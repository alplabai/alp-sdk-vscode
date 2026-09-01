// SPDX-License-Identifier: Apache-2.0
//
// The pure half of the debug device-write consent gate (#586): given a
// cortex-debug launch configuration, decide whether starting it programs the
// attached target, and produce the words the dialog shows for it.
//
// Ground truth for the "why it writes" rule is the installed adapter's own
// schema, `marus25.cortex-debug` 1.12.1,
// contributes.debuggers[0].configurationAttributes.launch.properties.loadFiles:
//
//   "List of files (hex/bin/elf files) to load/program instead of the
//    executable file. Symbols are not loaded (see `symbolFiles`). Can be an
//    empty list to specify none. If this property does not exist, then the
//    executable is used to program the device"
//
// So: no `loadFiles` key at all => the executable programs the device; an
// EMPTY `loadFiles` => nothing is programmed; a non-empty one => those files
// are programmed INSTEAD of the executable. All three are pinned here.

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  planDebugDeviceWrite,
  debugConsentMessage,
  describeDebugConsent,
} = require("../packages/alp-core/dist/debug/deviceWriteConsent.js");

/** The baremetal/OpenOCD shape tan writes, as recorded in #586. */
const LAUNCH = Object.freeze({
  name: "Alp: Baremetal Debug (OpenOCD)",
  type: "cortex-debug",
  request: "launch",
  cwd: "${workspaceFolder}",
  executable: "${workspaceFolder}/build/baremetal/app.elf",
  preLaunchTask: "alp: build baremetal target",
  servertype: "openocd",
});

const ALP_WORKSPACE = Object.freeze({ boardYamlExists: true });

const ask = (config, context = ALP_WORKSPACE) => {
  const decision = planDebugDeviceWrite(config, context);
  assert.equal(
    decision.kind,
    "ask",
    `expected a consent prompt for ${JSON.stringify(config)}`,
  );
  return decision;
};

const allow = (config, context = ALP_WORKSPACE) => {
  const decision = planDebugDeviceWrite(config, context);
  assert.equal(
    decision.kind,
    "allow",
    `expected no prompt for ${JSON.stringify(config)}`,
  );
  return decision;
};

// ---------------------------------------------------------------------------
// What counts as a device write

test("a cortex-debug launch in an Alp workspace asks before it programs", () => {
  const decision = ask(LAUNCH);
  assert.equal(decision.programsSource, "executable");
  assert.deepEqual(decision.programs, [
    "${workspaceFolder}/build/baremetal/app.elf",
  ]);
  assert.equal(decision.servertype, "openocd");
  assert.equal(decision.configName, "Alp: Baremetal Debug (OpenOCD)");
});

test("an attach request programs nothing, so it never asks", () => {
  // `request: "attach"` connects to a running target; the adapter's load step
  // belongs to `launch` alone.
  assert.equal(allow({ ...LAUNCH, request: "attach" }).reason, "not-a-launch");
});

test("a non-cortex-debug type is not this gate's business", () => {
  // cppdbg (Yocto/gdbserver) and lldb (native_sim) do not program silicon.
  for (const type of ["cppdbg", "lldb", "node", undefined]) {
    assert.equal(
      allow({ ...LAUNCH, type }).reason,
      "not-cortex-debug",
      `type=${String(type)} must not be gated here`,
    );
  }
});

test("a workspace with no board.yaml is somebody else's project", () => {
  // Scope decision for #586: this extension can be active in a window that has
  // nothing to do with Alp (activationEvents carries "onLanguage:yaml"), and a
  // stranger's cortex-debug session must not sprout an Alp dialog.
  assert.equal(
    allow(LAUNCH, { boardYamlExists: false }).reason,
    "not-an-alp-workspace",
  );
});

test("an EMPTY loadFiles list programs nothing and is let through", () => {
  // The adapter's documented escape hatch. If tan ever emits it, the session
  // attaches without a write and no dialog is owed.
  assert.equal(allow({ ...LAUNCH, loadFiles: [] }).reason, "loads-nothing");
});

test("a non-empty loadFiles programs THOSE files, not the executable", () => {
  const decision = ask({
    ...LAUNCH,
    loadFiles: ["build/baremetal/app.hex", "build/baremetal/boot.bin"],
  });
  assert.equal(decision.programsSource, "loadFiles");
  assert.deepEqual(decision.programs, [
    "build/baremetal/app.hex",
    "build/baremetal/boot.bin",
  ]);
});

test("a launch that names no artefact at all still asks", () => {
  // Refusing to guess: an unnamed executable is a reason to ask, never a
  // reason to assume nothing is written.
  const { executable, ...withoutExecutable } = LAUNCH;
  const decision = ask(withoutExecutable);
  assert.deepEqual(decision.programs, []);
});

test("a loadFiles that is not a list is not an escape hatch", () => {
  // Only a real empty array means "program nothing". Anything else is
  // malformed input and must not be read as consent.
  for (const loadFiles of [null, "", 0, false, {}]) {
    ask({ ...LAUNCH, loadFiles });
  }
});

test("the device name comes off the configuration when it has one", () => {
  assert.equal(
    ask({ ...LAUNCH, device: "AE722F80F55D5LS" }).device,
    "AE722F80F55D5LS",
  );
  assert.equal(ask(LAUNCH).device, null);
});

// ---------------------------------------------------------------------------
// The words

test("the message says a device is written, in the flash gate's own words", () => {
  // Same sentence shape as `flashConsentMessage` so the two dialogs read as
  // one product, not two.
  assert.match(
    debugConsentMessage(ask({ ...LAUNCH, device: "AE722F80F55D5LS" })),
    /AE722F80F55D5LS/,
  );
  assert.match(
    debugConsentMessage(ask(LAUNCH)),
    /This writes to the device\.$/,
  );
});

test("an unnamed device degrades to a phrase, never to an empty gap", () => {
  assert.match(debugConsentMessage(ask(LAUNCH)), /this device/);
});

test("the detail names the artefact and the debug server verbatim", () => {
  const detail = describeDebugConsent(ask(LAUNCH), { workspaceRoot: "/w" });
  assert.match(detail, /\$\{workspaceFolder\}\/build\/baremetal\/app\.elf/);
  assert.match(detail, /openocd/);
});

test("the detail explains WHY a launch writes when nothing asked it to", () => {
  // The whole defect in #586 is that the configuration carries no `loadFiles`
  // key, so the reader has no way to know a debug session programs anything.
  assert.match(
    describeDebugConsent(ask(LAUNCH), { workspaceRoot: "/w" }),
    /loadFiles/,
  );
});

test("the irreversibility sentence is LAST, immediately above the buttons", () => {
  // Same structural mitigation `describeFlashConsent` uses: a long detail must
  // not scroll the risk away from the button.
  const sections = describeDebugConsent(ask(LAUNCH), {
    workspaceRoot: "/w",
  })
    .split("\n\n")
    .filter((s) => s.length > 0);
  assert.match(
    sections[sections.length - 1],
    /Nothing is written unless you continue\.$/,
  );
});

test("the risk sentence does not claim more than is known", () => {
  // #586 is explicit that whether the write lands in non-volatile flash or in
  // RAM depends on the image's load addresses, and that no bench run has
  // narrowed it. The dialog must not assert flash unconditionally.
  const detail = describeDebugConsent(ask(LAUNCH), { workspaceRoot: "/w" });
  assert.match(detail, /can OVERWRITE non-volatile memory/);
  assert.doesNotMatch(detail, /always overwrites/i);
});

test("a loadFiles launch names the loaded files, not the executable", () => {
  const detail = describeDebugConsent(
    ask({ ...LAUNCH, loadFiles: ["build/app.hex"] }),
    { workspaceRoot: "/w" },
  );
  assert.match(detail, /build\/app\.hex/);
  assert.doesNotMatch(detail, /app\.elf/);
});

// ---------------------------------------------------------------------------
// The escape hatch is narrower than it looks (found by an adversarial pass)
//
// `loadFiles: []` only proves the DEFAULT load is off. cortex-debug 1.12.1 also
// honours thirteen gdb command lists on `launch` — preLaunchCommands,
// postLaunchCommands, preRestartCommands, postRestartCommands, preResetCommands,
// postResetCommands, overrideLaunchCommands, overrideRestartCommands,
// overrideResetCommands, postStartSessionCommands, postRestartSessionCommands,
// openOCDLaunchCommands, openOCDPreConfigLaunchCommands — and the schema says of
// overrideLaunchCommands, verbatim: "You can use this to property to override
// the commands that are normally executed as part of flashing and launching the
// target". Any of them can carry a bare gdb `load`, which programs the device
// through the same probe. So a command list present anywhere means the artefact
// cannot be read off the configuration, and the honest answer is to ask and say
// WHY, not to name a file that may not be the one written.

test("loadFiles: [] stops being an escape hatch once a gdb command list appears", () => {
  const decision = ask({
    ...LAUNCH,
    loadFiles: [],
    overrideLaunchCommands: ["monitor reset halt", "load"],
  });
  assert.equal(decision.programsSource, "gdbCommands");
  assert.deepEqual(decision.programs, []);
});

test("an attach carrying a gdb command list is asked about too", () => {
  // `attach` normally programs nothing — but postAttachCommands can hold a
  // `load` just as well, and this gate must not read the request verb as proof.
  const decision = ask({
    ...LAUNCH,
    request: "attach",
    postAttachCommands: ["load"],
  });
  assert.equal(decision.programsSource, "gdbCommands");
});

test("every *Commands key counts, including ones cortex-debug adds later", () => {
  // Matched by shape, not by an enumerated list, so a new attribute in a future
  // adapter release is covered the day it ships instead of silently escaping.
  for (const key of [
    "preLaunchCommands",
    "postLaunchCommands",
    "overrideRestartCommands",
    "postStartSessionCommands",
    "openOCDLaunchCommands",
    "someFutureCommands",
  ]) {
    const decision = ask({ ...LAUNCH, loadFiles: [], [key]: ["load"] });
    assert.equal(
      decision.programsSource,
      "gdbCommands",
      `${key} must not be ignored`,
    );
  }
});

test("an EMPTY command list is not a reason to ask", () => {
  // `preLaunchCommands: []` states that nothing extra runs. Treating it as a
  // risk would prompt on a configuration that says the opposite.
  assert.equal(
    allow({ ...LAUNCH, loadFiles: [], preLaunchCommands: [] }).reason,
    "loads-nothing",
  );
});

test("the unknown case says which keys made it unknown, and names no file", () => {
  const detail = describeDebugConsent(
    ask({ ...LAUNCH, loadFiles: [], overrideLaunchCommands: ["load"] }),
    { workspaceRoot: "/w" },
  );
  assert.match(detail, /overrideLaunchCommands/);
  assert.doesNotMatch(detail, /app\.elf/);
  assert.match(detail, /Nothing is written unless you continue\.$/);
});
