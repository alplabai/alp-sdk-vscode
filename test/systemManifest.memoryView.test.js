// SPDX-License-Identifier: Apache-2.0
//
// What the manifest pins in the address space, and what it must refuse to pin
// (#484).
//
// The fixture is a real `build/system-manifest.yaml`, emitted live from
// `examples/alp-sample` against alp-sdk `v0.16.0-rc1` — an E1M-AEN801 project
// with two rpmsg channels and one storage partition, none of which resolve.
// Its reason strings are verbatim, because they are what the view prints.
//
// The drop cases are the point of the module. Every one of them is a value
// that a cast would let through as an address, and a wrong address is the
// thing this whole feature exists to prevent.

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  buildMemoryView,
} = require("../packages/alp-core/dist/systemManifest/memoryView.js");

/** Verbatim from the emitted manifest — both channels carry this same text. */
const TBD_REASON =
  "memory_map.base is TBD for region 'mram_main' in SoM E1M-AEN801; this SoM " +
  "hasn't been HW-mapped yet so IPC carve-outs cannot be allocated.  Add a " +
  "`memory_map:` block to metadata/e1m_modules/E1M-AEN801.yaml (or per-region " +
  "`base`) or remove the matching ipc entry from board.yaml.";

const NO_DEVICE_REASON =
  "storage entry 'data' has no flash_device: declared; add one referencing a " +
  "SoM memory_map region or an on_module.ospi_memories key";

/** The emitted manifest for examples/alp-sample, trimmed to the blocks this
 *  module reads. Addresses are quoted exactly as the emitter writes them. */
