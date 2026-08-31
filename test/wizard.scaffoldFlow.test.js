// SPDX-License-Identifier: Apache-2.0
//
// `alp.scaffoldModule`, driven end to end (#601).
//
// ── What broke ──────────────────────────────────────────────────────────────
//
// The command used to GENERATE the module itself, from a TypeScript
// re-implementation of `tan scaffold`. tan's module README carries a
// `## Wiring` section naming the two `CMakeLists.txt` edits without which the
// module is never compiled; the port emitted `## Notes` and stopped. Everything
// around that section was byte-identical, so this was a port that missed an
// upstream addition — and a customer scaffolding from VS Code got a module that
// silently never built.
//
// No gate could have caught that, because the gate and the defect would have
// been the same file. So the port is deleted and the command calls tan. The
// tests here hold the two properties that replace it:
//
//   1. NOTHING IS GENERATED HERE. `fs.writeFileSync`/`mkdirSync` are booby
//      traps below: if this command ever writes a module file again, the test
//      that catches it is the one that fails.
//   2. `--force` IS ONLY EVER REACHED THROUGH A CONFIRM THAT NAMES THE FILES.
//      Measured on the pinned tan 0.6.0, `--force` REPLACES a file whose
//      contents differ, with no diff and no backup — an edit inside a
//      previously scaffolded `.c` is simply gone. tan refuses without it
//      (`scaffold.would-overwrite`, exit 3), and that refusal is the ONLY route
//      to sending it.
//
// The command is loaded from `out/` with its host modules stubbed, the same
// `Module._load` swap `test/ideHub.materialiseGuard.test.js` uses. The two
// `@alp-sdk/core/wizard/*` modules are deliberately NOT stubbed: the real argv
// planner and the real narrowing are what is under test here.

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const Module = require("node:module");

const root = path.join(__dirname, "..");
const PROJECT_ROOT = "/home/dev/proj";

// ---------------------------------------------------------------------------
// Captured envelopes (pinned tan 0.6.0, paths rewritten to /home/dev/proj)
// ---------------------------------------------------------------------------

const EXPLAIN_OVERVIEW = {
  outcome: {
    ok: true,
    envelope: {
      ok: true,
      issues: [],
      data: {
        schemaVersion: "1",
        selector: { kind: "overview", value: "all" },
        summary: "tan explain topics",
        details: [],
        available: {
          projectTemplates: ["minimal-app", "zephyr-app"],
          moduleTemplates: [
            "sensor-driver",
            "connectivity-service",
            "inference-stage",
            "diagnostics-check",
          ],
          generationTargets: ["zephyr-conf"],
        },
      },
    },
  },
};

const EXPLAIN_TEMPLATE = (id) => ({
  outcome: {
    ok: true,
    envelope: {
      ok: true,
      issues: [],
      data: {
        schemaVersion: "1",
        selector: { kind: "module-template", value: id },
        summary: `Sensor driver module (${id})`,
        details: [
          "Adds a source/header pair for sensor acquisition logic.",
          "Function prefix: alp_sensor",
        ],
      },
    },
  },
});

const CHANGES_NEW = [
  { relativePath: "include/modules/probesens.h", kind: "new" },
  { relativePath: "src/modules/probesens/probesens.c", kind: "new" },
  { relativePath: "src/modules/probesens/README.md", kind: "new" },
];

const okEnvelope = (data, issues = []) => ({
  outcome: {
    ok: true,
    exitCode: 0,
    severity: "info",
    envelope: { ok: true, issues, data },
  },
});

const PREVIEW_NEW = okEnvelope({
  schemaVersion: "1",
  templateId: "sensor-driver",
  moduleName: "probesens",
  normalizedModuleName: "probesens",
  destination: PROJECT_ROOT,
  preview: true,
  fileChanges: CHANGES_NEW,
  written: [],
  unchanged: [],
});

const WRITE_NEW = okEnvelope({
  schemaVersion: "1",
  templateId: "sensor-driver",
  moduleName: "probesens",
  normalizedModuleName: "probesens",
  destination: PROJECT_ROOT,
  preview: false,
  fileChanges: CHANGES_NEW,
  written: CHANGES_NEW.map((c) => c.relativePath),
  unchanged: [],
});

