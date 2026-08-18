// SPDX-License-Identifier: Apache-2.0
//
// The two-writers guard for #468 / ADR 0021 §5: the extension must never be a
// second writer of a variable the BUILD PLAN owns.
//
// Ownership is settled by ADR-0020 — the `envAppendPath` "plan wins / CLI fills
// gaps" rule and its Security consequence — and by ADR-0021's Ownership
// paragraph: provisioning logic in tan, pins in alp-sdk metadata, no PATH
// mutation anywhere. (This file first cited alp-sdk#949 item 2, following
// #468's own wording. That citation is wrong and the maintainer corrected it on
// alp-sdk#1286: #949 is bootstrap/toolchain provisioning —
// `metadata/toolchains.json`, `prerequisites.install` — not the plan-owned
// value rule. The substance was right, the reference was not.) If this
// extension also writes one of those names onto the `tan` child's environment,
// whichever writer lands last silently wins, and the failure shape is the worst
// one available: it built with the wrong compiler and nothing said so. No error,
// no warning, a green build and a wrong binary.
//
// Nothing writes them today. This file is what fails the day something does —
// a single `env: { ...spawnEnv(), ZEPHYR_SDK_INSTALL_DIR: sdkDir }` typechecks,
// breaks no other test, and would ship.
//
// The assertion is deliberately "the extension ADDS nothing", not "the variable
// is absent". A developer who exports `ZEPHYR_SDK_INSTALL_DIR` in their own
// shell SHOULD have it reach the child: inheriting the user's environment is not
// the extension writing it. So each name is checked in both directions —
// unset stays unset, and an exported value passes through byte-identical.
//
// Both child seams are covered. `cp.spawn` REPLACES the environment, so its
// `env` is the whole thing; `vscode.ProcessExecution` MERGES its `env` into the
// parent's, so the terminal seam's `env` is additions-only and any plan-owned
// key appearing there at all is a write. The terminal seam is where
// `tan bootstrap` and `tan build` run, so it is the one that matters most.
//
// Harness shape is borrowed from test/alpCli.spawnProxyEnv.test.js: the REAL
// out/alpCli/vscodeAdapter.js with its host requires swapped via `Module._load`,
// so the call chain from `runAlpCommand` to `cp.spawn` is the shipped one.

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const Module = require("node:module");

const root = path.join(__dirname, "..");
const ADAPTER = require.resolve(
  path.join(root, "out", "alpCli", "vscodeAdapter.js"),
);
const REAL_ADAPTER_CORE = require(
  path.join(root, "out", "alpCli", "adapterCore.js"),
);

/**
 * Every environment variable the build plan owns, taken from the plan a real
 * project emits rather than from memory. Generated for E1M-AEN801 on SDK
 * 0.15.0 (`scripts/alp_orchestrate/buildplan.py::emit_build_plan`), each slice
 * carries:
 *
 *   "env":           { "ALP_SDK_ROOT": "${SDK_ROOT}" }
 *   "envAppendPath": { "EXTRA_ZEPHYR_MODULES": ["${SDK_ROOT}"],
 *                      "PYTHONPATH":           ["${SDK_ROOT}/scripts"] }
 *
 * `ZEPHYR_SDK_INSTALL_DIR` and `ZEPHYR_TOOLCHAIN_VARIANT` are the ADR 0021 §5
 * names. They are NOT in the plan today — that is why #468's consumption slice
 * is blocked upstream — but they are listed here on purpose: they are the two
 * this extension is most likely to be tempted to write itself while waiting,
 * and that temptation is exactly what ADR-0021's Ownership paragraph forbids.
 */
const PLAN_OWNED = [
  "ALP_SDK_ROOT",
  "EXTRA_ZEPHYR_MODULES",
  "PYTHONPATH",
  "ZEPHYR_SDK_INSTALL_DIR",
  "ZEPHYR_TOOLCHAIN_VARIANT",
];

/** A child that produces no output and exits 0 the moment it is listened to. */
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

