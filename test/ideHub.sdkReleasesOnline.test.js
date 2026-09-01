// SPDX-License-Identifier: Apache-2.0
//
// The SDK Manager's Install list came up empty on a working machine, and
// nothing anywhere said why.
//
// Cause: `handleRequestSdkReleases` shelled `tan sdk list` with no `--online`.
// Since tan v0.5.0 the GitHub releases API query is gated behind that flag
// (`--online  Allow \`list\` to query the GitHub releases API.`), so the
// envelope came back SUCCESS-shaped and empty:
//
//   {"command":"sdk","ok":true,"exitCode":0,
//    "data":{"subcommand":"list","releases":[]},
//    "issues":[{"code":"sdk.network-required","severity":"warning",
//      "message":"`sdk list` reports the Alp SDK releases published upstream
//       on GitHub -- there is no local/offline copy to answer from. Add
//       --online to fetch them."}]}
//
// `ok: true` took the success branch, `releases: []` was posted, and the
// warning issue was discarded — so the panel showed "Install a release above"
// above nothing at all, with no toast and no channel line.
//
// Two assertions, one per half of the fix: the argv actually carries
// `--online`, and a successful envelope's issues reach the "Alp SDK" channel
// instead of being dropped. The argv is asserted BY VALUE, not by shape — a
// test that only checks `args.includes("--online")` still passes if the
// subcommand itself regresses.

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const Module = require("node:module");

const root = path.join(__dirname, "..");