const PREVIEW_ALL_UNCHANGED = okEnvelope({
  schemaVersion: "1",
  templateId: "sensor-driver",
  moduleName: "probesens",
  normalizedModuleName: "probesens",
  destination: PROJECT_ROOT,
  preview: true,
  fileChanges: CHANGES_NEW.map((c) => ({ ...c, kind: "unchanged" })),
  written: [],
  unchanged: CHANGES_NEW.map((c) => c.relativePath),
});

/** exit 3 — and it STILL names the offending path, which the confirm renders. */
const WOULD_OVERWRITE = {
  outcome: {
    ok: false,
    exitCode: 3,
    kind: "refused",
    severity: "error",
    message: "scaffold failed",
    envelope: {
      ok: false,
      issues: [
        {
          code: "scaffold.would-overwrite",
          severity: "error",
          message:
            "One or more files would be overwritten. Use --force to allow updates.",
        },
      ],
      data: {
        schemaVersion: "1",
        templateId: "sensor-driver",
        moduleName: "probesens",
        normalizedModuleName: "probesens",
        destination: PROJECT_ROOT,
        preview: false,
        fileChanges: [
          { relativePath: "include/modules/probesens.h", kind: "unchanged" },
          { relativePath: "src/modules/probesens/probesens.c", kind: "update" },
          {
            relativePath: "src/modules/probesens/README.md",
            kind: "unchanged",
          },
        ],
        written: [],
        unchanged: [],
      },
    },
  },
};

const FORCED_WRITE = okEnvelope({
  schemaVersion: "1",
  templateId: "sensor-driver",
  moduleName: "probesens",
  normalizedModuleName: "probesens",
  destination: PROJECT_ROOT,
  preview: false,
  fileChanges: [
    { relativePath: "include/modules/probesens.h", kind: "unchanged" },
    { relativePath: "src/modules/probesens/probesens.c", kind: "update" },
    { relativePath: "src/modules/probesens/README.md", kind: "unchanged" },
  ],
  written: ["src/modules/probesens/probesens.c"],
  unchanged: ["include/modules/probesens.h", "src/modules/probesens/README.md"],
});

// ---------------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------------

/**
 * Run one `alp.scaffoldModule` invocation.
 *
 * `scaffoldRuns` is consumed in order, one entry per `tan scaffold` spawn — an
 * unscripted spawn THROWS rather than returning something benign, so a flow
 * that runs a pass this test did not expect fails loudly.
 * `answers` is consumed in order, one per modal (`undefined` = dismissed).
 */
