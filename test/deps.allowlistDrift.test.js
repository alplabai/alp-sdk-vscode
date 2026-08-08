// SPDX-License-Identifier: Apache-2.0
//
// #472: `PLAIN_DOCTOR_HOST_CHECKS` was derived against tan v0.4.0 and never
// re-derived. By the 0.5.1 pin one of its five entries — `zephyrSdkHost` —
// named a check the binary no longer emits, and nothing anywhere said so. The
// row it existed to admit was simply never admitted, and a missing row reads to
// a customer as "not a problem" rather than "not asked".
//
// The five strings were never the defect. The silence was. So the guard here is
// `plainDoctorAllowlistDrift`, and these tests pin what it must say — not a
// fixed allowlist, which would just be the same hand-maintained list a second
// time and would go stale the same way.
//
// Why this is not a contract-corpus test: `test/golden/tan-contract/`
// (tan 0.5.1) carries 17 captured envelopes and none of them is `doctor`, so
// there is nothing in CI to assert a real doctor payload against. The drift
// report runs on the customer's own pinned binary instead, which is the only
// place two of the entries can be settled at all — `longPaths` is Windows-only
// and `lldb` appears only for a native-host debug target, and a darwin
// developer machine can answer neither.

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const Module = require("node:module");

const root = path.join(__dirname, "..");

/** Load the deps adapter with `vscode` and the host modules stubbed. */
function loadAdapter() {
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

const { plainDoctorAllowlistDrift } = loadAdapter();

/** A `doctor` envelope carrying exactly these check names. */
const envelopeWith = (names) => ({
  checks: names.map((name) => ({
    name,
    status: "pass",
    detail: "",
    fix: null,
  })),
  summary: {},
  missingPrerequisites: [],
});

/**
 * The check names plain `tan doctor` 0.5.1 emits with NO project — measured by
 * running the pinned binary in an empty directory, not copied from tan's source.
 * The project run adds `venvProvenance`, `zephyrVersion` and `sdkProvenance`;
 * neither run emits `longPaths` or `lldb` on darwin.
 */
const TAN_0_5_1_NO_PROJECT = [
  "sdk",
  "boardYaml",
  "workspace",
  "westResolved",
  "zephyrWorkspace",
  "zephyrSdkAvailableForHost",
  "homePath",
  "hostPython",
  "pythonFloor",
  "hostPrerequisites",
  "west",
  "zephyrSdk",
  "setools",
  "jlink",
];

test("the renamed check is recognised: `zephyrSdkAvailableForHost` is in the allowlist and does not drift", () => {
  const drift = plainDoctorAllowlistDrift(envelopeWith(TAN_0_5_1_NO_PROJECT));
  assert.ok(
    !drift.includes("zephyrSdkAvailableForHost"),
    "the allowlist does not name the id tan 0.5.1 actually emits — this is " +
      "#472 unfixed, and the Zephyr-SDK-host row goes missing without a word",
  );
});

test("the pre-0.5.x spelling is kept but never reported as drift", () => {
  // `zephyrSdkHost` stays in the allowlist deliberately — an extra entry costs
  // nothing (the merge only admits names the envelope carries), while a missing
  // one drops a row in silence. It must not show up as drift, or the report
  // becomes noise on every single refresh and stops being read.
  const drift = plainDoctorAllowlistDrift(envelopeWith(TAN_0_5_1_NO_PROJECT));
  assert.ok(
    !drift.includes("zephyrSdkHost"),
    "an entry kept on purpose for an older tan was reported as drift",
  );
});

test("an entry the pinned binary does not emit IS reported, rather than vanishing", () => {
  // `longPaths` and `lldb` are deliberately kept in the allowlist: the first is
  // Windows-only, the second appears only for a native-host debug target, and a
  // darwin measurement can settle neither. This is what makes them visible from
  // the machines that CAN.
  const drift = plainDoctorAllowlistDrift(envelopeWith(TAN_0_5_1_NO_PROJECT));
  assert.deepEqual(
    drift.sort(),
    ["lldb", "longPaths"],
    "the drift report must name exactly the entries this envelope lacks — " +
      "silence here is the defect #472 is about",
  );
});

test("a complete envelope drifts on nothing", () => {
  const drift = plainDoctorAllowlistDrift(
    envelopeWith([...TAN_0_5_1_NO_PROJECT, "longPaths", "lldb"]),
  );
  assert.deepEqual(drift, [], `unexpected drift: ${drift.join(", ")}`);
});

test("a failed plain doctor is not reported as drift — a missing run is not a stale allowlist", () => {
  assert.deepEqual(
    plainDoctorAllowlistDrift(null),
    [],
    "a null envelope means `tan doctor` did not answer at all; blaming the " +
      "allowlist for that would send the next reader to the wrong file " +
      "(`mergeDoctorEnvelopes` already pushes a `hostEnvironment` row for it)",
  );
});

test("drift is reported for every stale entry, not just the first", () => {
  const drift = plainDoctorAllowlistDrift(envelopeWith(["homePath"]));
  assert.deepEqual(
    drift.sort(),
    ["hostPrerequisites", "lldb", "longPaths", "zephyrSdkAvailableForHost"],
    "`zephyrSdkHost` is absent from this list because it is deliberately " +
      "legacy, not because drift reporting stops at the first miss",
  );
});
