// SPDX-License-Identifier: Apache-2.0
//
// `tan migrate --check` (#613): the pure classification, and the validate
// command that now asks for it.
//
// ── The gap, measured ───────────────────────────────────────────────────────
//
// At tan 0.6.0 against alp-sdk v0.16.0-rc1, a `board.yaml` carrying
// `schemaVersion: 2` — written by a newer SDK, opened against an older one —
// passes `tan validate` with `ok: true`, `exitCode 0`, `issues: []`. The schema
// permits any integer >= 1. The customer is told "board.yaml is clean" for a
// file the resolved SDK's migrator refuses outright:
//
//   $ tan --sdk-root <sdk> migrate --project <p> --check --format json
//   ok false, exitCode 1, issues[0].code "migrate.failed"
//   data.stderr  alp-migrate: <path>: board.yaml schemaVersion 2 is newer than
//                this SDK's latest (1); refusing to downgrade
//
// Both envelopes below are that run and its clean counterpart, with absolute
// paths rewritten to `/home/dev/proj`.
//
// ── What is NOT covered, deliberately ───────────────────────────────────────
//
// Version DRIFT. At this pin `scripts/alp_migrate` has `LATEST = 1` and an
// EMPTY migration registry, and the board schema documents an absent
// `schemaVersion` as "version 1 permanently … never out-of-date". Nothing can
// be behind, `--check` on a normal project answers `alp-migrate: all board.yaml
// at v1.`, and `--preview` returns an EMPTY stdout. #613's body describes a
// drift warning and a migration path off it; neither exists here, and no test
// below pretends otherwise.

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const Module = require("node:module");

const root = path.join(__dirname, "..");
const {
  classifyMigrateCheck,
  MIGRATE_REFUSED_MESSAGE,
} = require("../packages/alp-core/dist/validation/migrateCheck.js");

// ---------------------------------------------------------------------------
// Captured envelopes
// ---------------------------------------------------------------------------

const MIGRATE_CLEAN = {
  ok: true,
  issues: [],
  data: {
    schemaVersion: "1",
    westCommand: "alp-migrate",
    westCwd: "/home/dev/.alp/sdk",
    args: ["--board", "/home/dev/proj/board.yaml", "--check"],
    westExitCode: 0,
    stdout: "alp-migrate: all board.yaml at v1.\n",
    stderr: "",
  },
};

const MIGRATE_REFUSED = {
  ok: false,
  issues: [
    {
      code: "migrate.failed",
      severity: "error",
      message:
        "`west alp-migrate` failed with exit code 1: alp-migrate: /home/dev/proj/board.yaml: board.yaml schemaVersion 2 is newer than this SDK's latest (1); refusing to downgrade",
    },
  ],
  data: {
    schemaVersion: "1",
    westCommand: "alp-migrate",
    westCwd: "/home/dev/.alp/sdk",
    args: ["--board", "/home/dev/proj/board.yaml", "--check"],
    westExitCode: 1,
    stdout: "",
    stderr:
      "alp-migrate: /home/dev/proj/board.yaml: board.yaml schemaVersion 2 is newer than this SDK's latest (1); refusing to downgrade\n",
  },
};

/** `tan validate` on that SAME file. This is the whole reason #613 exists. */
const VALIDATE_CLEAN = { ok: true, issues: [], data: {} };

// ---------------------------------------------------------------------------
// classifyMigrateCheck
// ---------------------------------------------------------------------------

test("the captured clean check is clean", () => {
  assert.deepEqual(
    classifyMigrateCheck(MIGRATE_CLEAN.ok, MIGRATE_CLEAN.issues),
    {
      kind: "clean",
    },
  );
});

test("the captured refusal classifies on its CODE and keeps west's sentence", () => {
  const verdict = classifyMigrateCheck(
    MIGRATE_REFUSED.ok,
    MIGRATE_REFUSED.issues,
  );
  assert.equal(verdict.kind, "refused");
  assert.equal(verdict.code, "migrate.failed");
  assert.equal(verdict.message, MIGRATE_REFUSED.issues[0].message);
});