async function driveScaffold({
  scaffoldRuns,
  answers = [],
  explain = EXPLAIN_OVERVIEW,
  moduleName = "probesens",
  pickIndex = 0,
  project = { workspaceRoot: PROJECT_ROOT, boardYamlPath: null },
}) {
  const spawns = [];
  const envelopeCalls = [];
  const notified = [];
  const logs = [];
  const opened = [];
  const statusBar = [];
  let quickPickItems = null;
  let handler = null;

  const scripted = [...scaffoldRuns];
  const modalAnswers = [...answers];

  const fsTrap = (name) => () => {
    throw new Error(
      `src/wizard.ts called fs.${name} — the module generator is supposed to ` +
        "be gone; tan writes these files",
    );
  };

  const modPath = require.resolve(path.join(root, "out", "wizard.js"));
  delete require.cache[modPath];
  const stubs = {
    fs: {
      existsSync: () => true,
      writeFileSync: fsTrap("writeFileSync"),
      mkdirSync: fsTrap("mkdirSync"),
      readFileSync: fsTrap("readFileSync"),
    },
    vscode: {
      commands: {
        registerCommand: (_id, cb) => {
          handler = cb;
          return { dispose() {} };
        },
      },
      window: {
        withProgress: async (_options, task) =>
          task({ report() {} }, { isCancellationRequested: false }),
        showQuickPick: async (items) => {
          quickPickItems = items;
          return pickIndex === null ? undefined : items[pickIndex];
        },
        showInputBox: async () => moduleName,
        showTextDocument: async (doc) => {
          opened.push(doc);
        },
        setStatusBarMessage: (text) => statusBar.push(text),
      },
      workspace: {
        openTextDocument: async (uri) => ({ uri }),
      },
      ProgressLocation: { Notification: 15 },
      Uri: { file: (p) => ({ fsPath: p }) },
    },
    "./alpCli/vscodeAdapter": {
      runAlpCommand: async (_ctx, args, cwd) => {
        envelopeCalls.push({ args, cwd });
        if (args[0] === "explain" && args.length === 1) return explain;
        if (args[0] === "explain") return EXPLAIN_TEMPLATE(args[2]);
        throw new Error(
          `unexpected runAlpCommand argv ${JSON.stringify(args)}`,
        );
      },
    },
    "./loader": {
      CANCELLED: Symbol("cancelled"),
      runAlpWithProgress: async (_ctx, args, _title, cwd) => {
        spawns.push({ args, cwd });
        const next = scripted.shift();
        if (!next) {
          throw new Error(
            `unscripted tan spawn: ${JSON.stringify(args)} — the flow ran a ` +
              "pass this test did not expect",
          );
        }
        return next;
      },
    },
    "./notify/vscodeAdapter": {
      notify: async (plan) => {
        notified.push(plan);
        return plan.channel === "modal" ? modalAnswers.shift() : undefined;
      },
      notifyAsync: (plan) => notified.push(plan),
    },
    "./project/vscodeAdapter": { collectProjectContext: () => project },
    "./util": {
      log: (line) => logs.push(line),
      showOutput() {},
    },
  };

  const originalLoad = Module._load;
  Module._load = function (request, ...rest) {
    return Object.prototype.hasOwnProperty.call(stubs, request)
      ? stubs[request]
      : originalLoad.call(this, request, ...rest);
  };
  let registerProjectWizardCommand;
  try {
    ({ registerProjectWizardCommand } = require(modPath));
  } finally {
    Module._load = originalLoad;
    delete require.cache[modPath];
  }

  registerProjectWizardCommand({ globalState: {}, workspaceState: {} });
  assert.ok(handler, "alp.scaffoldModule was never registered");
  await handler();

  return {
    spawns,
    envelopeCalls,
    notified,
    logs,
    opened,
    statusBar,
    quickPickItems,
    unusedRuns: scripted.length,
  };
}

const scaffoldArgvs = (result) => result.spawns.map((s) => s.args);
const modals = (result) => result.notified.filter((p) => p.channel === "modal");

// ---------------------------------------------------------------------------
// 1. The happy path — tan generates, this extension does not
// ---------------------------------------------------------------------------

test("a new module is previewed, confirmed, then written by tan — and nothing is generated here", async () => {
  const result = await driveScaffold({
    scaffoldRuns: [PREVIEW_NEW, WRITE_NEW],
    answers: ["applyChanges"],
  });

  const argvs = scaffoldArgvs(result);
  assert.equal(argvs.length, 2, "expected a preview pass and a write pass");
  assert.equal(argvs[0][0], "scaffold");
  assert.ok(
    argvs[0].includes("--preview"),
    "the first pass must write nothing",
  );
  assert.ok(
    !argvs[1].includes("--preview"),
    "the second pass must actually write",
  );
  assert.equal(
    result.statusBar.length,
    1,
    "the run reported no outcome at all",
  );
  assert.match(result.statusBar[0], /wrote 3 file\(s\)/);
  assert.equal(result.unusedRuns, 0);
});

test("both scaffold spawns carry the project root as cwd AND as --project", async () => {
  const result = await driveScaffold({
    scaffoldRuns: [PREVIEW_NEW, WRITE_NEW],
    answers: ["applyChanges"],
  });
  for (const spawn of result.spawns) {
    assert.equal(
      spawn.cwd,
      PROJECT_ROOT,
      "a tan spawn with no cwd inherits the extension host's directory (#605)",
    );
    const index = spawn.args.indexOf("--project");
    assert.notEqual(index, -1, "--project absent");
    assert.equal(spawn.args[index + 1], PROJECT_ROOT);
  }
});

test("the file opened afterwards is the path TAN reported writing", async () => {
  const result = await driveScaffold({
    scaffoldRuns: [PREVIEW_NEW, WRITE_NEW],
    answers: ["applyChanges"],
  });
  assert.equal(result.opened.length, 1);
  assert.equal(
    result.opened[0].uri.fsPath,
    path.join(PROJECT_ROOT, "src/modules/probesens/probesens.c"),
    "rebuilding this path from the module name would re-create the local " +
      "layout assumption #601 removed",
  );
});