/** Load a FRESH copy of the real adapter and expose both child-launch seams. */
function loadAdapter() {
  delete require.cache[ADAPTER];
  let captured = null;
  const terminalRuns = [];
  const stubs = {
    vscode: {
      workspace: {
        getConfiguration: () => ({ get: (_key, fallback) => fallback }),
      },
    },
    child_process: {
      spawn: (_command, _args, options) => {
        captured = options;
        return fakeChild();
      },
      spawnSync: () => ({ status: 0, stdout: "tan 0.0.0\n", stderr: "" }),
      execFile: () => {},
    },
    "./adapterCore": {
      ...REAL_ADAPTER_CORE,
      // The one seam replaced: resolution would otherwise hit the filesystem
      // and, with nothing installed, try to DOWNLOAD.
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
    "../util": {
      log() {},
      runInTerminal(options) {
        terminalRuns.push(options);
      },
    },
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
    terminalRuns,
    spawnOptions: () => captured,
    context: {
      extensionPath: root,
      globalStorageUri: { fsPath: path.join(root, "no-such-storage-dir") },
      globalState: { update: async () => {} },
    },
  };
}

/** Run `fn` with `process.env` patched, then put it back exactly. A patch value
 *  of `undefined` DELETES the variable — assigning it would store the string
 *  "undefined", which reads as "the user exported one" and inverts the case. */
async function withEnv(patch, fn) {
  const saved = new Map(
    Object.keys(patch).map((key) => [key, process.env[key]]),
  );
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  try {
    return await fn();
  } finally {
    for (const [key, value] of saved) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

/** `PLAN_OWNED` as a patch object deleting every one of them. */
const allUnset = () =>
  Object.fromEntries(PLAN_OWNED.map((name) => [name, undefined]));

test("the spawned tan gets no plan-owned variable the extension invented", async () => {
  const { adapter, spawnOptions, context } = loadAdapter();
  const options = await withEnv(allUnset(), async () => {
    await adapter.runAlpCommand(context, ["sdk", "list"]);
    return spawnOptions();
  });
  assert.ok(options, "cp.spawn was never called — the harness is broken");

  for (const name of PLAN_OWNED) {
    assert.equal(
      options.env[name],
      undefined,
      `the extension wrote ${name} onto the tan child. The build plan owns ` +
        `that variable (ADR-0020, ADR-0021); a second writer means whichever ` +
        `runs last wins and a build with the wrong toolchain reports success. ` +
        `Consume the plan's value instead — see #468`,
    );
  }
});

test("an exported plan-owned variable reaches the child unchanged", async () => {
  const exported = {
    ZEPHYR_SDK_INSTALL_DIR: "/opt/zephyr-sdk-1.0.1",
    ZEPHYR_TOOLCHAIN_VARIANT: "zephyr",
    ALP_SDK_ROOT: "/home/u/.alp/sdk/v0.15.0-rc1",
  };
  const { adapter, spawnOptions, context } = loadAdapter();
  const options = await withEnv(exported, async () => {
    await adapter.runAlpCommand(context, ["sdk", "list"]);
    return spawnOptions();
  });
  assert.ok(options, "cp.spawn was never called — the harness is broken");

  for (const [name, value] of Object.entries(exported)) {
    assert.equal(
      options.env[name],
      value,
      `${name} was exported by the user and the extension changed it. ` +
        `Inheriting the developer's environment is right; rewriting it is the ` +
        `second-writer bug in the other direction`,
    );
  }
});

// The terminal seam MERGES into the parent environment, so anything present in
// its `env` at all was put there by this extension. `tan bootstrap` and
// `tan build` both run here — a plan-owned key on this path reaches the real
// build, not just an envelope query.
test("the terminal seam adds no plan-owned variable", async () => {
  const { adapter, terminalRuns, context } = loadAdapter();
  await withEnv(allUnset(), async () => {
    await adapter.runAlpInTerminal(context, ["bootstrap"], {
      name: "Alp: Bootstrap",
      cwd: undefined,
    });
  });
  assert.equal(
    terminalRuns.length,
    1,
    "expected exactly one runInTerminal call — the harness is broken",
  );

  const added = terminalRuns[0].env ?? {};
  for (const name of PLAN_OWNED) {
    assert.ok(
      !(name in added),
      `${name} is being MERGED into the environment of the terminal that runs ` +
        `the real build. ProcessExecution merges rather than replaces, so a ` +
        `key here is an addition this extension made — see #468`,
    );
  }
});

// PATH itself: ADR 0021 §5's other half is "no PATH mutation anywhere". The
// child inherits the parent's PATH; it must not be rewritten to point at an
// install this extension performed.
test("PATH reaches the child unmodified", async () => {
  const { adapter, spawnOptions, terminalRuns, context } = loadAdapter();
  const options = await withEnv(allUnset(), async () => {
    await adapter.runAlpCommand(context, ["sdk", "list"]);
    return spawnOptions();
  });
  assert.equal(
    options.env.PATH,
    process.env.PATH,
    "the extension rewrote PATH for the tan child. ADR 0021 §5 forbids PATH " +
      "mutation — the fix for a tool installed after the window opened is to " +
      "consume the plan's absolute path, not to patch PATH",
  );

  await withEnv(allUnset(), async () => {
    await adapter.runAlpInTerminal(context, ["build"], {
      name: "Alp: Build",
      cwd: undefined,
    });
  });
  assert.ok(
    !("PATH" in (terminalRuns[terminalRuns.length - 1].env ?? {})),
    "the terminal seam merges a PATH of its own into the build environment",
  );
});
