// SPDX-License-Identifier: Apache-2.0
//
// What may legally go into `tan init --cores` (#528).
//
// The New Project flow sent the SoM's ENTIRE declared topology, straight from
// `tan presets`, and every SoM declaring two Zephyr cores then failed at
// `tan init` with exit 2 / `init.invalid-cores` — the whole Alif Ensemble line,
// whose defining topology is dual-M55.
//
// The contract, quoted from `tan init --help` at the pinned 0.6.0-rc1:
//
//   OS is inferred from the id when omitted, but that inference is only
//   honored for the plan's app core -- any other id can only be spliced in
//   app-less, as `:off` or (on a Cortex-A id) `:yocto`, so a bare companion id
//   like `m55_he` infers `:zephyr` and is refused unless `m55_he` is the app
//   core.
//
// So a companion may be `off`, or `yocto` when its id is Cortex-A. Nothing
// else. A `zephyr` core cannot be a companion at all.
//
// WHICH core is the app core is a fact only the SoM knows, and `tan presets`
// does not report it — `soms[].cores[]` is `{id, os}` and nothing more. So this
// planner never names one. It OMITS every zephyr core instead, which is
// explicitly allowed ("Omit the entry or use m55_hp:zephyr") and leaves the
// choice where it belongs. Guessing it here would be a TypeScript re-derivation
// of a fact tan owns — the mistake `planner.ts` already warns about.

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  planInitCores,
} = require("../packages/alp-core/dist/project/initCores.js");

// Verbatim from `tan presets --format json` at alp-sdk v0.16.0-rc1.
const AEN801 = [
  { id: "a32_cluster", os: "yocto" },
  { id: "m55_hp", os: "zephyr" },
  { id: "m55_he", os: "zephyr" },
];
const AEN301 = [
  { id: "m55_hp", os: "zephyr" },
  { id: "m55_he", os: "zephyr" },
];
const V2N101 = [
  { id: "a55_cluster", os: "yocto" },
  { id: "m33_sm", os: "zephyr" },
];

test("a dual-M55 SoM sends only its Cortex-A companion", () => {
  // Arrange / Act -- this exact topology produced exit 2 before the filter.
  const plan = planInitCores(AEN801);

  // Assert
  assert.equal(plan.arg, "a32_cluster:yocto");
  assert.deepEqual(plan.zephyrCores, ["m55_hp", "m55_he"]);
});

test("a SoM with no companion at all sends no --cores flag", () => {
  // Arrange -- E1M-AEN301 is two Zephyr cores and nothing else, so there is
  // nothing tan can be told that it does not already know from --som.
  const plan = planInitCores(AEN301);

  // Assert
  assert.equal(plan.arg, null);
  assert.deepEqual(plan.zephyrCores, ["m55_hp", "m55_he"]);
});

test("a single-Zephyr SoM keeps its yocto companion", () => {
  // Arrange -- the five SoMs that worked before worked for this reason.
  const plan = planInitCores(V2N101);

  // Assert
  assert.equal(plan.arg, "a55_cluster:yocto");
  assert.deepEqual(plan.zephyrCores, ["m33_sm"]);
});

test("yocto on a NON-Cortex-A id is downgraded to off", () => {
  // Arrange -- tan honors `:yocto` for a companion "only when ... its id starts
  // with 'a'". Sending it anywhere else is the same refusal in a new costume.
  const plan = planInitCores([
    { id: "m55_hp", os: "zephyr" },
    { id: "dsp0", os: "yocto" },
  ]);

  // Assert
  assert.equal(plan.arg, "dsp0:off");
});

test("baremetal is off — a companion may only be off or Cortex-A yocto", () => {
  // Arrange -- `baremetal` is a real `osChoices` value, and it is not one of
  // the two a companion can honor app-less.
  const plan = planInitCores([
    { id: "m55_hp", os: "zephyr" },
    { id: "m4", os: "baremetal" },
  ]);

  // Assert
  assert.equal(plan.arg, "m4:off");
});

test("an os value this extension has never seen is off, not passed through", () => {
  // Arrange -- the allowlist runs in the SAFE direction here, and that is the
  // opposite of the planner's pass-tan's-word-through rule on purpose: an
  // unknown value forwarded to `--cores` is a refusal at best and a silently
  // wrong plan at worst, while `off` always scaffolds.
  const plan = planInitCores([
    { id: "m55_hp", os: "zephyr" },
    { id: "npu0", os: "rtos-of-the-future" },
  ]);

  // Assert
  assert.equal(plan.arg, "npu0:off");
});

test("companion order follows the SoM's declared order", () => {
  const plan = planInitCores([
    { id: "a55_cluster", os: "yocto" },
    { id: "m33", os: "zephyr" },
    { id: "m4", os: "baremetal" },
  ]);

  assert.equal(plan.arg, "a55_cluster:yocto,m4:off");
});

test("no cores at all is no flag", () => {
  assert.deepEqual(planInitCores([]), { arg: null, zephyrCores: [] });
});

test("a Cortex-A core declaring zephyr is still omitted, not kept as yocto", () => {
  // Arrange -- the Cortex-A exception is about the os VALUE `yocto`, not about
  // the core being Cortex-A. Rewriting a declared `zephyr` into `yocto` would
  // change what the customer asked for.
  const plan = planInitCores([
    { id: "a55_cluster", os: "zephyr" },
    { id: "m33", os: "zephyr" },
  ]);

  assert.equal(plan.arg, null);
  assert.deepEqual(plan.zephyrCores, ["a55_cluster", "m33"]);
});
