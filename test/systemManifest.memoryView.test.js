// SPDX-License-Identifier: Apache-2.0
//
// What the manifest pins in the address space, what it must refuse to pin, and
// where two pinned things land on top of each other (#484).
//
// THE FIXTURE THAT MATTERS is `test/fixtures/system-manifest.rpmsg-v2n.snap.yaml`
// — the SDK's OWN emitted golden snapshot, vendored byte-for-byte, parsed here
// through the same `parseSystemManifest` the panel uses. It exists because a
// hand-written fixture agreed with a broken narrower: the first revision of
// this module read the resolver's dataclass field names (`base`, `size`,
// `region`, `base_kib`) instead of the keys the emitter actually writes
// (`carve_out_base`, `carve_out_size`, `carve_out_region`, `offset_kib`), so
// every RESOLVED carve-out and partition was reported as unresolved — the exact
// inversion, on the one screen whose job is to say where things landed. Twelve
// hand-written tests were green throughout. Keep a real emitted file in this
// suite.
//
// The drop cases are the other half. Every one of them is a value that a cast
// would let through as an address, and a wrong address is the thing this whole
// feature exists to prevent.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const {
  buildMemoryView,
} = require("../packages/alp-core/dist/systemManifest/memoryView.js");
const {
  parseSystemManifest,
} = require("../packages/alp-core/dist/systemManifest/service.js");

/** Verbatim from an emitted manifest — both channels carry this same text. */
const TBD_REASON =
  "memory_map.base is TBD for region 'mram_main' in SoM E1M-AEN801; this SoM " +
  "hasn't been HW-mapped yet so IPC carve-outs cannot be allocated.  Add a " +
  "`memory_map:` block to metadata/e1m_modules/E1M-AEN801.yaml (or per-region " +
  "`base`) or remove the matching ipc entry from board.yaml.";

const NO_DEVICE_REASON =
  "storage entry 'data' has no flash_device: declared; add one referencing a " +
  "SoM memory_map region or an on_module.ospi_memories key";

/**
 * The emitted manifest for examples/alp-sample (E1M-AEN801, alp-sdk
 * v0.16.0-rc1), trimmed to the blocks this module reads. A blocked entry
 * carries `status` + `reason` and NOTHING else — that is what the emitter
 * writes, and it is why absence of `status` has to mean resolved.
 */
function blockedSample() {
  return {
    schema_version: 1,
    generated_by: "scripts/alp_orchestrate.py",
    hw_info: { sku: "E1M-AEN801", silicon: "alif:ensemble:e8" },
    slices: [
      {
        core_id: "a32_cluster",
        os: "yocto",
        status: "pending",
        flash_args: { target: "e1m-aen801-a32" },
      },
      {
        core_id: "m55_hp",
        os: "zephyr",
        status: "pending",
        flash_args: {
          jlink_flash_device: "AE822FA0E5597LS0_M55_HE",
          expect_dpidr: "0x4C013477",
          slot0_load_address: "0x802b0000",
        },
      },
      {
        core_id: "m55_he",
        os: "zephyr",
        status: "pending",
        flash_args: { slot0_load_address: "0x80010000" },
      },
    ],
    ipc: [
      {
        name: "alp_default_rpmsg",
        kind: "rpmsg",
        endpoints: ["m55_hp", "a32_cluster"],
        status: "blocked",
        reason: TBD_REASON,
      },
      {
        name: "alp_rpmsg",
        kind: "rpmsg",
        endpoints: ["m55_hp", "m55_he"],
        status: "blocked",
        reason: TBD_REASON,
      },
    ],
    helper_mcus: [],
    boot_order: [],
    storage: [
      {
        name: "data",
        fs: "raw",
        flash_device: "",
        status: "blocked",
        reason: NO_DEVICE_REASON,
      },
    ],
  };
}

/** A resolved partition, exactly as the emitter writes one (measured). */
const RESOLVED_PARTITION = Object.freeze({
  name: "data",
  fs: "littlefs",
  flash_device: "storage",
  dt_label: "storage",
  offset_kib: 0,
  size_kib: 64,
  mount: "/lfs",
});

/** A resolved carve-out, exactly as the emitter writes one (measured). */
const RESOLVED_CARVE_OUT = Object.freeze({
  name: "alp_rpmsg",
  kind: "rpmsg",
  endpoints: ["m55_hp", "m55_he"],
  carve_out_base: "0x80540000",
  carve_out_size: "0x00040000",
  carve_out_region: "mram_main",
  cacheable: false,
  rpmsg_endpoint_ids: { src: "0x000004e6", dst: "0x000004e7" },
  mailbox_channel: 0,
});

