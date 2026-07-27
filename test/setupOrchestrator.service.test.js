// SPDX-License-Identifier: Apache-2.0
//
// The activation-time drift toast, and the extension id it is activated next
// to.
//
// Two defects motivate this file, both of which shipped green:
//
//   1. `maybeOfferSetupPanel` read and wrote its tool-version fingerprint in
//      workspaceState but kept the "already shown" gate in globalState. A
//      drift shown once in workspace A silenced it in workspace B, whose
//      customer never saw it.
//   2. The stored fingerprint is written by a PREVIOUS extension build. If
//      `versionFingerprint`'s shape ever changes, every customer is told their
//      build tools moved — naming tools whose versions did not move. The first
//      fix keyed that off "was the extension upgraded?", which is wrong in the
//      common direction: VS Code auto-updates extensions on startup, so a
//      genuine python/cmake/ninja move landing in that same activation was
//      swallowed PERMANENTLY (the fingerprint is re-recorded either way, so
//      there is no "next time" to catch it). The fingerprint now carries its
//      own format tag and is judged on the value, not on the upgrade.
//
// `planToolDrift` is PURE, so the decision is driven directly here with no VS
// Code host. `maybeOfferSetupPanel` itself is then driven over fake mementos,
// because the SCOPE of the gate (which memento) is invisible to the pure
// function and is exactly what defect 1 got wrong.
//
// The compiled module is loaded with its three requires swapped out (the same
// Module._load trick test/util.terminalFinish.test.js and
// test/webviewHtml.csp.test.js use), so the real shipped code is asserted, not
// a copy of it that can drift.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const Module = require("node:module");

const root = path.join(__dirname, "..");

/** Load out/ideHub/setupOrchestrator.js with `stubs` standing in for the
 *  requests it requires. Swaps Node's loader only for the duration of the
 *  synchronous require, so it never leaks into another test file sharing the
 *  process. */
