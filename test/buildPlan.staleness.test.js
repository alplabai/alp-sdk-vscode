// SPDX-License-Identifier: Apache-2.0
//
// The Build Plan panel must stop calling an old manifest "post-build" (#470).
//
// The defect: `postBuild` was `fs.existsSync(build/system-manifest.yaml)`.
// Existence, not freshness. So after any past successful build the panel
// presented that build's per-slice status and its memory numbers as the current
// state — including immediately after a build that had just failed. Monday's
// green table, on Tuesday, over a tree that no longer compiles, with nothing on
// screen saying so.
//
// What these tests defend is the DISTINCTION the fix rests on: `stale` is a
// claim with evidence behind it (a build finished after the file was written
// and did not update it), and everything else is `unknown`. Collapsing
// `unknown` into `fresh` is the original bug with a new word on it; collapsing
// it into `stale` cries wolf on every project that also builds outside the IDE,
// and a warning that is always on is one nobody reads.

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const Module = require("node:module");

const root = path.join(__dirname, "..");
const {
  manifestFreshness,
} = require("../packages/alp-core/dist/systemManifest/staleness.js");
const {
  recordBuildFinish,
  readLastBuild,
} = require("../out/build/lastBuild.js");

/** 2026-08-10T09:15:00.000Z — an arbitrary fixed clock. Every assertion reads
 *  deltas, so the absolute value never matters, but a literal beats
 *  `Date.now()` in a test that is about timestamps. */
const WRITTEN = Date.parse("2026-08-10T09:15:00.000Z");
const MINUTE = 60_000;
const NOW = WRITTEN + 60 * MINUTE;

// ---------------------------------------------------------------------------
// The verdict
// ---------------------------------------------------------------------------

test("a build that finished BEFORE the manifest was written is what wrote it", () => {
  // Arrange -- the ordinary green path: build runs, build writes the file.
  const verdict = manifestFreshness({
    writtenAt: WRITTEN,
    lastBuild: { finishedAt: WRITTEN - MINUTE, exitCode: 0 },
    now: NOW,
  });

  // Assert
  assert.equal(verdict.freshness, "fresh");
  assert.equal(verdict.reason, null, "nothing to warn about");
  assert.equal(verdict.writtenAt, "2026-08-10T09:15:00.000Z");
});

test("a build that finished AFTER it and did not update it is stale — the whole bug", () => {
  // Arrange -- THE case. Tuesday's build failed at slice 2 and never rewrote
  // the file, so what is on disk is Monday's green run.
  const verdict = manifestFreshness({
    writtenAt: WRITTEN,
    lastBuild: { finishedAt: WRITTEN + 30 * MINUTE, exitCode: 1 },
    now: NOW,
  });

  // Assert
  assert.equal(verdict.freshness, "stale");
  assert.ok(verdict.reason, "a stale verdict without a reason is a puzzle");
  assert.match(verdict.reason, /exited 1/);
  assert.match(
    verdict.reason,
    /earlier build/,
    "the sentence must say what the reader is looking at, not just that it is old",
  );
});

test("a SUCCESSFUL build that still did not update the file is also stale", () => {
  // Arrange -- exit 0 is not evidence the manifest moved. `tan flash`, `tan
  // image` and `tan renode` never write it, and nothing in this repo pins when
  // `tan build` rewrites it on a partial run. The timestamps are the evidence;
  // the exit code is only wording.
  const verdict = manifestFreshness({
    writtenAt: WRITTEN,
    lastBuild: { finishedAt: WRITTEN + MINUTE, exitCode: 0 },
    now: NOW,
  });

  assert.equal(verdict.freshness, "stale");
  assert.match(verdict.reason, /exited 0/);
});

test("a build that reported no exit code is described as such, never as a failure", () => {
  // Arrange -- `undefined` means the task never started or its code could not
  // be read. Printing "exited undefined" or inventing a number would both be
  // claims about a run nobody watched finish.
  const verdict = manifestFreshness({
    writtenAt: WRITTEN,
    lastBuild: { finishedAt: WRITTEN + MINUTE, exitCode: null },
    now: NOW,
  });

  assert.equal(verdict.freshness, "stale");
  assert.match(verdict.reason, /did not report an exit code/);
  assert.ok(!/exited/.test(verdict.reason));
});

