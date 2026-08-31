// SPDX-License-Identifier: Apache-2.0
//
// The doctor rows a customer about to FLASH needs to have seen (#615), and the
// Flash command that now asks for them.
//
// ── The gap ─────────────────────────────────────────────────────────────────
//
// tan works out that this host cannot program the part, precisely and
// actionably, and said so only inside a panel the customer may never open. The
// checks below are VERBATIM from `tan doctor --format json` on this bench host
// at tan 0.6.0 / alp-sdk v0.16.0-rc1 — `data.checks[]`, with the two absolute
// paths in `jlink.detail` left exactly as tan wrote them, because a rounded
// path is how a reader stops trusting a fixture.
//
// `jlink` is the one that matters: on AEN hardware V9.26-vs-V9.46 is the
// difference between a flash that programs MRAM and one that does not.

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const Module = require("node:module");

const root = path.join(__dirname, "..");
const {
  collectFlashReadinessWarnings,
  describeFlashReadiness,
  flashReadinessDetail,
  flashReadinessModalDetail,
  FLASH_READINESS_CHECKS,
} = require("../packages/alp-core/dist/deps/flashReadiness.js");

// ---------------------------------------------------------------------------
// Captured checks
// ---------------------------------------------------------------------------

const JLINK_WARN = {
  name: "jlink",
  status: "warn",
  scope: "host",
  detail:
    "J-Link V9.26 (/usr/local/bin/JLinkExe) predates V9.46, which is where Alif's MRAM flash loader became built in -- Flow D has nothing to program MRAM with on this DLL. Flow D needs the `AE822FA0E5597LS0_M55_HE` part-number device profile (NOT the generic `Cortex-M55`, which has no MRAM loader) and a J-Link DLL V9.46+. Device profile resolved from: /Users/hakan/.alp/sdk/v0.16.0-rc1/metadata/socs/alif/ensemble/e8.json.",
  fix: "Upgrade the SEGGER J-Link pack to V9.46+.",
};

const SETOOLS_UNKNOWN = {
  name: "setools",
  status: "unknown",
  scope: "host",
  detail:
    "AEN MRAM flashing over the SE-UART is Linux-only in this tree: scripts/west_commands/runners/alif_flash.py hard-codes `app-release-exec-linux`, so its bundle is `app-release-exec-linux-SE_FW_x.y.z`. Nothing to check on this host for THAT path -- run it from WSL2/Linux (Windows hosts pass the SE-UART through with usbipd).",
};

/** `warn`, and NOT about programming a device. The reason this module carries a
 *  list rather than "every warning". */
const PYTHON_FLOOR_WARN = {
  name: "pythonFloor",
  status: "warn",
  scope: "host",
  detail:
    "alp-sdk's metadata/bootstrap.json declares pythonMinVersion 3.10, but the build's effective floor is higher.",
};

const JLINK_PASS = { name: "jlink", status: "pass", scope: "host", detail: "" };

// ---------------------------------------------------------------------------
// collectFlashReadinessWarnings
// ---------------------------------------------------------------------------

test("the captured warn row is picked up with tan's own strings", () => {
  assert.deepEqual(
    collectFlashReadinessWarnings([SETOOLS_UNKNOWN, JLINK_WARN]),
    [
      {
        name: "jlink",
        status: "warn",
        detail: JLINK_WARN.detail,
        fix: JLINK_WARN.fix,
      },
    ],
  );
});

test("an `unknown` row is NOT a problem", () => {
  assert.deepEqual(
    collectFlashReadinessWarnings([SETOOLS_UNKNOWN]),
    [],
    "`unknown` is tan declining to answer — its own detail says `Nothing to " +
      "check on this host for THAT path`. Reporting a declined check as a " +
      "problem is how a warning becomes noise on every macOS flash.",
  );
});

test("a warning that is not about programming a device is left alone", () => {
  assert.deepEqual(
    collectFlashReadinessWarnings([PYTHON_FLOOR_WARN, JLINK_PASS]),
    [],
    "`pythonFloor` warns on this same host and has nothing to do with " +
      "writing to a board; a dialog that cries about everything trains the " +
      "customer to click past the one that mattered",
  );
});

test("a passing flash-relevant row raises nothing", () => {
  assert.deepEqual(collectFlashReadinessWarnings([JLINK_PASS]), []);
});