test("places the resolved carve-out in the SDK's own emitted manifest", () => {
  // Arrange — the vendored golden snapshot, through the real parser.
  const text = fs.readFileSync(
    path.join(__dirname, "fixtures", "system-manifest.rpmsg-v2n.snap.yaml"),
    "utf8",
  );

  // Act
  const view = buildMemoryView(parseSystemManifest(text));

  // Assert
  const carve = view.spans.find((s) => s.kind === "carve_out");
  assert.ok(
    carve,
    "the emitted carve-out must be placed, not reported missing",
  );
  assert.deepEqual(
    {
      label: carve.label,
      base: carve.base,
      end: carve.base + carve.sizeBytes,
      region: carve.region,
      cores: carve.cores,
    },
    {
      label: "alp_default_rpmsg",
      base: 0x00010000,
      end: 0x00090000,
      region: "ocram_low",
      cores: ["a55_cluster", "m33_sm"],
    },
  );
  assert.deepEqual(view.unresolved, [], "nothing in this manifest is blocked");
  assert.deepEqual(
    view.apertures.map((a) => [a.kind, a.name, a.members]),
    [["region", "ocram_low", ["alp_default_rpmsg"]]],
  );
});

test("an entry with no status key is resolved, because that is what absence means", () => {
  const manifest = blockedSample();
  manifest.ipc = [RESOLVED_CARVE_OUT];
  manifest.storage = [RESOLVED_PARTITION];

  const view = buildMemoryView(manifest);

  assert.deepEqual(view.unresolved, []);
  assert.deepEqual(
    view.spans.map((s) => s.label),
    ["m55_he", "m55_hp", "alp_rpmsg", "data"],
    "ordered by address, the device-relative partition last",
  );
});

test("pins the load address of every active Zephyr slice", () => {
  const view = buildMemoryView(blockedSample());

  assert.equal(view.sku, "E1M-AEN801");
  const slots = view.spans.filter((s) => s.kind === "slot_image");
  assert.deepEqual(
    slots.map((s) => [s.label, s.base]),
    [
      ["m55_he", 0x80010000],
      ["m55_hp", 0x802b0000],
    ],
  );
  // The slot's capacity is a SoM budget the manifest does not carry; reporting
  // it as 0 would read as "no room left".
  assert.equal(slots[0].sizeBytes, null);
});

test("reports every blocked entry with its reason verbatim", () => {
  const view = buildMemoryView(blockedSample());

  assert.equal(view.spans.filter((s) => s.kind !== "slot_image").length, 0);
  assert.deepEqual(
    view.unresolved.map((u) => [u.kind, u.label, u.status]),
    [
      ["carve_out", "alp_default_rpmsg", "blocked"],
      ["carve_out", "alp_rpmsg", "blocked"],
      ["partition", "data", "blocked"],
    ],
    "carve-outs then partitions, in manifest order",
  );
  assert.equal(view.unresolved[0].reason, TBD_REASON);
  assert.equal(view.unresolved[2].reason, NO_DEVICE_REASON);
  assert.deepEqual(view.unresolved[1].cores, ["m55_hp", "m55_he"]);
});

test("keeps a resolved partition device-relative, never absolute", () => {
  const manifest = blockedSample();
  manifest.storage = [RESOLVED_PARTITION];

  const part = buildMemoryView(manifest).spans.find(
    (s) => s.kind === "partition",
  );

  assert.deepEqual(
    {
      base: part.base,
      deviceOffset: part.deviceOffset,
      sizeBytes: part.sizeBytes,
      device: part.device,
      fs: part.fs,
    },
    {
      base: null,
      deviceOffset: 0,
      sizeBytes: 65536,
      device: "storage",
      fs: "littlefs",
    },
    "the device's own base is in the region table this contract lacks",
  );
});

test("survives a manifest caught mid-write", () => {
  // A YAML list rendered at a `- ` boundary yields null members; the parser's
  // whole-array cast admits them. A throw here would leave the panel showing
  // the PREVIOUS build's manifest as current.
  const view = buildMemoryView({
    schema_version: 1,
    generated_by: "",
    hw_info: { sku: "E1M-AEN801" },
    slices: [null, "m55_hp", 7, [], { os: "zephyr" }],
    ipc: [null, [], "alp_rpmsg"],
    helper_mcus: [],
    boot_order: [],
    storage: [null, 42],
  });

  assert.deepEqual(view, {
    sku: "E1M-AEN801",
    spans: [],
    unresolved: [],
    apertures: [],
    conflicts: [],
  });
});

test("drops a load address on a core that builds nothing", () => {
  const manifest = blockedSample();
  manifest.slices.push({
    core_id: "m55_spare",
    os: "off",
    status: "skipped",
    flash_args: { slot0_load_address: "0x80500000" },
  });

  const view = buildMemoryView(manifest);

  assert.equal(
    view.spans.some((s) => s.label === "m55_spare"),
    false,
    "an os:off core loads no image, so its address points at nothing",
  );
});

test("refuses an address that is not written as one", () => {
  const manifest = blockedSample();
  // A bare decimal in a field of hex is likelier a mistake than a base-10
  // address, and 0x802b0000 read as decimal is a different part of memory.
  manifest.slices[1].flash_args.slot0_load_address = "2149253120";
  manifest.slices[2].flash_args.slot0_load_address = { addr: "0x80010000" };

  const view = buildMemoryView(manifest);

  assert.equal(view.spans.filter((s) => s.kind === "slot_image").length, 0);
});

