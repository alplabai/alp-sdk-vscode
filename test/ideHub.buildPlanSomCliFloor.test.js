// SPDX-License-Identifier: Apache-2.0
//
// #606: the Renesas CLI-floor warning (#502) guarded exactly one of four
// `tan build` spawn sites — `alp.westBuild` (test/west.somCliFloor.test.js).
// The Build Plan panel's Materialise and Build handlers both run `tan build`
// too (`--materialise` is still `tan build`) and both skipped it, so a
// Renesas customer building from the panel got the bare
// `attempt to assign the value 'y' to the undefined symbol
// ALP_SDK_CHIP_NONE` Kconfig abort with no explanation naming their CLI or
// their SoM.
//
// `warnIfCliCannotBuildSom` now lives in its own compiled module,
// src/build/somCliFloorGuard.ts, which captures `probeTanVersion` /
// `notifyAsync` at LOAD time. Only cache-busting `buildPlanPanel.js` itself
// is not enough — see test/west.somCliFloor.test.js's `SOM_FLOOR_GUARD`
// comment for the trap (the second test in a file would keep calling the
// FIRST test's stubs otherwise) and test/proxyEnv.nonTanChildren.test.js for
// the original occurrence of the pattern.
//
// Same `Module._load` swap as test/ideHub.materialiseGuard.test.js; asserts
// on whether the customer was WARNED, and whether the build still ran, per
// `test/west.somCliFloor.test.js`'s own three guarantees.

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const Module = require("node:module");

const root = path.join(__dirname, "..");
const SOM_FLOOR_GUARD = require.resolve(
  path.join(root, "out", "build", "somCliFloorGuard.js"),
);

/** A board.yaml declaring `sku`. Minimal on purpose -- `parseBoardConfig` is
 *  loaded for real, so this has to be YAML the real parser accepts. */
const boardYaml = (sku) => `som:\n  sku: ${sku}\ncores: {}\n`;

const PROJECT = "/work/renesas-control";

/**
 * Mount the Build Plan panel, post `message`, and collect every spawn and
 * every notification plan.
 *
 * @param opts.sku     board.yaml's declared SoM
 * @param opts.probed  what `probeTanVersion` answers
 */
async function drive(message, opts) {
  const commandSpawns = [];
  const streamedSpawns = [];
  const notified = [];
  const orderedCalls = [];
  let onMessage = () => {};
  const watcher = {
    onDidChange: () => ({ dispose() {} }),
    onDidCreate: () => ({ dispose() {} }),
    onDidDelete: () => ({ dispose() {} }),
    dispose() {},
  };

  const modPath = require.resolve(
    path.join(root, "out", "ideHub", "buildPlanPanel.js"),
  );
  delete require.cache[modPath];
  delete require.cache[SOM_FLOOR_GUARD];
  const stubs = {
    fs: {
      existsSync: (p) => String(p).endsWith("board.yaml"),
      readFileSync: () => boardYaml(opts.sku),
    },
    vscode: {
      window: {
        createWebviewPanel: () => ({
          webview: {
            set html(_v) {},
            onDidReceiveMessage: (cb) => {
              onMessage = cb;
              return { dispose() {} };
            },
            postMessage: async () => true,
          },
          onDidDispose: () => ({ dispose() {} }),
          reveal() {},
          dispose() {},
        }),
      },
      workspace: { createFileSystemWatcher: () => watcher },
      ViewColumn: { Active: 1 },
      Uri: { joinPath: (...p) => p.join("/"), parse: (v) => v },
      env: { openExternal: async () => true },
    },
    "../alpCli/vscodeAdapter": {
      runAlpCommand: async (_ctx, args, cwd) => {
        commandSpawns.push({ args: [...args], cwd });
        return {
          outcome: {
            message: "unused",
            envelope: {
              ok: true,
              issues: [],
              // A non-empty `written` so a genuinely successful materialise
              // posts `planSuccess`, not the separate "wrote no files"
              // failure — this file is about the CLI-floor warning, not
              // that unrelated check.
              data: { written: ["build/alp.conf"] },
            },
          },
        };
      },
      runAlpStreamed: async (_ctx, args, options) => {
        streamedSpawns.push({ args: [...args], cwd: options?.cwd });
      },
      probeTanVersion: async () => {
        orderedCalls.push("probe");
        if (opts.probeThrows) throw new Error("probe exploded");
        return opts.probed ?? null;
      },
    },
    "../util": {
      BUILD_RUN_NAME: "Alp Build",
      FLASH_RUN_NAME: "Alp Flash",
      isStreamedRunActive: () => false,
      reserveStreamedRun: () => {
        orderedCalls.push("reserve");
        return true;
      },
      releaseStreamedRun() {},
      log() {},
    },
    "../project/vscodeAdapter": {
      collectProjectContext: () => ({ workspaceRoot: PROJECT }),
    },
    "./webviewHtml": { buildWebviewHtml: () => "<html></html>" },
    "../notify/vscodeAdapter": {
      notifyAsync: (plan) => notified.push(plan),
      notify: async (plan) => {
        notified.push(plan);
        return undefined;
      },
    },
  };

  const originalLoad = Module._load;
  Module._load = function (request, ...rest) {
    return Object.prototype.hasOwnProperty.call(stubs, request)
      ? stubs[request]
      : originalLoad.call(this, request, ...rest);
  };
  let BuildPlanPanel;
  try {
    ({ BuildPlanPanel } = require(modPath));
  } finally {
    Module._load = originalLoad;
    delete require.cache[modPath];
    delete require.cache[SOM_FLOOR_GUARD];
  }

  BuildPlanPanel.open({ extensionUri: "/ext" });
  // The panel's own opening refresh runs a read-only `tan size` probe; only
  // spawns made AFTER the click are the ones under test.
  for (let i = 0; i < 8; i += 1) await new Promise((r) => setImmediate(r));
  commandSpawns.length = 0;
  streamedSpawns.length = 0;
  notified.length = 0;

  onMessage(message);
  for (let i = 0; i < 8; i += 1) await new Promise((r) => setImmediate(r));

  return { commandSpawns, streamedSpawns, notified, orderedCalls };
}