test("an ok check stays clean even when it carries advisories", () => {
  assert.deepEqual(
    classifyMigrateCheck(true, [
      { code: "migrate.note", severity: "warning", message: "something" },
    ]),
    { kind: "clean" },
    "a warning on a SUCCESSFUL check is channel material; turning it into a " +
      "refusal would report a file the migrator accepted as one it did not",
  );
});

test("a failure that names no code is unavailable, not an invented refusal", () => {
  for (const issues of [
    [],
    [{}],
    [{ code: "" }],
    [{ code: 7 }],
    "boom",
    null,
  ]) {
    assert.deepEqual(
      classifyMigrateCheck(false, issues),
      { kind: "unavailable" },
      `${JSON.stringify(issues)} produced a refusal out of nothing`,
    );
  }
});

test("anything that is not a literal true/false is unavailable", () => {
  for (const ok of [undefined, null, 1, 0, "true", {}]) {
    assert.deepEqual(
      classifyMigrateCheck(ok, MIGRATE_REFUSED.issues),
      { kind: "unavailable" },
      `${JSON.stringify(ok ?? String(ok))} was read as an answer`,
    );
  }
});

test("the customer sentence does not claim WHY the migrator refused", () => {
  assert.doesNotMatch(
    MIGRATE_REFUSED_MESSAGE,
    /newer|downgrade|schemaVersion/i,
    "`migrate.failed` is a generic wrapper tan emits for ANY non-zero west " +
      "exit. The `newer than this SDK's latest` sentence lives only in west's " +
      "stderr, and binding prose is what turns an upstream copy-edit into a " +
      "silently wrong branch.",
  );
});

// ---------------------------------------------------------------------------
// The validate command, driven
// ---------------------------------------------------------------------------

/**
 * Run one `alp.validateBoardYaml`.
 *
 * `validate` and `migrate` are scripted separately, and an argv this test did
 * not expect THROWS rather than returning something benign.
 */
async function driveValidate({ validate, migrate }) {
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
        if (args[0] === "validate") return { outcome: validate };
        if (args[0] === "migrate") {
          if (!migrate) {
            throw new Error(
              "migrate --check ran when this test did not script it",
            );
          }
          return { outcome: migrate };
        }
        throw new Error(`unexpected argv ${JSON.stringify(args)}`);
      },
    },
    // The seam `checkMigrator` resolves its cwd through (#605). Stubbed
    // because the REAL one reads `vscode.workspace`, and `checkMigrator`
    // computes the cwd INSIDE its own try/catch — so an unstubbed throw here
    // is swallowed and the migrator silently never runs, which is a green
    // suite hiding a skipped check rather than a passing one.
    "./project/vscodeAdapter": { readOnlyProjectCwd: () => "/home/dev/proj" },
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
  let registerLoaderCommands;
  try {
    ({ registerLoaderCommands } = require(modPath));
  } finally {
    Module._load = originalLoad;
    delete require.cache[modPath];
  }

  registerLoaderCommands({});
  const run = commands.get("alp.validateBoardYaml");
  assert.ok(run, "alp.validateBoardYaml was never registered");
  await run();
  return { notified, logs, argvs, cwds, outputRevealed };
}

const ok = (envelope) => ({
  ok: envelope.ok,
  exitCode: envelope.ok ? 0 : 1,
  severity: envelope.ok ? "info" : "error",
  message: "unused",
  envelope,
});