test("a build finishing at the SAME instant is fresh, not stale", () => {
  // Arrange -- the boundary. `>` and not `>=`: a build that finished exactly
  // when the file was stamped IS the build that wrote it, and second-resolution
  // filesystems make an equal comparison the common case rather than a corner.
  const verdict = manifestFreshness({
    writtenAt: WRITTEN,
    lastBuild: { finishedAt: WRITTEN, exitCode: 0 },
    now: NOW,
  });

  assert.equal(verdict.freshness, "fresh");
});

// ---------------------------------------------------------------------------
// The cases where there is NO claim to make
// ---------------------------------------------------------------------------

test("no build observed means unknown — not fresh, and not stale either", () => {
  // Arrange -- a fresh window, or a project built from a terminal outside the
  // IDE. The sources may have changed under the file or nothing may have
  // happened; this side cannot tell the two apart, and inventing either answer
  // is the defect (fresh) or a permanent false alarm (stale).
  const verdict = manifestFreshness({
    writtenAt: WRITTEN,
    lastBuild: null,
    now: NOW,
  });

  assert.equal(verdict.freshness, "unknown");
  assert.equal(
    verdict.reason,
    null,
    "no sentence to add: the AGE is the fact, and it still renders",
  );
  assert.equal(
    verdict.writtenAt,
    "2026-08-10T09:15:00.000Z",
    "the age must survive the unknown verdict — it is the whole improvement",
  );
});

test("a manifest dated in the FUTURE is unknown, and says why", () => {
  // Arrange -- a dual-boot, a corrected NTP sync, a tree copied off another
  // machine. This is the dangerous direction: a future mtime makes every real
  // build look older than the file, so a naive compare answers "fresh" forever.
  const verdict = manifestFreshness({
    writtenAt: NOW + 60 * MINUTE,
    lastBuild: { finishedAt: NOW, exitCode: 1 },
    now: NOW,
  });

  assert.equal(
    verdict.freshness,
    "unknown",
    "a build BEFORE a future-dated file must not read as 'the file is newer, so it is fresh'",
  );
  assert.match(verdict.reason, /future/);
});

test("an unreadable timestamp is unknown, and does not pretend to an age", () => {
  // Arrange -- the stat failed. Substituting `Date.now()` would render the
  // file as freshly written, which is exactly the shape of the original bug.
  const verdict = manifestFreshness({
    writtenAt: null,
    lastBuild: { finishedAt: NOW, exitCode: 0 },
    now: NOW,
  });

  assert.equal(verdict.freshness, "unknown");
  assert.equal(verdict.writtenAt, null);
  assert.match(verdict.reason, /could not be read/);
});

test("the verdict never looks at the manifest's contents", () => {
  // Arrange -- a slice marked `failed` INSIDE a current manifest is a real,
  // fresh result and must keep saying so; that is tan's verdict about a build,
  // not evidence about the file's age. Pinning the arity keeps the contents
  // out of reach: there is no parameter to pass them through.
  assert.equal(
    manifestFreshness.length,
    1,
    "manifestFreshness took a second parameter; if it is the manifest, a " +
      "failed slice will start being reported as a stale FILE",
  );
});

// ---------------------------------------------------------------------------
// The record the verdict reads
// ---------------------------------------------------------------------------

/** A memento that behaves like VS Code's: JSON in, JSON out. */
function fakeContext(initial) {
  const store = new Map(initial ? Object.entries(initial) : []);
  return {
    workspaceState: {
      get: (key) => store.get(key),
      update: (key, value) => {
        store.set(key, JSON.parse(JSON.stringify(value)));
        return Promise.resolve();
      },
    },
    _store: store,
  };
}

test("a recorded build round-trips, exit code and all", async () => {
  // Arrange / Act
  const context = fakeContext();
  await recordBuildFinish(context, 1, WRITTEN);

  // Assert
  assert.deepEqual(readLastBuild(context), {
    finishedAt: WRITTEN,
    exitCode: 1,
  });
});