// A written `.c` at a path the `src/modules/<name>/<name>.c` formula does NOT
// produce. CONSTRUCTED, not captured: the pinned tan 0.6.0 writes exactly that
// layout for a single-core project, so this envelope is a probe for the rule,
// not a claim about what tan emits today. The rule is what matters — the whole
// of #601 is a local copy of tan's own decisions going stale — and a fixture
// where both spellings agree cannot tell the two apart. Verified against the
// mutation that rebuilds the path locally: the test above survives it, this
// one does not.
const WRITE_NESTED = okEnvelope({
  schemaVersion: "1",
  templateId: "sensor-driver",
  moduleName: "probesens",
  normalizedModuleName: "probesens",
  destination: PROJECT_ROOT,
  preview: false,
  fileChanges: [
    { relativePath: "src/m55_hp/modules/probesens/probesens.c", kind: "new" },
  ],
  written: ["src/m55_hp/modules/probesens/probesens.c"],
  unchanged: [],
});

test("a written path outside the assumed layout is opened as TAN reported it", async () => {
  const result = await driveScaffold({
    scaffoldRuns: [PREVIEW_NEW, WRITE_NESTED],
    answers: ["applyChanges"],
  });
  assert.equal(result.opened.length, 1);
  assert.equal(
    result.opened[0].uri.fsPath,
    path.join(PROJECT_ROOT, "src/m55_hp/modules/probesens/probesens.c"),
    "rebuilding `src/modules/<name>/<name>.c` from the module name opens a " +
      "file that does not exist, and re-creates the local copy of a layout " +
      "decision that is tan's",
  );
});

test("a write that reported no .c opens nothing rather than guessing a path", async () => {
  const readmeOnly = okEnvelope({
    schemaVersion: "1",
    normalizedModuleName: "probesens",
    fileChanges: [
      { relativePath: "src/modules/probesens/README.md", kind: "update" },
    ],
    written: ["src/modules/probesens/README.md"],
    unchanged: [],
  });
  const result = await driveScaffold({
    scaffoldRuns: [PREVIEW_NEW, readmeOnly],
    answers: ["applyChanges"],
  });
  assert.deepEqual(
    result.opened,
    [],
    "a formula-built path would open a `.c` this run never wrote",
  );
  assert.match(result.statusBar[0], /wrote 1 file\(s\)/);
});

test("the confirm names every file tan planned, from tan's own list", async () => {
  const result = await driveScaffold({
    scaffoldRuns: [PREVIEW_NEW, WRITE_NEW],
    answers: ["applyChanges"],
  });
  const [confirm] = modals(result);
  assert.ok(confirm, "the multi-file write was not gated by a modal");
  for (const change of CHANGES_NEW) {
    assert.ok(
      confirm.modalDetail.includes(change.relativePath),
      `${change.relativePath} is missing from the confirm`,
    );
  }
});

// ---------------------------------------------------------------------------
// 2. The confirm actually gates the write
// ---------------------------------------------------------------------------

test("declining the confirm runs no write pass at all", async () => {
  const result = await driveScaffold({
    scaffoldRuns: [PREVIEW_NEW],
    answers: [undefined],
  });
  assert.equal(
    scaffoldArgvs(result).length,
    1,
    "only the --preview pass may run before the customer answers",
  );
  assert.equal(result.statusBar.length, 0);
});

// ---------------------------------------------------------------------------
// 3. --force, the data-loss flag
// ---------------------------------------------------------------------------

test("the write pass never sends --force on its own", async () => {
  const result = await driveScaffold({
    scaffoldRuns: [PREVIEW_NEW, WRITE_NEW],
    answers: ["applyChanges"],
  });
  for (const argv of scaffoldArgvs(result)) {
    assert.ok(
      !argv.includes("--force"),
      "--force REPLACES a differing file with no diff and no backup " +
        `(measured). It must never ride along: ${argv.join(" ")}`,
    );
  }
});

