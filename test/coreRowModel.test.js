// SPDX-License-Identifier: Apache-2.0
//
// What one core's row says (coreRowModel.ts), off the pure function: the
// figures a reader scans, the exact hex one disclosure down, and the status
// word a slice that never built keeps as its own.

const test = require("node:test");
const assert = require("node:assert/strict");

const load = async () =>
  (await import("./webview/esbuildImport.mjs")).importWebviewModule(
    "features/build-plan/coreRowModel.ts",
  );

const size = (overrides) => ({
  core_id: "m55_hp",
  os: "zephyr",
  status: "ok",
  flash: { used: 0x18068, total: 0x2a0000, pct: 3.6 },
  ram: { used: 0x3762, total: 0x100000, pct: 1.4 },
  source: "size-tool",
  ...overrides,
});

test("a built slice prints rounded meters and keeps the exact hex in its details", async () => {
  const { coreRowOf } = await load();
  const row = coreRowOf(
    {
      core_id: "m55_hp",
      os: "zephyr",
      status: "ok",
      toolchain: "arm-zephyr-eabi",
      flash_method: "zephyr_west_flash",
      flash_args: { slot0_load_address: "0x802b0000" },
    },
    size({}),
  );
  assert.equal(row.statusKind, "ok");
  assert.equal(row.subtitle, "zephyr · arm-zephyr-eabi");
  assert.equal(row.problem, null);
  assert.equal(row.flashable, true);
  assert.deepEqual(
    row.meters.map((m) => [m.label, m.usedText, m.totalText, m.pct]),
    [
      ["Flash", "96.1 KiB", "2.63 MiB", 3.6],
      ["RAM", "13.8 KiB", "1 MiB", 1.4],
    ],
  );
  const details = Object.fromEntries(
    row.details.map((d) => [d.label, d.value]),
  );
  assert.equal(details["Flash used (exact)"], "0x18068 of 0x2a0000");
  assert.equal(details["RAM used (exact)"], "0x3762 of 0x100000");
  assert.equal(details.slot0_load_address, "0x802b0000");
  assert.equal(details["Size source"], "size-tool");
});

test("a skipped slice carries the producer's reason verbatim; a pending one keeps only its status word", async () => {
  const { coreRowOf } = await load();
  const skipped = coreRowOf(
    {
      core_id: "a32_cluster",
      os: "yocto",
      status: "skipped",
      reason: "tool `bitbake` not found",
    },
    size({
      core_id: "a32_cluster",
      status: "not-built",
      flash: { used: null, total: null, pct: null },
      ram: { used: null, total: null, pct: null },
    }),
  );
  assert.equal(skipped.statusLabel, "Skipped");
  assert.equal(skipped.statusKind, "warn");
  assert.equal(skipped.problem, "tool `bitbake` not found");
  assert.equal(skipped.meters, null);
  assert.equal(skipped.flashable, false);
  assert.equal(skipped.subtitle, "yocto · not reported");

  const pending = coreRowOf(
    { core_id: "m33_sm", os: "zephyr", status: "pending" },
    undefined,
  );
  assert.equal(pending.problem, null);
  assert.equal(pending.measureNote, null);
  assert.equal(pending.statusLabel, "Pending");
});

test("an off slice never shows a toolchain, a built-but-unmeasured one says so, and a null figure is 'unknown'", async () => {
  const { coreRowOf } = await load();
  const off = coreRowOf(
    {
      core_id: "a32_idle",
      os: "off",
      status: "pending",
      toolchain: "poky-glibc",
    },
    undefined,
  );
  assert.equal(off.subtitle, "off");
  assert.equal(off.statusKind, "off");
  assert.equal(off.problem, null);
  const unmeasured = coreRowOf(
    { core_id: "m55_he", os: "zephyr", status: "ok" },
    undefined,
  );
  assert.equal(unmeasured.measureNote, "Not measured");
  const partial = coreRowOf(
    { core_id: "m55_he", os: "zephyr", status: "ok" },
    size({
      status: "no-budget",
      flash: { used: 1024, total: null, pct: null },
      ram: { used: null, total: null, pct: null },
      budget_note: "no SoM budget",
    }),
  );
  assert.equal(partial.meters[0].usedText, "1 KiB");
  assert.equal(partial.meters[0].totalText, null);
  assert.equal(partial.meters[0].exactText, "0x400");
  assert.equal(partial.meters[1].usedText, "unknown");
  assert.equal(partial.meters[1].exactText, null);
});

test("budget verdicts are said in words", async () => {
  const { coreRowOf } = await load();
  const over = coreRowOf(
    { core_id: "m55_hp", os: "zephyr", status: "ok" },
    size({ status: "over" }),
  );
  assert.equal(over.meters[0].verdict, "over budget");
  const warn = coreRowOf(
    { core_id: "m55_hp", os: "zephyr", status: "ok" },
    size({ status: "warn" }),
  );
  assert.equal(warn.meters[0].verdict, "near budget");
});