test("`fail` counts as well as `warn`", () => {
  const warnings = collectFlashReadinessWarnings([
    { ...JLINK_WARN, status: "fail" },
  ]);
  assert.equal(warnings.length, 1);
  assert.equal(warnings[0].status, "fail", "tan's word, never recomputed");
});

test("an unseen status word raises nothing", () => {
  assert.deepEqual(
    collectFlashReadinessWarnings([{ ...JLINK_WARN, status: "degraded" }]),
    [],
    "stopping a flash on a word this extension has never seen would keep a " +
      "customer from their board over a vocabulary change",
  );
});

test("warnings come back in FLASH_READINESS_CHECKS order, not envelope order", () => {
  const warnings = collectFlashReadinessWarnings([
    { ...SETOOLS_UNKNOWN, status: "fail" },
    JLINK_WARN,
  ]);
  assert.deepEqual(
    warnings.map((w) => w.name),
    [...FLASH_READINESS_CHECKS],
    "the dialog must not reorder itself because tan reordered its checks",
  );
});

test("a duplicate name reads the FIRST entry, never the last", () => {
  const warnings = collectFlashReadinessWarnings([
    JLINK_WARN,
    { ...JLINK_WARN, status: "pass" },
  ]);
  assert.equal(
    warnings.length,
    1,
    "a later `pass` must not silently cancel an earlier `warn` — that would " +
      "make the warning depend on list order in a malformed envelope",
  );
});

test("a payload that is not a list of checks raises nothing and never throws", () => {
  for (const checks of [undefined, null, "checks", 5, {}, [null], [{}], [[]]]) {
    assert.deepEqual(
      collectFlashReadinessWarnings(checks),
      [],
      `${JSON.stringify(checks ?? String(checks))} did not answer []`,
    );
  }
});

test("a row with no detail or fix still warns", () => {
  const warnings = collectFlashReadinessWarnings([
    { name: "jlink", status: "warn" },
  ]);
  assert.deepEqual(warnings, [
    { name: "jlink", status: "warn", detail: null, fix: null },
  ]);
});

// ---------------------------------------------------------------------------
// The rendered strings
// ---------------------------------------------------------------------------

test("the dialog title names the checks and asks a question", () => {
  const message = describeFlashReadiness(
    collectFlashReadinessWarnings([JLINK_WARN]),
  );
  assert.match(message, /jlink/);
  assert.match(message, /Flash anyway\?/);
  assert.doesNotMatch(
    message,
    /\/Users\/|\/usr\/local/,
    "tan's detail carries absolute paths, and `planFailure`'s leak filter " +
      "would demote a sentence containing one out of the toast entirely",
  );
});

test("the dialog BODY carries tan's detail and fix verbatim", () => {
  const body = flashReadinessModalDetail(
    collectFlashReadinessWarnings([JLINK_WARN]),
  );
  assert.ok(
    body.includes(JLINK_WARN.detail),
    "the reason must be on the dialog: a customer deciding whether to spend " +
      "a bench slot needs it in front of them, not in a channel",
  );
  assert.ok(body.includes(`Fix: ${JLINK_WARN.fix}`));
});

test("the channel record carries the status word too", () => {
  const line = flashReadinessDetail(
    collectFlashReadinessWarnings([JLINK_WARN]),
  );
  assert.match(line, /^jlink \(warn\)/);
  assert.ok(line.includes(JLINK_WARN.fix));
});

// ---------------------------------------------------------------------------
// The Flash command, driven
// ---------------------------------------------------------------------------

/**
 * Run one `alp.westAlpFlash`.
 *
 * `doctor` is scripted; the flash dispatch is recorded rather than run. An argv
 * this test did not expect THROWS.
 */
