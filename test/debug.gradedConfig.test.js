// SPDX-License-Identifier: Apache-2.0
//
// WHICH launch configuration the preflight verdict grades
// (`gradeWrittenLaunchConfig`, src/debug/service.ts).
//
// `tan debug-config` reports the draft it composed in `data.configuration` and
// MERGES that draft into the customer's `.vscode/launch.json`. The two are not
// the same object: the merge preserves a value the customer hand-filled while
// the draft still carries the placeholder tan could not resolve. Grading the
// draft therefore reports a file that launches as unlaunchable, which is #339's
// own symptom pointed the other way -- a Start Anyway gate in front of a
// session that would have worked.
//
// Every fixture below is verbatim output of the real tan 0.4.0 against the #339
// E1M-AEN801 fixture (slice `m55_he`), on a FRESH copy per run. Where a runner
// is missing it was deleted from `runners.yaml` before the run; tan exits 0 and
// says why in a note it emits alongside:
//
//   This build registers no 'pyocd' runner (runners.yaml: ["jlink",
//   "openocd"]), so its fields could not be resolved.

const test = require("node:test");
const assert = require("node:assert/strict");

const { gradeWrittenLaunchConfig } = require("../out/debug/service.js");
const {
  buildDebugPreflightReport,
  createDebugProfile,
  foldLaunchConfigPlaceholders,
} = require("../packages/alp-core/dist/debug/service.js");

const GDB_PATH =
  "/home/dev/zephyr-sdk-1.0.1/gnu/arm-zephyr-eabi/bin/arm-zephyr-eabi-gdb-py";
const ELF = "build/m55_he-zephyr/build/zephyr/zephyr.elf";
const BOARD_CFG = "/home/dev/board/e1m_aen801.cfg";

/** `data.configuration` from `--server pyocd` against a build registering no
 *  pyocd runner. `targetId` is the field tan could not resolve. */
function pyocdDraft() {
  return {
    name: "ALP: Zephyr Debug (pyOCD)",
    type: "cortex-debug",
    request: "launch",
    cwd: "${workspaceFolder}",
    executable: ELF,
    runToEntryPoint: "main",
    servertype: "pyocd",
    targetId: "<resolved-target-id>",
    gdbPath: GDB_PATH,
  };
}

/** `data.configuration` from `--server openocd` against a build registering no
 *  openocd runner. The unresolved value sits INSIDE an array. */
function openOcdDraft() {
  return {
    name: "ALP: Zephyr Debug (OpenOCD)",
    type: "cortex-debug",
    request: "launch",
    cwd: "${workspaceFolder}",
    executable: ELF,
    runToEntryPoint: "main",
    servertype: "openocd",
    configFiles: ["<resolved-openocd-board-cfg>"],
    gdbPath: GDB_PATH,
    serverpath: "/home/dev/zephyr-sdk-1.0.1/hosttools/usr/bin/openocd",
    searchDir: [
      "/home/dev/zephyr-sdk-1.0.1/hosttools/opt/openocd/share/openocd/scripts",
    ],
  };
}

function launchJson(...configurations) {
  return { version: "0.2.0", configurations };
}

/** A host-ready report: adapters installed, tool on PATH, ELF present. Every
 *  `canLaunch` below is therefore the CONFIGURATION's verdict and nothing
 *  else's. */
function hostReadyReport(server) {
  return buildDebugPreflightReport(
    "2026-05-14T00:00:00.000Z",
    {
      generatedAt: "2026-05-14T00:00:00.000Z",
      workspaceRoot: "/workspace/app",
      sdkRoot: "/workspace/sdk",
      boardYamlPath: "/workspace/app/board.yaml",
      boardYamlExists: true,
      westCwd: "/workspace/app",
      pythonBinary: "python3",
      debuggerExtensions: { cortexDebug: true, cppTools: true, codeLLDB: true },
    },
    createDebugProfile("zephyr-mcu", server),
    {
      pythonAvailable: true,
      jlinkExecutable: "/usr/bin/JLinkGDBServerCL",
      openOcdExecutable: "/usr/bin/openocd",
      pyocdExecutable: "/usr/bin/pyocd",
      gdbExecutable: "/usr/bin/gdb",
      lldbExecutable: "/usr/bin/lldb",
    },
    { pathExists: () => true },
  );
}

/** The whole production chain: read the file back, grade it, fold the verdict. */
function verdict(document, draft, server) {
  const graded = gradeWrittenLaunchConfig(document, draft);
  return {
    graded,
    report: foldLaunchConfigPlaceholders(
      hostReadyReport(server),
      graded.placeholders,
      graded.source,
    ),
  };
}

// ── The defect this seam exists for ─────────────────────────────────────────

