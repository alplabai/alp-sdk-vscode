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
//   1. NOTHING IS GENERATED HERE — with a stated limit. `writeFileSync`,
//      `mkdirSync` and `readFileSync` are booby traps in the stub table below,
//      and they cover the module's TOP-LEVEL filesystem imports: `fs`,
//      `node:fs`, `fs/promises`, `node:fs/promises`. They do NOT cover a lazy
//      `require`/`import()` inside the handler (the `Module._load` swap is
//      restored before the command runs, so only load-time resolution is
//      redirected), nor `vscode.workspace.fs`, nor a `child_process` spawn. A
//      reintroduced generator written the ordinary way trips these; one written
//      any of those other ways does not, and would be caught — if at all — by
//      the unscripted-spawn throw and the argv assertions instead.
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

/** The cancellation sentinel, shared with the module under test through the
 *  `./loader` stub — a fresh `Symbol()` per drive would never `===` the one the
 *  module captured, so the cancel branch would be unreachable from here. Script
 *  it in `scaffoldRuns` to cancel that pass. */
const CANCELLED = Symbol("cancelled");

/** Script a modal the customer closes without picking the confirm action.
 *  A literal `undefined` in `answers` cannot say this — it is what an EXHAUSTED
 *  list returns, and the two must not be the same value. */
const DISMISS = Symbol("dismissed");

// ---------------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------------

/**
 * Run one `alp.scaffoldModule` invocation.
 *
 * `scaffoldRuns` is consumed in order, one entry per `tan scaffold` spawn — an
 * unscripted spawn THROWS rather than returning something benign, so a flow
 * that runs a pass this test did not expect fails loudly.
 *
 * `answers` is consumed the same way, one per MODAL, and an unscripted modal
 * also throws. That matters more than it looks: the obvious spelling (`shift()`
 * off an empty array) returns `undefined`, which every caller here reads as
 * "the customer declined" — so an unexpected extra dialog would silently shift
 * every later answer by one and the test would still pass or fail for the wrong
 * reason. Use the exported `DISMISS` to script a dialog the customer closes.
 */
async function driveScaffold({
  scaffoldRuns,
  answers = [],
  explain = EXPLAIN_OVERVIEW,
  moduleName = "probesens",
  pickIndex = 0,
  project = { workspaceRoot: PROJECT_ROOT, boardYamlPath: null },
  /** What `fs.existsSync` answers for the board.yaml path — the input to the
   *  project-root resolution, which is NOT the workspace folder. */
  boardYamlExists = true,
  /** Make every per-id `tan explain --template <id>` return a null envelope. */
  explainTemplateFails = false,
}) {
  const spawns = [];
  const envelopeCalls = [];
  const notified = [];
  const logs = [];
  const opened = [];
  const statusBar = [];
  let quickPickItems = null;
  let inputBoxOptions = null;
  let outputRevealed = false;
  let handler = null;

  const scripted = [...scaffoldRuns];
  const modalAnswers = [...answers];

  const fsTrap = (name) => () => {
    throw new Error(
      `src/wizard.ts called fs.${name} — the module generator is supposed to ` +
        "be gone; tan writes these files",
    );
  };
  const fsStub = {
    existsSync: () => true,
    writeFileSync: fsTrap("writeFileSync"),
    mkdirSync: fsTrap("mkdirSync"),
    readFileSync: fsTrap("readFileSync"),
    writeFile: fsTrap("writeFile"),
    mkdir: fsTrap("mkdir"),
    readFile: fsTrap("readFile"),
  };

  const modPath = require.resolve(path.join(root, "out", "wizard.js"));
  delete require.cache[modPath];
  const stubs = {
    fs: { ...fsStub, existsSync: () => boardYamlExists },
    "node:fs": fsStub,
    "fs/promises": fsStub,
    "node:fs/promises": fsStub,
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
        showInputBox: async (options) => {
          inputBoxOptions = options;
          return moduleName;
        },
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
        if (args[0] === "explain") {
          return explainTemplateFails
            ? {
                outcome: { ok: false, envelope: null, message: "spawn failed" },
              }
            : EXPLAIN_TEMPLATE(args[2]);
        }
        throw new Error(
          `unexpected runAlpCommand argv ${JSON.stringify(args)}`,
        );
      },
    },
    "./loader": {
      CANCELLED,
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
        if (plan.channel !== "modal") return undefined;
        if (modalAnswers.length === 0) {
          throw new Error(
            "unscripted modal: " +
              JSON.stringify({
                message: plan.message,
                severity: plan.severity,
              }) +
              " — this flow raised a dialog the test did not expect, and " +
              "answering it `undefined` would read as a decline",
          );
        }
        const answer = modalAnswers.shift();
        return answer === DISMISS ? undefined : answer;
      },
      notifyAsync: (plan) => notified.push(plan),
    },
    "./project/vscodeAdapter": { collectProjectContext: () => project },
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
    inputBoxOptions,
    outputRevealed,
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
    answers: [DISMISS],
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
    answers: ["applyChanges", DISMISS],
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

