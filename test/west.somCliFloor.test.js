// SPDX-License-Identifier: Apache-2.0
//
// The WIRING of #502's pre-build warning, which the pure module cannot cover.
//
// `test/alpCli.somCliFloor.test.js` proves the decision; everything asserted
// here lives only in `alpBuild` and would otherwise ship untested:
//
//   1. the build still RUNS. This is a warning, not a gate -- an early `return`
//      slipped in later would turn an explanation into a refusal, and every
//      Renesas user would lose a command that works the moment they upgrade;
//   2. the probe is skipped for non-Renesas projects. `probeTanVersion` spawns
//      the CLI, so an unconditional probe is a process on every single build;
//   3. an unreadable or absent board.yaml says nothing, rather than assuming.
//
// Same `Module._load` swap as test/west.noWorkspace.test.js, and the same
// reason: this drives the REAL registered handler out of `out/west.js`.
//
// `src/notify/service.ts` is pure and loaded FOR REAL, so the asserted sentence
// is the one the customer sees rather than a copy of it in a stub.

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const Module = require("node:module");

const root = path.join(__dirname, "..");
const { SUPPORTED_CLI_VERSION } = require("../out/alpCli/service.js");

function loadWest(stubs) {
  const modPath = require.resolve(path.join(root, "out", "west.js"));
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

const PROJECT = "/work/renesas-control";

/** A board.yaml declaring `sku`. Minimal on purpose -- `parseBoardConfig` is
 *  loaded for real, so this has to be YAML the real parser accepts. */
const boardYaml = (sku) => `som:\n  sku: ${sku}\ncores: {}\n`;

/**
 * @param opts.sku          what the project's board.yaml declares
 * @param opts.probed       what `probeTanVersion` reports
 * @param opts.boardMissing true = no board.yaml on disk
 * @param opts.boardText    raw override (to feed the parser something broken)
 */
function register(opts) {
  const handlers = new Map();
  const spawns = [];
  const plans = [];
  let probes = 0;

  const { registerWestCommands } = loadWest({
    vscode: {
      commands: {
        registerCommand(id, handler) {
          handlers.set(id, handler);
          return { dispose() {} };
        },
      },
      window: { showInputBox: async ({ value }) => value },
    },
    fs: {
      existsSync: (p) =>
        String(p).endsWith("board.yaml") ? !opts.boardMissing : true,
      readFileSync: () => opts.boardText ?? boardYaml(opts.sku),
    },
    "./alpCli/vscodeAdapter": {
      runAlpInTerminal: async (...args) => void spawns.push(args),
      runAlpStreamed: async (...args) => void spawns.push(args),
      probeTanVersion: async () => {
        probes += 1;
        return opts.probed ?? null;
      },
      runAlpCommand: async () => ({
        outcome: { ok: true },
        raw: {},
        source: "test",
      }),
    },
    "./west/vscodeAdapter": {
      collectWestWorkspaceContext: () => ({
        workspaceRoot: PROJECT,
        sdkRoot: null,
        boardYamlPath: `${PROJECT}/board.yaml`,
        westCwd: null,
        pythonBinary: "python3",
      }),
      executeWestPlan: () => {},
      nativeSimOverlayExists: () => true,
    },
    "@alp-sdk/core/west/service": {
      createWestFlashPlan: () => ({}),
      createWestUpdatePlan: () => ({}),
    },
    "./util": {
      log() {},
      BUILD_RUN_NAME: "Alp Build",
      FLASH_RUN_NAME: "Alp Flash",
    },
    "./notify/vscodeAdapter": {
      notify: async () => undefined,
      notifyAsync: (plan) => void plans.push(plan),
    },
  });

  registerWestCommands({});
  return { handlers, spawns, plans, probeCount: () => probes };
}

const build = async (h) => h.handlers.get("alp.westBuild")();

test("an old tan on a Renesas project warns AND still runs the build", async () => {
  // Arrange
  const h = register({ sku: "E1M-V2N101", probed: "0.5.1" });

  // Act
  await build(h);

  // Assert -- both halves. The warning is the point, but so is the build: this
  // must never become a refusal.
  assert.equal(h.plans.length, 1, "the old tan must be called out");
  assert.match(h.plans[0].message, /E1M-V2N101/);
  assert.equal(h.plans[0].severity, "warning");
  assert.equal(h.spawns.length, 1, "the build must still be dispatched");
  assert.deepEqual(h.spawns[0][1], ["build"]);
});

test("the warning offers the pinned tan as its action", async () => {
  // Arrange -- a warning with nothing to click is a dead end; `updateCli` is
  // the one action that resolves this without the customer reading an issue.
  const h = register({ sku: "E1M-V2M101", probed: "0.4.1" });

  // Act
  await build(h);

  // Assert
  const titles = h.plans[0].actions.map((a) => a.title);
  assert.ok(
    titles.includes(`Use tan ${SUPPORTED_CLI_VERSION}`),
    `expected an update action, got ${JSON.stringify(titles)}`,
  );
});

test("a current tan on a Renesas project is silent", async () => {
  // Arrange / Act
  const h = register({ sku: "E1M-V2N102", probed: "0.6.0" });
  await build(h);

  // Assert
  assert.deepEqual(h.plans, []);
  assert.equal(h.spawns.length, 1);
});

test("a non-Renesas project never even probes the CLI", async () => {
  // Arrange -- `probeTanVersion` spawns a process. Probing on every Alif build
  // to answer a question only Renesas can fail is a cost nobody asked for, so
  // the SKU check has to come FIRST. Asserting the probe count (not just the
  // silence) is what pins the ordering: a version-first implementation would
  // stay silent here too, and pass on the weaker assertion alone.
  const h = register({ sku: "E1M-AEN801", probed: "0.4.1" });

  // Act
  await build(h);

  // Assert
  assert.equal(h.probeCount(), 0, "no probe for a non-Renesas SoM");
  assert.deepEqual(h.plans, []);
  assert.equal(h.spawns.length, 1);
});

test("a missing board.yaml is silent and still builds", async () => {
  // Arrange -- the example-app fallback path has no project board.yaml at the
  // build cwd; it must not warn about a SoM it cannot see.
  const h = register({ boardMissing: true, probed: "0.5.1" });

  // Act
  await build(h);

  // Assert
  assert.equal(h.probeCount(), 0);
  assert.deepEqual(h.plans, []);
  assert.equal(h.spawns.length, 1);
});

test("an unparseable board.yaml is silent and still builds", async () => {
  // Arrange -- a half-typed board.yaml is the NORMAL state of a file being
  // edited. Throwing out of a build command over it would be a regression the
  // customer cannot work around.
  const h = register({
    boardText: "som: [this is not\n  a mapping",
    probed: "0.5.1",
  });

  // Act
  await build(h);

  // Assert
  assert.deepEqual(h.plans, []);
  assert.equal(
    h.spawns.length,
    1,
    "a broken board.yaml must not block a build",
  );
});
