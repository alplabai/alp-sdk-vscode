// SPDX-License-Identifier: Apache-2.0
//
// WHICH ROWS ARE WITHHELD WHEN NO FOLDER IS OPEN, AND WHO DECIDES.
//
// This file replaces test/deps.allowlistDrift.test.js, and the swap is the
// point rather than a tidy-up.
//
// #472: `PLAIN_DOCTOR_HOST_CHECKS` was a hand list of check names, derived
// against tan v0.4.0 and never re-derived. By the 0.5.1 pin one of its five
// entries — `zephyrSdkHost` — named a check the binary no longer emits, and
// nothing anywhere said so. The row it existed to admit was simply never
// admitted, and a missing row reads to a customer as "not a problem" rather
// than "not asked". The five strings were never the defect; the SILENCE was,
// so the guard became a drift report over the list.
//
// #544 removed the list instead. One `tan doctor` run means no merge, no
// duplicate row keys to dodge, and no allowlist — every check tan reports is a
// row. What is LEFT of the same question is narrower and lives in
// `isProjectCheck`: not "may this row exist" but "does this row read the
// project, so must it be withheld when there is no project".
//
// And that question tan now ANSWERS ITSELF. Every check in a pinned-tan
// envelope carries `"scope": "project"` or `"scope": "host"` — required by
// tan's frozen contract (`envelopes.doctor.dataKeys.checks.requiredKeys`). A
// hand list is consulted only for a binary older than that contract, reached
// through `alpSdk.cliPath`.
//
// So these tests pin two things: that tan's answer WINS, and that the fallback
// is reachable, correct, and cannot quietly become the primary source.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const Module = require("node:module");

const { SUPPORTED_CLI_VERSION } = require("../out/alpCli/service.js");

const root = path.join(__dirname, "..");

/** Load the deps adapter with `vscode` and the host modules stubbed.
 *  `overrides` replaces one stub per call; everything else stays inert. */
