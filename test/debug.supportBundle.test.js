// SPDX-License-Identifier: Apache-2.0
//
// The two notes `Alp: Export support bundle` writes into the file a customer
// sends AFTER a debug session has already failed.
//
// This surface never reads the written `launch.json` — no diagnostic path
// spawns tan — so the report it embeds grades HOST readiness and nothing else
// (#339). A bundle that labelled that verdict `canLaunch=` would tell its
// reader the profile launches while the session is dying on a placeholder
// inside the file, i.e. send them to the wrong half of the problem. So the note
// says `hostReady=`, and `configurationGraded=` beside it says the
// configuration was not read at all.
//
// The report FIELD is guarded in test/debug.service.test.js and the panel line
// in test/debug.panelHtml.test.js. Neither sees this string: `src/debug.ts`
// builds it by hand, and a grep for `hostReady` across `test/` returned nothing
// before this file existed. So the whole reason the marker was added was the
// one surface with no test on it.
//
// Drives the REAL registered handler out of `out/debug.js` (same `Module._load`
// swap as test/west.noWorkspace.test.js) and reads the notes back off the
// serialized bundle. `@alp-sdk/core/debug/service` is pure and is loaded FOR
// REAL, so `hostReady=true` here is the genuine `buildDebugPreflightReport`
// verdict, not a stub's.

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const Module = require("node:module");

const root = path.join(__dirname, "..");

/** Load out/debug.js with `stubs` standing in for the requires named. Swaps
 *  Node's loader only for the duration of the synchronous require, so it never
 *  leaks into another test file sharing the process. */
function loadDebug(stubs) {
  const modPath = require.resolve(path.join(root, "out", "debug.js"));
  delete require.cache[modPath];
  const originalLoad = Module._load;
  Module._load = function (request, ...rest) {
    return Object.prototype.hasOwnProperty.call(stubs, request)
      ? stubs[request]
      : originalLoad.call(this, request, ...rest);
  };
  try {
    return require(modPath);
  } finally {
    Module._load = originalLoad;
    delete require.cache[modPath];
  }
}

/** A host with everything a zephyr-mcu/jlink session needs: both pickers answer
 *  with the first choice, every adapter extension is installed, every tool is
 *  on PATH, and the ELF exists. That is the dangerous combination — the report
 *  passes, and it still read no `launch.json`. */
/** Default `tan doctor` result: a healthy report, one row. Override via
 *  `runDebugDoctor` to drive the unavailable path. */
const DOCTOR_DATA = {
  checks: [{ name: "sdk", status: "pass", detail: "alp-sdk v0.6.0" }],
  summary: { pass: 1, warn: 0, fail: 0 },
};

function register({
  pathExists = () => true,
  runDebugDoctor = async () => ({ data: DOCTOR_DATA, message: "ok" }),
} = {}) {
  const written = [];

  const { registerDebugCommands } = loadDebug({
    vscode: {
      commands: {
        registerCommand(id, handler) {
          return { id, handler, dispose() {} };
        },
      },
      window: {
        // pickTargetKind / pickServer both take the head of the list:
        // zephyr-mcu, then jlink.
        showQuickPick: async (items) => items[0],
        showTextDocument: async () => undefined,
      },
      workspace: {
        openTextDocument: async () => ({}),
        asRelativePath: (value) => value,
      },
    },
    "./debug/vscodeAdapter": {
      collectWorkspaceDebugContext: () => ({
        generatedAt: "2026-07-28T00:00:00.000Z",
        workspaceRoot: "/w",
        sdkRoot: "/w",
        boardYamlPath: "/w/board.yaml",
        boardYamlExists: true,
        westCwd: "/w",
        pythonBinary: "python3",
        debuggerExtensions: {
          cortexDebug: true,
          cppTools: true,
          codeLLDB: true,
        },
      }),
      collectRuntimeCapabilities: () => ({
        pythonAvailable: true,
        jlinkExecutable: "/usr/bin/JLinkGDBServer",
        openOcdExecutable: "/usr/bin/openocd",
        pyocdExecutable: "/usr/bin/pyocd",
        gdbExecutable: "/usr/bin/gdb",
        lldbExecutable: "/usr/bin/lldb",
        hostPlatform: "linux",
      }),
      fileExists: pathExists,
      writeSupportBundle: (workspaceRoot, fileName, content) => {
        written.push({ workspaceRoot, fileName, content });
        return path.posix.join(workspaceRoot, ".alp-support", fileName);
      },
      runDebugDoctor,
    },
    // Module-level imports of src/debug.ts that would otherwise drag a terminal
    // or the west surface in. Nothing under test reaches them.
    "./alpCli/vscodeAdapter": { runAlpCommand: async () => ({}) },
    "./west": { ensureNativeSimOverlay: async () => true },
    "./util": { log() {}, showOutput() {} },
    "./notify/vscodeAdapter": { notify: async () => undefined },
  });

  const handlers = new Map(
    registerDebugCommands({}).map((entry) => [entry.id, entry.handler]),
  );
  return { handlers, written };
}