test("an exit code of undefined is STORED as an explicit null", async () => {
  // Arrange -- asserted on the stored record, not on the read, and the
  // difference matters: a memento round-trips JSON, so an `undefined` value
  // and an absent key read back identically and `readLastBuild` normalises
  // both to `null`. Asserting the read would therefore pass whether or not
  // the write is explicit — a test that cannot fail.
  //
  // What is worth pinning is the record on disk being self-describing:
  // `{"finishedAt":…,"exitCode":null}` says "the build reported no exit code",
  // where `{"finishedAt":…}` leaves the next reader to guess whether the key
  // was dropped or never set.
  const context = fakeContext();
  await recordBuildFinish(context, undefined, WRITTEN);

  // Assert
  assert.deepEqual(context._store.get("alp.build.lastFinished"), {
    finishedAt: WRITTEN,
    exitCode: null,
  });
  assert.deepEqual(readLastBuild(context), {
    finishedAt: WRITTEN,
    exitCode: null,
  });
});

test("no record at all reads as null, which is the 'unknown' input", () => {
  assert.equal(readLastBuild(fakeContext()), null);
});

test("a drifted or corrupt record reads as null rather than as a NaN comparison", () => {
  // Arrange -- the failure mode this guards is silent: a `finishedAt` that is
  // not a number makes every `>` comparison false, so the verdict would answer
  // "fresh" for every manifest forever and nothing would ever say why.
  for (const bad of [
    "yesterday",
    { finishedAt: "2026-08-10" },
    { finishedAt: Number.NaN, exitCode: 0 },
    { exitCode: 0 },
    42,
    null,
  ]) {
    const context = fakeContext({ "alp.build.lastFinished": bad });
    assert.equal(
      readLastBuild(context),
      null,
      `${JSON.stringify(bad)} must not be trusted`,
    );
  }
});

test("a non-numeric exit code degrades to null without losing the timestamp", () => {
  // Arrange -- the record is still usable for the comparison that matters;
  // only the wording loses a detail.
  const context = fakeContext({
    "alp.build.lastFinished": { finishedAt: WRITTEN, exitCode: "boom" },
  });

  assert.deepEqual(readLastBuild(context), {
    finishedAt: WRITTEN,
    exitCode: null,
  });
});

test("a workspaceState that throws never propagates — a badge must not blank the panel", () => {
  // Arrange -- this feeds one line of a panel. If reading a memento ever
  // throws, the caller is mid-way through fetching the manifest, and letting
  // it out would lose the whole table to avoid mislabelling one badge.
  const context = {
    workspaceState: {
      get() {
        throw new Error("memento unavailable");
      },
    },
  };

  assert.equal(readLastBuild(context), null);
});

// ---------------------------------------------------------------------------
// The panel actually attaches it
// ---------------------------------------------------------------------------

/** Load `out/ideHub/buildPlanPanel.js` with the host modules stubbed, drive one
 *  `requestBuildPlan`, and hand back the `systemManifestData` it posted. */
