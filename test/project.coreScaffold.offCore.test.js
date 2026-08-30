// SPDX-License-Identifier: Apache-2.0
//
// What must happen to the rest of board.yaml when a core is switched off (#582).
//
// Turning a core off is not a one-field edit. tan writes an `ipc:` stanza of
// its own whenever `--cores` names a Cortex-A companion, and `alp_project`
// refuses an entry whose endpoint is disabled. Measured on the pinned tan
// 0.6.0, answering the Cortex-A companion `yocto` (so tan writes the
// channel) and the app core `off`:
//
//   ok: false  exit: 2
//   validate.schema-violation | consistency: ipc entry 'alp_default_rpmsg' references core 'm55_hp' which is os: off
//
// That is a project the customer cannot build, produced by an answer the wizard
// offers. Dropping the core without dropping its channels is not a smaller fix,
// it is a different failure.
//
// The other half is what is LEFT BEHIND. tan puts the template's real source in
// the app core's directory (`app: .` for `minimal-app`, measured), so taking the
// application away from that core orphans a tree nothing builds. Reported, not
// deleted: the customer may mean it, and removing a freshly scaffolded source
// tree on their behalf is not a repair.

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  applyCoreAssignments,
  orphanedAppDirs,
} = require("../packages/alp-core/dist/project/coreScaffold.js");

/** A board exactly as `tan init --cores a32_cluster:yocto` writes one for
 *  E1M-AEN801, ipc stanza and all. */
function scaffolded() {
  return {
    som: { sku: "E1M-AEN801" },
    cores: {
      m55_hp: { os: "zephyr", app: "." },
      a32_cluster: { os: "yocto", image: "alp-image-edge" },
    },
    ipc: [
      {
        kind: "rpmsg",
        name: "alp_default_rpmsg",
        endpoints: ["m55_hp", "a32_cluster"],
        carve_out_kb: 512,
      },
    ],
  };
}

// ── the ipc stanza ──────────────────────────────────────────────────────────

test("an ipc entry whose endpoint this call switched off is dropped with it", () => {
  // The measured-fatal case: the companion stays `yocto`, so tan wrote the
  // channel, and the app core is answered `off`.
  const next = applyCoreAssignments(scaffolded(), [
    { id: "a32_cluster", os: "yocto" },
    { id: "m55_hp", os: "off" },
  ]);

  assert.equal(next.cores.m55_hp.os, "off");
  assert.deepEqual(
    next.ipc,
    [],
    "leaving the entry behind is `consistency: ipc entry ... references core " +
      "'m55_hp' which is os: off`, exit 2 — a project that cannot be built",
  );
});

test("a channel between cores that stay enabled is untouched", () => {
  // The control. A prune that dropped every entry would satisfy the assertion
  // above and silently delete a working channel.
  const next = applyCoreAssignments(scaffolded(), [
    { id: "m55_hp", os: "zephyr", app: "./src" },
  ]);

  assert.equal(next.ipc.length, 1);
  assert.equal(next.ipc[0].name, "alp_default_rpmsg");
  assert.deepEqual(next.ipc[0].endpoints, ["m55_hp", "a32_cluster"]);
});

test("only the entries naming a just-disabled core go", () => {
  const board = scaffolded();
  board.cores.m55_he = { os: "zephyr", app: "./peer" };
  board.ipc.push({
    kind: "raw_shmem",
    name: "alp_shmem0",
    endpoints: ["m55_hp", "m55_he"],
    carve_out_kb: 4,
  });

  const next = applyCoreAssignments(board, [{ id: "a32_cluster", os: "off" }]);

  assert.deepEqual(
    next.ipc.map((entry) => entry.name),
    ["alp_shmem0"],
    "the M-to-M channel does not involve the A-core and must survive",
  );
});

