// SPDX-License-Identifier: Apache-2.0
//
// The customer's core answers must reach `tan init` — without pushing their
// answer into a refusal (#582).
//
// The wizard's Cores step asks, per core, for a runtime: `zephyr`, `yocto`,
// `baremetal`, or `off` ("Off (skip core)"). Those answers were collected and
// then IGNORED when the argv was built: `planInitArgv` was handed the SoM's
// declared topology from `tan presets` instead. A core the customer switched
// off still reached `--cores` as an enabled runtime, tan spliced it into
// `board.yaml`, and for a Cortex-A companion tan also wrote a whole `ipc:`
// stanza linking it to a core nobody had asked for.
//
// THE OBVIOUS FIX IS WORSE THAN THE DEFECT, and it was measured rather than
// argued. Feeding the answers straight through, over every combination of four
// answers for every core of all eleven SoMs, driving the pinned tan 0.6.0-rc1:
//
//   sending the declared topology (what shipped):  0 of 368 refused
//   sending the answers verbatim:                276 of 368 refused, exit 2 /
//                                                `init.invalid-cores`
//
// One rule accounts for every one of the 276: `--cores` may not name the core
// tan resolves as the plan's APP CORE as `:off`, and an answer of `baremetal`,
// `yocto` or `off` on that core collapses to exactly that. It is 3/4 of the
// matrix on every SoM. Turning the Cortex-A companion off — the actual
// complaint in #582 — was never refused at all.
//
// So the split: `--cores` carries only what it can express, and everything else
// is deferred to the second pass, which edits tan's own board.yaml and has no
// such limits. The invariant that keeps the refusal count at zero is
// MONOTONE-DOWN:
//
//   the emitted --cores value is the DECLARED-topology value with zero or more
//   entries turned down to `:off`, and never anything else.
//
// It holds because `:off` is legal on any non-app core, and a declared-zephyr
// core is never emitted at all — so no answer can ever name the app core.
// Tested as a property below, over the real catalog, without naming an app
// core: which one it is remains tan's to know (`tan presets` reports
// `soms[].cores[]` as `{id, os}` and nothing else).

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  planInitCores,
} = require("../packages/alp-core/dist/project/initCores.js");

/** Every SoM, verbatim from `tan presets --format json` at alp-sdk v0.16.0-rc1
 *  resolved against the vendored `alp-sdk-upstream`. */
const CATALOG = {
  "E1M-AEN301": [
    { id: "m55_hp", os: "zephyr" },
    { id: "m55_he", os: "zephyr" },
  ],
  "E1M-AEN401": [
    { id: "m55_hp", os: "zephyr" },
    { id: "m55_he", os: "zephyr" },
  ],
  "E1M-AEN501": [
    { id: "a32_cluster", os: "yocto" },
    { id: "m55_hp", os: "zephyr" },
    { id: "m55_he", os: "zephyr" },
  ],
  "E1M-AEN601": [
    { id: "a32_cluster", os: "yocto" },
    { id: "m55_hp", os: "zephyr" },
    { id: "m55_he", os: "zephyr" },
  ],
  "E1M-AEN701": [
    { id: "a32_cluster", os: "yocto" },
    { id: "m55_hp", os: "zephyr" },
    { id: "m55_he", os: "zephyr" },
  ],
  "E1M-AEN801": [
    { id: "a32_cluster", os: "yocto" },
    { id: "m55_hp", os: "zephyr" },
    { id: "m55_he", os: "zephyr" },
  ],
  "E1M-NX9101": [
    { id: "a55_cluster", os: "yocto" },
    { id: "m33", os: "zephyr" },
  ],
  "E1M-V2M101": [
    { id: "a55_cluster", os: "yocto" },
    { id: "m33_sm", os: "zephyr" },
  ],
  "E1M-V2M102": [
    { id: "a55_cluster", os: "yocto" },
    { id: "m33_sm", os: "zephyr" },
  ],
  "E1M-V2N101": [
    { id: "a55_cluster", os: "yocto" },
    { id: "m33_sm", os: "zephyr" },
  ],
  "E1M-V2N102": [
    { id: "a55_cluster", os: "yocto" },
    { id: "m33_sm", os: "zephyr" },
  ],
};

/** The four answers the Cores step can produce. `off` is the wizard's own
 *  addition: `tan presets` reports `osChoices` as
 *  `["zephyr", "yocto", "baremetal"]` and has no word for a disabled core. */
const ANSWERS = ["zephyr", "yocto", "baremetal", "off"];

