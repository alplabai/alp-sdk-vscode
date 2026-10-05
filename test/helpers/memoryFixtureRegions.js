// SPDX-License-Identifier: Apache-2.0
//
// The resolved SoM region tables of the two memory fixtures, as the
// webview's `MemoryRegion` shape — values copied digit for digit from
// test/fixtures/system-manifest.rpmsg-{aen,v2n}.memory.yaml (`memory:`),
// so the rail/window/format tests run on real firmware numbers rather than
// invented ones. `test/systemManifest.memoryView.test.js` covers the YAML ->
// MemoryView conversion itself.

/** A minimal, fully-resolved `MemoryRegion`. */
function region(
  name,
  base,
  sizeBytes,
  authorityClass,
  { source = "som_preset", kind = "flash" } = {},
) {
  return {
    id: `memory:${name}`,
    name,
    source,
    kind,
    status: "ok",
    base,
    sizeBytes,
    writeAuthority: null,
    authorityClass,
    cores: [],
    reason: null,
  };
}

/** rpmsg-aen: six regions tiling 0x80000000 – 0x8057ffff. */
const AEN_REGIONS = [
  region("mcuboot", 2147483648, 65536, "vendor_image"), // 0x80000000, 64 KiB
  region("he_slot0", 2147549184, 2752512, "customer_image"), // 0x80010000
  region("hp_slot0", 2150301696, 2752512, "customer_image"), // 0x802b0000
  region("reserved", 2153054208, 65536, "none"), // 0x80550000
  region("storage", 2153119744, 98304, "customer_runtime"), // 0x80560000
  region("atoc", 2153218048, 32768, "secure_enclave"), // 0x80578000, 32 KiB
];

/** rpmsg-v2n: ddr_main (4 GiB) CONTAINS m33_tcm; ocram_low sits far below.
 *  All three are `source: soc_derived`, `kind: unresolved` in the fixture. */
const V2N = { source: "soc_derived", kind: "unresolved" };
const V2N_REGIONS = [
  region("ddr_main", 1207959552, 4294967296, "unstated", V2N), // 0x48000000, 4 GiB
  region("ocram_low", 65536, 524288, "unstated", V2N), // 0x00010000, 512 KiB
  region("m33_tcm", 2147483648, 131072, "unstated", V2N), // 0x80000000, 128 KiB
];

/** A minimal `MemorySpan`. */
function span(overrides) {
  return {
    id: `slot_image:${overrides.label}`,
    kind: "slot_image",
    label: overrides.label,
    base: null,
    deviceOffset: null,
    sizeBytes: null,
    region: null,
    device: null,
    cores: [],
    fs: null,
    ...overrides,
  };
}

module.exports = { AEN_REGIONS, V2N_REGIONS, region, span };