function sampleManifest() {
  return {
    schema_version: 1,
    generated_by: "scripts/alp_orchestrate.py",
    hw_info: { sku: "E1M-AEN801", silicon: "alif:ensemble:e8" },
    slices: [
      {
        core_id: "a32_cluster",
        os: "yocto",
        status: "pending",
        flash_method: "yocto_wic_to_sd_or_emmc",
        flash_args: { target: "e1m-aen801-a32" },
      },
      {
        core_id: "m55_hp",
        os: "zephyr",
        status: "pending",
        flash_method: "zephyr_west_flash",
        flash_args: {
          jlink_flash_device: "AE822FA0E5597LS0_M55_HE",
          expect_dpidr: "0x4C013477",
          jlink_device: "Cortex-M55",
          slot0_load_address: "0x802b0000",
        },
      },
      {
        core_id: "m55_he",
        os: "zephyr",
        status: "pending",
        flash_method: "zephyr_west_flash",
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

test("pins the load address of every active Zephyr slice", () => {
  // Arrange
  const manifest = sampleManifest();

  // Act
  const view = buildMemoryView(manifest);

  // Assert
  assert.equal(view.sku, "E1M-AEN801");
  const slots = view.spans.filter((s) => s.kind === "slot_image");
  assert.deepEqual(
    slots.map((s) => [s.label, s.base]),
    [
      ["m55_he", 0x80010000],
      ["m55_hp", 0x802b0000],
    ],
    "both slots placed, ascending by address",
  );
  // The slot's capacity is a SoM budget the manifest does not carry; reporting
  // it as 0 would read as "no room left".
  assert.equal(slots[0].sizeBytes, null);
});

test("reports every blocked entry with its reason verbatim", () => {
  const view = buildMemoryView(sampleManifest());

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

test("drops a load address on a core that builds nothing", () => {
  const manifest = sampleManifest();
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
  const manifest = sampleManifest();
  // A bare decimal in a field of hex is likelier a mistake than a base-10
  // address, and 0x802b0000 read as decimal is a different part of memory.
  manifest.slices[1].flash_args.slot0_load_address = "2149253120";
  manifest.slices[2].flash_args.slot0_load_address = { addr: "0x80010000" };

  const view = buildMemoryView(manifest);

  assert.equal(view.spans.filter((s) => s.kind === "slot_image").length, 0);
});

test("refuses an address too large to survive a JS number", () => {
  const manifest = sampleManifest();
  manifest.slices[1].flash_args.slot0_load_address = "0xFFFFFFFFFFFFFFFF";

  const view = buildMemoryView(manifest);

  assert.equal(
    view.spans.some((s) => s.label === "m55_hp"),
    false,
    "a base that cannot round-trip is worse than an absent one",
  );
});

test("places a carve-out once the resolver gives it a base and a size", () => {
  const manifest = sampleManifest();
  manifest.ipc[1] = {
    name: "alp_rpmsg",
    kind: "rpmsg",
    endpoints: ["m55_hp", "m55_he"],
    status: "ok",
    base: 0x80540000,
    size: 262144,
    region: "mram_main",
    cacheable: false,
  };

  const view = buildMemoryView(manifest);
  const carve = view.spans.find((s) => s.kind === "carve_out");

  assert.deepEqual(
    {
      base: carve.base,
      sizeBytes: carve.sizeBytes,
      region: carve.region,
      cores: carve.cores,
    },
    {
      base: 0x80540000,
      sizeBytes: 262144,
      region: "mram_main",
      cores: ["m55_hp", "m55_he"],
    },
  );
  assert.equal(
    view.unresolved.some((u) => u.label === "alp_rpmsg"),
    false,
  );
});

test("keeps a degraded link off the map even when it carries an extent", () => {
  const manifest = sampleManifest();
  manifest.ipc[0] = {
    name: "alp_default_rpmsg",
    kind: "rpmsg",
    endpoints: ["m55_hp", "a32_cluster"],
    status: "blocked",
    base: 0,
    size: 0,
    region: "",
    reason: TBD_REASON,
  };

  const view = buildMemoryView(manifest);

  assert.equal(
    view.spans.some((s) => s.label === "alp_default_rpmsg"),
    false,
    "base 0 / size 0 is the blocked projection, not an allocation at 0x0",
  );
  assert.equal(view.unresolved[0].reason, TBD_REASON);
});

test("reports a link that claims ok but pins nothing, keeping its own word", () => {
  const manifest = sampleManifest();
  manifest.ipc = [
    {
      name: "alp_rpmsg",
      kind: "rpmsg",
      endpoints: ["m55_hp", "m55_he"],
      status: "ok",
    },
  ];

  const view = buildMemoryView(manifest);

  assert.deepEqual(
    view.unresolved
      .filter((u) => u.kind === "carve_out")
      .map((u) => [u.label, u.status, u.reason]),
    [["alp_rpmsg", "ok", null]],
    "the picture cannot place it; the status stays the emitter's word",
  );
});

test("keeps a resolved partition device-relative, never absolute", () => {
  const manifest = sampleManifest();
  manifest.storage = [
    {
      name: "data",
      fs: "littlefs",
      flash_device: "mram_main",
      dt_label: "storage_partition",
      base_kib: 0,
      size_kib: 64,
      mount: "/lfs",
      status: "ok",
    },
  ];

  const view = buildMemoryView(manifest);
  const part = view.spans.find((s) => s.kind === "partition");

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
      device: "mram_main",
      fs: "littlefs",
    },
    "the device's own base is in the region table this contract lacks",
  );
});

test("drops storage rows that are not partitions at all", () => {
  const manifest = sampleManifest();
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

test("tolerates a manifest whose optional blocks are absent", () => {
  const view = buildMemoryView({
    schema_version: 1,
    generated_by: "",
    hw_info: { sku: "E1M-AEN801" },
    slices: [],
    ipc: [],
    helper_mcus: [],
    boot_order: [],
  });

  assert.deepEqual(view, { sku: "E1M-AEN801", spans: [], unresolved: [] });
});

test("orders the map by address, with the device-relative extents last", () => {
  const manifest = sampleManifest();
  manifest.ipc = [
    {
      name: "late",
      kind: "raw_shmem",
      endpoints: ["m55_hp", "m55_he"],
      status: "ok",
      base: 0x80570000,
      size: 4096,
      region: "mram_main",
    },
  ];
  manifest.storage = [
    {
      name: "data",
      fs: "raw",
      flash_device: "mram_main",
      base_kib: 0,
      size_kib: 64,
    },
  ];

  const view = buildMemoryView(manifest);

  assert.deepEqual(
    view.spans.map((s) => s.label),
    ["m55_he", "m55_hp", "late", "data"],
  );
});
