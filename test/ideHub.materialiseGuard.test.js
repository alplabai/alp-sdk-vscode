// SPDX-License-Identifier: Apache-2.0
//
// `handleMaterialiseBuildPlan` (src/ideHub/buildPlanPanel.ts) is the one place
// this extension asks tan to WRITE into the build tree, and it was the one
// envelope reader with no shape gate.
//
// Why that asymmetry matters. The `--plan` and `--manifest` readers beside it
// spell their access `plan.slices.filter` / `manifest.ipc.length`, so a renamed
// field throws and blanks the panel — loud, and already covered by
// test/tanPayloadShape.test.js. This one spelled it `written ?? []`, which
// cannot throw: the same drift reported "Materialised 0 file(s)" through
// `planSuccess`, and a success toast for a run that wrote nothing is
// indistinguishable from one that legitimately had nothing to do. The user
// then builds against whatever was already on disk.
//
// The upstream half, which these tests do NOT claim to fix: tan-cli#505 item 3
// measured that a demoted slice's `configArtefacts` drop out of `written` with
// `issues: []`, exit 0 and `ok: true` — no demotion signal anywhere in the
// envelope, and byte-identical whether `executionPolicy.missingTool` is "skip"
// or "fail". A PARTIAL loss is therefore undetectable from here. What the code
// can do, and what the last tests below pin, is log the paths so five becoming
// three is visible at all.
//
// The panel is loaded from `out/` with its host modules stubbed, the same
// `Module._load` swap test/tanPayloadShape.test.js uses.

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const Module = require("node:module");

const root = path.join(__dirname, "..");

/** The five files a real `tan build --materialise` writes for the sample
 *  project on tan 0.5.1 — captured from the live envelope, not invented. */
const WRITTEN = [
  "build/generated/alp/system_ipc.h",
  "build/generated/dts-reservations.dtsi",
  "build/generated/dts-partitions.dtsi",
  "build/m55_he-zephyr/alp.conf",
  "build/m55_hp-zephyr/alp.conf",
];

/**
 * Drive one `materialiseBuildPlan` click.
 *
 * `materialiseEnvelope` is what `runAlpCommand` answers for the
 * `build --materialise` argv; every other argv (the `--plan` re-request that
 * follows a success) gets a benign complete payload so it cannot be the thing
 * that fails an assertion here.
 */
async function driveMaterialise(materialiseEnvelope) {
  const notified = [];
  const logs = [];
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
  const stubs = {
    fs: { existsSync: () => true },
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
      workspace: {
        workspaceFolders: [{ uri: { fsPath: "/home/dev/proj" } }],
        createFileSystemWatcher: () => watcher,
      },
      ViewColumn: { Active: 1 },
      Uri: { joinPath: (...p) => p.join("/"), parse: (v) => v },
      env: { openExternal: async () => true },
    },
    "../alpCli/vscodeAdapter": {
      runAlpCommand: async (_ctx, args) =>
        args[1] === "--materialise"
          ? materialiseEnvelope
          : {
              outcome: {
                message: "unused",
                envelope: {
                  ok: true,
                  issues: [],
                  data: {
                    sku: "E1M-AEN801",
                    boardYaml: "board.yaml",
                    slices: [],
                    sharedArtefacts: [],
                    warnings: [],
                  },
                },
              },
            },
      runAlpStreamed: async () => {},
      runAlpInTerminal: async () => {},
    },
    // Stubbed whole: the real `../util` builds the "Alp SDK" output channel and
    // an EventEmitter at LOAD time. `reserveStreamedRun` must answer true or
    // the handler bails before it ever reads an envelope.
    "../util": {
      BUILD_RUN_NAME: "Alp Build",
      FLASH_RUN_NAME: "Alp Flash",
      isStreamedRunActive: () => false,
      reserveStreamedRun: () => true,
      releaseStreamedRun() {},
      log: (line) => logs.push(line),
    },
    "./webviewHtml": { buildWebviewHtml: () => "<html></html>" },
    "../notify/vscodeAdapter": {
      notifyAsync: (plan) => notified.push(plan),
      notify: async () => undefined,
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
  }

  BuildPlanPanel.open({ extensionUri: "/ext" });
  onMessage({ type: "materialiseBuildPlan" });
  for (let i = 0; i < 8; i += 1) await new Promise((r) => setImmediate(r));
  return { notified, logs };
}

/** A well-formed ok envelope carrying `written`. */
const okWith = (written, issues = []) => ({
  outcome: {
    message: "unused",
    envelope: {
      ok: true,
      issues,
      data: { schemaVersion: "1", baseDir: "/home/dev/proj", written },
    },
  },
});

test("a materialise payload with no `written` is reported as a failure, not as zero files materialised", async () => {
  const { notified } = await driveMaterialise({
    outcome: {
      message: "unused",
      envelope: {
        ok: true,
        issues: [],
        // `written` renamed or dropped by a tan version this extension does not
        // match. The old reader turned this into `[]` and announced success.
        data: { schemaVersion: "1", baseDir: "/home/dev/proj", files: WRITTEN },
      },
    },
  });
  assert.ok(notified.length > 0, "the panel reported nothing at all");
  const plan = notified[0];
  const text = JSON.stringify(plan);
  assert.doesNotMatch(
    text,
    /Materialised 0 file/,
    "a payload this extension cannot read was announced as a success",
  );
  assert.match(text, /tan build --materialise/);
  assert.match(text, /`written`/);
});

test("an ok run that wrote no files is a failure — the build tree was not updated", async () => {
  const { notified } = await driveMaterialise(okWith([]));
  assert.ok(notified.length > 0, "the panel reported nothing at all");
  const text = JSON.stringify(notified[0]);
  assert.doesNotMatch(
    text,
    /Materialised 0 file/,
    "zero files written was announced as a successful materialise",
  );
  assert.match(text, /wrote no files/);
  assert.match(
    text,
    /already on disk/,
    "the message must say what the user is about to build against",
  );
});

test("a normal materialise still succeeds, and names every file it wrote", async () => {
  const { notified, logs } = await driveMaterialise(okWith(WRITTEN));
  const text = JSON.stringify(notified);
  assert.match(text, /Materialised 5 file\(s\)/);

  const line = logs.find((l) => l.includes("materialised"));
  assert.ok(
    line,
    "the paths were never logged — a slice silently dropped from `written` " +
      "would then be invisible, which is the tan-cli#505 item 3 hazard",
  );
  for (const file of WRITTEN) {
    assert.ok(line.includes(file), `\`${file}\` is missing from the log line`);
  }
});

test("issues on a SUCCESSFUL materialise reach the log instead of being dropped", async () => {
  const { logs } = await driveMaterialise(
    okWith(WRITTEN, [
      {
        code: "plan.slice-demoted",
        severity: "warning",
        message: "slice m55_hp demoted: ${TOOLCHAIN_ROOT} unresolved",
      },
    ]),
  );
  const line = logs.find((l) => l.includes("demoted"));
  assert.ok(
    line,
    "a warning on an ok envelope was discarded — the same ok-path drop that " +
      "hid `sdk.network-required` in #477. If tan ever reports a demotion " +
      "(tan-cli#505 item 3), this is the line that surfaces it",
  );
  assert.match(line, /warning/);
});
