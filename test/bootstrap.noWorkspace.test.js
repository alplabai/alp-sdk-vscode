// SPDX-License-Identifier: Apache-2.0
//
// The one guard in `alp.installDependencies` that protects the customer's
// disk, and the run it must NOT block.
//
// `tan bootstrap` creates a venv and a west workspace in its cwd. With no
// folder open there is no cwd to hand it: `runAlpInTerminal` would pass
// `cwd: undefined`, the child would inherit the extension host's own working
// directory (on Windows, the VS Code install directory), and bootstrap would
// scaffold a west workspace there. Nothing about that failure is visible —
// the terminal succeeds.
//
// So this drives the REAL registered command handler out of `out/bootstrap.js`
// (same `Module._load` swap as test/setupOrchestrator.service.test.js) with
// the workspace root as the only variable, and asserts on the two things that
// actually matter: was a process spawned, and with which cwd. A source-level
// grep could not tell those apart, and the whole suite stayed green with the
// guard deleted before this file existed.
//
// `src/notify/service.ts` and `src/alpCli/service.ts` are pure, so they are
// loaded FOR REAL — the asserted sentence is the one the customer sees, not a
// copy of it in a stub.

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const Module = require("node:module");

const root = path.join(__dirname, "..");

/** Load out/bootstrap.js with `stubs` standing in for the requires named.
 *  Swaps Node's loader only for the duration of the synchronous require, so it
 *  never leaks into another test file sharing the process. */