function loadOrchestrator(stubs) {
  const modPath = require.resolve(
    path.join(root, "out", "ideHub", "setupOrchestrator.js"),
  );
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

// The leading `v1` is the fingerprint's own format tag (see
// `FINGERPRINT_FORMAT` in setupOrchestrator.ts) — it is what makes a stored
// value self-describing, so a value from an older format is never diffed.
const FP_BEFORE = "v1|py:3.11.3|west:1.2.0|cmake:3.28.0|ninja:1.11.1";
const FP_AFTER = "v1|py:3.11.3|west:1.3.0|cmake:3.28.0|ninja:1.11.1";
// What a pre-tag build wrote: same tools, no format tag at all.
const FP_LEGACY = "py:3.11.3|west:1.2.0|cmake:3.28.0|ninja:1.11.1";
// What a future format bump would write.
const FP_OTHER_FORMAT = "v2|py:3.11.3|west:1.2.0|cmake:3.28.0|ninja:1.11.1";

// ─────────────────────────── the pure decision ───────────────────────────

const { planToolDrift } = loadOrchestrator({
  vscode: {},
  "../notify/vscodeAdapter": {
    notify: async () => undefined,
    notifyAsync() {},
  },
  "../util": { log() {} },
  "./vscodeAdapter": {
    queryAlpIdeState: async () => {
      throw new Error("not used by the pure decision");
    },
  },
});

test("planToolDrift: unchanged versions say nothing", () => {
  assert.equal(
    planToolDrift({ stored: FP_BEFORE, current: FP_BEFORE, lastShown: "" }),
    null,
  );
});

test("planToolDrift: a first run has nothing to compare against", () => {
  assert.equal(
    planToolDrift({ stored: "", current: FP_AFTER, lastShown: "" }),
    null,
    "no stored fingerprint means the tools were observed for the first time, " +
      "not that they changed",
  );
});

test("planToolDrift: a changed version toasts, naming the tool that moved", () => {
  const plan = planToolDrift({
    stored: FP_BEFORE,
    current: FP_AFTER,
    lastShown: "",
  });
  assert.ok(plan, "a real tool change must be reported");
  assert.equal(
    plan.message,
    "Alp IDE: build tools changed since last session — west 1.2.0 → 1.3.0. " +
      "Run Doctor to re-verify the environment.",
  );
  assert.equal(plan.severity, "info");
  assert.equal(plan.channel, "toast");
  assert.deepEqual(plan.actions, [{ id: "runDoctor" }, { id: "showOutput" }]);
});

test("planToolDrift: a fingerprint of another shape falls back to the generic sentence", () => {
  // Same format tag, but an entry the current build no longer writes: the
  // entries that line up are identical, so no tool can be named.
  const plan = planToolDrift({
    stored: `${FP_BEFORE}|extra:1`,
    current: FP_BEFORE,
    lastShown: "",
  });
  assert.ok(plan);
  assert.equal(
    plan.message,
    "Alp IDE: build tool versions have changed since last session. " +
      "Run Doctor to re-verify the environment.",
  );
});

for (const [label, stored] of [
  ["a pre-tag build", FP_LEGACY],
  ["a later format", FP_OTHER_FORMAT],
]) {
  test(`planToolDrift: a fingerprint written by ${label} is not comparable`, () => {
    assert.equal(
      planToolDrift({ stored, current: FP_AFTER, lastShown: "" }),
      null,
      "entries written in another format do not line up, so diffing them " +
        "would name tools whose versions never moved",
    );
  });
}

test("planToolDrift: the SAME format with moved versions is still a drift", () => {
  // The counterpart to the two cases above, and the regression the old
  // `extensionUpgraded` flag caused: an ordinary tool move must survive.
  const plan = planToolDrift({
    stored: FP_BEFORE,
    current: FP_AFTER,
    lastShown: "",
  });
  assert.ok(plan, "same format + different versions = a real tool change");
  assert.match(plan.message, /west 1\.2\.0 → 1\.3\.0/);
});

test("planToolDrift: the same drift is not repeated", () => {
  assert.equal(
    planToolDrift({
      stored: FP_BEFORE,
      current: FP_AFTER,
      lastShown: FP_AFTER,
    }),
    null,
  );
});

// ───────────────────── the memento scope around it ──────────────────────

/** A `vscode.Memento` over a plain object. */
function memento(initial = {}) {
  const store = { ...initial };
  return {
    store,
    get: (key, fallback) =>
      Object.prototype.hasOwnProperty.call(store, key) ? store[key] : fallback,
    update: async (key, value) => {
      if (value === undefined) delete store[key];
      else store[key] = value;
    },
  };
}

const READY_STATE = {
  setup: {
    pythonAvailable: true,
    westAvailable: true,
    toolVersions: {
      python: "3.11.3",
      west: "1.3.0",
      cmake: "3.28.0",
      ninja: "1.11.1",
    },
  },
  sdk: { readiness: "ready" },
  workspace: { workspaceRoot: "/w" },
};

/** The environment the setup nudge exists for: west missing on an open
 *  project, so the toast fires and offers Bootstrap. */
const NOT_READY_STATE = {
  ...READY_STATE,
  setup: { ...READY_STATE.setup, westAvailable: false },
};

/** Run `maybeOfferSetupPanel` over the given mementos, collecting every plan
 *  the presenter was handed.
 *
 *  Returns the `notifyAsync` plans (the drift toast). `nudges` and `logs`, when
 *  passed, additionally collect the awaited `notify` plans (the setup nudge)
 *  and every output-channel line — those are what the bookkeeping-order and
 *  cancellation tests read. `state` is what the readiness query answers with,
 *  or an Error it rejects with. */
async function activate({
  globalState,
  workspaceState,
  state = READY_STATE,
  nudges,
  logs,
}) {
  const plans = [];
  const { maybeOfferSetupPanel } = loadOrchestrator({
    vscode: {},
    "../notify/vscodeAdapter": {
      notify: async (plan) => {
        nudges?.push(plan);
        return undefined;
      },
      notifyAsync: (plan) => plans.push(plan),
    },
    "../util": {
      log: (line, level = "info") => logs?.push({ line, level }),
    },
    "./vscodeAdapter": {
      queryAlpIdeState: async () => {
        if (state instanceof Error) throw state;
        return state;
      },
    },
  });
  await maybeOfferSetupPanel({ globalState, workspaceState });
  return plans;
}

const DRIFT_KEY = "alp.setupOrchestrator.lastShownFingerprint.drift";
const FINGERPRINT_KEY = "alp.setupOrchestrator.lastToolVersions";

test("a fingerprint in an older format is re-recorded without toasting", async () => {
  const workspaceState = memento({ [FINGERPRINT_KEY]: FP_LEGACY });
  const plans = await activate({
    globalState: memento(),
    workspaceState,
  });

  assert.deepEqual(
    plans,
    [],
    "a value written in another format is not comparable — saying 'your build " +
      "tools changed' would name versions that never moved",
  );
  assert.equal(
    workspaceState.store[FINGERPRINT_KEY],
    FP_AFTER,
    "the fingerprint must still be re-recorded, or the same stale comparison " +
      "is made again on the next activation",
  );
});

test("a real tool move is reported even on the activation that upgraded the extension", async () => {
  // The defect this replaces: VS Code auto-updates extensions on startup, so
  // gating the comparison on "the extension was upgraded" swallowed this
  // toast in the COMMON case — permanently, because the fingerprint below is
  // re-recorded regardless. Nothing here tells the orchestrator about an
  // upgrade any more; the stored value's format tag is the only signal.
  const workspaceState = memento({ [FINGERPRINT_KEY]: FP_BEFORE });
  const plans = await activate({
    globalState: memento(),
    workspaceState,
  });

  assert.equal(plans.length, 1, "west 1.2.0 → 1.3.0 must still be reported");
  assert.match(plans[0].message, /west 1\.2\.0 → 1\.3\.0/);
  assert.equal(workspaceState.store[FINGERPRINT_KEY], FP_AFTER);
});

test("a drift shown in one workspace still shows in another", async () => {
  // globalState is machine-wide and shared by both windows; workspaceState is
  // per-folder. The gate must live in the same scope as the fingerprint it
  // gates, or workspace B's customer is silenced by workspace A's toast.
  const globalState = memento();

  const workspaceA = memento({ [FINGERPRINT_KEY]: FP_BEFORE });
  const first = await activate({ globalState, workspaceState: workspaceA });
  assert.equal(first.length, 1, "workspace A is told its tools changed");
  assert.equal(workspaceA.store[DRIFT_KEY], FP_AFTER);
  assert.equal(
    globalState.store[DRIFT_KEY],
    undefined,
    "the gate must not be recorded machine-wide",
  );

  const workspaceB = memento({ [FINGERPRINT_KEY]: FP_BEFORE });
  const second = await activate({ globalState, workspaceState: workspaceB });
  assert.equal(
    second.length,
    1,
    "workspace B's customer has not seen this drift and must still be told",
  );
});

test("the same drift is not repeated in the same workspace", async () => {
  const globalState = memento();
  const workspaceState = memento({ [FINGERPRINT_KEY]: FP_BEFORE });
  assert.equal((await activate({ globalState, workspaceState })).length, 1);
  assert.deepEqual(
    await activate({ globalState, workspaceState }),
    [],
    "the fingerprint was re-recorded, so there is no drift left to report",
  );
});

// ────────────── bookkeeping must never gate the remedy ──────────────

/** A `Memento` whose writes always reject — a storage fault, or the teardown
 *  that rejects every pending main-thread reply. */
function rejectingMemento(err) {
  return {
    get: (_key, fallback) => fallback,
    update: async () => {
      throw err;
    },
  };
}

for (const [label, err] of [
  ["a storage fault", new Error("EPERM: operation not permitted")],
  [
    "window teardown",
    Object.assign(new Error("Canceled"), { name: "Canceled" }),
  ],
]) {
  test(`the setup nudge is shown even when a fingerprint write fails (${label})`, async () => {
    // The defect: two `workspaceState.update` RPCs sat BEFORE the nudge inside
    // the same `try`. Either one rejecting took the whole readiness check into
    // the catch, so the ONE customer-facing sentence this file exists to
    // deliver was never shown — and the only trace was a line claiming
    // readiness itself had failed. Fingerprint bookkeeping is a nicety; the
    // nudge is the product.
    const nudges = [];
    const logs = [];
    await activate({
      globalState: rejectingMemento(err),
      workspaceState: rejectingMemento(err),
      state: NOT_READY_STATE,
      nudges,
      logs,
    });

    assert.equal(nudges.length, 1, "the nudge must survive the failed write");
    assert.equal(
      nudges[0].message,
      "Alp: build environment not set up (west not found). Run Bootstrap to " +
        "install west + Zephyr build tools.",
    );
    assert.deepEqual(
      logs.filter((l) => l.line.startsWith("[setup] readiness check failed")),
      [],
      "a failed bookkeeping write is not a failed readiness check",
    );
  });
}

test("a failed fingerprint write is still reported to the channel", async () => {
  // Fire-and-forget, not ignore-and-forget: the write is idempotent and the
  // next activation redoes it, but a rejection still leaves one line naming
  // the key — and never an unhandled rejection.
  const logs = [];
  await activate({
    globalState: memento(),
    workspaceState: rejectingMemento(new Error("EPERM")),
    state: NOT_READY_STATE,
    nudges: [],
    logs,
  });
  assert.deepEqual(
    logs.filter((l) => l.line.startsWith("[setup] could not record")),
    [
      {
        line: "[setup] could not record alp.setupOrchestrator.lastToolVersions: Error: EPERM",
        level: "warn",
      },
    ],
  );
});

// ─────────── the window closing is not a readiness failure ───────────

test("a readiness check abandoned by window teardown is not logged as a failure", async () => {
  // Observed verbatim in two extension-host transcripts:
  //   [setup] readiness check failed: Canceled: Canceled
  // The check did not fail — the window went away (reload/close, or a
  // folder-open replacing the workspace), and the host rejected every pending
  // main-thread reply, the unanswered toast above included.
  const logs = [];
  await activate({
    globalState: memento(),
    workspaceState: memento(),
    state: Object.assign(new Error("Canceled"), { name: "Canceled" }),
    logs,
  });
  assert.deepEqual(logs, [
    {
      line: "[setup] readiness check abandoned, window closing",
      level: "info",
    },
  ]);
});

test("a real fault is STILL a readiness failure, even when it mentions cancellation", async () => {
  // The half-fix that would be worse than the bug: matching on the message
  // alone swallows real faults in the one channel the customer is told to
  // read.
  const logs = [];
  await activate({
    globalState: memento(),
    workspaceState: memento(),
    state: new Error("Canceled"),
    logs,
  });
  assert.deepEqual(logs, [
    {
      line: "[setup] readiness check failed: Error: Canceled",
      level: "warn",
    },
  ]);
});

// ───────────────────────── the extension id ─────────────────────────────

// `context.extension.id` is the authoritative `<publisher>.<name>`. Hardcoding
// it drifted once already: src/extension.ts spelled it `alplabai.alp-sdk`
// while package.json publishes `"publisher": "AlpLabAI"`, so
// `alp.openGettingStarted` asked VS Code for a walkthrough id that does not
// exist. A behavioural test cannot see that — the command resolves, and
// nothing opens — so this reads SOURCE.

const SRC = path.join(root, "src");

const HARDCODED_ID = [
  // `alplabai.alp-sdk#alpGettingStarted` — an id glued to the walkthrough id.
  // The composed form ends in `}`, so it never matches.
  /[A-Za-z0-9._-]#alpGettingStarted/,
  // The two query filters that take this extension's id: the Settings one
  // (`ext` prefix) and the Extensions-view search the notify presenter's
  // `openExtensions` action runs (`id` prefix). Both composed forms
  // interpolate, so the character after the colon is `$` and never matches.
  /@(?:ext|id):[A-Za-z0-9._-]/,
  // …and the same filter with the literal moved into the interpolation as a
  // default (`@id:${arg ?? "alplabai.alp-sdk"}`), which is how the mis-cased
  // spelling survived the first version of this guard: the id is still
  // re-typed, it is just no longer the first thing after the colon. A quoted
  // string anywhere on an `@ext:`/`@id:` line is a hardcoded id.
  /@(?:ext|id):.*["'][A-Za-z0-9._-]+["']/,
];

function tsFiles(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...tsFiles(full));
    else if (entry.name.endsWith(".ts")) out.push(full);
  }
  return out;
}

