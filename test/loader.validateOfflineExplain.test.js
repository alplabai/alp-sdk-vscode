// SPDX-License-Identifier: Apache-2.0
//
// `runValidator`'s two additions to the "Validate board.yaml" flow
// (`src/loader.ts`):
//
//   #619 — `tan validate --offline` fallback when NO SDK is resolved
//   (tan's own `validate.sdk-root-unresolved`), reported as the REDUCED
//   check it is — never the "board.yaml is clean" sentence a real
//   (SDK-backed) validation earns. Measured at tan 0.6.0: `--offline`
//   answered ok true / exit 0 / issues [] for a board.yaml a resolved SDK
//   rejected with TWO ALP-B00x errors.
//
//   #617 — a validate FAILURE's issues carry their ALP-Bxxx code INSIDE the
//   message text, not on `issues[].code`. `runValidator` extracts every
//   distinct code and offers one "Explain <code>" action per code, backed by
//   the new `alp.explainDiagnosticCode` command (`tan explain --code`).
//
// Drives the REAL compiled `out/loader.js` with every host seam stubbed —
// the same `Module._load` swap `test/validation.migrateCheck.test.js` uses.
// An unscripted `runAlpCommand` argv throws rather than returning something
// benign, so a path this file did not mean to exercise is loud, not silently
// green.

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const Module = require("node:module");

const root = path.join(__dirname, "..");

const VALIDATE_CLEAN = { ok: true, issues: [], data: {} };

/** The measured two-error board.yaml (#619's own fixture). */
const VALIDATE_TWO_ERRORS = {
  ok: false,
  issues: [
    {
      code: "validate.schema-violation",
      severity: "error",
      message:
        "ALP-B002: unknown key 'totally_unknown_key'\n  see: docs/diagnostics/ALP-B002.md",
    },
    {
      code: "validate.schema-violation",
      severity: "error",
      message:
        "ALP-B003: 'verbose' is not one of ['error','warn','info','debug','trace']\n  hint: ...\n  see: docs/diagnostics/ALP-B003.md",
    },
  ],
  data: {},
};

const MIGRATE_CLEAN = {
  ok: true,
  issues: [],
  data: { stdout: "alp-migrate: all board.yaml at v1.\n", stderr: "" },
};

const EXPLAIN_B003 = {
  ok: true,
  issues: [],
  data: {
    selector: { kind: "diagnostic-code", value: "ALP-B003" },
    summary: "ALP-B003 (runtime-diagnostic)",
    details: [
      "summary: value violates an enum or pattern constraint",
      "cause: - A value with the right idea but the wrong spelling...",
    ],
  },
};

const ok = (envelope) => ({
  ok: envelope.ok,
  exitCode: envelope.ok ? 0 : 2,
  severity: envelope.ok ? "info" : "error",
  message: "unused",
  envelope,
});

/**
 * Load `out/loader.js` fresh under the given stubs and register its
 * commands. `unresolved` makes the FIRST `validate` answer tan's own
 * `validate.sdk-root-unresolved` — which is what the retry decides on now,
 * rather than a locally computed `sdkRoot` (a COMPETING resolution: measured,
 * tan walks up to an enclosing checkout while `resolveSdkRoot` does not)
 * triggers the #619 offline fallback, a string does not.
 */