function loadBootstrap(stubs) {
  const modPath = require.resolve(path.join(root, "out", "bootstrap.js"));
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

/** Sentinel standing in for loader.ts's CANCELLED — the pre-flight stub never
 *  returns it, so the win32 path always falls through to the real run. */
const CANCELLED = Symbol("CANCELLED");

/**
 * Register the bootstrap commands against a fake host whose only interesting
 * property is `workspaceRoot`, and collect every terminal spawn, pre-flight
 * probe and notification plan.
 *
 * `awaitRunCode` controls what the bootstrap terminal run "finished" with —
 * `0` (default) for a clean exit, anything else for a failed/cancelled one —
 * so tests can drive #614's reconciliation follow-up without a real terminal.
 *
 * `alreadyRunning` simulates `isRunActive("Alp Bootstrap")` already being true
 * the moment this dispatch starts — a SECOND concurrent caller, which the
 * real `runInTerminal` (util.ts) would refuse without reserving anything.
 *
 * `dispatchReserves: false` simulates a dispatch that never actually starts
 * (e.g. `resolveAlpBinaryForContext` failed and the customer declined to
 * retry) — `runAlpInTerminal` returns, but `isRunActive` never turns true.
 *
 * `manualAwaitRun` holds the terminal "finish" open until the test calls the
 * returned `resolveAwaitRun(code)` itself, instead of an already-settled
 * promise — so a test can prove the reconcile genuinely waits for the
 * terminal to exit, not just for dispatch to return.
 *
 * `collectProjectContextCalls` (returned) counts every call, and after the
 * first, `collectProjectContext` answers a DIFFERENT, WRONG workspaceRoot —
 * so a caller that re-derives `cwd` from a second call instead of using the
 * one it already captured is caught, not just one that happens to agree.
 */
function register(workspaceRoot, options = {}) {
  // Not a destructured default: `{ awaitRunCode = 0 } = {}` would also
  // replace an EXPLICITLY passed `awaitRunCode: undefined` with `0`, which is
  // exactly the "task never started" case one test below needs to drive.
  const awaitRunCode = Object.prototype.hasOwnProperty.call(
    options,
    "awaitRunCode",
  )
    ? options.awaitRunCode
    : 0;
  const handlers = new Map();
  const spawns = [];
  const preflights = [];
  const plans = [];
  // Both `awaitRun` and `runAlpInTerminal` push here, in call order — the
  // contract `util.ts`'s own doc states for `awaitRun` ("SUBSCRIBE BEFORE
  // DISPATCHING") is otherwise unobservable from outside the module.
  const order = [];
  const reconcileCalls = [];
  let resolveReconciled = () => {};
  const reconciled = new Promise((resolve) => {
    resolveReconciled = resolve;
  });

  let runActive = options.alreadyRunning ?? false;
  let resolveAwaitRun = () => {};
  const awaitRunPromise = options.manualAwaitRun
    ? new Promise((resolve) => {
        resolveAwaitRun = resolve;
      })
    : Promise.resolve(awaitRunCode);

  let contextCalls = 0;

  const { registerBootstrapCommand } = loadBootstrap({
    vscode: {
      commands: {
        registerCommand(id, handler) {
          handlers.set(id, handler);
          return { dispose() {} };
        },
        executeCommand: async () => undefined,
      },
      env: { openExternal: async () => true },
      Uri: { parse: (value) => value },
    },
    "./alpCli/vscodeAdapter": {
      runAlpInTerminal: async (...args) => {
        order.push(["runAlpInTerminal", args[2]]);
        spawns.push(args);
        if (options.dispatchReserves !== false) runActive = true;
      },
    },
    "./loader": {
      CANCELLED,
      // An envelope with no issues: neither the host-level refusal nor the
      // prerequisites-missing one fires, so the win32 pre-flight falls through
      // to the real run — the path this file needs to reach.
      runAlpWithProgress: async (...args) => {
        preflights.push(args);
        return {
          outcome: { envelope: { issues: [] }, severity: "warning" },
          raw: { stdout: "", stderr: "" },
          source: "test",
        };
      },
    },
    "./project/vscodeAdapter": {
      collectProjectContext: () => {
        contextCalls += 1;
        return {
          workspaceRoot:
            contextCalls === 1
              ? workspaceRoot
              : "/wrong-cwd-from-a-second-call",
        };
      },
    },
    "./sdk/activeSdk": {
      reconcileActiveSdkAfterBootstrap: async (context, cwd) => {
        reconcileCalls.push({ context, cwd });
        resolveReconciled();
      },
    },
    "./util": {
      log() {},
      isRunActive: (name) => name === "Alp Bootstrap" && runActive,
      awaitRun: (name) => {
        order.push(["awaitRun", name]);
        return awaitRunPromise;
      },
    },
    "./notify/vscodeAdapter": {
      notify: async (plan) => {
        plans.push(plan);
        return undefined;
      },
    },
  });

  registerBootstrapCommand({});
  return {
    handlers,
    spawns,
    preflights,
    plans,
    order,
    reconcileCalls,
    reconciled,
    resolveAwaitRun: (code) => resolveAwaitRun(code),
    contextCallCount: () => contextCalls,
  };
}

/** Flush pending microtasks — enough for a `.then()` chain attached to an
 *  already-settled promise (this harness's `awaitRun` stub) to run, without a
 *  real timer. Used only to assert something must NOT have happened by now. */
function flushMicrotasks() {
  return new Promise((resolve) => setImmediate(resolve));
}

// Both ids run the same handler: the palette/Setup-view one and the id the
// webview's "Initialize Workspace" / "Activate workspace" buttons post. A
// guard on only one of them still lets the other scaffold in the wrong place.
for (const command of ["alp.installDependencies", "alp.bootstrap"]) {
  test(`${command} with no folder open never spawns tan`, async () => {
    const { handlers, spawns, preflights, plans } = register(null);

    await handlers.get(command)();

    assert.deepEqual(
      spawns,
      [],
      "with no workspace root the child would inherit the extension host's " +
        "cwd and create a venv + west workspace there — nothing may spawn",
    );
    assert.deepEqual(
      preflights,
      [],
      "the win32 pre-flight must not run against an arbitrary directory either",
    );
    assert.equal(plans.length, 1, "exactly one notification, and it explains");
    assert.equal(plans[0].message, "Open a folder to bootstrap the toolchain.");
  });
}

test("alp.installDependencies with a folder open runs tan in that folder", async () => {
  const { handlers, spawns, plans } = register("/w");

  await handlers.get("alp.installDependencies")();

  assert.equal(spawns.length, 1, "the guard must not block a real bootstrap");
  const [, argv, options] = spawns[0];
  assert.deepEqual(argv, ["bootstrap"]);
  assert.equal(options.cwd, "/w", "tan must run in the open folder");
  assert.equal(options.name, "Alp Bootstrap");
  assert.deepEqual(plans, [], "nothing to tell the customer on the happy path");
});

// ---------------------------------------------------------------------------
// The SECOND disk-protecting guard: the win32 pre-flight's own argv.
//
// The pre-flight was written as a read-only probe -- "the SAME gate a real run
// hits, made side-effect-free by those two flags". It is not. Measured against
// the pinned tan 0.6.0, `bootstrap --no-pip --no-west` MOVES the customer's
// alp-sdk checkout (tan-cli#185) and writes the machine-global default-SDK
// pointer `~/.alp/sdk-default`, both BEFORE the pip and west phases those two
// flags skip. It returns `ok:true, exitCode:0`, so every verdict this call site
// parses stays silent and the extension logs nothing.
//
// `--dry-run` is what actually makes it read-only: "Resolve everything and
// report the commands each step would run, without installing, cloning or
// writing anything." Measured to still produce the two verdicts this call site
// reads (`bootstrap.prerequisites-missing` + `missingPrerequisites[]`).
//
// The platform check is a runtime `process.platform` read inside the handler,
// so the override has to wrap the CALL, not the require.

/** Run `fn` with `process.platform` reporting `value`, then restore it. */
async function withPlatform(value, fn) {
  const original = Object.getOwnPropertyDescriptor(process, "platform");
  Object.defineProperty(process, "platform", { value, configurable: true });
  try {
    return await fn();
  } finally {
    Object.defineProperty(process, "platform", original);
  }
}

test("the win32 pre-flight probes with --dry-run and writes nothing", async () => {
  const { handlers, preflights } = register("/w");

  await withPlatform("win32", () => handlers.get("alp.installDependencies")());

  assert.equal(preflights.length, 1, "the win32 pre-flight must still run");
  const [, argv] = preflights[0];
  assert.ok(
    argv.includes("--dry-run"),
    "without --dry-run this probe MOVES the customer's alp-sdk checkout and " +
      "repoints their global default SDK, at ok:true with nothing logged " +
      `(argv was ${JSON.stringify(argv)})`,
  );
  assert.deepEqual(argv, ["bootstrap", "--no-pip", "--no-west", "--dry-run"]);
});

// ---------------------------------------------------------------------------
// #604/#614: after `tan bootstrap` runs in the terminal, ask `tan sdk current`
// so tan's own resolution ladder and `alpSdk.path` are reconciled at the one
// moment they are known to diverge (a relocating bootstrap, tan-cli#185).
//
// The terminal route parses NOTHING from the bootstrap run itself (`
// runAlpInTerminal` just starts a live terminal) — the follow-up is a
// SEPARATE envelope call, made once the run finishes, not a parse of its
// output.

test("a clean bootstrap exit asks tan sdk current in the SAME cwd it just bootstrapped", async () => {
  const { handlers, reconcileCalls, reconciled, contextCallCount } = register(
    "/w",
    { awaitRunCode: 0 },
  );

  await handlers.get("alp.installDependencies")();
  await reconciled;

  assert.equal(reconcileCalls.length, 1);
  // Major 9 (adversarial review): `collectProjectContext` answers something
  // DIFFERENT after the first call (this harness's own fixture) — a
  // reconcile that re-derived `cwd` from a second call instead of the
  // captured parameter would fail this, not just happen to agree with it.
  assert.equal(reconcileCalls[0].cwd, "/w");
  assert.equal(
    contextCallCount(),
    1,
    "the dispatched cwd must be threaded through as a captured value, not " +
      "re-read from collectProjectContext() a second time",
  );
});

test("a failed bootstrap exit never asks tan sdk current", async () => {
  const { handlers, reconcileCalls } = register("/w", { awaitRunCode: 1 });

  await handlers.get("alp.installDependencies")();
  await flushMicrotasks();

  assert.deepEqual(
    reconcileCalls,
    [],
    "reconciling off a run that failed risks reporting a location nothing " +
      "actually finished writing to",
  );
});

test("an unknown bootstrap exit code (task never started) never asks tan sdk current", async () => {
  const { handlers, reconcileCalls } = register("/w", {
    awaitRunCode: undefined,
  });

  await handlers.get("alp.installDependencies")();
  await flushMicrotasks();

  assert.deepEqual(reconcileCalls, []);
});

test("subscribes to the bootstrap run's finish BEFORE dispatching it", async () => {
  const { handlers, order, reconciled } = register("/w");

  await handlers.get("alp.installDependencies")();
  await reconciled;

  assert.deepEqual(order, [
    ["awaitRun", "Alp Bootstrap"],
    ["runAlpInTerminal", { name: "Alp Bootstrap", cwd: "/w" }],
  ]);
});

// MAJOR 4 (adversarial review): `awaitRun`'s subscription has no
// unsubscribe and no correlation to which caller's dispatch it belongs to —
// it just resolves on the FIRST `terminalFinished` event under this name.
// Two races that exposed:
test("a SECOND dispatch while one is already running does not subscribe -- the run in flight owns reconciling", async () => {
  const { handlers, order, reconcileCalls } = register("/w", {
    alreadyRunning: true,
  });

  // No `awaitRun` is ever subscribed for THIS call (asserted below), so
  // there is nothing here to await settling — the run already in flight
  // (simulated by `alreadyRunning`, not represented in this harness) is what
  // would eventually resolve it in the real system.
  await handlers.get("alp.installDependencies")();
  await flushMicrotasks();

  assert.deepEqual(
    order.filter((e) => e[0] === "awaitRun"),
    [],
    "a refused re-run must not attach a SECOND listener to the one event " +
      "the run already in flight will fire -- that double-fires reconcile, " +
      "the second time against a cwd that never actually bootstrapped",
  );
  assert.deepEqual(
    reconcileCalls,
    [],
    "this dispatch reserved nothing, so nothing here should have reconciled",
  );
});

test("a dispatch that never actually reserves the run does not reconcile, even on a later unrelated finish", async () => {
  const { handlers, reconcileCalls, resolveAwaitRun } = register("/w", {
    dispatchReserves: false,
    manualAwaitRun: true,
  });

  await handlers.get("alp.installDependencies")();
  // Simulates the ONE real `terminalFinished` event under this name later
  // firing for some OTHER, unrelated bootstrap -- the exact way a listener
  // left over from a dispatch that never truly started used to fire wrongly.
  resolveAwaitRun(0);
  await flushMicrotasks();

  assert.deepEqual(
    reconcileCalls,
    [],
    "a dispatch that reserved nothing must never act on whatever the " +
      "shared event bus eventually resolves to",
  );
});

// MINOR 10 (adversarial review): the RED before this test used an
// already-settled `awaitRun` stub throughout, so a bug that reconciled at
// DISPATCH time instead of at terminal-EXIT time would have stayed green.
test("reconciles only after the terminal genuinely EXITS, not merely once dispatch resolves", async () => {
  const { handlers, reconcileCalls, resolveAwaitRun } = register("/w", {
    manualAwaitRun: true,
  });

  await handlers.get("alp.installDependencies")();
  assert.deepEqual(
    reconcileCalls,
    [],
    "dispatch resolving is not the terminal exiting -- must not reconcile yet",
  );

  resolveAwaitRun(0);
  await flushMicrotasks();
  assert.equal(
    reconcileCalls.length,
    1,
    "reconciles once the terminal actually reports its exit code",
  );
});

test("alp.bootstrap (the webview's id) also reconciles, not just the palette command", async () => {
  const { handlers, reconcileCalls, reconciled } = register("/w");

  await handlers.get("alp.bootstrap")();
  await reconciled;

  assert.equal(reconcileCalls.length, 1);
});