test("a value the customer hand-filled and the merge kept is not a placeholder", () => {
  // Driven: `targetId: "cortex_m55"` was already in the customer's file, tan
  // exits 0 with `replaced: true`, the DRAFT says `<resolved-target-id>` and the
  // FILE still says `cortex_m55`. Grading the draft fails a session that runs.
  const draft = pyocdDraft();
  const onDisk = { ...draft, targetId: "cortex_m55" };

  const { graded, report } = verdict(launchJson(onDisk), draft, "pyocd");

  assert.equal(graded.source, "launchJson");
  assert.deepEqual(graded.placeholders, []);
  assert.equal(report.canLaunch, true);
  assert.equal(report.configurationGraded, "launchJson");

  // And the draft on its own is exactly what would have blocked it.
  assert.deepEqual(gradeWrittenLaunchConfig(null, draft).placeholders, [
    { key: "targetId", value: "<resolved-target-id>" },
  ]);
});

test("an array element the customer hand-filled survives tan's merge too", () => {
  // tan's array branch keeps an all-placeholder incoming list from overwriting
  // the customer's, so the draft's `configFiles[0]` is unresolved while the
  // file's is a real .cfg. Driven, same fixture, `--server openocd`.
  const draft = openOcdDraft();
  const onDisk = { ...draft, configFiles: [BOARD_CFG] };

  const { graded, report } = verdict(launchJson(onDisk), draft, "openocd");

  assert.equal(graded.source, "launchJson");
  assert.deepEqual(graded.placeholders, []);
  assert.equal(report.canLaunch, true);
});

// ── The failing cases must not weaken ───────────────────────────────────────

test("a placeholder really in the file still blocks the launch and names the key", () => {
  // Same run with nothing hand-filled: tan appends `<resolved-target-id>` to
  // the customer's entry, so the file carries it and the verdict must too.
  const draft = pyocdDraft();

  const { graded, report } = verdict(launchJson({ ...draft }), draft, "pyocd");

  assert.equal(graded.source, "launchJson");
  assert.deepEqual(graded.placeholders, [
    { key: "targetId", value: "<resolved-target-id>" },
  ]);
  assert.equal(report.canLaunch, false);
  const check = report.checks.find((entry) => entry.name === "targetId");
  assert.equal(check.status, "fail");
  assert.equal(check.detail, "<resolved-target-id>");
});

test("a placeholder inside an array in the file is named by its index", () => {
  const draft = openOcdDraft();

  const { graded, report } = verdict(
    launchJson({ ...draft }),
    draft,
    "openocd",
  );

  assert.equal(graded.source, "launchJson");
  assert.deepEqual(graded.placeholders, [
    { key: "configFiles[0]", value: "<resolved-openocd-board-cfg>" },
  ]);
  assert.equal(report.canLaunch, false);
  const check = report.checks.find((entry) => entry.name === "configFiles[0]");
  assert.equal(check.status, "fail");
  assert.equal(check.detail, "<resolved-openocd-board-cfg>");
});

// ── A failed read falls back, and says so ───────────────────────────────────

test("an unreadable launch.json grades the CLI envelope and labels it", () => {
  const draft = pyocdDraft();
  // `readLaunchJsonDocument` returns null for all three of "no file", "does not
  // parse" (JSONC included) and "not an object" -- one path here.
  for (const document of [
    null,
    { version: "0.2.0" }, // present, but no `configurations` array
    launchJson({ name: "Some other profile", type: "node" }), // no entry of ours
  ]) {
    const { graded, report } = verdict(document, draft, "pyocd");
    assert.equal(graded.source, "cliEnvelope");
    assert.deepEqual(graded.placeholders, [
      { key: "targetId", value: "<resolved-target-id>" },
    ]);
    // The fallback must not invent a green verdict: the draft's placeholder
    // still blocks, and the label says the file was never read.
    assert.equal(report.canLaunch, false);
    assert.equal(report.configurationGraded, "cliEnvelope");
  }
});

// ── Found by name, never by prefix ──────────────────────────────────────────

test("the entry is found by tan's own name, not by an ALP:/Alp: prefix guess", () => {
  // The orphan this file's neighbour repairs: a pre-#387 `Alp:` entry, fully
  // resolved, sitting beside the `ALP:` entry tan 0.4.0 maintains. Prefix
  // matching would grade the wrong one -- and would call this launchable while
  // F5 uses the entry that still says `<resolved-target-id>`.
  const draft = pyocdDraft();
  const document = launchJson(
    { ...draft, name: "Alp: Zephyr Debug (pyOCD)", targetId: "cortex_m55" },
    { ...draft },
  );

  const { graded, report } = verdict(document, draft, "pyocd");

  assert.equal(graded.source, "launchJson");
  assert.deepEqual(graded.placeholders, [
    { key: "targetId", value: "<resolved-target-id>" },
  ]);
  assert.equal(report.canLaunch, false);
});
