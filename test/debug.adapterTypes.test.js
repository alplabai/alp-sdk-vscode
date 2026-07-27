// SPDX-License-Identifier: Apache-2.0
//
// The `type` of a launch configuration is not ours to invent. VS Code resolves
// it against the debug types installed extensions register in their own
// `contributes.debuggers`, and refuses the session outright when nothing
// registers it -- "configured debug type 'codelldb' is not supported".
//
// This suite pins, per target kind, that the type we emit is (a) really
// contributed by an extension and (b) contributed by an extension THIS package
// declares, so it is present on the customer's machine.
//
// It exists because `native-host` shipped `type: "codelldb"` -- the extension's
// NAME, never a debug type -- while the unit test asserted the same wrong
// string, so the suite certified the bug instead of catching it. A table that
// is wrong is at least a table someone can check.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const {
  DEBUG_ADAPTER_EXTENSION_ID,
  DEBUG_TARGET_ADAPTER,
  DEBUG_TARGET_CHOICES,
  createLaunchPreview,
  serverChoicesForTarget,
} = require("../packages/alp-core/dist/debug/service.js");

const root = path.join(__dirname, "..");

/**
 * Debug types each adapter extension registers, read off `contributes.debuggers`
 * in the manifest of the version named. Anything absent here is not a debug
 * type, however plausibly it is named after one.
 */
const CONTRIBUTED_DEBUG_TYPES = {
  // marus25.cortex-debug v1.12.1 -> contributes.debuggers = [{ type:
  // "cortex-debug" }]. (Its own extensionDependencies pull in
  // mcu-debug.debug-tracker-vscode / memory-view / rtos-views /
  // peripheral-viewer transitively, so we declare none of those.)
  "marus25.cortex-debug": ["cortex-debug"],
  // ms-vscode.cpptools v1.33.4 -> contributes "cppdbg" and "cppvsdbg".
  // "cppdbg" is the MI/gdb one; "cppvsdbg" is the Windows-native debugger.
  "ms-vscode.cpptools": ["cppdbg", "cppvsdbg"],
  // vadimcn.vscode-lldb v1.12.2 -> contributes.debuggers = [{ type: "lldb" }],
  // and only that. The extension is NAMED CodeLLDB; "codelldb" is not a type.
  "vadimcn.vscode-lldb": ["lldb"],
};

/** targetKind -> the debug type we emit, and the extension that owns it. */
const EXPECTED_ADAPTER = {
  "zephyr-mcu": { type: "cortex-debug", extension: "marus25.cortex-debug" },
  "baremetal-mcu": { type: "cortex-debug", extension: "marus25.cortex-debug" },
  "yocto-userspace": { type: "cppdbg", extension: "ms-vscode.cpptools" },
  "native-host": { type: "lldb", extension: "vadimcn.vscode-lldb" },
};

// EXPECTED_ADAPTER above is deliberately hand-written: it is the reviewed
// statement of what SHOULD be true, checked against silicon-level facts nobody
// can derive from the source. This test binds it to the maps the extension
// actually runs on, so a re-pointed or deleted declaration fails here instead
// of leaving four independent copies drifting apart -- which is how "native-host
// launches with codelldb" stayed green.
test("the reviewed adapter table matches the maps the core exports", () => {
  assert.deepEqual(
    Object.keys(DEBUG_TARGET_ADAPTER).sort(),
    Object.keys(EXPECTED_ADAPTER).sort(),
  );
  // Every adapter some target routes to has exactly one owning extension, and
  // the map declares no adapter no target uses.
  assert.deepEqual(
    Object.keys(DEBUG_ADAPTER_EXTENSION_ID).sort(),
    [...new Set(Object.values(DEBUG_TARGET_ADAPTER))].sort(),
  );

  for (const [targetKind, expected] of Object.entries(EXPECTED_ADAPTER)) {
    const adapter = DEBUG_TARGET_ADAPTER[targetKind];
    assert.equal(
      adapter,
      expected.type,
      `${targetKind} is declared to debug via "${adapter}"`,
    );
    assert.equal(
      DEBUG_ADAPTER_EXTENSION_ID[adapter],
      expected.extension,
      `"${adapter}" is declared to be owned by ${DEBUG_ADAPTER_EXTENSION_ID[adapter]}`,
    );
  }
});

test("every debug target kind is covered by the adapter table", () => {
  // Driven off the real exported list, so a fifth target kind fails here rather
  // than quietly skipping every check below.
  assert.deepEqual(
    DEBUG_TARGET_CHOICES.map((choice) => choice.targetKind).sort(),
    Object.keys(EXPECTED_ADAPTER).sort(),
  );
});

test("each target emits a debug type its owning extension contributes", () => {
  for (const { targetKind } of DEBUG_TARGET_CHOICES) {
    const expected = EXPECTED_ADAPTER[targetKind];
    // Every backend the target offers: the type must not vary by server, and a
    // new backend cannot slip in with a type of its own.
    for (const { server } of serverChoicesForTarget(targetKind)) {
      const config = createLaunchPreview(
        "2026-05-14T00:00:00.000Z",
        targetKind,
        server,
      ).launch.configurations[0];

      assert.equal(
        config.type,
        expected.type,
        `${targetKind}/${server} emitted debug type "${config.type}"`,
      );
      assert.ok(
        CONTRIBUTED_DEBUG_TYPES[expected.extension].includes(config.type),
        `"${config.type}" is not contributed by ${expected.extension}`,
      );
    }
  }
});

test("the extension owning each debug type is declared in package.json", () => {
  const manifest = JSON.parse(
    fs.readFileSync(path.join(root, "package.json"), "utf-8"),
  );
  // What this guarantees is narrow and worth stating exactly, because the file
  // exists to assert reality over implementation: the extension that owns the
  // type is still DECLARED, so it arrives on a first install --
  // extensionDependencies ship with us and cannot be uninstalled, extensionPack
  // entries are installed once. It does NOT guarantee the type resolves at
  // launch time: VS Code resolves `type` against extensions installed AND
  // enabled right then, so a customer who removed or disabled an extensionPack
  // entry has none. That case is a runtime one and is handled at runtime, by
  // `ensureDebugExtension` in src/debug.ts, which prompts before launching.
  const declared = new Set([
    ...(manifest.extensionDependencies ?? []),
    ...(manifest.extensionPack ?? []),
  ]);

  for (const { targetKind } of DEBUG_TARGET_CHOICES) {
    const { extension } = EXPECTED_ADAPTER[targetKind];
    assert.ok(
      declared.has(extension),
      `${targetKind} debugs via ${extension}, which package.json no longer declares in extensionDependencies or extensionPack`,
    );
  }
});