async function drivePanel(opts) {
  const posted = [];
  let onMessage = () => {};
  const noop = () => ({ dispose() {} });
  const watcher = {
    onDidChange: noop,
    onDidCreate: noop,
    onDidDelete: noop,
    dispose() {},
  };

  const modPath = require.resolve(
    path.join(root, "out", "ideHub", "buildPlanPanel.js"),
  );
  delete require.cache[modPath];
  const originalLoad = Module._load;
  const stubs = {
    fs: {
      existsSync: () => opts.manifestOnDisk !== false,
      statSync: () => {
        if (opts.statThrows) throw new Error("EACCES");
        return { mtimeMs: opts.writtenAt };
      },
    },
    vscode: {
      EventEmitter: class {
        constructor() {
          this.event = () => ({ dispose() {} });
        }
        fire() {}
        dispose() {}
      },
      window: {
        createOutputChannel: () => ({
          appendLine() {},
          append() {},
          show() {},
          clear() {},
          dispose() {},
        }),
        createWebviewPanel: () => ({
          webview: {
            html: "",
            asWebviewUri: (u) => u,
            cspSource: "",
            onDidReceiveMessage: (handler) => {
              onMessage = handler;
              return { dispose() {} };
            },
            postMessage: (msg) => {
              posted.push(msg);
              return Promise.resolve(true);
            },
          },
          onDidDispose: noop,
          reveal() {},
          dispose() {},
        }),
      },
      workspace: {
        workspaceFolders: [{ uri: { fsPath: "/proj" } }],
        createFileSystemWatcher: () => watcher,
      },
      Uri: { joinPath: (...parts) => parts.join("/") },
      ViewColumn: { Active: 1 },
    },
    "../alpCli/vscodeAdapter": {
      runAlpCommand: async () => ({
        outcome: {
          ok: true,
          envelope: {
            ok: true,
            data: { slices: [], ipc: [], helper_mcus: [] },
          },
        },
      }),
      runAlpStreamed: async () => undefined,
    },
    "./webviewHtml": { buildWebviewHtml: () => "<html></html>" },
    "../notify/vscodeAdapter": { notifyAsync() {} },
    "../build/lastBuild": { readLastBuild: () => opts.lastBuild ?? null },
  };
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

  BuildPlanPanel.open({ extensionUri: "/ext", workspaceState: {} });
  await onMessage({ type: "requestBuildPlan" });
  // The three handlers are dispatched without awaiting each other.
  await new Promise((resolve) => setImmediate(resolve));
  return posted.filter((m) => m.type === "systemManifestData");
}

test("the panel attaches a STALE verdict when a build ran after the manifest", async () => {
  // Arrange / Act -- the end-to-end shape of #470's failure scenario.
  const [msg] = await drivePanel({
    writtenAt: WRITTEN,
    lastBuild: { finishedAt: WRITTEN + 30 * MINUTE, exitCode: 1 },
  });

  // Assert
  assert.ok(msg, "the panel posted no systemManifestData");
  assert.equal(msg.postBuild, true);
  assert.equal(msg.provenance?.freshness, "stale");
  assert.match(msg.provenance.reason, /exited 1/);
});

test("the panel attaches FRESH when the manifest is the last build's own output", async () => {
  const [msg] = await drivePanel({
    writtenAt: WRITTEN,
    lastBuild: { finishedAt: WRITTEN - MINUTE, exitCode: 0 },
  });

  assert.equal(msg.provenance?.freshness, "fresh");
  assert.equal(msg.provenance.reason, null);
});

test("a projection carries NO provenance — it was computed just now", async () => {
  // Arrange -- no file on disk, so `--manifest` runs. A projection cannot be
  // stale, and attaching an empty verdict would invite the view to render one.
  const [msg] = await drivePanel({ manifestOnDisk: false, writtenAt: WRITTEN });

  assert.equal(msg.postBuild, false);
  assert.equal(msg.provenance, null);
});

test("an unreadable mtime still posts the message, with an unknown verdict", async () => {
  // Arrange -- the badge must never cost the message. A stat that throws is "no
  // claim", not "nothing to post".
  //
  // This used to assert `msg.manifest` was populated -- "the badge must never
  // cost the TABLE". It cannot any more, and not because of anything here:
  // `build --manifest*` is deferred at the pin (tan-cli#427), so the panel
  // fetches no manifest at all and `manifest` is null on EVERY path (#541).
  // What #470 is actually about survives intact -- the provenance verdict is
  // still computed from the file on disk and still reaches the view, because
  // whether a manifest exists and when it was written does not depend on tan
  // being able to parse it.
  const [msg] = await drivePanel({
    statThrows: true,
    lastBuild: { finishedAt: WRITTEN, exitCode: 0 },
  });

  assert.ok(msg, "the panel posted no systemManifestData at all");
  assert.equal(msg.postBuild, true, "the on-disk fact still reaches the view");
  assert.equal(msg.provenance?.freshness, "unknown");
  assert.equal(msg.provenance.writtenAt, null);
});