async function driveFlash({ doctor, answer }) {
  const streamed = [];
  const envelopeArgvs = [];
  const notified = [];
  const logs = [];
  const commands = new Map();

  const modPath = require.resolve(path.join(root, "out", "west.js"));
  delete require.cache[modPath];
  const stubs = {
    fs: { existsSync: () => true },
    vscode: {
      commands: {
        registerCommand: (id, cb) => {
          commands.set(id, cb);
          return { dispose() {} };
        },
      },
      window: {},
      workspace: { getConfiguration: () => ({ get: () => undefined }) },
    },
    "./alpCli/vscodeAdapter": {
      runAlpCommand: async (_ctx, args, cwd) => {
        envelopeArgvs.push({ args, cwd });
        if (args[0] === "doctor") {
          if (!doctor) throw new Error("doctor ran but was not scripted");
          return doctor;
        }
        throw new Error(`unexpected envelope argv ${JSON.stringify(args)}`);
      },
      runAlpStreamed: async (_ctx, args, options) => {
        streamed.push({ args, options });
      },
      runAlpInTerminal: async () => {},
    },
    "./build/somCliFloorGuard": { warnIfCliCannotBuildSom: async () => {} },
    "./notify/vscodeAdapter": {
      notify: async (plan) => {
        notified.push(plan);
        return plan.channel === "modal" ? answer : undefined;
      },
      notifyAsync: (plan) => notified.push(plan),
    },
    "./util": {
      BUILD_RUN_NAME: "Alp Build",
      FLASH_RUN_NAME: "Alp Flash",
      log: (line) => logs.push(line),
    },
    "./west/vscodeAdapter": {
      collectWestWorkspaceContext: () => ({
        boardYamlPath: "/home/dev/proj/board.yaml",
        workspaceRoot: "/home/dev/proj",
      }),
      executeWestPlan: async () => {},
      pickAppPath: async () => undefined,
    },
  };

  const originalLoad = Module._load;
  Module._load = function (request, ...rest) {
    return Object.prototype.hasOwnProperty.call(stubs, request)
      ? stubs[request]
      : originalLoad.call(this, request, ...rest);
  };
  let registerWestCommands;
  try {
    ({ registerWestCommands } = require(modPath));
  } finally {
    Module._load = originalLoad;
    delete require.cache[modPath];
  }

  registerWestCommands({});
  const run = commands.get("alp.westAlpFlash");
  assert.ok(run, "alp.westAlpFlash was never registered");
  await run();
  return { streamed, envelopeArgvs, notified, logs };
}

const doctorWith = (checks) => ({
  outcome: {
    ok: true,
    exitCode: 0,
    severity: "info",
    envelope: { ok: true, issues: [], data: { checks } },
  },
});

test("a clean doctor flashes with no extra dialog", async () => {
  const result = await driveFlash({ doctor: doctorWith([JLINK_PASS]) });
  assert.equal(result.streamed.length, 1);
  assert.deepEqual(result.streamed[0].args, ["flash"]);
  assert.equal(
    result.notified.filter((p) => p.channel === "modal").length,
    0,
    "a host with nothing wrong must not gain a dialog",
  );
});

test("the flash-blocking J-Link warning is put in front of the customer", async () => {
  const result = await driveFlash({
    doctor: doctorWith([SETOOLS_UNKNOWN, JLINK_WARN, PYTHON_FLOOR_WARN]),
    answer: "applyChanges",
  });
  const modal = result.notified.find((p) => p.channel === "modal");
  assert.ok(
    modal,
    "tan worked this out and the flash path never asked — a corner toast is " +
      "easy to miss and the cost of missing it is a bench slot",
  );
  assert.match(modal.message, /jlink/);
  assert.ok(modal.modalDetail.includes("V9.46"));
  assert.ok(
    !modal.modalDetail.includes("pythonFloor"),
    "an unrelated warning on the same host must not ride along",
  );
});

test("DECLINING the readiness dialog spawns no flash at all", async () => {
  const result = await driveFlash({
    doctor: doctorWith([JLINK_WARN]),
    answer: undefined,
  });
  assert.deepEqual(
    result.streamed,
    [],
    "the dialog is the gate; a declined warning that still writes the board " +
      "is worse than no dialog",
  );
});

test("accepting it flashes, because the warning is not universal", async () => {
  const result = await driveFlash({
    doctor: doctorWith([JLINK_WARN]),
    answer: "applyChanges",
  });
  assert.equal(
    result.streamed.length,
    1,
    "`jlink` is about Alif's Flow D; a customer flashing a Renesas part is " +
      "right to continue, so this is a confirm and not a refusal",
  );
});

test("a doctor that could not run does not stand between the customer and the board", async () => {
  const result = await driveFlash({
    doctor: { outcome: { ok: false, exitCode: 1, envelope: null } },
  });
  assert.equal(
    result.streamed.length,
    1,
    '"tan did not tell us" is not "tan said no"',
  );
  assert.equal(result.notified.filter((p) => p.channel === "modal").length, 0);
});

test("the doctor spawn runs in the project, and is the only envelope command", async () => {
  const result = await driveFlash({ doctor: doctorWith([JLINK_PASS]) });
  assert.deepEqual(result.envelopeArgvs, [
    { args: ["doctor"], cwd: "/home/dev/proj" },
  ]);
});