test("a clean validate ALSO asks the migrator, and stays clean when it agrees", async () => {
  const result = await driveValidate({
    validate: ok(VALIDATE_CLEAN),
    migrate: ok(MIGRATE_CLEAN),
  });
  assert.deepEqual(result.argvs, [["validate"], ["migrate", "--check"]]);
  assert.equal(
    result.cwds.at(-1),
    "/home/dev/proj",
    "`migrate` resolves the project AND the SDK from cwd, so an omitted one " +
      "answers about the extension host's own directory (#605)",
  );
  assert.equal(result.notified.length, 1, "the customer saw two verdicts");
  assert.match(result.notified[0].message, /board\.yaml is clean/);
});

test("a board.yaml the migrator REFUSES is not reported as clean", async () => {
  const result = await driveValidate({
    validate: ok(VALIDATE_CLEAN),
    migrate: ok(MIGRATE_REFUSED),
  });
  const plan = result.notified.at(-1);
  assert.doesNotMatch(
    plan.message,
    /is clean/,
    "`tan validate` answers ok/exit 0/issues [] for a schemaVersion the " +
      "resolved SDK cannot process — announcing that as clean is the whole " +
      "defect (#613)",
  );
  assert.equal(plan.severity, "warning");
  assert.match(plan.message, /migrator refused it/);
});

test("west's own sentence survives verbatim, in the channel-only detail", async () => {
  const result = await driveValidate({
    validate: ok(VALIDATE_CLEAN),
    migrate: ok(MIGRATE_REFUSED),
  });
  const plan = result.notified.at(-1);
  assert.match(plan.detail, /migrate\.failed/);
  assert.match(
    plan.detail,
    /schemaVersion 2 is newer than this SDK's latest \(1\); refusing to downgrade/,
    "the exact reason is west's and must reach the channel unedited",
  );
  assert.doesNotMatch(
    plan.message,
    /schemaVersion|newer|downgrade/,
    "and must NOT be the sentence this extension branches on or shows as its own",
  );
});

test("a migrator that could not run leaves the clean verdict alone", async () => {
  // No SDK resolved, no west workspace, an unknown subcommand: `runAlpCommand`
  // answers a null-envelope outcome. Turning that into an error would break
  // validation for every project without an SDK.
  const result = await driveValidate({
    validate: ok(VALIDATE_CLEAN),
    migrate: { ok: false, exitCode: 1, severity: "error", envelope: null },
  });
  assert.equal(result.notified.length, 1);
  assert.match(result.notified[0].message, /board\.yaml is clean/);
});

test("a migrator that ANSWERED but named no code also leaves the clean verdict alone", async () => {
  // Distinct from the null-envelope case above, and reachable: tan ran, wrote
  // an envelope, and failed without a code this extension can act on. The
  // null-envelope test returns before `classifyMigrateCheck` is ever called, so
  // it does not cover the branch that reads the verdict — verified against the
  // mutation that reports every non-`clean` verdict as a customer error, which
  // that test survives and this one kills.
  const result = await driveValidate({
    validate: ok(VALIDATE_CLEAN),
    migrate: ok({ ok: false, issues: [], data: {} }),
  });
  assert.equal(result.notified.length, 1);
  assert.match(
    result.notified[0].message,
    /board\.yaml is clean/,
    "an unreadable answer from a second-opinion verb must not overturn the " +
      "verdict the customer actually asked for",
  );
});

test("a FAILED validate never reaches the migrator", async () => {
  const result = await driveValidate({
    validate: ok({
      ok: false,
      issues: [
        { code: "ALP-B002", severity: "error", message: "som.sku missing" },
      ],
      data: {},
    }),
  });
  assert.deepEqual(
    result.argvs,
    [["validate"]],
    "a second opinion on a file that already failed is noise, and the " +
      "unscripted-argv throw is what proves it never ran",
  );
});

test("the migrator's own issues reach the output channel", async () => {
  const result = await driveValidate({
    validate: ok(VALIDATE_CLEAN),
    migrate: ok(MIGRATE_REFUSED),
  });
  const line = result.logs.find((l) => l.includes("migrate --check"));
  assert.ok(line, "the migrator's issues were dropped (#611's class)");
  assert.equal(result.outputRevealed, true);
});