function driveLoader({ unresolved, validate, migrate, explain }) {
  const notified = [];
  const logs = [];
  const argvs = [];
  const cwds = [];
  const commands = new Map();
  let outputRevealed = false;

  const modPath = require.resolve(path.join(root, "out", "loader.js"));
  delete require.cache[modPath];
  const stubs = {
    vscode: {
      commands: {
        registerCommand: (id, cb) => {
          commands.set(id, cb);
          return { dispose() {} };
        },
      },
      window: {
        withProgress: async (_options, task) =>
          task(
            { report() {} },
            {
              isCancellationRequested: false,
              onCancellationRequested: () => ({ dispose() {} }),
            },
          ),
      },
      ProgressLocation: { Notification: 15 },
    },
    "./alpCli/vscodeAdapter": {
      runAlpCommand: async (_ctx, args, cwd) => {
        argvs.push(args);
        cwds.push(cwd);
        if (args[0] === "validate") {
          // The FIRST `validate` (no `--offline`) answers tan's own
          // unresolved-SDK code when this case is driving that path; the
          // scripted outcome is what the RETRY returns. That mirrors the real
          // sequence: ask, read tan's answer, retry reduced.
          if (unresolved && !args.includes("--offline")) {
            return {
              outcome: {
                ok: false,
                exitCode: 2,
                severity: "error",
                message: "validate failed",
                envelope: {
                  ok: false,
                  issues: [
                    {
                      code: "validate.sdk-root-unresolved",
                      severity: "error",
                      message:
                        "alp-sdk root is unresolved. Use --sdk-root, place the project near an alp-sdk checkout, ...",
                    },
                  ],
                  data: {},
                },
              },
            };
          }
          if (!validate) {
            throw new Error("validate ran when this test did not script it");
          }
          return { outcome: validate };
        }
        if (args[0] === "migrate") {
          if (!migrate) {
            throw new Error(
              "migrate --check ran when this test did not script it",
            );
          }
          return { outcome: migrate };
        }
        if (args[0] === "explain") {
          if (!explain) {
            throw new Error("explain ran when this test did not script it");
          }
          return { outcome: explain };
        }
        throw new Error(`unexpected argv ${JSON.stringify(args)}`);
      },
    },
    "./project/vscodeAdapter": {
      collectProjectContext: () => ({
        unresolved: false,
        workspaceRoot: "/home/dev/proj",
      }),
      readOnlyProjectCwd: () => "/home/dev/proj",
    },
    "./loader/vscodeAdapter": {
      boardYamlExists: () => true,
      collectLoaderWorkspaceContext: () => ({
        workspaceRoot: "/home/dev/proj",
      }),
      previewGeneratedFile: async () => undefined,
    },
    "./notify/vscodeAdapter": {
      notify: async (plan) => {
        notified.push(plan);
        return undefined;
      },
      notifyAsync: (plan) => notified.push(plan),
    },
    "./util": {
      log: (line) => logs.push(line),
      showOutput() {
        outputRevealed = true;
      },
    },
  };

  const originalLoad = Module._load;
  Module._load = function (request, ...rest) {
    return Object.prototype.hasOwnProperty.call(stubs, request)
      ? stubs[request]
      : originalLoad.call(this, request, ...rest);
  };
  let mod;
  try {
    mod = require(modPath);
  } finally {
    Module._load = originalLoad;
    delete require.cache[modPath];
  }

  mod.registerLoaderCommands({});
  return {
    commands,
    notified,
    logs,
    argvs,
    cwds,
    get outputRevealed() {
      return outputRevealed;
    },
  };
}

async function runValidate(scripted) {
  const drive = driveLoader(scripted);
  const run = drive.commands.get("alp.validateBoardYaml");
  assert.ok(run, "alp.validateBoardYaml was never registered");
  await run();
  return drive;
}

// ---------------------------------------------------------------------------
// #619 — the --offline fallback, gated on tan's OWN unresolved-SDK code
// ---------------------------------------------------------------------------

test("tan's own unresolved-SDK answer is what triggers --offline", async () => {
  const drive = await runValidate({
    unresolved: true,
    validate: ok(VALIDATE_CLEAN),
  });
  assert.deepEqual(
    drive.argvs,
    [["validate"], ["validate", "--offline"]],
    "ASK, then retry. An earlier version decided this locally from " +
      "`collectProjectContext().sdkRoot`, which is a COMPETING resolution — " +
      "measured, tan walks up to an enclosing alp-sdk checkout while " +
      "`resolveSdkRoot` looks only at the workspace folder, a `../alp-sdk` " +
      "sibling and `~/.alp/sdk/*`. A project at `<checkout>/examples/app` " +
      "would have been forced onto the reduced check AND told no SDK was " +
      "active, both wrong, while tan would have run the full one.",
  );
});