const SITES = [
  {
    message: { type: "materialiseBuildPlan" },
    what: "Materialise",
    spawns: (r) => r.commandSpawns,
  },
  {
    message: { type: "runBuild" },
    what: "the Build button",
    spawns: (r) => r.streamedSpawns,
  },
];

/** Only the CLI-floor notification, never the materialise/build handler's OWN
 *  unrelated notices (a materialise's `planSuccess`, say) — this file is
 *  about #606, not those other, already-covered behaviours. */
const floorNotices = (notified) =>
  notified.filter((p) => p.dedupeKey === "som-cli-floor");

for (const { message, what, spawns } of SITES) {
  test(`${what}: an old tan on a Renesas project is warned before the build runs`, async () => {
    const result = await drive(message, { sku: "E1M-V2N101", probed: "0.5.1" });

    const notices = floorNotices(result.notified);
    assert.equal(
      notices.length,
      1,
      `${what} must run the #502 Renesas CLI-floor warning — got ` +
        JSON.stringify(result.notified),
    );
    assert.match(notices[0].message, /E1M-V2N101/);
    assert.equal(
      spawns(result).length,
      1,
      `${what} is a warning, not a gate — the build must still run`,
    );
  });

  test(`${what}: a current tan on a Renesas project is silent`, async () => {
    const result = await drive(message, { sku: "E1M-V2N102", probed: "0.6.0" });

    assert.deepEqual(floorNotices(result.notified), []);
    assert.equal(spawns(result).length, 1);
  });

  test(`${what}: a non-Renesas project is silent`, async () => {
    const result = await drive(message, { sku: "E1M-AEN801", probed: "0.4.1" });

    assert.deepEqual(floorNotices(result.notified), []);
    assert.equal(spawns(result).length, 1);
  });
}

test("Materialise: the CLI-floor probe runs BEFORE the build reservation, not inside it (#9)", async () => {
  // `probeTanVersion` (`readResolvedCliVersion`'s `cp.spawn`) can take up to
  // 3s. Reserving `BUILD_RUN_NAME` before the probe resolves would refuse
  // the Build button with `"Alp Build" is still running` for that whole
  // window while nothing is actually running yet.
  const result = await drive(
    { type: "materialiseBuildPlan" },
    { sku: "E1M-V2N101", probed: "0.5.1" },
  );

  assert.deepEqual(
    result.orderedCalls,
    ["probe", "reserve"],
    "the probe must resolve before the build reservation is taken — got " +
      JSON.stringify(result.orderedCalls),
  );
});

for (const { message, what, spawns } of SITES) {
  test(`${what}: a throwing CLI-floor probe still runs the build (#2)`, async () => {
    // `warnIfCliCannotBuildSom` must never reject — fixed centrally in
    // src/build/somCliFloorGuard.ts (test/build.somCliFloorGuardNeverThrows.
    // test.js proves that in isolation). This is the end-to-end half: BEFORE
    // that fix, `handleRunBuild` awaits the guard with no try/catch at all
    // (a `void`-dispatched message handler — a throw here is an unhandled
    // rejection AND the build never runs), and `handleMaterialiseBuildPlan`'s
    // try/catch is really a try/FINALLY with no catch, so a throw there
    // skips the materialise too.
    const result = await drive(message, {
      sku: "E1M-V2N101",
      probed: "0.5.1",
      probeThrows: true,
    });

    assert.equal(
      spawns(result).length,
      1,
      `${what} must still run even when the CLI-floor probe itself throws`,
    );
  });
}