/** Every combination of answers for one topology. */
function* answerMatrix(topology) {
  const total = ANSWERS.length ** topology.length;
  for (let n = 0; n < total; n += 1) {
    let rest = n;
    yield topology.map((core) => {
      const os = ANSWERS[rest % ANSWERS.length];
      rest = Math.floor(rest / ANSWERS.length);
      return { id: core.id, os };
    });
  }
}

/** `--cores` entries, parsed back into `{id, os}`. */
function entriesOf(arg) {
  if (!arg) return [];
  return arg.split(",").map((entry) => {
    const [id, os] = entry.split(":");
    return { id, os };
  });
}

// ── the invariant ───────────────────────────────────────────────────────────

test("no answer can put a declared-zephyr core into --cores", () => {
  // The load-bearing half. tan resolves its app core out of the declared-zephyr
  // population, so an entry naming one of them is the single thing that
  // produced all 276 refusals.
  let checked = 0;
  for (const [sku, topology] of Object.entries(CATALOG)) {
    const zephyr = new Set(
      topology.filter((c) => c.os === "zephyr").map((c) => c.id),
    );
    for (const answers of answerMatrix(topology)) {
      const named = entriesOf(planInitCores(topology, answers).arg).map(
        (e) => e.id,
      );
      for (const id of named) {
        assert.equal(
          zephyr.has(id),
          false,
          `${sku}: --cores named the declared-zephyr core ${id} for answers ` +
            `${JSON.stringify(answers)} — tan refuses this with exit 2 / ` +
            "init.invalid-cores whenever that core is the plan's app core",
        );
      }
      checked += 1;
    }
  }
  // Anti-vacuity: a planner that returned `arg: null` for everything would
  // satisfy the loop above without ever being tested.
  assert.equal(checked, 368, "the whole measured matrix must be exercised");
});

test("every emitted entry is the topology's, turned down or unchanged", () => {
  // MONOTONE-DOWN, under the order `off < yocto`. This is what holds the
  // refusal count at the measured 0 of 368: the argv can only ever be the
  // topology argv with entries lowered, and `:off` is legal on any non-app
  // core.
  const RANK = { off: 0, yocto: 1 };
  let lowered = 0;
  for (const [sku, topology] of Object.entries(CATALOG)) {
    const baselineArg = planInitCores(topology).arg;
    const baseline = new Map(entriesOf(baselineArg).map((e) => [e.id, e.os]));
    for (const answers of answerMatrix(topology)) {
      const arg = planInitCores(topology, answers).arg;
      if (arg !== baselineArg) lowered += 1;
      for (const entry of entriesOf(arg)) {
        const was = baseline.get(entry.id);
        assert.ok(
          was !== undefined,
          `${sku}: --cores named ${entry.id}, which the topology argv never ` +
            "names — the value is no longer derived from the topology",
        );
        assert.ok(
          RANK[entry.os] <= RANK[was],
          `${sku}: ${entry.id} went ${was} -> ${entry.os}, which is UP. Only ` +
            "turning an entry down is known to be accepted for every core",
        );
      }
    }
  }
  // ANTI-VACUITY, and it is not decoration: a planner that IGNORES its second
  // argument satisfies every assertion above, because the topology argv is
  // trivially monotone-down against itself. That is precisely the planner this
  // file exists to reject, and the first draft of this test passed on it.
  //
  // 252 is arithmetic, not a recorded output. The argv changes exactly when a
  // companion is answered something other than what it declares, so per SoM it
  // is (answers other than the declared one) / (all answers) x (all
  // combinations): 3/4 x 64 = 48 on each of the four three-core SoMs, 3/4 x 16
  // = 12 on each of the five with an `a*` companion, and 0 on E1M-AEN301 and
  // E1M-AEN401, which declare no companion at all. 4x48 + 5x12 + 2x0 = 252.
  assert.equal(
    lowered,
    252,
    "the answers must actually reach the argv — a planner that ignores them " +
      "passes every other assertion in this test",
  );
});

test("no answers at all reproduces the shipped topology argv exactly", () => {
  // The fallback an older webview, or the example flow, still takes. It must
  // not drift from the value measured at 0 of 368 refused.
  for (const [sku, topology] of Object.entries(CATALOG)) {
    assert.equal(
      planInitCores(topology, []).arg,
      planInitCores(topology).arg,
      `${sku}: an empty answer list must mean "no answers", not "all off"`,
    );
  }
});

// ── the answers that DO reach --cores ───────────────────────────────────────