test("an SDK resolved: validate runs WITHOUT --offline, and asks the migrator", async () => {
  const drive = await runValidate({
    unresolved: false,
    validate: ok(VALIDATE_CLEAN),
    migrate: ok(MIGRATE_CLEAN),
  });
  assert.deepEqual(drive.argvs, [["validate"], ["migrate", "--check"]]);
});

test("an offline clean result is NEVER reported as 'board.yaml is clean'", async () => {
  const drive = await runValidate({
    unresolved: true,
    validate: ok(VALIDATE_CLEAN),
  });
  assert.equal(drive.notified.length, 1);
  const plan = drive.notified[0];
  assert.doesNotMatch(
    plan.message,
    /is clean/,
    "`--offline` misses whatever only the SDK's schema data catches " +
      "(measured: two ALP-B00x errors on a file it called clean) — the " +
      "customer must not be told this is the same verdict a real " +
      "validation gives",
  );
});

test("an offline clean result says plainly that only tan's own checks ran", async () => {
  const drive = await runValidate({
    unresolved: true,
    validate: ok(VALIDATE_CLEAN),
  });
  const plan = drive.notified[0];
  assert.match(plan.message, /built-in structural checks/);
  assert.match(plan.message, /no SDK is active/i);
  assert.equal(
    plan.severity,
    "warning",
    "a reduced check earns a warning, not the transient status-bar info a " +
      "real clean validation gets",
  );
});

test("an offline clean result offers to select an SDK, not a bare dismiss", async () => {
  const drive = await runValidate({
    unresolved: true,
    validate: ok(VALIDATE_CLEAN),
  });
  const plan = drive.notified[0];
  assert.ok(
    plan.actions.some((a) => a.id === "openSdkManager"),
    "the fix for 'no SDK is active' is on the plan, not just named in prose",
  );
});

test("the migrator is NEVER asked on the offline path (no SDK to ask it about)", async () => {
  const drive = await runValidate({
    unresolved: true,
    validate: ok(VALIDATE_CLEAN),
  });
  assert.deepEqual(
    drive.argvs,
    [["validate"], ["validate", "--offline"]],
    "a migrate --check call here would be the exact trap this fallback " +
      "must avoid: `checkMigrator` reports its OWN 'board.yaml is clean' " +
      "when migrate is unavailable, which is the sentence #619 forbids",
  );
});

test("an ordinary (SDK-resolved) validation FAILURE does not retry into --offline", async () => {
  const drive = await runValidate({
    unresolved: false,
    validate: ok(VALIDATE_TWO_ERRORS),
  });
  assert.deepEqual(
    drive.argvs,
    [["validate"]],
    "the offline flag is decided ONCE from sdkRoot, before the outcome is " +
      "even known — a genuine failure with an SDK resolved must not be " +
      "misread as a reason to fall back",
  );
});

// ---------------------------------------------------------------------------
// #617 — explain actions on a validate failure
// ---------------------------------------------------------------------------

test("the OFFLINE path offers no Explain action, even when a code is present", async () => {
  // `tan explain --code` needs a resolved SDK to read the catalogue from, and
  // on this path there is none by construction — measured at the pin it exits
  // 1 with `explain.sdk-root-unresolved`. Today tan 0.6.0's own offline
  // messages happen to carry no ALP-Bxxx token, so the list would be empty
  // anyway; this drives one that DOES, because a button whose only possible
  // outcome is a failure must not depend on that staying true.
  const drive = await runValidate({
    unresolved: true,
    validate: ok({
      ok: false,
      issues: [
        {
          code: "validate.schema-violation",
          severity: "error",
          message: "ALP-B002: unknown key 'totally_unknown_key'",
        },
      ],
      data: {},
    }),
  });
  const offered = JSON.stringify(drive.notified);
  assert.ok(
    !offered.includes("explainDiagnostic"),
    "an Explain button on the offline path can only ever fail: " +
      `${offered.slice(0, 300)}`,
  );
});