test("refuses an address too large to survive a JS number", () => {
  const manifest = blockedSample();
  manifest.slices[1].flash_args.slot0_load_address = "0xFFFFFFFFFFFFFFFF";

  const view = buildMemoryView(manifest);

  assert.equal(
    view.spans.some((s) => s.label === "m55_hp"),
    false,
    "a base that cannot round-trip is worse than an absent one",
  );
});

test("keeps a degraded link off the map even when it carries an extent", () => {
  const manifest = blockedSample();
  manifest.ipc = [
    {
      ...RESOLVED_CARVE_OUT,
      status: "degraded",
      reason: "peer slice skipped",
    },
  ];

  const view = buildMemoryView(manifest);

  assert.equal(
    view.spans.some((s) => s.kind === "carve_out"),
    false,
  );
  assert.deepEqual(
    view.unresolved.map((u) => [u.label, u.status, u.reason]),
    [
      ["alp_rpmsg", "degraded", "peer slice skipped"],
      ["data", "blocked", NO_DEVICE_REASON],
    ],
    "any non-ok status counts, not just `blocked`",
  );
});

test("drops storage rows that are not partitions at all", () => {
  const manifest = blockedSample();
  manifest.storage = ["data", null, 42, [], {}, { fs: "raw" }];

  const view = buildMemoryView(manifest);

  assert.deepEqual(
    view.spans.filter((s) => s.kind === "partition"),
    [],
  );
  assert.deepEqual(
    view.unresolved.filter((u) => u.kind === "partition"),
    [],
    "a row with no name cannot be shown or acted on, so it is dropped whole",
  );
});

// ---------------------------------------------------------------------------
// Conflicts — the one thing this view says that the manifest does not
// ---------------------------------------------------------------------------

test("reports a carve-out that covers a slice's load address", () => {
  const manifest = blockedSample();
  // A pinned `ipc[].address:` placed on top of the HP image slot. The
  // allocator's own overlap check compares carve-outs against carve-outs, so
  // nothing upstream looks at this pair.
  manifest.ipc = [
    {
      ...RESOLVED_CARVE_OUT,
      name: "alp_shmem0",
      carve_out_base: "0x802b0000",
      carve_out_size: "0x00001000",
    },
  ];

  const view = buildMemoryView(manifest);

  assert.deepEqual(
    view.conflicts.map((c) => [c.kind, c.first, c.second, c.from, c.to]),
    [["covers_load_address", "alp_shmem0", "m55_hp", 0x802b0000, 0x802b0000]],
  );
});

test("reports two carve-outs that share addresses, and ignores adjacency", () => {
  const manifest = blockedSample();
  manifest.slices = [];
  manifest.ipc = [
    {
      ...RESOLVED_CARVE_OUT,
      name: "a",
      carve_out_base: "0x80540000",
      carve_out_size: "0x00010000",
    },
    // Starts exactly where `a` ends — the normal adjacency of a partition
    // table, not a conflict.
    {
      ...RESOLVED_CARVE_OUT,
      name: "b",
      carve_out_base: "0x80550000",
      carve_out_size: "0x00010000",
    },
    {
      ...RESOLVED_CARVE_OUT,
      name: "c",
      carve_out_base: "0x80558000",
      carve_out_size: "0x00010000",
    },
  ];

  const view = buildMemoryView(manifest);

  assert.deepEqual(
    view.conflicts.map((c) => [c.kind, c.first, c.second, c.from, c.to]),
    [["overlap", "b", "c", 0x80558000, 0x80560000]],
  );
});

test("compares partitions only against siblings in the same device", () => {
  const manifest = blockedSample();
  manifest.slices = [];
  manifest.ipc = [];
  manifest.storage = [
    {
      ...RESOLVED_PARTITION,
      name: "logs",
      flash_device: "storage",
      offset_kib: 0,
      size_kib: 64,
    },
    {
      ...RESOLVED_PARTITION,
      name: "data",
      flash_device: "storage",
      offset_kib: 32,
      size_kib: 64,
    },
    // Same offsets, different device: a different address space entirely.
    {
      ...RESOLVED_PARTITION,
      name: "cache",
      flash_device: "ospi0",
      offset_kib: 0,
      size_kib: 64,
    },
  ];

  const view = buildMemoryView(manifest);

  assert.deepEqual(
    view.conflicts.map((c) => [
      c.kind,
      c.first,
      c.second,
      c.device,
      c.from,
      c.to,
    ]),
    // Map order, and device-relative extents sort by label: `data` before
    // `logs`.
    [["device_overlap", "data", "logs", "storage", 32768, 65536]],
  );
});

test("names each aperture with what landed in it, never with its own extent", () => {
  const manifest = blockedSample();
  manifest.ipc = [RESOLVED_CARVE_OUT];
  manifest.storage = [RESOLVED_PARTITION];

  const view = buildMemoryView(manifest);

  assert.deepEqual(
    view.apertures.map((a) => [
      a.kind,
      a.name,
      a.members,
      a.hullBase,
      a.hullEnd,
    ]),
    [
      ["region", "mram_main", ["alp_rpmsg"], 0x80540000, 0x80580000],
      // Device-relative members contribute no absolute hull, by design.
      ["device", "storage", ["data"], null, null],
    ],
  );
});
