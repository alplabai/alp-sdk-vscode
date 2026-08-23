// SPDX-License-Identifier: Apache-2.0
//
// Doctor has to measure the environment the BUILD runs in, not the one VS Code
// happened to inherit.
//
// Builds go through `runAlpStreamed`, which spawns under the user's login shell
// (`loginShellInvocation`). Its own comment records the measurement that made
// that necessary: `spawn west ENOENT` before, `West version: v1.5.0` after. The
// envelope path — `runAlpCommand`, which `runDoctor` uses — did not, so `tan
// doctor` answered about a different PATH. That is how the Dependencies panel
// came to advise installing a tool the build had just found.
//
// This drives the REAL `runAlpCommand` and asserts on what reaches `cp.spawn`,
// because the pure invocation builder can stay perfect while nothing calls it:
// dropping `loginShell: true` from the doctor call site is a one-token edit
// that typechecks and breaks no other test.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const Module = require("node:module");

const root = path.join(__dirname, "..");
const ADAPTER = require.resolve(
  path.join(root, "out", "alpCli", "vscodeAdapter.js"),
);
const REAL_ADAPTER_CORE = require(
  path.join(root, "out", "alpCli", "adapterCore.js"),
);

function fakeChild() {
  const stream = { setEncoding() {}, on() {} };
  return {
    stdout: stream,
    stderr: stream,
    kill() {},
    on(event, handler) {
      if (event === "close") setImmediate(() => handler(0));
    },
  };
}

/** Load the real adapter and capture every `cp.spawn` call it makes. */
function loadAdapter() {
  delete require.cache[ADAPTER];
  const spawns = [];
  const stubs = {
    vscode: {
      workspace: {
        getConfiguration: () => ({ get: (_key, fallback) => fallback }),
      },
    },
    child_process: {
      spawn: (command, args, options) => {
        spawns.push({ command, args, options });
        return fakeChild();
      },
      spawnSync: () => ({ status: 0, stdout: "tan 0.0.0\n", stderr: "" }),
      execFile: () => {},
    },
    "./adapterCore": {
      ...REAL_ADAPTER_CORE,
      // The one seam replaced: real resolution would hit the filesystem and,
      // with nothing installed, try to download. Everything downstream —
      // `runAlpAsync`, the curried spawner, `spawnAlpAsync` — is real.
      resolveAlpBinary: async () => ({ command: "tan", source: "cached" }),
    },
    "../notify/vscodeAdapter": {
      notify: async () => undefined,
      notifyAsync() {},
    },
    "../project/vscodeAdapter": {
      collectProjectContext: () => ({
        workspaceRoot: null,
        sdkRoot: null,
        boardYamlPath: null,
        westCwd: null,
        pythonBinary: "python",
      }),
    },
    "../util": { log() {}, runInTerminal() {} },
  };
  const originalLoad = Module._load;
  Module._load = function (request, ...rest) {
    return Object.prototype.hasOwnProperty.call(stubs, request)
      ? stubs[request]
      : originalLoad.call(this, request, ...rest);
  };
  let adapter;
  try {
    adapter = require(ADAPTER);
  } finally {
    Module._load = originalLoad;
    delete require.cache[ADAPTER];
  }
  return {
    adapter,
    spawns,
    context: {
      extensionPath: root,
      globalStorageUri: { fsPath: path.join(root, "no-such-storage-dir") },
      globalState: { update: async () => {} },
    },
  };
}

const isPosix = process.platform !== "win32";

test("without the flag, the binary is spawned directly", async () => {
  const { adapter, spawns, context } = loadAdapter();

  await adapter.runAlpCommand(context, ["presets"], undefined);

  assert.equal(spawns.length, 1);
  assert.equal(spawns[0].command, "tan", "no shell wrapping when not asked");
  assert.ok(!spawns[0].args.includes("-lc"));
});

test(
  "loginShell routes the run through the user's login shell",
  { skip: !isPosix },
  async () => {
    const { adapter, spawns, context } = loadAdapter();

    await adapter.runAlpCommand(context, ["doctor"], undefined, {
      loginShell: true,
    });

    assert.equal(spawns.length, 1);
    const { command, args } = spawns[0];
    assert.equal(
      command,
      process.env.SHELL?.trim() || "/bin/sh",
      "the user's own shell, so their profile is what defines PATH",
    );
    assert.equal(args[0], "-lc", "a LOGIN shell — `-c` alone reads no profile");
    assert.match(
      args[1],
      /\btan\b/,
      "the tan invocation is what the shell is asked to exec",
    );
    assert.match(args[1], /\bdoctor\b/);
  },
);

test("the doctor call site asks for it", () => {
  // `runDoctor` is the single doctor spawn path (its own header says so), and
  // the flag is what makes it measure the build's environment. A behavioural
  // test on `runAlpCommand` cannot see the call site being reverted.
  const source = fs.readFileSync(
    path.join(root, "src", "alpCli", "doctor.ts"),
    "utf8",
  );

  assert.match(
    source,
    /loginShell:\s*true/,
    "tan doctor must measure the login environment, not VS Code's inherited PATH",
  );
});