test("tan's would-overwrite refusal raises a SECOND confirm that names the file and says what is lost", async () => {
  const result = await driveScaffold({
    scaffoldRuns: [PREVIEW_NEW, WOULD_OVERWRITE, FORCED_WRITE],
    answers: ["applyChanges", "applyChanges"],
  });
  const dialogs = modals(result);
  assert.equal(dialogs.length, 2, "the overwrite was not confirmed separately");
  const overwrite = dialogs[1];
  assert.ok(
    overwrite.modalDetail.includes("src/modules/probesens/probesens.c"),
    "the confirm did not name the file being replaced",
  );
  assert.ok(
    !overwrite.modalDetail.includes("include/modules/probesens.h"),
    "an `unchanged` file was listed as being replaced",
  );
  assert.match(
    overwrite.modalDetail,
    /lost/,
    "the dialog must say the edits are lost — this is the only warning there is",
  );
  assert.equal(overwrite.severity, "error");
});

test("--force is sent only on the pass that follows the overwrite confirm", async () => {
  const result = await driveScaffold({
    scaffoldRuns: [PREVIEW_NEW, WOULD_OVERWRITE, FORCED_WRITE],
    answers: ["applyChanges", "applyChanges"],
  });
  const argvs = scaffoldArgvs(result);
  assert.equal(argvs.length, 3);
  assert.ok(!argvs[0].includes("--force"));
  assert.ok(!argvs[1].includes("--force"));
  assert.ok(argvs[2].includes("--force"), "the confirmed retry did not force");
  assert.ok(
    !argvs[2].includes("--preview"),
    "the forced pass must be a real write",
  );
});

test("DECLINING the overwrite confirm sends no forced pass — the customer's edits survive", async () => {
  const result = await driveScaffold({
    scaffoldRuns: [PREVIEW_NEW, WOULD_OVERWRITE],
    answers: ["applyChanges", undefined],
  });
  const argvs = scaffoldArgvs(result);
  assert.equal(
    argvs.length,
    2,
    "a third spawn after a declined overwrite is the data loss this gate exists to stop",
  );
  for (const argv of argvs) {
    assert.ok(!argv.includes("--force"), argv.join(" "));
  }
  assert.equal(
    result.statusBar.length,
    0,
    "a declined overwrite is not a success",
  );
});

// ---------------------------------------------------------------------------
// 4. Nothing to do, and nothing readable
// ---------------------------------------------------------------------------

test("a preview where every file already matches writes nothing and says so", async () => {
  const result = await driveScaffold({
    scaffoldRuns: [PREVIEW_ALL_UNCHANGED],
    answers: [],
  });
  assert.equal(scaffoldArgvs(result).length, 1);
  assert.equal(modals(result).length, 0, "a no-op must not open a dialog");
  const plan = result.notified.at(-1);
  assert.match(plan.message, /Nothing to write/);
  assert.equal(plan.severity, "info");
});

test("an ok run whose payload cannot be read is a failure, not a zero-file success", async () => {
  const unreadable = okEnvelope({
    schemaVersion: "1",
    // `fileChanges` renamed by a tan this extension does not match.
    files: CHANGES_NEW,
    written: [],
  });
  const result = await driveScaffold({
    scaffoldRuns: [unreadable],
    answers: [],
  });
  const plan = result.notified.at(-1);
  assert.equal(
    plan.severity,
    "error",
    "the `written ?? []` shape announced `Materialised 0 file(s)` through a " +
      "success toast while a rename went unnoticed (#601's sibling, pinned in " +
      "test/ideHub.materialiseGuard.test.js)",
  );
  assert.equal(result.statusBar.length, 0);
  assert.equal(scaffoldArgvs(result).length, 1, "no write may follow");
});

// ---------------------------------------------------------------------------
// 5. Refusals reach the customer with tan's own words
// ---------------------------------------------------------------------------

test("an invalid-name refusal keeps tan's sentence and adds a route forward", async () => {
  const refused = {
    outcome: {
      ok: false,
      exitCode: 2,
      kind: "refused",
      severity: "error",
      message: "scaffold failed",
      envelope: {
        ok: false,
        issues: [
          {
            code: "scaffold.invalid-name",
            severity: "error",
            message: "Module name is empty after normalization.",
          },
        ],
        data: { schemaVersion: "1", fileChanges: [], written: [] },
      },
    },
  };
  const result = await driveScaffold({ scaffoldRuns: [refused], answers: [] });
  const plan = result.notified.at(-1);
  assert.match(plan.message, /Module name is empty after normalization\./);
  assert.match(plan.message, /at least one letter or digit/);
  assert.match(plan.detail, /scaffold\.invalid-name/);
});