/** The `notes` array off the one bundle the command wrote. */
async function exportBundle(options) {
  const { handlers, written } = register(options);
  await handlers.get("alp.exportSupportBundle")();
  assert.equal(written.length, 1, "the command must write exactly one bundle");
  return JSON.parse(written[0].content);
}

test("the support bundle labels a host-only verdict hostReady, never canLaunch", async () => {
  const bundle = await exportBundle();

  assert.deepEqual(bundle.notes, [
    "targetKind=zephyr-mcu",
    "server=jlink",
    "hostReady=true",
    "configurationGraded=none",
  ]);

  // The failure this note exists to prevent, asserted as its own sentence: the
  // bundle is read by someone whose session already died, and `canLaunch=true`
  // on a file nothing read points them away from the placeholder that killed
  // it. `hostReady` may never quietly become `canLaunch` again.
  assert.equal(
    bundle.notes.some((note) => note.startsWith("canLaunch=")),
    false,
    "no note may call a configuration-blind verdict canLaunch",
  );
  // And the embedded report must agree with the note it is labelled by.
  assert.equal(bundle.preflight.canLaunch, true);
  assert.equal(bundle.preflight.configurationGraded, "none");
});

// #376: the doctor half of the bundle is now `tan doctor`'s own envelope,
// verbatim — no allowlist, no recomputed counts, an `unknown` status renders
// as itself.
test("the support bundle carries tan's doctor envelope verbatim, including an `unknown` status", async () => {
  const data = {
    checks: [
      { name: "sdk", status: "pass", detail: "alp-sdk v0.6.0" },
      {
        name: "codeLLDBExtension",
        status: "unknown",
        detail:
          "unknown — the standalone tan binary cannot see VS Code's installed extensions.",
      },
    ],
    summary: { pass: 1, warn: 0, fail: 0 },
  };
  const bundle = await exportBundle({
    runDebugDoctor: async () => ({ data, message: "ok" }),
  });

  assert.deepEqual(bundle.doctor, { kind: "envelope", data });
});

// #376 decision 5: a customer exports this bundle precisely when things are
// broken — i.e. exactly when `tan` may be unresolvable — so the bundle must
// still be WRITTEN, carrying the resolver's own failure verbatim rather than
// a silently absent doctor section.
test("the support bundle is still written when tan is unresolvable, and the doctor section says so verbatim", async () => {
  const bundle = await exportBundle({
    runDebugDoctor: async () => ({
      data: null,
      message:
        "tan could not be resolved: no prebuilt tan CLI is available for this platform.",
    }),
  });

  assert.deepEqual(bundle.doctor, {
    kind: "unavailable",
    error:
      "tan could not be resolved: no prebuilt tan CLI is available for this platform.",
  });
  // The rest of the bundle — preflight + inspect — is unaffected by the
  // doctor being unresolvable.
  assert.equal(bundle.preflight.canLaunch, true);
  assert.ok(bundle.inspect);
});

test("the support bundle reports the host NOT ready when it is not", async () => {
  // Same run, one host fact flipped: the ELF was never built. `hostReady` has
  // to track the report rather than be a constant.
  const bundle = await exportBundle({ pathExists: () => false });

  assert.ok(bundle.notes.includes("hostReady=false"));
  assert.ok(bundle.notes.includes("configurationGraded=none"));
});