test("a board with no ipc key never gains one", () => {
  const board = {
    som: { sku: "E1M-AEN801" },
    cores: { m55_hp: { os: "zephyr", app: "./src" } },
  };
  const next = applyCoreAssignments(board, [{ id: "m55_hp", os: "off" }]);

  assert.equal("ipc" in next, false);
});

test("an entry that was ALREADY fatal is left alone, not silently repaired", () => {
  // Keyed on what THIS call disabled, never on the final state.
  //
  // A board that arrived with a disabled endpoint is broken by something this
  // call did not do, and deleting the entry would be the only record of it —
  // the customer's way out may well be turning the core back ON. `tan validate`
  // names the entry; this function must not make it disappear first.
  //
  // Today there is exactly ONE production caller (the New Project wizard's
  // second pass), and tan never hands it a board in this state, so the two
  // keyings agree in practice. The contract is written for the next caller.
  const board = scaffolded();
  board.cores.a32_cluster = { os: "off" };

  const next = applyCoreAssignments(board, [
    { id: "m55_hp", os: "zephyr", app: "./src" },
  ]);

  assert.equal(
    next.ipc.length,
    1,
    "not this call's doing, not this call's fix",
  );
});

test("re-asserting an already-off core does not trigger a prune", () => {
  // `os: off` written over `os: off` changed nothing, so nothing may be
  // removed on account of it.
  const board = scaffolded();
  board.cores.a32_cluster = { os: "off" };

  const next = applyCoreAssignments(board, [{ id: "a32_cluster", os: "off" }]);

  assert.equal(next.ipc.length, 1);
});

// ── the orphaned source tree ────────────────────────────────────────────────

test("taking the application away from tan's app core is reported", () => {
  // `app: .` is what `minimal-app` scaffolds — the project root, holding the
  // template's real source.
  assert.deepEqual(
    orphanedAppDirs(scaffolded(), [
      { id: "a32_cluster", os: "yocto" },
      { id: "m55_hp", os: "off" },
    ]),
    [{ id: "m55_hp", app: ".", os: "off" }],
  );
});

test("bare-metal orphans the directory just as off does", () => {
  // `baremetal` takes no `app:` either — the SDK's bare-metal shape is
  // `cmake-args`, not a Zephyr application — so the source is equally stranded.
  assert.deepEqual(
    orphanedAppDirs(scaffolded(), [{ id: "m55_hp", os: "baremetal" }]),
    [{ id: "m55_hp", app: ".", os: "baremetal" }],
  );
});

test("a core that keeps running Zephyr orphans nothing", () => {
  assert.deepEqual(
    orphanedAppDirs(scaffolded(), [
      { id: "m55_hp", os: "zephyr", app: "./src" },
      { id: "a32_cluster", os: "yocto" },
    ]),
    [],
    "the A-core never had an `app:` to orphan, and m55_hp still has one",
  );
});

test("an os this build cannot write is not reported as an orphan either", () => {
  // The two functions have to agree about the SAME assignment.
  // `applyCoreAssignments` DROPS an unrecognised os (`narrowCoreOs` returns
  // null, the loop continues) and leaves tan's entry exactly as it was — so the
  // core is still running its application. `orphanedAppDirs` asked only
  // `takesApp(os)`, which is false for any string it does not know, and
  // therefore told the customer to delete a directory their core still builds.
  //
  // `unknownCoreOs` is what reports this case, and it says the core was left
  // out — the opposite advice. Only one of the two can be right.
  const board = scaffolded();

  assert.deepEqual(
    orphanedAppDirs(board, [{ id: "m55_hp", os: "hypervisor" }]),
    [],
    "an assignment applyCoreAssignments will not write cannot orphan anything",
  );
  // And the board really is untouched, which is what makes the report wrong.
  const next = applyCoreAssignments(board, [
    { id: "m55_hp", os: "hypervisor" },
  ]);
  assert.equal(next.cores.m55_hp.os, "zephyr");
  assert.equal(next.cores.m55_hp.app, ".");
});