test("turning the Cortex-A companion off is honoured, and is #582's own case", () => {
  const plan = planInitCores(CATALOG["E1M-AEN801"], [
    { id: "a32_cluster", os: "off" },
    { id: "m55_hp", os: "zephyr" },
    { id: "m55_he", os: "zephyr" },
  ]);

  assert.equal(plan.arg, "a32_cluster:off");
  // Measured: this exact argv is accepted, and tan then writes NO `ipc:`
  // stanza — which is the whole point. The stanza only appears when `--cores`
  // names the A-core as `:yocto`.
  assert.deepEqual(plan.deferred, []);
});

test("keeping the Cortex-A companion still sends yocto", () => {
  const plan = planInitCores(CATALOG["E1M-AEN801"], [
    { id: "a32_cluster", os: "yocto" },
    { id: "m55_hp", os: "zephyr" },
    { id: "m55_he", os: "zephyr" },
  ]);

  assert.equal(plan.arg, "a32_cluster:yocto");
});

// ── the answers that CANNOT reach --cores, and are reported ─────────────────

test("an off answer on a declared-zephyr core is deferred, not sent", () => {
  const plan = planInitCores(CATALOG["E1M-AEN801"], [
    { id: "a32_cluster", os: "yocto" },
    { id: "m55_hp", os: "zephyr" },
    { id: "m55_he", os: "off" },
  ]);

  assert.equal(plan.arg, "a32_cluster:yocto");
  assert.deepEqual(plan.deferred, [{ id: "m55_he", requested: "off" }]);
});

test("a baremetal answer is deferred whichever core it lands on", () => {
  // `--cores` has no spelling for bare-metal at all: a companion is `:off` or
  // (on a Cortex-A id) `:yocto`, full stop. Sending `:off` and saying nothing
  // is the silent downgrade #582 is about, one layer down.
  const onZephyr = planInitCores(CATALOG["E1M-AEN801"], [
    { id: "a32_cluster", os: "yocto" },
    { id: "m55_hp", os: "baremetal" },
    { id: "m55_he", os: "zephyr" },
  ]);
  assert.deepEqual(onZephyr.deferred, [
    { id: "m55_hp", requested: "baremetal" },
  ]);

  const onCompanion = planInitCores(CATALOG["E1M-AEN801"], [
    { id: "a32_cluster", os: "baremetal" },
    { id: "m55_hp", os: "zephyr" },
    { id: "m55_he", os: "zephyr" },
  ]);
  assert.equal(onCompanion.arg, "a32_cluster:off");
  assert.deepEqual(onCompanion.deferred, [
    { id: "a32_cluster", requested: "baremetal" },
  ]);
});

test("a yocto answer on a non-Cortex-A id is deferred", () => {
  // tan honours `:yocto` "only when ... its id starts with 'a'" — its own
  // words, from the `init.invalid-cores` message.
  const plan = planInitCores(
    [
      { id: "m55_hp", os: "zephyr" },
      { id: "dsp0", os: "baremetal" },
    ],
    [
      { id: "m55_hp", os: "zephyr" },
      { id: "dsp0", os: "yocto" },
    ],
  );

  assert.equal(plan.arg, "dsp0:off");
  assert.deepEqual(plan.deferred, [{ id: "dsp0", requested: "yocto" }]);
});

test("an answer naming a core the SoM does not have is dropped and reported", () => {
  // Boundary validation: the assignments arrive in a webview message, and the
  // declared topology is the authority on which cores exist. Writing a core
  // the part does not have would be a board.yaml no SoM can build.
  const plan = planInitCores(CATALOG["E1M-AEN301"], [
    { id: "m55_hp", os: "zephyr" },
    { id: "a32_cluster", os: "yocto" },
  ]);

  assert.equal(plan.arg, null);
  assert.deepEqual(plan.unknown, ["a32_cluster"]);
});

test("an os this build has never seen is turned down, and reported", () => {
  // The SAFE direction, deliberately opposite to the rule the dependency
  // planner follows: this value is an ARGUMENT going back to tan, not a fact
  // being displayed. Forwarded blindly it is a refusal at best and a wrong
  // plan at worst.
  const plan = planInitCores(CATALOG["E1M-AEN801"], [
    { id: "a32_cluster", os: "hypervisor" },
    { id: "m55_hp", os: "zephyr" },
    { id: "m55_he", os: "zephyr" },
  ]);

  assert.equal(plan.arg, "a32_cluster:off");
  assert.deepEqual(plan.deferred, [
    { id: "a32_cluster", requested: "hypervisor" },
  ]);
});