function hardcodedIdSites(files) {
  const sites = [];
  for (const file of files) {
    const lines = fs.readFileSync(file, "utf8").split("\n");
    lines.forEach((line, index) => {
      if (HARDCODED_ID.some((re) => re.test(line))) {
        sites.push(
          `src/${path.relative(SRC, file).replace(/\\/g, "/")}:${index + 1}`,
        );
      }
    });
  }
  return sites;
}

test("no source file hardcodes this extension's id", () => {
  assert.deepEqual(
    hardcodedIdSites(tsFiles(SRC)),
    [],
    "The publisher/extension id is being re-typed instead of read from " +
      "`context.extension.id`, which is what VS Code actually registered this " +
      "extension under. A mis-cased copy compiles, ships, and silently opens " +
      "nothing.\nOffenders:\n  " +
      hardcodedIdSites(tsFiles(SRC)).join("\n  "),
  );
});

test("the id guard can actually see an offending literal", () => {
  // Proves the guard is not vacuously green, and that the composed forms the
  // shipped code uses are genuinely accepted.
  const offending = [
    '"alplabai.alp-sdk#alpGettingStarted",',
    '"AlpLabAI.alp-sdk#alpGettingStarted",',
    '"@ext:alplabai.alp-sdk",',
    // Correct casing is still a re-typed id, so both spellings must be caught.
    '`@id:${arg ?? "alplabai.alp-sdk"}`,',
    '`@id:${arg ?? "AlpLabAI.alp-sdk"}`,',
  ];
  const accepted = [
    "`${context.extension.id}#alpGettingStarted`,",
    "`@ext:${context.extension.id}`,",
    "`@id:${arg ?? thisExtensionId}`,",
  ];
  for (const line of offending) {
    assert.ok(
      HARDCODED_ID.some((re) => re.test(line)),
      `must be rejected: ${line}`,
    );
  }
  for (const line of accepted) {
    assert.ok(
      !HARDCODED_ID.some((re) => re.test(line)),
      `must be accepted: ${line}`,
    );
  }
});