test("a two-error board.yaml offers BOTH explain actions, not just the first", async () => {
  const drive = await runValidate({
    unresolved: false,
    validate: ok(VALIDATE_TWO_ERRORS),
  });
  const plan = drive.notified.at(-1);
  const explainActions = plan.actions.filter(
    (a) => a.id === "explainDiagnostic",
  );
  assert.deepEqual(
    explainActions.map((a) => a.arg),
    ["ALP-B002", "ALP-B003"],
  );
  assert.deepEqual(
    explainActions.map((a) => a.title),
    ["Explain ALP-B002", "Explain ALP-B003"],
  );
  assert.ok(
    plan.actions.some((a) => a.id === "openBoardYaml"),
    "the explain actions are ADDED to the existing remedy, not a replacement for it",
  );
});

test("a failure whose message names no ALP-Bxxx code offers no explain action, and does not throw", async () => {
  const drive = await runValidate({
    unresolved: false,
    validate: ok({
      ok: false,
      issues: [
        {
          code: "validate.parse-error",
          severity: "error",
          message: "board.yaml: mapping values are not allowed here",
        },
      ],
      data: {},
    }),
  });
  const plan = drive.notified.at(-1);
  assert.deepEqual(
    plan.actions.filter((a) => a.id === "explainDiagnostic"),
    [],
    "a miss (#617's own rule) degrades to no action, never an error",
  );
});

test("a repeated code across issues is offered once, not twice", async () => {
  const drive = await runValidate({
    unresolved: false,
    validate: ok({
      ok: false,
      issues: [
        {
          code: "validate.schema-violation",
          severity: "error",
          message: "ALP-B002: unknown key 'a'",
        },
        {
          code: "validate.schema-violation",
          severity: "error",
          message: "ALP-B002: unknown key 'b'",
        },
      ],
      data: {},
    }),
  });
  const plan = drive.notified.at(-1);
  assert.deepEqual(
    plan.actions.filter((a) => a.id === "explainDiagnostic").map((a) => a.arg),
    ["ALP-B002"],
  );
});

// ---------------------------------------------------------------------------
// alp.explainDiagnosticCode — the command an explain action runs
// ---------------------------------------------------------------------------

async function runExplain(code, scripted) {
  const drive = driveLoader(scripted);
  const run = drive.commands.get("alp.explainDiagnosticCode");
  assert.ok(run, "alp.explainDiagnosticCode was never registered");
  await run(code);
  return drive;
}

test("explain --code runs read-only, at the project's cwd, and shows summary + details on the dialog", async () => {
  const drive = await runExplain("ALP-B003", {
    unresolved: false,
    explain: ok(EXPLAIN_B003),
  });
  assert.deepEqual(drive.argvs, [["explain", "--code", "ALP-B003"]]);
  assert.deepEqual(
    drive.cwds,
    ["/home/dev/proj"],
    "an omitted cwd would answer about the extension host's own directory, " +
      "not the project the diagnostic came from (#605)",
  );
  assert.equal(drive.notified.length, 1);
  const plan = drive.notified[0];
  assert.equal(plan.channel, "modal");
  assert.match(plan.message, /ALP-B003 \(runtime-diagnostic\)/);
  assert.match(plan.modalDetail, /enum or pattern constraint/);
  assert.match(plan.modalDetail, /wrong spelling/);
});

test("explain --code with no code does NOTHING — no tan explain --code undefined", async () => {
  const drive = await runExplain(undefined, { sdkRoot: null });
  assert.deepEqual(drive.argvs, []);
  assert.equal(drive.notified.length, 0);
});

test("explain --code whose CLI run fails falls back to the ordinary CLI-outcome plan", async () => {
  const drive = await runExplain("ALP-B999", {
    unresolved: false,
    explain: {
      ok: false,
      exitCode: 1,
      severity: "error",
      message: "unused",
      envelope: {
        command: "explain",
        ok: false,
        exitCode: 1,
        project: { root: null, boardYaml: null },
        data: {},
        issues: [
          {
            code: "explain.unknown-code",
            severity: "error",
            message: "no diagnostic named ALP-B999",
          },
        ],
      },
    },
  });
  assert.equal(drive.notified.length, 1);
  const plan = drive.notified[0];
  assert.notEqual(
    plan.channel,
    "modal",
    "a failed explain must not render as though it answered",
  );
});