function loadAdapter(overrides = {}) {
  const modPath = require.resolve(
    path.join(root, "out", "deps", "vscodeAdapter.js"),
  );
  delete require.cache[modPath];
  const stubs = {
    vscode: {
      workspace: {
        getConfiguration: () => ({ get: (_k, fallback) => fallback }),
        workspaceFolders: undefined,
      },
      window: {
        createOutputChannel: () => ({
          appendLine() {},
          append() {},
          show() {},
          clear() {},
          dispose() {},
        }),
      },
      EventEmitter: class {
        constructor() {
          this.event = () => ({ dispose() {} });
        }
        fire() {}
        dispose() {}
      },
      Uri: { joinPath: (...p) => p.join("/"), parse: (v) => v },
      env: { openExternal: async () => true },
    },
    "../util": {
      isRunActive: () => false,
      log() {},
      runInTerminal() {},
    },
    "../notify/vscodeAdapter": { notifyAsync() {}, notify: async () => {} },
    ...overrides,
  };
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

const {
  isProjectCheck,
  scopeDriftLogLines,
  scopeVocabularyDrift,
  withheldProjectChecks,
} = loadAdapter();

/** A check as tan emits one. `scope` omitted entirely models a pre-contract
 *  binary — NOT `scope: undefined` written out, because the two differ to a
 *  `hasOwnProperty` reader and only the omission is what an old tan produces. */
const check = (name, scope) => ({
  name,
  status: "pass",
  detail: "",
  ...(scope === undefined ? {} : { scope }),
});

/**
 * The real envelope the pinned binary printed, for the tests that must not be
 * asserting against a stub of our own imagination.
 *
 * RESOLVED FROM `SUPPORTED_CLI_VERSION`, not from a hardcoded filename. The
 * capture used to be named in a string literal that merely HAPPENED to contain
 * the pinned version, so a pin bump left every assertion below reading the old
 * binary's envelope forever — the exact hole `test/tan.surfaceContract.test.js`
 * closes for `surface.json` with its first assertion. Naming the file from the
 * pin makes a bump a RED that says re-capture, which is the only moment anyone
 * would think to.
 */
const PINNED_DOCTOR_FIXTURE = path.join(
  __dirname,
  "fixtures",
  // `v`-prefixed, matching every other capture in `test/fixtures/`.
  `tan-doctor.v${SUPPORTED_CLI_VERSION}.darwin.json`,
);

const RECAPTURE =
  `no doctor capture for the pinned tan at ${PINNED_DOCTOR_FIXTURE}. A pin ` +
  `bump IS a doctor-envelope change: check names, the \`scope\` vocabulary ` +
  `and which checks are project-scoped all move with it, and every ` +
  `assertion in this file is about that envelope. Re-capture with ` +
  `\`COLUMNS=200 tan --format json doctor\` on the newly pinned binary, ` +
  `redact absolute paths onto /home/dev, and commit it under that name.`;

test("the captured doctor envelope is the PINNED tan's", () => {
  assert.ok(fs.existsSync(PINNED_DOCTOR_FIXTURE), RECAPTURE);
});

/** The capture, or a failure that says what to do. Read lazily so the assertion
 *  above is what reports a missing file, rather than a MODULE_NOT_FOUND at
 *  require time taking the whole file down with a stack trace. */
function pinnedEnvelope() {
  assert.ok(fs.existsSync(PINNED_DOCTOR_FIXTURE), RECAPTURE);
  return JSON.parse(fs.readFileSync(PINNED_DOCTOR_FIXTURE, "utf8")).data;
}

// ---------------------------------------------------------------------------
// tan's answer wins
// ---------------------------------------------------------------------------

test("tan's `scope` decides, not the name", () => {
  assert.equal(isProjectCheck(check("boardYaml", "project")), true);
  assert.equal(isProjectCheck(check("homePath", "host")), false);
});

test("a name in the legacy list scoped `host` by tan is NOT withheld", () => {
  // The direction that proves precedence rather than coincidence: `sdk` is in
  // `LEGACY_PROJECT_CHECKS`, so a fallback consulted first would withhold it.
  assert.equal(
    isProjectCheck(check("sdk", "host")),
    false,
    "tan said host; a hand list that overrode that would be the #472 defect " +
      "with the arrow reversed — our stale opinion beating the producer's " +
      "live answer",
  );
});

test("a project-scoped check absent from the legacy list IS withheld", () => {
  // The two the hand list never named. This is the concrete cost of a hand
  // list and the concrete gain of reading tan.
  for (const name of ["zephyrWorkspace", "pythonFloor"]) {
    assert.equal(
      isProjectCheck(check(name, "project")),
      true,
      `${name} is scoped \`project\` by the pinned tan and was never in the ` +
        "retired hand list — with that list as the source it answered about a " +
        "temp directory and read as a real verdict",
    );
  }
});

test("the pinned tan really does scope every check it emits", () => {
  // The tripwire under every assertion above: if a pin bump dropped `scope`,
  // the fallback would silently become the ONLY decider and nothing else here
  // would notice.
  const unscoped = pinnedEnvelope().checks.filter(
    (entry) => typeof entry.scope !== "string",
  );
  assert.deepEqual(
    unscoped.map((entry) => entry.name),
    [],
    "these checks carry no `scope`, so `LEGACY_PROJECT_CHECKS` — a hand list " +
      "derived against v0.4.0 — is what decides whether they are withheld. " +
      "That is #472 coming back through the fallback door",
  );
  assert.deepEqual(
    [...new Set(pinnedEnvelope().checks.map((entry) => entry.scope))].sort(),
    ["host", "project"],
    "and the vocabulary is the two words `isProjectCheck` interprets",
  );
});

// ---------------------------------------------------------------------------
// The fallback: reachable, correct, and no wider than it has to be
// ---------------------------------------------------------------------------

test("with no `scope` at all, the legacy names are withheld and nothing else is", () => {
  for (const name of ["sdk", "boardYaml", "workspace", "westResolved"]) {
    assert.equal(
      isProjectCheck(check(name)),
      true,
      `${name} answers about whatever directory tan was launched in on ` +
        "v0.4.0 — measured, not assumed",
    );
  }
  for (const name of ["git", "python", "cmake", "ninja", "longPaths", "lldb"]) {
    assert.equal(
      isProjectCheck(check(name)),
      false,
      `${name} is a PATH or host probe whose answer does not depend on the ` +
        "working directory — withholding it would blank a true row",
    );
  }
});

test("`westResolved` is legacy-project and `west` is not", () => {
  // Not a spelling detail: `westResolved` asks whether west resolves inside
  // the WORKSPACE venv, `west` is a plain PATH probe. Collapsing them is how a
  // pre-bootstrap machine rendered a venv verdict as a host fact.
  assert.equal(isProjectCheck(check("westResolved")), true);
  assert.equal(isProjectCheck(check("west")), false);
});

test("a scope word nobody has interpreted is not treated as project", () => {
  // tan may add a third word. Withholding on it would hide a row behind a
  // guess; showing it costs the customer one extra true verdict.
  assert.equal(isProjectCheck(check("somethingNew", "build")), false);
  assert.equal(isProjectCheck(check("somethingNew", "")), false);
});

test("a `scope` of the wrong SHAPE falls back rather than reading as truthy", () => {
  // `isDoctorEnvelopeData` refuses this before it gets here. Asserted anyway:
  // the narrower is one edit away from being loosened, and `{} === "project"`
  // is false while `if (check.scope)` would have been true.
  assert.equal(
    isProjectCheck({ name: "sdk", status: "pass", scope: {} }),
    true,
  );
  assert.equal(
    isProjectCheck({ name: "homePath", status: "pass", scope: 7 }),
    false,
  );
});

// ---------------------------------------------------------------------------
// What the withheld row says
// ---------------------------------------------------------------------------

test("a withheld row keeps its name and its scope, loses its verdict and its fix", () => {
  const data = {
    checks: [
      { name: "sdk", status: "fail", scope: "project", detail: "d", fix: "f" },
    ],
    summary: { pass: 0, warn: 0, fail: 1 },
  };
  const [row] = withheldProjectChecks(data, false).checks;

  assert.equal(
    row.name,
    "sdk",
    "the row stays — a vanished row teaches nothing",
  );
  assert.equal(row.scope, "project", "and keeps tan's own scope");
  assert.equal(row.status, "not checked");
  assert.match(row.detail, /no project folder is open/i);
  assert.equal(
    row.fix,
    null,
    "tan's remedy prose is for the verdict it never reached; offering a fix " +
      "for a finding nobody made is worse than offering none",
  );
});

test("with a project open the envelope is passed through untouched", () => {
  const data = {
    checks: [{ name: "sdk", status: "fail", scope: "project", detail: "d" }],
    summary: { pass: 0, warn: 0, fail: 1 },
  };
  assert.equal(
    withheldProjectChecks(data, true),
    data,
    "the same object, not a copy: nothing is filtered, added or reordered " +
      "when there is a project, and a rebuild would invite one to creep in",
  );
});

// ---------------------------------------------------------------------------
// Drift in the VOCABULARY itself
// ---------------------------------------------------------------------------
//
// `isProjectCheck` maps an unrecognised `scope` to "host". That default is
// right — see its own doc — and it is also completely silent. Rename `project`
// upstream and every project row is answered against `os.tmpdir()` with no log
// line and no failing test anywhere: exactly #472's failure mode, one field
// over. The #472-successor log that DOES exist fires only when NOT ONE check
// carries a scope string, so a renamed vocabulary slips past it whole.
//
// The retired `test/deps.allowlistDrift.test.js` asserted one core property:
// an entry the binary does not emit is REPORTED rather than quietly doing
// nothing. That property has an exact analogue here, and both directions of it
// are asserted below.

test("a scope value nobody interprets is reported, by VALUE and by check", () => {
  const drift = scopeVocabularyDrift({
    checks: [
      check("boardYaml", "project"),
      check("homePath", "host"),
      check("longPaths", "machine"),
      check("registry", "machine"),
      check("slice", "build"),
    ],
    summary: { pass: 5, warn: 0, fail: 0 },
  });

  assert.deepEqual(
    drift.unknown,
    [
      { scope: "build", checks: ["slice"] },
      { scope: "machine", checks: ["longPaths", "registry"] },
    ],
    "at VALUE granularity, with the checks that carried each word. A boolean " +
      "`somethingDrifted` would say nothing anyone can act on — which word " +
      "arrived, and on which checks, IS the report",
  );
  assert.deepEqual(
    drift.unused,
    [],
    "both interpreted words are in use here, so neither is reported",
  );
  assert.equal(drift.unscoped, false);

  const lines = scopeDriftLogLines(drift);
  assert.equal(lines.length, 2, "one line per unknown value, not one in total");
  assert.match(lines.join("\n"), /"machine"/);
  assert.match(lines.join("\n"), /longPaths, registry/);
  assert.match(lines.join("\n"), /"build"/);
});

test("a word we still branch on that the binary never emits is reported too", () => {
  // The retired allowlist-drift property, restored in the new vocabulary: the
  // failure that matters is not an unknown word arriving, it is `project`
  // LEAVING. `isProjectCheck` would then withhold nothing, every project row
  // would carry a verdict about a temp directory, and the unknown-value arm
  // above would happily report the new word without anyone noticing the old
  // one had gone.
  const drift = scopeVocabularyDrift({
    checks: [check("homePath", "host"), check("west", "host")],
    summary: { pass: 2, warn: 0, fail: 0 },
  });

  assert.deepEqual(
    drift.unused,
    ["project"],
    "`project` is a word `isProjectCheck` still branches on and this " +
      "envelope never used — a branch that can no longer fire, reported " +
      "rather than vanishing",
  );
  assert.match(
    scopeDriftLogLines(drift).join("\n"),
    /no doctor check in this envelope is scoped "project"/,
  );
});

test("the pinned tan's real envelope drifts in neither direction", () => {
  // The tripwire on both arms at once. If either one fires on the capture the
  // pin actually produced, the report is noise and would be tuned out.
  const drift = scopeVocabularyDrift({
    checks: pinnedEnvelope().checks,
    summary: { pass: 0, warn: 0, fail: 0 },
  });
  assert.deepEqual(drift.unknown, []);
  assert.deepEqual(drift.unused, []);
  assert.equal(drift.unscoped, false);
  assert.deepEqual(scopeDriftLogLines(drift), []);
});

test("no `scope` anywhere reports the fallback, and NOTHING else", () => {
  // A pre-0.5 binary has no vocabulary to compare, so the two lists above are
  // meaningless rather than empty — reporting "`project` is unused" about a
  // binary that predates the field would be a true sentence pointing at the
  // wrong thing.
  const drift = scopeVocabularyDrift({
    checks: [check("sdk"), check("git"), check("ninja")],
    summary: { pass: 3, warn: 0, fail: 0 },
  });

  assert.equal(drift.unscoped, true);
  assert.deepEqual(drift.unknown, []);
  assert.deepEqual(drift.unused, []);
  assert.deepEqual(scopeDriftLogLines(drift).length, 1);
  assert.match(scopeDriftLogLines(drift)[0], /LEGACY_PROJECT_CHECKS/);
});

// ---------------------------------------------------------------------------
// …and that the report actually reaches the log
// ---------------------------------------------------------------------------
//
// Every assertion above is about pure functions. The #472-successor log they
// replace was asserted by NO test at all — `log` is stubbed everywhere — so
// inverting its condition left the whole suite green. These two drive the real
// `buildDependencyReport` and read what it logged.

/** Drive the compiled `buildDependencyReport` against a fake doctor, returning
 *  every line it sent to the "Alp SDK" channel. */
async function loggedLines(doctorData) {
  const lines = [];
  const { buildDependencyReport } = loadAdapter({
    "../util": {
      isRunActive: () => false,
      log: (line) => lines.push(line),
      runInTerminal() {},
    },
    "../alpCli/doctor": {
      runDoctor: async () => ({ data: doctorData, message: "" }),
    },
    "../project/vscodeAdapter": {
      collectProjectContext: () => ({
        workspaceRoot: "/home/dev/proj",
        sdkRoot: null,
      }),
      readOnlyProjectCwd: () => "/home/dev/proj",
    },
  });
  const result = await buildDependencyReport(
    {},
    {
      sdk: { version: null },
      setup: {
        bootstrapRunning: false,
        toolVersions: { tan: "0.4.0", west: null, cmake: null, ninja: null },
      },
    },
  );
  return { lines, result };
}

test("a binary too old to report `scope` says so in the channel", async () => {
  // The real v0.4.0 `--build` envelope: no `scope` on any check, and it DOES
  // carry the PATH probes, so it reaches the log rather than the refusal.
  const { lines, result } = await loggedLines(
    require("./fixtures/tan-doctor-build.v0.4.0.windows.json").data,
  );

  assert.ok(result.report, "this envelope renders — see the guard's own tests");
  assert.equal(
    lines.filter((line) => line.includes("LEGACY_PROJECT_CHECKS")).length,
    1,
    "the #472-successor line must actually be logged, exactly once. It was " +
      "asserted by nothing before this: inverting its `.some()` left every " +
      "test in the repo green while the one surviving fallback went silent",
  );
});

test("a renamed scope vocabulary says so in the channel", async () => {
  const renamed = {
    checks: [
      { name: "sdk", status: "pass", detail: "", scope: "workspace" },
      { name: "west", status: "pass", detail: "", scope: "host" },
    ],
    summary: { pass: 2, warn: 0, fail: 0 },
  };
  const { lines, result } = await loggedLines(renamed);

  assert.ok(result.report, "a renamed vocabulary is a warning, not a refusal");
  const text = lines.join("\n");
  assert.match(
    text,
    /"workspace"/,
    "the unknown word reaches the channel — before this it was mapped to " +
      "`host` in perfect silence, and `sdk` (a project check under any name) " +
      "would have been rendered with a verdict about os.tmpdir()",
  );
  assert.match(
    text,
    /no doctor check in this envelope is scoped "project"/,
    "and so does the disappearance of the word that decides the withholding",
  );
});