test("an invalid-name refusal gives the customer a route forward, with tan's own words in the channel", async () => {
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
  assert.match(plan.message, /at least one letter or digit/);
  assert.doesNotMatch(
    plan.message,
    /--name|--force|non-interactively/,
    "tan writes for a terminal and names flags this UI never exposes; a " +
      "customer in the editor cannot act on `Use --name <name>`",
  );
  assert.match(plan.detail, /scaffold\.invalid-name/);
  assert.match(
    plan.detail,
    /Module name is empty after normalization\./,
    "tan's own sentence must survive VERBATIM in the channel — it is the record",
  );
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
  assert.equal(
    result.outputRevealed,
    true,
    "a line written to a channel nobody opened is a line nobody reads; the " +
      "reveal is the half that makes logging an advisory worth anything",
  );
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
// 6b. The project is not the workspace folder
// ---------------------------------------------------------------------------

// `alpSdk.boardYamlPath` is a documented, per-folder `resource`-scoped setting
// holding a path relative to its workspace folder. Point it at
// `firmware/board.yaml` and the project is `<outer>/firmware`, which is where
// `src/west.ts` has always run the build. This flow passed `<outer>` as both
// `--project` and cwd, so the module landed beside the project and was never
// compiled — #601's own symptom, through a different mechanism. Found in
// adversarial review and confirmed live against the pinned tan 0.6.0.
test("the module goes where board.yaml is, not where the workspace folder is", async () => {
  const result = await driveScaffold({
    scaffoldRuns: [PREVIEW_NEW, WRITE_NEW],
    answers: ["applyChanges"],
    project: {
      workspaceRoot: "/home/dev/outer",
      boardYamlPath: "/home/dev/outer/firmware/board.yaml",
    },
  });
  for (const spawn of result.spawns) {
    assert.equal(
      spawn.cwd,
      "/home/dev/outer/firmware",
      "the spawn ran in the workspace folder, not the project",
    );
    const index = spawn.args.indexOf("--project");
    assert.equal(
      spawn.args[index + 1],
      "/home/dev/outer/firmware",
      "tan was told to scaffold into the workspace folder, not the project",
    );
  }
  assert.equal(
    result.opened[0].uri.fsPath,
    path.join("/home/dev/outer/firmware", "src/modules/probesens/probesens.c"),
  );
});

test("with no board.yaml on disk the workspace folder is used, and that is the only fallback", async () => {
  const result = await driveScaffold({
    scaffoldRuns: [PREVIEW_NEW, WRITE_NEW],
    answers: ["applyChanges"],
    project: {
      workspaceRoot: "/home/dev/proj",
      boardYamlPath: "/home/dev/proj/board.yaml",
    },
    boardYamlExists: false,
  });
  for (const spawn of result.spawns) {
    assert.equal(spawn.cwd, "/home/dev/proj");
  }
});

// ---------------------------------------------------------------------------
// 6c. The dialogs say what is true
// ---------------------------------------------------------------------------

// Delete a scaffolded header, edit its `.c`, and the pinned tan refuses with
// the header marked `"new"` alongside the `"update"`. The overwrite dialog's
// whole job is naming what `--force` destroys; a file that does not exist is
// not one of them.
const OVERWRITE_WITH_NEW = {
  outcome: {
    ok: false,
    exitCode: 3,
    kind: "refused",
    severity: "error",
    message: "scaffold failed",
    envelope: {
      ok: false,
      issues: WOULD_OVERWRITE.outcome.envelope.issues,
      data: {
        schemaVersion: "1",
        normalizedModuleName: "probesens",
        preview: false,
        fileChanges: [
          { relativePath: "include/modules/probesens.h", kind: "new" },
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

test("the overwrite dialog does not list a NEW file among the ones whose edits are lost", async () => {
  const result = await driveScaffold({
    scaffoldRuns: [PREVIEW_NEW, OVERWRITE_WITH_NEW],
    answers: ["applyChanges", DISMISS],
  });
  const body = modals(result)[1].modalDetail;
  const lostAt = body.indexOf("Any edits");
  const createdAt = body.indexOf("will be created");
  assert.notEqual(
    lostAt,
    -1,
    "the `edits are lost` paragraph is gone entirely",
  );
  assert.notEqual(createdAt, -1, "the NEW file is not named at all");

  // The paragraph that says "any edits made in them are lost" runs from
  // `lostAt` to the next heading. Only the `"update"` row may appear in it.
  const destroyed = body.slice(lostAt, createdAt);
  assert.ok(
    destroyed.includes("src/modules/probesens/probesens.c"),
    "the file actually at risk is missing from the paragraph that names it",
  );
  assert.ok(
    !destroyed.includes("include/modules/probesens.h"),
    "a file tan reported as NEW was named as one whose edits are lost — it " +
      "does not exist, and this dialog is the one place that must be exact",
  );
  assert.ok(
    body.slice(createdAt).includes("include/modules/probesens.h"),
    "the NEW file must still be named, just not as one being destroyed",
  );
});

test("an UNKNOWN kind is still named in the overwrite dialog, under its own heading", async () => {
  const withUnknown = {
    outcome: {
      ...OVERWRITE_WITH_NEW.outcome,
      envelope: {
        ...OVERWRITE_WITH_NEW.outcome.envelope,
        data: {
          ...OVERWRITE_WITH_NEW.outcome.envelope.data,
          fileChanges: [
            {
              relativePath: "src/modules/probesens/probesens.c",
              kind: "update",
            },
            { relativePath: "src/modules/probesens/legacy.c", kind: "delete" },
          ],
        },
      },
    },
  };
  const result = await driveScaffold({
    scaffoldRuns: [PREVIEW_NEW, withUnknown],
    answers: ["applyChanges", DISMISS],
  });
  const body = modals(result)[1].modalDetail;
  assert.ok(
    body.includes("src/modules/probesens/legacy.c"),
    "a row this extension does not understand was hidden from the dialog " +
      "that gates --force",
  );
  assert.match(
    body,
    /does not\s+recognise/,
    'an unknown kind must not be claimed as "replaced with the template" — ' +
      "this extension does not know what tan will do to it",
  );
});

test("the confirm counts files that CHANGE, not rows tan happened to list", async () => {
  const mixed = okEnvelope({
    schemaVersion: "1",
    normalizedModuleName: "probesens",
    preview: true,
    fileChanges: [
      { relativePath: "include/modules/probesens.h", kind: "unchanged" },
      { relativePath: "src/modules/probesens/probesens.c", kind: "update" },
      { relativePath: "src/modules/probesens/README.md", kind: "unchanged" },
    ],
    written: [],
    unchanged: [],
  });
  const result = await driveScaffold({
    scaffoldRuns: [mixed, WRITE_NEW],
    answers: ["applyChanges"],
  });
  const confirm = modals(result)[0];
  assert.match(
    confirm.message,
    /apply 1 module file change\(s\)/,
    "counting the `unchanged` rows announced three changes for a run that " +
      "would touch one",
  );
  const [promised] = confirm.modalDetail.split("Already identical");
  assert.ok(
    !promised.includes("include/modules/probesens.h"),
    "a file tan will leave alone was listed under `will write these files`",
  );
  assert.ok(
    confirm.modalDetail.includes("include/modules/probesens.h"),
    "the untouched files must still be shown, just not as writes",
  );
});

// ---------------------------------------------------------------------------
// 6d. Cancelling
// ---------------------------------------------------------------------------

test("cancelling the PREVIEW is a clean no-op and says so", async () => {
  const result = await driveScaffold({ scaffoldRuns: [CANCELLED] });
  assert.equal(scaffoldArgvs(result).length, 1);
  const plan = result.notified.at(-1);
  assert.equal(plan.severity, "info");
  assert.match(plan.message, /Nothing was written/);
});

test("cancelling the WRITE is not reported as a clean cancellation", async () => {
  const result = await driveScaffold({
    scaffoldRuns: [PREVIEW_NEW, CANCELLED],
    answers: ["applyChanges"],
  });
  const plan = result.notified.at(-1);
  assert.notEqual(
    plan.severity,
    "info",
    "the tan child is SIGTERMed mid-write (src/loader.ts aborts the " +
      "controller), so this is not the same event as a cancelled --preview",
  );
  assert.match(
    plan.message,
    /may already have been written/,
    "tan keeps no journal and reports nothing on a kill, so the one honest " +
      "thing to say is that the customer must look",
  );
  assert.equal(result.statusBar.length, 0);
});

test("cancelling the FORCED write warns about replacement, not about writing", async () => {
  const result = await driveScaffold({
    scaffoldRuns: [PREVIEW_NEW, WOULD_OVERWRITE, CANCELLED],
    answers: ["applyChanges", "applyChanges"],
  });
  const plan = result.notified.at(-1);
  assert.match(plan.message, /already have been replaced/);
  assert.notEqual(plan.severity, "info");
});

// ---------------------------------------------------------------------------
// 6e. The catalogue loop
// ---------------------------------------------------------------------------

test("a per-template explain failure reaches the channel instead of an unexplained bare id", async () => {
  const result = await driveScaffold({
    scaffoldRuns: [PREVIEW_NEW, WRITE_NEW],
    answers: ["applyChanges"],
    explainTemplateFails: true,
  });
  assert.equal(
    result.quickPickItems[0].label,
    "sensor-driver",
    "the id came from tan's catalogue, so the template is still offered",
  );
  const line = result.logs.find((l) => l.includes("could not describe"));
  assert.ok(
    line,
    "four bare ids with empty descriptions and NOTHING anywhere saying why — " +
      "the overview's failure is surfaced, its N children were swallowed",
  );
});

test("a non-string template id is DROPPED, never coerced into --template", async () => {
  const dirty = {
    outcome: {
      ok: true,
      envelope: {
        ok: true,
        issues: [],
        data: {
          available: { moduleTemplates: ["sensor-driver", 42, null, { a: 1 }] },
        },
      },
    },
  };
  const result = await driveScaffold({
    explain: dirty,
    scaffoldRuns: [PREVIEW_NEW, WRITE_NEW],
    answers: ["applyChanges"],
  });
  assert.deepEqual(
    result.quickPickItems.map((item) => item.template.id),
    ["sensor-driver"],
    "a coerced `42` reaches --template and comes straight back as " +
      "scaffold.invalid-template",
  );
});

// ---------------------------------------------------------------------------
// 6f. The input box
// ---------------------------------------------------------------------------

test("the pre-filled name is derived from the template id, not looked up", async () => {
  const result = await driveScaffold({
    scaffoldRuns: [PREVIEW_NEW, WRITE_NEW],
    answers: ["applyChanges"],
    pickIndex: 1,
  });
  assert.equal(
    result.inputBoxOptions.value,
    "connectivity_service",
    "the retired port carried a four-entry templateId -> suggestion table; a " +
      "derived default is what lets an unknown template still get one",
  );
});

test("the name box refuses a name with no alphanumeric, and accepts one that has any", () => {
  return driveScaffold({
    scaffoldRuns: [PREVIEW_NEW, WRITE_NEW],
    answers: ["applyChanges"],
  }).then((result) => {
    const validate = result.inputBoxOptions.validateInput;
    assert.equal(validate("probesens"), null);
    assert.equal(validate("---"), null === undefined ? null : validate("---"));
    assert.ok(
      typeof validate("---") === "string",
      "`---` normalizes to nothing and tan refuses it; answering here saves a spawn",
    );
    assert.equal(validate("_a_"), null, "one digit or letter is enough");
  });
});

// ---------------------------------------------------------------------------
// 6g. The destructive dialog leaves a record
// ---------------------------------------------------------------------------

// `modalDetail` is rendered ON the dialog and, until #601, nowhere else — so a
// customer who confirmed a `--force` replace left no trace of the file list
// they were shown. `src/notify/vscodeAdapter.ts`'s `present` now writes it to
// the channel with the rest of the plan. Asserted here, on the plan, because
// this is the flow that produces the one dialog where the record matters.
test("the overwrite dialog's file list is carried on the plan, where the channel can log it", async () => {
  const result = await driveScaffold({
    scaffoldRuns: [PREVIEW_NEW, WOULD_OVERWRITE, FORCED_WRITE],
    answers: ["applyChanges", "applyChanges"],
  });
  const overwrite = modals(result)[1];
  assert.ok(
    overwrite.modalDetail?.includes("src/modules/probesens/probesens.c"),
    "the file list must live on `modalDetail`, not be built inline at the " +
      "presenter — nothing downstream could then record it",
  );
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