/** Same `Module._load` swap as test/ideHub.sdkInstallGit.test.js. */
function loadWithStubs(relPath, stubs) {
  const modPath = require.resolve(path.join(root, "out", relPath));
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

/** One Refresh click. `envelope` is what the stubbed `tan` answers with.
 *  `readOnlyProjectCwd` is overridable per-test — #605's own test wants a
 *  DISTINCT value to prove it reaches the spawn, not just any string. */
async function driveRefresh(envelope, projectCwd = "/proj") {
  const argvs = [];
  const cwds = [];
  const channel = [];
  const posted = [];
  const plans = [];

  const handler = loadWithStubs("ideHub/sdkManagerMessages.js", {
    vscode: {
      window: { withProgress: (_opts, task) => task({ report() {} }, {}) },
      workspace: { getConfiguration: () => ({ inspect: () => undefined }) },
      commands: { executeCommand: async () => undefined },
      ConfigurationTarget: { Global: 1, Workspace: 2 },
      ProgressLocation: { Notification: 15 },
    },
    "../alpCli/vscodeAdapter": {
      proxyEnvAdditions: () => ({}),
      runAlpCommand: async (_context, args, cwd) => {
        argvs.push(args);
        cwds.push(cwd);
        return { outcome: { envelope } };
      },
    },
    "../notify/vscodeAdapter": {
      notify: async () => undefined,
      notifyAsync: (plan) => plans.push(plan),
    },
    // #605: this handler used to pass `undefined` as the `sdk list` cwd; it
    // now resolves through `readOnlyProjectCwd()`.
    "../project/vscodeAdapter": { readOnlyProjectCwd: () => projectCwd },
    "../sdk/activeSdk": {
      clearActiveSdk: async () => {},
      setActiveSdk: async () => {},
      warnIfWestManifestDangling: () => false,
    },
    "../sdk/settingsWrite": { writeAlpSetting: async () => true },
    "../util": { log: (line) => channel.push(line) },
    "./vscodeAdapter": { sdkCacheRoot: () => path.join(root, "out") },
  });

  const consumed = handler.createSdkMessageHandler({
    context: {},
    post: (msg) => posted.push(msg),
    refresh: async () => {},
  })({ type: "requestSdkReleases" });
  assert.equal(consumed, true, "the handler must consume requestSdkReleases");

  // The handler is fire-and-forget, so wait for the post that stops the
  // webview's "Loading SDK list…" spinner rather than a promise nobody returns.
  for (let i = 0; i < 200 && posted.length === 0; i += 1) {
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  return { argvs, cwds, channel, posted, plans };
}

const RELEASE = {
  tag: "v0.15.0-rc1",
  publishedAt: "2026-07-31T21:54:56Z",
  tarballUrl:
    "https://api.github.com/repos/alplabai/alp-sdk/tarball/v0.15.0-rc1",
  releaseNotesSummary: "Release candidate.",
  releaseNotes: "Release candidate.",
};

test("the releases fetch asks tan to go online", async () => {
  const { argvs, posted } = await driveRefresh({
    command: "sdk",
    ok: true,
    exitCode: 0,
    project: { root: null, boardYaml: null },
    data: { subcommand: "list", releases: [RELEASE] },
    issues: [],
  });

  assert.equal(argvs.length, 1, "exactly one tan invocation per Refresh");
  // By value: `sdk list` without `--online` answers ok/empty, and any other
  // subcommand does not report releases at all.
  assert.deepEqual(argvs[0], ["sdk", "list", "--online"]);
  assert.deepEqual(posted, [
    { type: "sdkReleasesLoaded", releases: [RELEASE] },
  ]);
});

test("a successful-but-empty answer records its own reason", async () => {
  const { channel, posted } = await driveRefresh({
    command: "sdk",
    ok: true,
    exitCode: 0,
    project: { root: null, boardYaml: null },
    data: { subcommand: "list", releases: [] },
    issues: [
      {
        code: "sdk.network-required",
        severity: "warning",
        message:
          "`sdk list` reports the Alp SDK releases published upstream on GitHub -- there is no local/offline copy to answer from. Add --online to fetch them.",
      },
    ],
  });

  // The spinner still resolves — an empty list drops the user to the
  // actionable empty state rather than spinning forever.
  assert.deepEqual(posted, [{ type: "sdkReleasesLoaded", releases: [] }]);
  assert.deepEqual(channel, [
    "[sdk-list] warning: `sdk list` reports the Alp SDK releases published upstream on GitHub -- there is no local/offline copy to answer from. Add --online to fetch them.",
  ]);
});

// ── #611: share sdkListAnswered with the OTHER `sdk list` reader, and narrow
// rather than cast `releases` ────────────────────────────────────────────────
//
// `src/deps/vscodeAdapter.ts` refuses to CACHE an unanswered `sdk list`
// lookup; this handler used to log the same `issues[]` and post `releases`
// as a real catalogue regardless — a divergence, not (at the pinned tan,
// with `--online` always on the argv) a reachable bug: constructed directly
// here rather than through a real `tan` run, since the pin itself cannot
// produce `ok: true` + `sdk.network-required` while `--online` is set.
test("an (unreachable-at-the-pin, but still handled) ok:true+unanswered envelope posts no releases, closing the divergence with the other sdk-list reader", async () => {
  const { posted, channel, plans } = await driveRefresh({
    command: "sdk",
    ok: true,
    exitCode: 0,
    project: { root: null, boardYaml: null },
    data: { subcommand: "list", releases: [RELEASE] },
    issues: [
      {
        code: "sdk.network-required",
        severity: "warning",
        message: "tan reports it did not look.",
      },
    ],
  });

  assert.deepEqual(
    posted,
    [{ type: "sdkReleasesLoaded", releases: [] }],
    "an unanswered lookup must not post a real release as though it were one",
  );
  assert.deepEqual(channel, [
    "[sdk-list] warning: tan reports it did not look.",
  ]);
  // Adversarial review (#611 follow-up): posting `{ releases: [] }` with NO
  // notification renders identically to "there really are no releases" —
  // the same silent-blank class #607 fixed for the Build Plan panel. Even
  // though this branch is unreachable at the pinned tan, it must not leave a
  // new silent blank behind while closing the divergence.
  assert.equal(
    plans.length,
    1,
    "an unanswered lookup must say so on screen, not just to the channel",
  );
});

test("a release entry with no string tag is dropped, not thrown on, before it ever reaches the webview", async () => {
  const { posted } = await driveRefresh({
    command: "sdk",
    ok: true,
    exitCode: 0,
    project: { root: null, boardYaml: null },
    data: {
      subcommand: "list",
      releases: [{ ...RELEASE, tag: undefined }, RELEASE],
    },
    issues: [],
  });

  assert.deepEqual(posted, [
    { type: "sdkReleasesLoaded", releases: [RELEASE] },
  ]);
});

test("`sdk list` runs with an explicit, resolved cwd — never undefined (#605)", async () => {
  const { cwds } = await driveRefresh(
    {
      command: "sdk",
      ok: true,
      exitCode: 0,
      project: { root: null, boardYaml: null },
      data: { subcommand: "list", releases: [RELEASE] },
      issues: [],
    },
    "/work/renesas-control",
  );

  assert.ok(cwds.length > 0, "the lookup must still run");
  for (const cwd of cwds) {
    assert.equal(
      cwd,
      "/work/renesas-control",
      "an omitted cwd reaches child_process.spawn unset and the child " +
        "inherits the extension host's own directory instead of the " +
        "customer's project — `sdk` resolves a project and an SDK from cwd",
    );
  }
});
