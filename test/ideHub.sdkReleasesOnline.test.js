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

/** One Refresh click. `envelope` is what the stubbed `tan` answers with. */
async function driveRefresh(envelope) {
  const argvs = [];
  const channel = [];
  const posted = [];

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
      runAlpCommand: async (_context, args) => {
        argvs.push(args);
        return { outcome: { envelope } };
      },
    },
    "../notify/vscodeAdapter": {
      notify: async () => undefined,
      notifyAsync: () => {},
    },
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
  return { argvs, channel, posted };
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