test("tan's issues reach the output channel even on a SUCCESSFUL run", async () => {
  const advisory = {
    code: "scaffold.advisory",
    severity: "warning",
    message: "the module was written outside the app core's source tree",
  };
  const result = await driveScaffold({
    scaffoldRuns: [
      okEnvelope(PREVIEW_NEW.outcome.envelope.data, [advisory]),
      WRITE_NEW,
    ],
    answers: ["applyChanges"],
  });
  const line = result.logs.find((l) => l.includes(advisory.message));
  assert.ok(
    line,
    "an advisory on an ok envelope was discarded — the #611 drop, which is " +
      "how `sdk.network-required` went missing in #477",
  );
  assert.match(line, /warning/);
});

// ---------------------------------------------------------------------------
// 6. The catalogue is tan's, not a table in this repo
// ---------------------------------------------------------------------------

test("the template picker offers exactly what `tan explain` lists", async () => {
  const result = await driveScaffold({
    scaffoldRuns: [PREVIEW_NEW, WRITE_NEW],
    answers: ["applyChanges"],
  });
  assert.deepEqual(
    result.quickPickItems.map((item) => item.template.id),
    [
      "sensor-driver",
      "connectivity-service",
      "inference-stage",
      "diagnostics-check",
    ],
  );
  assert.equal(
    result.quickPickItems[0].label,
    "Sensor driver module (sensor-driver)",
    "the label must be tan's own `summary`, not a string in this repo",
  );
});

test("a template tan adds tomorrow reaches the picker with no code change here", async () => {
  const withNewTemplate = {
    outcome: {
      ok: true,
      envelope: {
        ok: true,
        issues: [],
        data: {
          available: { moduleTemplates: ["sensor-driver", "future-template"] },
        },
      },
    },
  };
  const result = await driveScaffold({
    explain: withNewTemplate,
    scaffoldRuns: [PREVIEW_NEW, WRITE_NEW],
    answers: ["applyChanges"],
  });
  assert.deepEqual(
    result.quickPickItems.map((item) => item.template.id),
    ["sensor-driver", "future-template"],
    "the retired port's four-entry table is what made this impossible",
  );
});

test("the chosen template id is what reaches --template", async () => {
  const result = await driveScaffold({
    scaffoldRuns: [PREVIEW_NEW, WRITE_NEW],
    answers: ["applyChanges"],
    pickIndex: 2,
  });
  for (const spawn of result.spawns) {
    const index = spawn.args.indexOf("--template");
    assert.equal(spawn.args[index + 1], "inference-stage");
  }
});

test("the customer's raw name reaches --name, normalization left to tan", async () => {
  const result = await driveScaffold({
    scaffoldRuns: [PREVIEW_NEW, WRITE_NEW],
    answers: ["applyChanges"],
    moduleName: "My Sensor!! 2",
  });
  for (const spawn of result.spawns) {
    const index = spawn.args.indexOf("--name");
    assert.equal(spawn.args[index + 1], "My Sensor!! 2");
  }
});

// ---------------------------------------------------------------------------
// 7. Preconditions
// ---------------------------------------------------------------------------

test("with no folder open nothing spawns and the customer is offered one", async () => {
  const result = await driveScaffold({
    scaffoldRuns: [],
    project: { workspaceRoot: null, boardYamlPath: null },
  });
  assert.equal(scaffoldArgvs(result).length, 0);
  assert.equal(result.envelopeCalls.length, 0);
  const plan = result.notified.at(-1);
  assert.equal(
    plan.severity,
    "warning",
    "a first-run state is not an error toast",
  );
});

test("dismissing the template picker spawns no scaffold", async () => {
  const result = await driveScaffold({ scaffoldRuns: [], pickIndex: null });
  assert.equal(scaffoldArgvs(result).length, 0);
});

test("an empty module-template list is reported, not an empty picker", async () => {
  const empty = {
    outcome: {
      ok: true,
      envelope: {
        ok: true,
        issues: [],
        data: { available: { moduleTemplates: [] } },
      },
    },
  };
  const result = await driveScaffold({ explain: empty, scaffoldRuns: [] });
  assert.equal(result.quickPickItems, null, "the picker opened anyway");
  const plan = result.notified.at(-1);
  assert.equal(plan.severity, "error");
  assert.match(plan.message, /no module templates/);
});
